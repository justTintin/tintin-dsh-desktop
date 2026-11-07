// 影片轮次的模型请求明细(TurnLog 的 calls 页签数据源): 数据从 DSH 子进程自己的会话日志
// 重建 —— 官方 0.3 对各 agent 的同款做法(apps/desktop/src/agent-records.mjs 读各家记录,
// 我们读 DSH 会话持久化日志 sessions/<项目key>/session-<id>/session.v*.jsonl[.zstd])。
// 重放 user/assistant/tool/system/header 事件建消息历史, 每个 assistant/message(带 usage)
// 是一次请求的应答; compactCalls 去重语义(每行只带与前一次不同的增量)与写侧上限
// (MODEL_LOG_MAX+cut 行)按官方 chat-store/agent-records 1:1。会话日志是多帧 zstd:
// 首帧一条 header 行, 之后每帧一批事件 —— Node 流式 API 在帧边界停, 按帧头格式逐帧解压。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { join } from 'node:path'

/** 一轮 model 日志的字节上限: 超出截断, 一条 cut 行说明丢了几个(官方同值)。 */
const MODEL_LOG_MAX = 64 * 1024 * 1024
/** 落笔前等一会: 子进程最后几条事件可能还在写盘路上(官方 RECORD_SETTLE_MS 同值)。 */
const RECORD_SETTLE_MS = 800

type Json = Record<string, unknown>
type Item = Record<string, any>

interface SessionEvent { type: string; seq?: number; time?: number | null; data?: Json }

/** 轮次 id → 文件名: Windows 文件名禁冒号(官方 fileOf 同款; 未净化时冒号 id 会写成 ADS 流)。 */
export const fileOf = (turnId: string): string => turnId.replace(/:/g, '-')

/* ── zstd 多帧读 ─────────────────────────────────────────────────────────── */

/** 逐帧解压一个多帧 zstd 文件为文本; 明文文件按原样回。帧头大小=magic(4)+描述符(1)
    +[窗口(1), 单段帧才免]+FCS(0/1/2/4/8)+字典 id(0/1/2/4)。 */
export function decodeSessionLog(path: string): string | null {
  let bytes: Buffer
  try { bytes = readFileSync(path) } catch { return null }
  if (path.endsWith('.zstd')) {
    const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
    const starts: number[] = []
    let idx = 0
    while ((idx = bytes.indexOf(MAGIC, idx)) !== -1) {
      const desc = bytes[idx + 4] ?? 0
      const single = (desc >> 5) & 1
      const fcsFlag = (desc >> 6) & 3
      const did = desc & 3
      const fcs = fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
      starts.push(idx)
      idx += 5 + (single ? 0 : 1) + fcs + (did === 3 ? 4 : did)
    }
    if (starts.length === 0) return null
    let text = ''
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1] : bytes.length
      try { text += zstdDecompressSync(bytes.subarray(starts[i], end)).toString('utf8') } catch { return null }
    }
    return text
  }
  return bytes.toString('utf8')
}

/* ── 会话日志定位(官方 format.ts 的 projectKey/sessionDir 同款) ─────────────── */

/** cwd → sessions 根下的项目目录名: 分隔符折叠成一个 -, 其余安全字符保留, 其它按
    UTF-16 码元 ~XXXX~, 首尾去 -, 251 字符封顶, 前后各两条 --。 */
