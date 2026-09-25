// ═══════════════════════════════════════════════════════════════
// useTaskContext.ts — 会话上下文条·状态与 task.json 注入编排（WP-5b）
// 2026-09-25 用户裁决：不改 dsh 底层，业务上下文经 UI 层注入——选中条目
// 防抖写入工作区 task.json（context:writeTask 宿主通道），agent 经自带
// read 工具读取（V10 实证路径可读写）。
// 状态为模块级单例：accessory slot 挂载点随会话切换重建（scope: session），
// 而业务上下文是工作区全局语义（与 task.json 文件同界），故状态常驻、
// 不随会话销毁。选中口径对照源 useWorkbenchChat.addCtx*（L195-256）：
// 产品单选覆盖；素材按 materialKeyOf 去重；脚本按 id 去重；音频信息胶囊。
// ═══════════════════════════════════════════════════════════════
import { ref } from 'vue'
import {
  buildTaskContext,
  materialKeyOf,
  type CtxAudioItem,
  type CtxMaterialItem,
  type CtxProductItem,
  type CtxScriptItem,
} from './contextTaskLogic'
import type { PickerItem } from './useWorkbenchPickers'

const product = ref<CtxProductItem | null>(null)
const materials = ref<CtxMaterialItem[]>([])
const scripts = ref<CtxScriptItem[]>([])
const audios = ref<CtxAudioItem[]>([])

/** task.json 同步状态（防抖写入的 UI 反馈） */
export type TaskSyncState = 'idle' | 'saving' | 'saved' | 'error'
const syncState = ref<TaskSyncState>('idle')
const syncError = ref('')
const savedAt = ref('')

let writeTimer: ReturnType<typeof setTimeout> | null = null
const WRITE_DEBOUNCE_MS = 400

/** 防抖写入：条目变化即调度；写入载荷由 buildTaskContext 编组（含 contextText） */
function scheduleWrite(): void {
  syncState.value = 'saving'
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(async () => {
    writeTimer = null
    try {
      const task = buildTaskContext({
        product: product.value,
        materials: materials.value,
        scripts: scripts.value,
        audios: audios.value,
      })
      const r = await window.tintin?.context?.writeTask(task)
      if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(String(r.error))
      if (!r || typeof r !== 'object' || !('ok' in r) || !r.ok) throw new Error('宿主未确认写入')
      syncState.value = 'saved'
      syncError.value = ''
      savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    } catch (e) {
      syncState.value = 'error'
      syncError.value = e instanceof Error ? e.message : String(e)
    }
  }, WRITE_DEBOUNCE_MS)
}

/* ── 选中口径（源 useWorkbenchChat.addCtx* 移植） ── */

/** 产品：单选覆盖（原版 addCtxProduct L201-204） */
export function addCtxProduct(it: PickerItem): void {
  product.value = (it ?? {}) as CtxProductItem
  scheduleWrite()
}

/** 素材：按 id/material_id 去重追加（原版 addCtxMaterial L228-240） */
export function addCtxMaterial(it: PickerItem): void {
  const m = (it ?? {}) as CtxMaterialItem
  const key = materialKeyOf(m)
  if (!key) return
  if (!materials.value.some((x) => materialKeyOf(x) === key)) materials.value.push(m)
  scheduleWrite()
}

/** 脚本：按 id 去重追加（原版 addCtxScript L212-216） */
export function addCtxScript(it: PickerItem): void {
  const s = (it ?? {}) as CtxScriptItem
  const id = String(s?.id ?? '').trim()
  if (!id) return
  if (!scripts.value.some((x) => String(x?.id ?? '').trim() === id)) scripts.value.push(s)
  scheduleWrite()
}

/** 参考音频：信息胶囊（原版 addCtxAudio L246-256，infoOnly 不入素材池语义） */
export function addCtxAudio(it: PickerItem): void {
  const a = (it ?? {}) as CtxAudioItem
  const key = String(a?.audio_id ?? a?.id ?? a?.filename ?? '')
  if (!key) return
  if (!audios.value.some((x) => String(x?.audio_id ?? x?.id ?? x?.filename ?? '') === key)) audios.value.push(a)
  scheduleWrite()
}

export function removeProduct(): void {
  product.value = null
  scheduleWrite()
}

export function removeMaterial(key: string): void {
  materials.value = materials.value.filter((x) => materialKeyOf(x) !== key)
  scheduleWrite()
}

export function removeScript(id: string): void {
  scripts.value = scripts.value.filter((x) => String(x?.id ?? '').trim() !== id)
  scheduleWrite()
}

export function removeAudio(key: string): void {
  audios.value = audios.value.filter((x) => String(x?.audio_id ?? x?.id ?? x?.filename ?? '') !== key)
  scheduleWrite()
}

export function clearAll(): void {
  product.value = null
  materials.value = []
  scripts.value = []
  audios.value = []
  scheduleWrite()
}

/** 单例状态读取（ContextBar 渲染用；写入即副作用，无需 watch） */
export function useTaskContextState() {
  return { product, materials, scripts, audios, syncState, syncError, savedAt }
}
