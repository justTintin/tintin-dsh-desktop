// ═══════════════════════════════════════════════════════════════
// workbenchChatContext.ts — 媒体预览 URL / 弹窗列表容错解析·纯函数逻辑层
// （无 vue 依赖，可单测）
// 历史：原为工作台 AI 对话纯函数层（智能体快捷条/斜杠菜单/上下文编组，
// 对照原客户端 gui/agent_home_page.py）。服务端 /agent/* 编排于 2026-09-25
// 退役，对话族连同其消费方一并移除；本文件仅保留选择弹窗仍在消费的
// 容错解析与媒体预览 URL 工具（useWorkbenchPickers / CopywritingStep2Panel）。
// ═══════════════════════════════════════════════════════════════

/* ── 媒体预览 URL（「选择素材」弹窗预览；无鉴权流式端点，<img>/<video>/<audio> 直接加载） ── */

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

/* ── 弹窗列表容错解析（服务端自由格式响应） ─────────────────── */

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