export function projectSessionKey(cwd: string): string {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/** 一个会话的持久化日志(项目目录+session-<id> 下, 最新一代的 zstd 或明文); 不在则 null。 */
export function findSessionLog(agentHome: string, cwd: string, sessionId: string): string | null {
  if (!sessionId || !/^[\w-]{1,120}$/.test(sessionId)) return null
  const dir = join(agentHome, 'sessions', projectSessionKey(cwd), `session-${sessionId}`)
  if (!existsSync(dir)) return null
  let names: string[] = []
  try { names = readdirSync(dir).filter((n) => /^session\..*\.jsonl(\.zstd)?$/.test(n)) } catch { return null }
  names.sort()
  const zstd = names.filter((n) => n.endsWith('.zstd'))
  const pick = (zstd.length ? zstd : names).at(-1)
  return pick ? join(dir, pick) : null
}

/* ── 会话事件重放 → 请求明细(官方 agent-records 各家重建的同构) ───────────────── */

/** usage 从 DSH 命名映到聊天侧命名(官方 usageOf 吃 input/cacheRead/cacheWrite/output/reasoning)。 */
function usageOf(raw: Json | null | undefined): Item {
  const u = raw ?? {}
  const cacheRead = Number(u.cacheReadTokens) || 0
  return {
    input: Math.max(0, (Number(u.inputTokens) || 0) - cacheRead),
    cacheRead,
    cacheWrite: Number(u.cacheWriteTokens) || 0,
    output: Number(u.outputTokens) || 0,
    reasoning: Number(u.reasoningTokens) || 0,
  }
}

/** 消息里图片等大块换成占位(model 日志不留字节; textOf 认 image)。 */
function safeParts(parts: unknown): Item[] {
  if (typeof parts === 'string') return [{ type: 'text', text: parts }]
  if (!Array.isArray(parts)) return []
  return parts.map((p) => {
    const part = (p ?? {}) as Item
    if (part.type === 'image' || part.inlineData || part.data) return { type: 'image' }
    return part
  })
}

interface RawCall { startedAt: number; ms: number | null; messages: Item[]; answer: Item | null; systemPrompt: string | null; tools: Item[] | null; settings: Item | null }

/** 从会话事件重放整段对话, 每个带 usage 的 assistant/message 出一次请求;
    只收 startedAt 在 [fromMs, toMs] 内的(官方 keepAgentRecord 的窗口语义)。 */
export function reconstructCalls(events: SessionEvent[], fromMs: number, toMs: number): RawCall[] {
  const calls: RawCall[] = []
  const history: Item[] = []
  const toolNames = new Map<string, string>()
  let systemPrompt: string | null = null
  let tools: Item[] | null = null
  let settings: Item | null = null
  const at = (e: SessionEvent): number => typeof e.time === 'number' ? e.time : 0
  for (const e of events) {
    const data = (e.data ?? {}) as Json
    switch (e.type) {
      case 'system/message': {
        const parts = safeParts((data.message as Json | undefined)?.content)
        systemPrompt = parts.map((p) => (p.type === 'text' ? String(p.text ?? '') : '')).join('\n\n')
        break
      }
      case 'request/header': {
        const header = (data.header ?? {}) as Json
        const config = (header.config ?? {}) as Json
        if (Array.isArray(header.tools)) tools = header.tools as Item[]
        settings = { model: config.model ?? null, provider: config.provider ?? null }
        break
      }
      case 'request/context': {
        const model = typeof data.model === 'string' ? data.model : null
        settings = { ...(settings ?? {}), ...(model ? { model } : {}), ...(Number.isFinite(Number(data.contextWindow)) ? { contextWindow: Number(data.contextWindow) } : {}) }
        break
      }
      case 'user/message':
        history.push({ role: 'user', content: safeParts(data.content) })
        break
      case 'assistant/message': {
        const usage = (data.usage ?? null) as Json | null
        const message = (data.message ?? {}) as Json
        const content = safeParts(message.content)
        if (usage !== null && at(e) >= fromMs && at(e) <= toMs) {
          calls.push({
            startedAt: at(e), ms: null, messages: JSON.parse(JSON.stringify(history)),
            answer: { role: 'assistant', content, usage: usageOf(usage), ...(typeof settings?.model === 'string' ? { responseModel: settings.model } : {}) },
            systemPrompt, tools, settings,
          })
        }
        const assistant: Item = { role: 'assistant', content }
        history.push(assistant)
        break
      }
      case 'tool/call': {
        const callId = String(data.callId ?? '')
        const name = String(data.name ?? 'tool')
        toolNames.set(callId, name)
        let parsed: unknown = data.arguments
        if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { /* 保留原文 */ } }
        const last = [...history].reverse().find((m) => m.role === 'assistant')
        if (last) (last.content as Item[]).push({ type: 'toolCall', id: callId, name, arguments: parsed })
        break
      }
      case 'tool/result': {
        const message = (data.message ?? {}) as Json
        history.push({
          role: 'toolResult', toolCallId: String(data.toolCallId ?? message.toolCallId ?? ''),
          toolName: toolNames.get(String(data.toolCallId ?? message.toolCallId ?? '')) ?? 'tool',
          content: safeParts(message.content), isError: message.isError === true,
        })
        break
      }
      default: break
    }
  }
  return calls
}

