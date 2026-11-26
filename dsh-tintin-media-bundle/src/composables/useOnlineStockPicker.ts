// useOnlineStockPicker — 在线搜索 tab 的列表/勾选/分页状态与动作。
// 与 useOnlineStock（纯搜索+归一化）配对：本文件只持 UI 状态，供素材库与混剪共用。
import { computed, ref } from 'vue'
import { searchOnlineStock, onlineKey, onlineServerPath, onlineToClipUrl, ONLINE_STOCK_PER, type OnlineItem } from './useOnlineStock'
import { errText } from './copywritingMontage/context'
import type { SplitSceneRow } from './copywritingMontageStep1SplitLogic'

export function useOnlineStockPicker() {
  const oKw = ref('')
  const oKind = ref<'video' | 'image'>('video')
  const oItems = ref<OnlineItem[]>([])
  const oLoading = ref(false)
  const oError = ref('')
  const oMsg = ref('')
  const oPage = ref(1)
  const oHasMore = ref(false)
  const oSelected = ref(new Map<string, OnlineItem>())
  const oThumbFailed = ref<Record<string, boolean>>({})
  const oSelectedCount = computed(() => oSelected.value.size)

  function oToggle(it: OnlineItem): void {
    const k = onlineKey(it)
    const next = new Map(oSelected.value)
    if (next.has(k)) next.delete(k); else next.set(k, it)
    oSelected.value = next
  }
  function oSelectPageAll(): void {
    const next = new Map(oSelected.value)
    for (const it of oItems.value) next.set(onlineKey(it), it)
    oSelected.value = next
  }
  function oClearSelection(): void { oSelected.value = new Map() }

  async function runOnline(p = 1): Promise<void> {
    const q = oKw.value.trim()
    if (!q) { oError.value = '请输入搜索关键词（支持中文）'; return }
    oLoading.value = true
    oError.value = ''
    try {
      const out = await searchOnlineStock(q, oKind.value, p)
      oItems.value = out.items
      oPage.value = p
      oHasMore.value = out.items.length >= ONLINE_STOCK_PER
      if (p > 1 && !out.items.length) oPage.value = p - 1
    } catch (e) {
      oItems.value = []
      oError.value = errText(e)
    } finally { oLoading.value = false }
  }

  return {
    oKw, oKind, oItems, oLoading, oError, oMsg, oPage, oHasMore,
    oSelected, oThumbFailed, oSelectedCount, oToggle, oSelectPageAll, oClearSelection, runOnline,
  }
}

/** 在线素材 → 选择池行。clipUrl=外链（合成阶段按需下载）；serverPath 用 stock:
 *  前缀保持稳定唯一且不伪装 material://。 */
export function addOnlineToPool(
  picked: OnlineItem[], scenes: SplitSceneRow[], imageDuration: number,
): { added: number; skipped: number } {
  const existing = new Set(scenes.map((s) => s.serverPath))
  let nextIdx = scenes.reduce((m, s) => Math.max(m, s.idx), 0)
  let added = 0
  let skipped = 0
  for (const it of picked) {
    const dur = Number(it.duration_sec) > 0 ? Number(it.duration_sec) : imageDuration || 0
    const sp = onlineServerPath(it)
    const clipUrl = onlineToClipUrl(it)
    if (!sp || !clipUrl || dur <= 0 || existing.has(sp)) { skipped++; continue }
    nextIdx++
    const base = String(it.author || it.provider || '在线素材')
    const name = `${base} · ${String(it.id || '').split(/[?&#/]/).filter(Boolean).pop() || onlineKey(it).slice(-8)}`
    const desc = [base, String(it.provider || '')].filter(Boolean).join(' · ')
    scenes.push({
      idx: nextIdx, name, sourceName: name, startSec: 0, endSec: dur, duration: dur,
      description: desc, analysis: desc, clipUrl, serverPath: sp,
      downloadState: 'pending', checked: true,
      mediaType: it.type === 'image' ? 'image' : 'video',
      resolution: it.width && it.height ? `${Number(it.width)}x${Number(it.height)}` : undefined,
    })
    existing.add(sp)
    added++
  }
  return { added, skipped }
}
