// ═══════════════════════════════════════════════════════════════
// creationServer — 创作包的服务端桥与产品库访问（独立域）
// 与媒体包 useWorkbenchPickers/useSettingsConfig 同口径：window.tintin
// 桥直调、URL 只在本层拼装（IRON-06）、错误转用户可读文案。
// ═══════════════════════════════════════════════════════════════

import { subjectProductFromItem, type CreationSubjectProduct } from './creationStudioLogic'

export function getTintin(): any {
  return (window as any).tintin
}

export type PickerItem = Record<string, unknown>

/** 服务端/搜索错误的用户可读文案（与媒体包 workbenchChatContext 同口径） */
export function searchErrorText(err: unknown): string {
  if (err === null || err === undefined) {
    return '网络异常：无法连接服务端，请检查「设置 → 服务端」的地址与网络后重试。'
  }
  const msg = (err as Error)?.message || String(err)
  return `搜索失败：${msg}`
}

async function fetchJsonPayload(call: () => Promise<unknown>): Promise<unknown> {
  let data: unknown
  try {
    data = await call()
  } catch (e) {
    throw new Error(searchErrorText(e))
  }
  if (data === null || data === undefined) throw new Error(searchErrorText(null))
  if (typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const msg = String((data as Record<string, unknown>).error || '')
    if (msg) throw new Error(searchErrorText(new Error(msg)))
  }
  return data
}

function pickListItems(data: unknown): PickerItem[] {
  if (Array.isArray(data)) return data as PickerItem[]
  const o = (data ?? {}) as Record<string, unknown>
  for (const key of ['items', 'data', 'results']) {
    if (Array.isArray(o[key])) return o[key] as PickerItem[]
  }
  return []
}

/** 产品检索：GET /api/product-library/search?q=&limit=200（产品库） */
export async function fetchProducts(kw: string): Promise<PickerItem[]> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  return pickListItems(await fetchJsonPayload(() => t.server.get('/api/product-library/search', { q: kw, limit: 200 })))
}

/** 产品详情：GET /api/product-library/items/{id}（@ 主体产品档案） */
export async function fetchProductDetail(id: string): Promise<PickerItem> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  const data = await fetchJsonPayload(() => t.server.get(`/api/product-library/items/${encodeURIComponent(id)}`))
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return (o.item ?? o) as PickerItem
}

/** 服务端直连基址（六视图相对 URL → 可直连绝对地址；样本试听 2026-09-07
 *  同款裁决）：经 env.serverPing，预览环境无 env 桥 → 空串（不改写）。 */
export async function resolveServerBase(): Promise<string> {
  try {
    return String((await (window as unknown as { tintin?: { env?: { serverPing?: () => Promise<{ url?: unknown }> } } }).tintin?.env?.serverPing?.())?.url || '').replace(/\/$/, '')
  } catch { return '' }
}

// ── 真生成与口播字典（2026-10-30 服务端整改对齐；契约=live OpenAPI+探针实测）──

export interface GenerateSubmission {
  taskId: string
  poll?: string
}

/** 提交真生成：POST /generate/image|video（prompt≤2000 + aspect 可选）
 *  → {task_id, poll}；轮询与取消见 fetchUnifiedTask/cancelUnifiedTasks */
export async function submitGenerate(kind: 'image' | 'video', body: Record<string, unknown>): Promise<GenerateSubmission> {
  const t = getTintin()
  if (!t?.server?.post) throw new Error('服务端不可用，请检查「设置 → 服务端」的连接。')
  const data = await fetchJsonPayload(() => t.server.post(`/generate/${kind}`, body)) as Record<string, unknown>
  const taskId = String(data?.task_id ?? '').trim()
  if (!taskId) throw new Error('生成任务提交失败：服务端未返回 task_id')
  const poll = String(data?.poll ?? '').trim()
  return { taskId, ...(poll ? { poll } : {}) }
}

/** 统一任务轮询：GET /tasks/unified/{id} → {status, progress, result, error, …}
 *  （终态枚举 running/completed/failed/cancelled，归一在 creationGenerateLogic） */
export async function fetchUnifiedTask(taskId: string): Promise<Record<string, unknown>> {
  const t = getTintin()
  if (!t?.server?.get) throw new Error('服务端不可用，请检查「设置 → 服务端」的连接。')
  return await fetchJsonPayload(() => t.server.get(`/tasks/unified/${encodeURIComponent(taskId)}`)) as Record<string, unknown>
}

/** 取消进行中的统一任务：POST /tasks/batch_cancel {task_ids} → {cancelled,total}；
 *  桥缺失/失败返回 0（取消失败卡片仍在轮询，不阻塞界面） */