/* ── 去重与写侧(官方 compactCalls/writeModelLog 1:1) ───────────────────────── */

/** 每行只留与前一次请求不同的增量: 相同的消息前缀折叠成 prefix, systemPrompt/tools/
    settings/source/thread 变了才带。聊天侧 lib/model-calls.ts 逆向展开。 */
export function compactCalls(calls: RawCall[]): Array<Item> {
  let keys: string[] = []
  const last = { systemPrompt: 'null', tools: 'null', settings: 'null', source: 'null', thread: 'null' }
  return calls.map((call) => {
    const all = call.messages.map((m) => JSON.stringify(m))
    let prefix = 0
    while (prefix < keys.length && prefix < all.length && keys[prefix] === all[prefix]) prefix += 1
    keys = all
    const line: Item = { startedAt: call.startedAt, ms: call.ms, prefix, messages: call.messages.slice(prefix), answer: call.answer ?? null }
    for (const field of ['systemPrompt', 'tools', 'settings', 'source', 'thread'] as const) {
      const key = JSON.stringify((call as unknown as Item)[field] ?? null)
      if (key !== last[field]) { line[field] = (call as unknown as Item)[field] ?? null; last[field] = key }
    }
    return line
  })
}

/** 整写一轮的 model 日志(原子), 超 MODEL_LOG_MAX 截断并落一条 cut 行(官方同款)。 */
export function writeModelLog(project: string, turnId: string, lines: Array<Item>): void {
  const dir = join(project, '.film', 'logs')
  mkdirSync(dir, { recursive: true })
  const kept: string[] = []
  let size = 0
  for (const [i, line] of lines.entries()) {
    const text = JSON.stringify(line)
    if (size + text.length > MODEL_LOG_MAX) {
      kept.push(JSON.stringify({ t: Date.now(), kind: 'cut', max: MODEL_LOG_MAX, dropped: lines.length - i }))
      break
    }
    kept.push(text)
    size += text.length + 1
  }
  const final = join(dir, `${fileOf(turnId)}.model.jsonl`)
  const temp = `${final}.${process.pid}.tmp`
  writeFileSync(temp, `${kept.map((l) => `${l}\n`).join('')}`, 'utf8')
  renameSync(temp, final)
}

/* ── 一站式钩子: 轮次落定后重建该轮的 model 日志(永不抛) ─────────────────────── */

const modelLogDigest = new Map<string, string>()

/** 轮次结束(settle 等待后)从 DSH 会话日志重建 [fromMs,toMs] 窗口内的请求明细。
    日志不在/解不开/无请求: 安静退出 —— 明细缺失不报错(官方 keepAgentRecord 同款)。
    同轮同内容跳过重写(哈希比对), 保 readLog 的字节偏移与文件身份稳定。 */
export function scheduleFilmModelLog(o: {
  project: string; turnId: string; agentHome: string; sessionId: string; fromMs: number; toMs: number;
}, settleMs = RECORD_SETTLE_MS): void {
  setTimeout(() => {
    try {
      const logPath = findSessionLog(o.agentHome, o.project, o.sessionId)
      if (!logPath) return
      const text = decodeSessionLog(logPath)
      if (!text) return
      const events = text.split('\n').filter((l) => l.trim() !== '').map((l) => { try { return JSON.parse(l) as SessionEvent } catch { return null } }).filter((e): e is SessionEvent => e !== null)
      const calls = reconstructCalls(events, o.fromMs, o.toMs)
      if (!calls.length) return
      const lines = compactCalls(calls)
      const digest = createHash('sha256').update(JSON.stringify(lines)).digest('hex')
      const final = join(o.project, '.film', 'logs', `${fileOf(o.turnId)}.model.jsonl`)
      if (modelLogDigest.get(final) === digest && existsSync(final)) return
      modelLogDigest.set(final, digest)
      writeModelLog(o.project, o.turnId, lines)
    } catch { /* 明细缺失不报错 */ }
  }, settleMs).unref?.()
}
