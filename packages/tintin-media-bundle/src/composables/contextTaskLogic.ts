// ═══════════════════════════════════════════════════════════════
// contextTaskLogic.ts — 会话上下文注入·纯函数逻辑层（无 vue 依赖，可单测）
// 2026-09-25 WP-5b（用户裁决：不改 dsh 底层，上下文经 UI 层注入——
// 主通道 = 工作区 task.json（agent 用自带 fs 工具读取），辅通道 = 随
// task.json 携带的 contextText 现成文本块）。
//
// 摘要函数（productSummary/materialSummary/scriptSummary/mediaTypeLabel/
// productLabel/materialLabel/scriptLabel/audioSummary）自源项目
// workbenchChatContext.ts 原样复活（2026-09-25 上午随 /agent/* 退役清理移除，
// 本工作包为其唯一新消费方；口径对照原客户端 gui/agent_home_page.py）。
//
// 与源实现的差异（有意，登记如下）：
//   · buildContextText 不再区分 poolMode/附件素材池——服务端会话素材池随
//     /agent/* 退役；本模型 materials 一律拼入文本与 task.json 结构体。
//   · 附件（ChatAttachment）机制不复活：文件级上下文后续走 agent 原生
//     附件能力，不在本层。
// ═══════════════════════════════════════════════════════════════

/* ── 上下文条目类型（源 workbenchChatContext.ts L177-204 原样） ── */

export interface CtxProductItem {
  id?: string
  category?: string
  brand?: string
  model?: string
  goods_no?: string
  features?: string
  selling_points?: string
}

export interface CtxMaterialItem {
  id?: string | number
  material_id?: string | number
  filename?: string
  media_type?: string
  brand?: string
  model?: string
  category?: string
  path?: string
}

export interface CtxScriptItem {
  id?: string | number
  topic?: string
  shot_count?: number
  ratio?: string
  saved_at?: string
}

/** 参考音频条目（源「选择素材」弹窗音频 tab，infoOnly 信息胶囊） */
export type CtxAudioItem = Record<string, unknown>

const MEDIA_TYPE_LABEL: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  document: '文档'
}

/** media_type → 中文标签（原版 _MEDIA_TYPE_LABEL L64，未知回退「素材」） */
export function mediaTypeLabel(t: string): string {
  return MEDIA_TYPE_LABEL[String(t || '').toLowerCase()] || '素材'
}

/** 产品上下文文本：品牌/型号/品类/货号 + 性能 + 卖点（原版 L1320-1334） */
export function productSummary(item: CtxProductItem): string {
  const lines: string[] = []
  for (const [key, label] of [
    ['brand', '品牌'],
    ['model', '型号'],
    ['category', '品类'],
    ['goods_no', '货号']
  ] as const) {
    const val = String((item as Record<string, unknown>)?.[key] || '').trim()
    if (val) lines.push(`${label}:${val}`)
  }
  const feat = String(item?.features || '').trim()
  const sell = String(item?.selling_points || '').trim()
  if (feat) lines.push(`性能:${feat.slice(0, 300)}`)
  if (sell) lines.push(`卖点:${sell.slice(0, 300)}`)
  return lines.join('\n')
}

/** 素材上下文文本：ID/文件名/类型/品牌型号/路径（原版 L1336-1350） */
export function materialSummary(item: CtxMaterialItem): string {
  const mid = String(item?.id || item?.material_id || '')
  const name = item?.filename || mid || '未命名'
  const lines = [`素材ID:${mid}`, `文件名:${name}`, `类型:${mediaTypeLabel(String(item?.media_type || ''))}`]
  for (const [key, label] of [
    ['brand', '品牌'],
    ['model', '型号'],
    ['category', '分类']
  ] as const) {
    const val = String((item as Record<string, unknown>)?.[key] || '').trim()
    if (val) lines.push(`${label}:${val}`)
  }
  const path = String(item?.path || '').trim()
  if (path) lines.push(`路径:${path}`)
  return lines.join('\n')
}

/** 分镜脚本上下文文本：ID/主题/镜头数/画幅/保存时间（原版 L1352-1366） */
export function scriptSummary(item: CtxScriptItem): string {
  const lines = [`脚本ID:${item?.id || ''}`]
  const topic = String(item?.topic || '').trim()
  if (topic) lines.push(`主题:${topic}`)
  lines.push(`镜头数:${item?.shot_count || 0}`)
  const ratio = String(item?.ratio || '').trim()
  if (ratio) lines.push(`画幅:${ratio}`)
  const saved = String(item?.saved_at || '').trim()
  if (saved) lines.push(`保存时间:${saved}`)
  return lines.join('\n')
}

/** 胶囊展示文案（原版 _rebuild_ctx_bar L1581-1594） */
export function productLabel(item: CtxProductItem): string {
  return `${item?.brand || ''} / ${item?.model || ''}`
}

export function materialLabel(item: CtxMaterialItem): string {
  const mid = String(item?.id || item?.material_id || '')
  const name = item?.filename || mid || '未命名'
  return `[${mediaTypeLabel(String(item?.media_type || ''))}] ${name}`
}

