// ═══════════════════════════════════════════════════════════════
// opsMaterialPickerData — 选择素材弹窗数据层（运营工具 · 图库选图）
// 2026-11-07 用户裁决（产品资料六视图「搜索图库」·方案1）：弹窗自媒体包
// WbPickMaterialDialog 一比一移植（OtPickMaterialDialog），本文件随迁其数据层
// ——ops-bundle 是独立包不依赖 media-bundle，公共组件各包持副本是既有先例
// （TButton 两包字节相同）；与 media-bundle 原件逐函数同语义，仅模块归属不同。
// 服务端契约（API-GUIDE 已核实，响应为自由格式 → pickListItems
// 容错解析 {items}|{data}|{results}|裸数组）：
//   · GET  /material/list?search=&brand=&model=&media_type=&purpose=  图视网格
//     （缩略图/预览走 /material/thumbnail、/material/serve，无鉴权流式端点）
//   · GET  /material/distinct?field=            品牌/型号/分类过滤候选
//   · GET  /audio/library?keyword=&category=    音频库（播放走
//     /audio/library/{audio_id}/file；分类候选 GET /audio/categories）
// HTTP 全部经主进程通用 server:get IPC（离线 null / 5xx 抛错），本层只做调用
// 编排与异常文案映射，组件零 URL 拼装（IRON-06）。
// ═══════════════════════════════════════════════════════════════

import { getTintin } from './useSettingsConfig'

export type PickerItem = Record<string, unknown>

/* ── 容错解析（media-bundle workbenchChatContext 同函数副本）────────── */

/**
 * 搜索弹窗列表容错解析：兼容 {items}|{data}|{results}|裸数组；
 * 异常/字段缺失 → []（调用方按空结果提示）。
 */
export function pickListItems(data: unknown): Record<string, unknown>[] {
  let arr: unknown = data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>
    arr = d.items ?? d.data ?? d.results ?? []
  }
  if (!Array.isArray(arr)) return []
  return arr.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[]
}

/**
 * 分页 total 容错解析：{total}|{total_count}|{count}；无分页字段 → -1
 * （调用方退化为单页，不显示分页器）。
 */
export function pickListTotal(data: unknown): number {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>
    for (const k of ['total', 'total_count', 'count'] as const) {
      const n = Number(d[k])
      if (Number.isFinite(n) && n >= 0) return n
    }
  }
  return -1
}

/**
 * /material/distinct 响应容错解析：{values:[...]}（字符串或 {name}/{value}
 * 对象条目）兼容裸数组；去空/去重/剔除 null，保持服务端顺序。
 */