export async function cancelUnifiedTasks(taskIds: readonly string[]): Promise<number> {
  const t = getTintin()
  if (!t?.server?.post) return 0
  try {
    const data = await t.server.post('/tasks/batch_cancel', { task_ids: [...taskIds] }) as Record<string, unknown> | null
    return Number(data?.cancelled ?? 0)
  } catch {
    return 0
  }
}

/** 口播字典条目（GET /copywriting/formulas|platforms → {default, [key]:[{name,aliases,guide}]}） */
export interface CopywritingDictEntry {
  name: string
  aliases: string[]
  guide: string
}

function dictEntries(data: unknown, key: string): CopywritingDictEntry[] {
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const list = Array.isArray(o[key]) ? o[key] as unknown[] : []
  return list
    .map((e) => {
      const it = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
      return {
        name: String(it.name ?? '').trim(),
        aliases: Array.isArray(it.aliases) ? it.aliases.map((a) => String(a ?? '').trim()).filter(Boolean) : [],
        guide: String(it.guide ?? ''),
      }
    })
    .filter((e) => e.name)
}

/** 口播写法字典：GET /copywriting/formulas（痛点式/开箱实测式…，服务端织入提示词） */
export async function fetchFormulas(): Promise<CopywritingDictEntry[]> {
  const t = getTintin()
  if (!t?.server?.get) throw new Error(searchErrorText(null))
  return dictEntries(await fetchJsonPayload(() => t.server.get('/copywriting/formulas')), 'formulas')
}

/** 口播平台字典：GET /copywriting/platforms（抖音/小红书/公众号，缺省抖音） */
export async function fetchPlatforms(): Promise<CopywritingDictEntry[]> {
  const t = getTintin()
  if (!t?.server?.get) throw new Error(searchErrorText(null))
  return dictEntries(await fetchJsonPayload(() => t.server.get('/copywriting/platforms')), 'platforms')
}

/** @ 主体产品档案整取：详情 + 直连基址并行，六视图 URL 就地绝对化。
 *  失败上抛——调用方保持型号级档案不冲界面（2026-10-12 裁决口径）。 */
export async function fetchSubjectProductDetail(id: string): Promise<CreationSubjectProduct> {
  const [item, base] = await Promise.all([fetchProductDetail(id), resolveServerBase()])
  const detail = subjectProductFromItem(item)
  return {
    ...detail,
    sixViews: detail.sixViews?.map((v) => ({ ...v, url: base && !/^https?:\/\//i.test(v.url) ? base + v.url : v.url })),
  }
}

// ── 口播响应解析（与媒体包 copywritingMontageStep2ConcatLogic 同口径拷贝：
//    十稿 variants 与单稿 text 双形态；此处独立副本=创作包不反向依赖媒体包）──

/** 口播生成：POST /copywriting/voiceover，响应就地解析为候选集。
 *  无结果不在此报错——候选空/失败写法清单交调用方出文案（App 发送链）。 */
export async function fetchVoiceoverCandidates(req: Record<string, unknown>): Promise<VoiceoverCandidatesResult> {
  const t = getTintin()
  if (!t?.server?.post) throw new Error('服务端不可用，请检查「设置 → 服务端」的连接。')
  return voiceoverCandidatesFromResponse(await t.server.post('/copywriting/voiceover', req))
}
export interface VoiceoverCandidate {
  formula: string
  text: string
  chars: number
  durationS?: number
}

export interface VoiceoverCandidatesResult {
  candidates: VoiceoverCandidate[]
  failedFormulas: string[]
  single: boolean
}

function posNumOrUndef(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function voiceoverCandidatesFromResponse(resp: unknown): VoiceoverCandidatesResult {
  const out: VoiceoverCandidatesResult = { candidates: [], failedFormulas: [], single: false }
  const r = resp as { variants?: unknown; text?: unknown; chars?: unknown; duration_s?: unknown; formula?: unknown } | null | undefined
  if (r && Array.isArray(r.variants)) {
    for (const v of r.variants as Array<Record<string, unknown>>) {
      const name = String(v?.formula ?? '').trim()
      const text = String(v?.text ?? '').trim()
      if (text) {
        const chars = Number(v?.chars)
        out.candidates.push({
          formula: name,
          text,
          chars: Number.isFinite(chars) && chars > 0 ? chars : text.length,
          durationS: posNumOrUndef(v?.duration_s),
        })
      } else {
        out.failedFormulas.push(name)
      }
    }
    return out
  }
  const text = String(r?.text ?? '').trim()
  if (text) {
    const chars = Number(r?.chars)
    out.single = true
    out.candidates.push({
      formula: String(r?.formula ?? '').trim(),
      text,
      chars: Number.isFinite(chars) && chars > 0 ? chars : text.length,
      durationS: posNumOrUndef(r?.duration_s),
    })
  }
  return out
}