export function scriptLabel(item: CtxScriptItem): string {
  return `[${item?.topic || ''}] ${item?.shot_count || 0}镜`
}

/** 音频上下文文本：文件名/类型/分类/风格/时长（原版 L332-347，字段容错） */
export function audioSummary(item: Record<string, unknown>): string {
  const name = String(item?.filename || item?.title || item?.name || '').trim() || '未命名'
  const lines = [`文件名:${name}`, '类型:音频']
  for (const [key, label] of [
    ['category', '分类'],
    ['genre', '风格'],
    ['emotion', '情绪'],
    ['tags', '标签']
  ] as const) {
    const val = String((item as Record<string, unknown>)?.[key] || '').trim()
    if (val) lines.push(`${label}:${val}`)
  }
  const dur = Number(item?.duration || item?.duration_sec || 0)
  if (dur > 0) lines.push(`时长:${Math.round(dur)}秒`)
  return lines.join('\n')
}

/* ── 上下文文本编组（源 _build_context_text L1733-1751 的适配版） ── */

export interface ContextTextInput {
  product: CtxProductItem | null
  materials: CtxMaterialItem[]
  scripts: CtxScriptItem[]
  audios?: CtxAudioItem[]
}

/**
 * 对话上下文文本：段落间 \n\n。
 * 【产品】+ 逐条【素材】+ 逐条【脚本】+ 逐条【参考音频】；
 * 空输入的段落不产生。与源差异见文件头（poolMode/附件机制不复活）。
 */
export function buildContextText(input: ContextTextInput): string {
  const { product, materials, scripts, audios } = input || {}
  const parts: string[] = []
  if (product) parts.push('【产品】\n' + productSummary(product))
  for (const m of materials || []) parts.push('【素材】\n' + materialSummary(m))
  for (const s of scripts || []) parts.push('【脚本】\n' + scriptSummary(s))
  for (const a of audios || []) parts.push('【参考音频】\n' + audioSummary(a))
  return parts.join('\n\n')
}

/* ── task.json 模型（WP-5b 注入主通道的载体） ── */

/** task.json 结构版本（schema 变更时递增；agent 按 version 容错） */
export const TASK_CONTEXT_VERSION = 1

/** task.json 条目上限（防御失控写入；上下文条场景远用不到） */
export const TASK_CONTEXT_ITEM_CAP = 200

/** 工作区 task.json 载荷：结构化条目 + 现成 contextText 文本块 */
export interface TintinTaskContext {
  version: typeof TASK_CONTEXT_VERSION
  updatedAt: string
  product: CtxProductItem | null
  materials: CtxMaterialItem[]
  scripts: CtxScriptItem[]
  audios: CtxAudioItem[]
  /** 供 agent 直接引用的现成上下文文本（= buildContextText 产物） */
  contextText: string
}

export interface TaskContextInput {
  product?: CtxProductItem | null
  materials?: CtxMaterialItem[]
  scripts?: CtxScriptItem[]
  audios?: CtxAudioItem[]
}

/** 编组 task.json 载荷（contextText 随条目自动生成；时间由调用方传入可测） */
export function buildTaskContext(input: TaskContextInput, now: Date = new Date()): TintinTaskContext {
  const product = input?.product ?? null
  const materials = (input?.materials ?? []).slice(0, TASK_CONTEXT_ITEM_CAP)
  const scripts = (input?.scripts ?? []).slice(0, TASK_CONTEXT_ITEM_CAP)
  const audios = (input?.audios ?? []).slice(0, TASK_CONTEXT_ITEM_CAP)
  return {
    version: TASK_CONTEXT_VERSION,
    updatedAt: now.toISOString(),
    product,
    materials,
    scripts,
    audios,
    contextText: buildContextText({ product, materials, scripts, audios }),
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 宿主侧防御解析（外部输入先视为 unknown）：非法字段回退默认值，
 * 条目超限截断；永不抛出——写入失败要如实报错，解析失败要降级成功。
 */
export function sanitizeTaskContext(raw: unknown): TintinTaskContext {
  const d = isObj(raw) ? raw : {}
  const arr = (v: unknown): Record<string, unknown>[] =>
    (Array.isArray(v) ? v : []).filter(isObj).slice(0, TASK_CONTEXT_ITEM_CAP)
  const product = isObj(d.product) ? (d.product as CtxProductItem) : null
  const materials = arr(d.materials) as CtxMaterialItem[]
  const scripts = arr(d.scripts) as CtxScriptItem[]
  const audios = arr(d.audios)
  return {
    version: TASK_CONTEXT_VERSION,
    updatedAt: typeof d.updatedAt === 'string' && d.updatedAt ? d.updatedAt : new Date().toISOString(),
    product,
    materials,
    scripts,
    audios,
    contextText: buildContextText({ product, materials, scripts, audios }),
  }
}

/** 素材去重键（id ?? material_id；同键覆盖——源 useWorkbenchChat.addCtxMaterial 口径） */
export function materialKeyOf(m: CtxMaterialItem): string {
  return String(m?.id ?? m?.material_id ?? '')
}