export function pickDistinctValues(data: unknown): string[] {
  let arr: unknown = data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    arr = (data as Record<string, unknown>).values ?? []
  }
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  for (const x of arr) {
    if (x === null || x === undefined) continue
    const raw =
      typeof x === 'string'
        ? x
        : x && typeof x === 'object'
          ? (x as Record<string, unknown>).name ?? (x as Record<string, unknown>).value
          : x // 数字等原始值直接转字符串
    const v = String(raw ?? '').trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

/** 搜索异常分支文案：null=网络离线；Error('HTTP 5xx')=服务端错误 */
export function searchErrorText(err: unknown): string {
  if (err === null || err === undefined) {
    return '网络异常：无法连接服务端，请检查「设置 → 服务端」的地址与网络后重试。'
  }
  const msg = (err as Error)?.message || String(err)
  return `搜索失败：${msg}`
}

/* ── 媒体预览 URL（无鉴权流式端点，<img>/<video>/<audio> 直接加载）────── */

/** 服务端相对根拼接：去尾斜杠；serverUrl 为空（未连通）→ 空串（预览区显示占位） */
function mediaBaseUrl(serverUrl: string): string {
  return String(serverUrl || '').trim().replace(/\/$/, '')
}

/** 素材原文件流（GET /material/serve?material_id=，视频预览/图片预览共用） */
export function buildMediaServeUrl(serverUrl: string, materialId: string | number): string {
  const base = mediaBaseUrl(serverUrl)
  const mid = String(materialId ?? '').trim()
  return base && mid ? `${base}/material/serve?material_id=${encodeURIComponent(mid)}` : ''
}

/** 素材缩略图（GET /material/thumbnail?material_id=，卡片网格用） */
export function buildMediaThumbUrl(serverUrl: string, materialId: string | number): string {
  const base = mediaBaseUrl(serverUrl)
  const mid = String(materialId ?? '').trim()
  return base && mid ? `${base}/material/thumbnail?material_id=${encodeURIComponent(mid)}` : ''
}

/** 音频库文件流（GET /audio/library/{audio_id}/file，底部播放条用） */
export function buildAudioFileUrl(serverUrl: string, audioId: string | number): string {
  const base = mediaBaseUrl(serverUrl)
  const aid = String(audioId ?? '').trim()
  return base && aid ? `${base}/audio/library/${encodeURIComponent(aid)}/file` : ''
}

/** media_type → 中文标签（原版 _MEDIA_TYPE_LABEL 口径，未知回退「素材」） */
export function mediaTypeLabel(t: string): string {
  const labels: Record<string, string> = { image: '图片', video: '视频', audio: '音频', document: '文档' }
  return labels[String(t || '').toLowerCase()] || '素材'
}

/* ── 搜索 fetcher（组件只消费，不感知 URL）────────────────────── */

/** 单次搜索调用的统一封装：离线/5xx/{error} → Error(用户可读文案)，返回原始 payload */
async function fetchJsonPayload(call: () => Promise<unknown>): Promise<unknown> {
  let data: unknown
  try {
    data = await call()
  } catch (e) {
    throw new Error(searchErrorText(e))
  }
  if (data === null || data === undefined) {
    throw new Error(searchErrorText(null)) // 离线静默 null
  }
  if (typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const msg = String((data as Record<string, unknown>).error || '')
    if (msg) throw new Error(searchErrorText(new Error(msg)))
  }
  return data
}

/** payload → 列表（pickListItems 容错解析 {items}|{data}|{results}|裸数组） */
async function fetchJsonList(call: () => Promise<unknown>): Promise<PickerItem[]> {
  return pickListItems(await fetchJsonPayload(call))
}

/** 图视网格检索：GET /material/list（品牌/型号/分类/类型过滤 + 分页，原版素材检索
 *  vector_search/page.py 口径；空媒体类型=全部）；返回 items + total
 *  （total 缺失 → -1，调用方退化为单页不分页） */
export async function fetchMaterialGrid(p: {
  search?: string
  brand?: string
  model?: string
  category?: string
  mediaType?: string
  page?: number
  size?: number
  /** 服务端产品图模式（opt-in，/material/list 与 /material/search 同语义）：
   *  底型白名单 white/solid/transparent+强制 media_type=image+宽高比闸 0.4~2.6+
   *  白底→透明底→其余排序；缺省=不带，行为与旧版逐字节一致 */
  purpose?: string
}): Promise<{ items: PickerItem[]; total: number }> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  const q: Record<string, unknown> = {
    page: Math.max(1, Number(p.page) || 1),
    size: Math.max(1, Number(p.size) || 60),
  }
  if (String(p.search || '').trim()) q.search = String(p.search).trim()
  if (String(p.brand || '').trim()) q.brand = String(p.brand).trim()
  if (String(p.model || '').trim()) q.model = String(p.model).trim()
  if (String(p.category || '').trim()) q.category = String(p.category).trim()
  if (String(p.mediaType || '').trim()) q.media_type = String(p.mediaType).trim()
  if (String(p.purpose || '').trim()) q.purpose = String(p.purpose).trim()
  const data = await fetchJsonPayload(() => t.server.get('/material/list', q))
  return { items: pickListItems(data), total: pickListTotal(data) }
}

/** 素材字段候选值：GET /material/distinct?field=brand|model|category（失败回退
 *  空数组——候选缺失不阻塞弹窗，仍可手输过滤） */
export async function fetchMaterialDistinct(field: 'brand' | 'model' | 'category'): Promise<string[]> {
  const t = getTintin()
  if (!t?.server) return []
  try {
    return pickDistinctValues(await t.server.get('/material/distinct', { field }))
  } catch (_) {
    return []
  }
}

/** 音频库检索：GET /audio/library（keyword + category 过滤，契约已核实） */
export async function fetchAudioLibrary(p: { keyword?: string; category?: string }): Promise<PickerItem[]> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  const q: Record<string, unknown> = { page: 1, size: 60 }
  if (String(p.keyword || '').trim()) q.keyword = String(p.keyword).trim()
  if (String(p.category || '').trim()) q.category = String(p.category).trim()
  return fetchJsonList(() => t.server.get('/audio/library', q))
}

/** 音频分类候选：GET /audio/categories（失败回退空 → 分类下拉仅「全部分类」） */
export async function fetchAudioCategories(): Promise<string[]> {
  const t = getTintin()
  if (!t?.server) return []
  try {
    const d = await t.server.get('/audio/categories')
    const arr = Array.isArray(d) ? d : ((d as { categories?: unknown[]; items?: unknown[] } | null)?.categories ?? (d as { items?: unknown[] } | null)?.items ?? [])
    return (Array.isArray(arr) ? arr : [])
      .map((x: unknown) =>
        typeof x === 'string' ? x : String((x as Record<string, unknown>)?.category ?? (x as Record<string, unknown>)?.name ?? '')
      )
      .filter(Boolean)
  } catch (_) {
    return []
  }
}
