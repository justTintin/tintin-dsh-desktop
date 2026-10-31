// ═══════════════════════════════════════════════════════════════
// creationGenerateLogic — 创作模式·真生成纯函数层（2026-10-30）
//
// 服务端整改对齐（用户裁决 2026-10-30）：图片生成/视频生成创作类型从
// 「LLM 提示词方案」升级为真生成——POST /generate/image|video（prompt
// ≤2000 字 + aspect 可选）→ {task_id, poll} → GET /tasks/unified/{id}
// 轮询（status: running/completed/failed/cancelled + progress + result），
// 取消走 POST /tasks/batch_cancel。实测口径（2026-10-30 live OpenAPI +
// 探针）：参考图字段（images/material_ids）被服务端静默忽略——纯文生；
// 结果从 result.output_url|output_path 取（与宿主 openfilm-tools 的
// tintin_generate_* 同源契约）。
//
// 即梦 CLI 后端（2026-10-25 组件）经 resolveSendRoute 共用类型判定；
// CLI 支持本地参考图（image2image），服务端后端不支持——差异如实呈现，
// 不做静默降级。本模块零 vue/桥依赖（同 creationStudioLogic 分层口径）。
// ═══════════════════════════════════════════════════════════════

import { composeCreationPrompt, type CreationSkill, type CreationSubject } from './creationStudioLogic'
import type { CreationBackendId } from './creationDreaminaLogic'

/** 真生成种类（创作类型字典 image/video 两档；其余类型不出真生成路由） */
export type GenerateKind = 'image' | 'video'

/** 发送路由（即梦双形态口径，2026-10-30 用户纠偏）：**非 Agent 创作类型不使用
 *  技能**——图片/视频生成由类型×后端开关决定路由，技能后端不得劫持；
 *  Agent 模式才走技能自带后端（copy/voiceover），其余=LLM 提示词方案 */
export type CreationSendRoute = 'copy' | 'voiceover' | 'llm' | 'generate' | 'cli' | 'cli-unsupported'

export function resolveSendRoute(p: {
  backend: CreationBackendId
  typeId: string
  skill: CreationSkill | null | undefined
}): CreationSendRoute {
  if (p.typeId !== 'agent') {
    if (p.typeId === 'image' || p.typeId === 'video') {
      return p.backend === 'jimeng-cli' ? 'cli' : 'generate'
    }
    // 即梦 CLI 只提供图片/视频两命令——其余类型显式阻断（不静默回落，用户裁决口径）
    if (p.backend === 'jimeng-cli') return 'cli-unsupported'
    return 'llm'
  }
  if (p.skill?.backend === 'voiceover') return 'voiceover'
  if (p.skill?.backend === 'copy') return 'copy'
  return 'llm'
}

/** 视频生成参数档（服务端 /generate/video 实收 resolution/duration——
 *  宿主 openfilm-tools tintin_generate_video 同源契约；''/0=自动不携带） */
export const GENERATION_RESOLUTIONS = ['', '720p', '1080p'] as const
export const GENERATION_DURATIONS = [0, 5, 10] as const

/** 服务端 generate 请求体：「智能」比例不携带 aspect（交服务端推断——实测
 *  缺省 9:16）；视频档 resolution/duration 仅非空携带；prompt 去首尾空白后
 *  1..2000 硬校验（超限显式报错不静默截断） */
export function buildGenerateBody(p: {
  kind: GenerateKind
  prompt: string
  ratio?: string
  resolution?: string
  durationS?: number
}): { prompt: string; aspect?: string; resolution?: string; duration?: number } {
  const prompt = String(p.prompt ?? '').trim()
  if (!prompt) throw new Error('生成内容为空：先写点画面描述再发送')
  if (prompt.length > 2000) throw new Error(`提示词 ${prompt.length} 字符超出服务端上限 2000，请精简后再发送`)
  const body: { prompt: string; aspect?: string; resolution?: string; duration?: number } = { prompt }
  const ratio = String(p.ratio ?? '').trim()
  if (ratio && ratio !== '智能') body.aspect = ratio
  if (p.kind === 'video') {
    const resolution = String(p.resolution ?? '').trim()
    if (resolution) body.resolution = resolution
    if (Number.isFinite(p.durationS) && (p.durationS as number) > 0) body.duration = Math.round(p.durationS as number)
  }
  return body
}

/** 真生成提示词组包：模板/{{主体}} 组包后剥掉「六视图参考：」行（服务端纯
 *  文生，URL 列表是噪声；产品主体/卖点/参数保留），再走 2000 字硬校验 */
export function buildGenerationPrompt(p: {
  skill?: CreationSkill | null
  input: string
  subjects?: readonly CreationSubject[]
}): string {
  const composed = composeCreationPrompt({ skill: p.skill ?? null, input: p.input, subjects: p.subjects ?? [] })
  const cleaned = composed
    .split(/\r?\n/u)
    .filter((line) => !/^六视图参考[:：]/u.test(line.trim()))
    .join('\n')
    .trim()
  if (!cleaned) throw new Error('生成内容为空：先写点画面描述再发送')
  if (cleaned.length > 2000) throw new Error(`提示词 ${cleaned.length} 字符超出服务端上限 2000，请精简输入或去掉技能模板后再发送`)
  return cleaned
}

export type UnifiedPhase = 'active' | 'completed' | 'failed' | 'cancelled'

/** /tasks/unified status → 归一（2026-10-30 实测枚举 running/completed/failed/
 *  cancelled；未知字符串按进行中处理——不把看不懂的状态误判成失败） */
export function unifiedPhase(status: unknown): UnifiedPhase {
  const s = String(status ?? '').toLowerCase()
  if (s === 'completed' || s === 'success' || s === 'succeeded') return 'completed'
  if (s === 'failed' || s === 'error') return 'failed'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  return 'active'
}

/** 进行中任务的状态行文案（终态出空串，终态文案由卡片自身状态承担） */
export function unifiedProgressLabel(status: unknown, progress: unknown): string {
  if (unifiedPhase(status) !== 'active') return ''
  const n = Number(progress)
  return Number.isFinite(n) && n > 0 ? `生成中 ${Math.round(n)}%` : '排队中…'
}

export interface GenerateResultMedia {
  urls: string[]
  engine?: string
  jobId?: string
  width?: number
  height?: number
  durationSec?: number
  seedUsed?: number
}

/** unified result → 媒体地址与引擎元数据（output_url 主形态；string/数组/
 *  files 列表防御解析——服务端无历史样本可对照，宽口径不漏产物） */
export function parseGenerateResult(result: unknown): GenerateResultMedia {
  const out: GenerateResultMedia = { urls: [] }
  const push = (v: unknown): void => {
    const s = String(v ?? '').trim()
    if (s && !out.urls.includes(s)) out.urls.push(s)
  }
  if (typeof result === 'string') {
    push(result)
    return out
  }
  if (Array.isArray(result)) {
    result.forEach(push)
    return out
  }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    push(r.output_url)
    push(r.output_path)
    push(r.url)
    push(r.path)
    if (Array.isArray(r.files)) {
      for (const f of r.files) {
        push(f && typeof f === 'object' ? (f as Record<string, unknown>).url ?? (f as Record<string, unknown>).path : f)
      }
    }
    const engine = String(r.engine ?? '').trim()
    if (engine) out.engine = engine
    const jobId = String(r.job_id ?? '').trim()
    if (jobId) out.jobId = jobId
    const width = Number(r.width)
    if (Number.isFinite(width) && width > 0) out.width = width
    const height = Number(r.height)
    if (Number.isFinite(height) && height > 0) out.height = height
    const durationSec = Number(r.duration_sec)
    if (Number.isFinite(durationSec) && durationSec > 0) out.durationSec = durationSec
    if (r.seed_used !== undefined && Number.isFinite(Number(r.seed_used))) out.seedUsed = Number(r.seed_used)
  }
  return out
}

/** 生成结果 → 历史/预览摘要（URL 逐行 + 引擎注记；无产物给可复查行） */
export function generateResultSummary(p: { media: GenerateResultMedia; taskId: string }): string {
  const lines: string[] = [...p.media.urls]
  if (!lines.length) lines.push('（任务完成，服务端未返回产物地址——可按任务号向服务端复查）')
  const meta = [
    p.media.engine ? `引擎 ${p.media.engine}` : '',
    p.media.jobId ? `job ${p.media.jobId}` : '',
    `任务 ${p.taskId}`,
  ].filter(Boolean).join(' · ')
  lines.push(`— ${meta}`)
  return lines.join('\n')
}

/** 服务端 error 常是整段 traceback——只留首行+末行并截断（卡片/历史同用） */
export function truncateServerError(raw: unknown, max = 300): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const lines = text.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean)
  const head = lines[0] ?? ''
  const tail = lines.length > 1 ? lines[lines.length - 1] ?? '' : ''
  const joined = tail && tail !== head ? `${head}\n…\n${tail}` : head
  return joined.length > max ? `${joined.slice(0, max)}…` : joined
}

/** 轮询预算（毫秒）：与宿主 openfilm-tools tintin_generate_* 同口径——
 *  图 900s / 视频 1800s；超时不判失败，给「按任务号复查」出口 */
export function generatePollBudget(kind: GenerateKind): number {
  return kind === 'image' ? 15 * 60 * 1000 : 30 * 60 * 1000
}

/** 相对产物地址 → 绝对（服务端直连基址；已是绝对/无基址原样返回） */
export function absoluteMediaUrl(base: string, url: string): string {
  const u = String(url ?? '').trim()
  if (!u || /^https?:\/\//iu.test(u) || !base) return u
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`
}
