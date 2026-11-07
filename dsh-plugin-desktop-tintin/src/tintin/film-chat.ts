// TinTin 影片聊天的持久化(desktop:chat:* 的后端):官方 src/chat-store.mjs 的存储语义
// (每影片一份 .film/chat.json:sessions/last/turns)。存档格式只需被本模块与聊天端经 IPC
// 往返, 不与官方磁盘格式互通。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileOf } from './film-model-calls.ts'

type Json = Record<string, unknown>
interface SavedTurn { turn: Json; items: unknown[] }
interface ProjectChat { sessions: unknown[]; last: string | null; turns: SavedTurn[] }

const chatPath = (project: string): string => join(project, '.film', 'chat.json')
const EMPTY = (): ProjectChat => ({ sessions: [], last: null, turns: [] })

/* 非终态轮次(官方 local-agent-run 的 ACTIVE_STATUSES 口径): 应用被关闭在半路时落盘的状态。
   零内容(未流出任何条目)的这类轮次读档只会显示一条红字「OpenFilm closed while the agent
   was working on this.」, 是纯噪音 —— load 时丢弃, 不再回显(2026-11-04 用户裁决)。 */
const ACTIVE_TURN_STATUSES = new Set(['generating', 'failing', 'canceling'])

function readChat(project: string): ProjectChat {
  try {
    const parsed = JSON.parse(readFileSync(chatPath(project), 'utf8')) as Partial<ProjectChat>
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      last: typeof parsed.last === 'string' ? parsed.last : null,
      turns: Array.isArray(parsed.turns) ? parsed.turns : [],
    }
  } catch { return EMPTY() }
}

/** 读档视图: 丢弃零内容的非终态轮次(僵尸记录), 只影响读出, 不改写磁盘。 */
function readableTurns(turns: SavedTurn[]): SavedTurn[] {
  return turns.filter(({ turn, items }) =>
    !(ACTIVE_TURN_STATUSES.has(String((turn as { status?: unknown }).status ?? '')) && Array.isArray(items) && items.length === 0))
}

function writeChat(project: string, chat: ProjectChat): void {
  mkdirSync(join(project, '.film'), { recursive: true })
  const temp = `${chatPath(project)}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(chat, null, 2)}\n`, 'utf8')
  renameSync(temp, chatPath(project))
}

export const filmChat = {
  load(project: string): ProjectChat {
    const chat = readChat(project)
    return { ...chat, turns: readableTurns(chat.turns) }
  },
  saveSessions(project: string, sessions: unknown[], last: string | null): void {
    const chat = readChat(project)
    writeChat(project, { ...chat, sessions, last })
  },
  saveTurn(project: string, turn: Json, items: unknown[]): void {
    const chat = readChat(project)
    const id = typeof (turn as { id?: unknown }).id === 'string' ? (turn as { id: string }).id : ''
    const turns = id ? [...chat.turns.filter((t) => (t.turn as { id?: unknown }).id !== id), { turn, items }] : [...chat.turns, { turn, items }]
    writeChat(project, { ...chat, turns })
  },
  /** 一轮的事件日志(.film/logs/<fileOf(turnId)>.jsonl, 由影片智能体桥按 ACP 事件写入)与其
      模型请求明细(<同名>.model.jsonl, film-model-calls 在轮次落定后重建)。0.3 语义:
      since=上次读位次(TurnLogAt: events 字节/calls 字节/callsFile 文件身份) —— 事件只回新增,
      明细按官方 readLog 的偏移增量读(文件被整写则回 whole); 全部无新增回 {same:true}。 */
  log(project: string, turnId: string, since?: { events: number; calls: number; callsFile: number }):
    { file: string; cut: boolean; whole: boolean; events: Array<Record<string, unknown>>; calls: unknown[]; callsWhole: boolean; callsCut: boolean; at: { events: number; calls: number; callsFile: number } } | { same: true } | null {
    const base = fileOf(turnId)
    const file = join(project, '.film', 'logs', `${base}.jsonl`)
    if (!existsSync(file)) return null
    const raw = readFileSync(file, 'utf8')
    const parse = (line: string): Record<string, unknown> => {
      try { return JSON.parse(line) as Record<string, unknown> } catch { return { kind: 'raw', line } }
    }
    /* 模型明细: 独立文件, 按字节位增量, ino 作文件身份(整写即换, 读侧回 whole)。 */
    const modelFile = join(project, '.film', 'logs', `${base}.model.jsonl`)
    const modelStat = existsSync(modelFile) ? statSync(modelFile) : null
    const at = { events: raw.length, calls: modelStat?.size ?? 0, callsFile: modelStat?.ino ?? 0 }
    const onwardEvents = typeof since?.events === 'number' && since.events >= 0 && since.events <= raw.length
    const onwardCalls = typeof since?.calls === 'number' && since.calls >= 0 && since.calls <= at.calls && since.callsFile === at.callsFile
    if (onwardEvents && since!.events === raw.length && (!modelStat || (onwardCalls && since!.calls === at.calls))) return { same: true }
    const eventsAt = onwardEvents && !(since!.events === 0 && raw.length === 0) ? since!.events : 0
    const wholeEvents = !onwardEvents || eventsAt === 0
    const eventSource = onwardEvents ? raw.slice(eventsAt) : raw
    let events = eventSource.split('\n').filter((line) => line.trim() !== '').map(parse)
    const lines = raw.split('\n').filter((line) => line.trim() !== '')
    const cut = wholeEvents ? lines.length > 200 : false
    if (wholeEvents) events = lines.slice(-200).map(parse)
    const calls: unknown[] = []
    let callsCut = false
    if (modelStat) {
      const from = onwardCalls ? since!.calls : 0
      for (const line of readFileSync(modelFile, 'utf8').slice(from).split('\n')) {
        if (line.trim() === '') continue
        const value = parse(line)
        if ((value as { kind?: unknown }).kind === 'cut') { callsCut = true; continue }
        calls.push(value)
      }
    }
    return { file, cut, whole: wholeEvents, events, calls, callsWhole: !onwardCalls, callsCut, at }
  },
  /** 有日志而聊天记录里尚无对应存档轮的轮次(官方 unsavedTurns 语义): 文件名是净化基名,
      真实 turnId(带冒号)从 prompt 行的 meta.turnId 反解; except 与已存档按净化基名比对。 */
  unsavedTurns(project: string, except: string[]): Array<{ turnId: string; events: Array<Record<string, unknown>> }> {
    const logsDir = join(project, '.film', 'logs')
    if (!existsSync(logsDir)) return []
    const skip = new Set(except.map((id) => fileOf(id)))
    const saved = new Set(readChat(project).turns.map((t) => String((t.turn as { id?: unknown }).id ?? '')))
    const out: Array<{ turnId: string; events: Array<Record<string, unknown>> }> = []
    for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl') || entry.name.endsWith('.model.jsonl')) continue
      const base = entry.name.slice(0, -'.jsonl'.length)
      if (skip.has(base) || saved.has(base) || saved.has(base.replace(/-/g, ':'))) continue
      const events: Array<Record<string, unknown>> = []
      for (const line of readFileSync(join(logsDir, entry.name), 'utf8').split('\n')) {
        if (!line.trim()) continue
        try { events.push(JSON.parse(line) as Record<string, unknown>) } catch { events.push({ kind: 'raw', line }) }
      }
      const prompt = events.find((e) => e.kind === 'prompt') as { meta?: { turnId?: unknown } } | undefined
      const turnId = typeof prompt?.meta?.turnId === 'string' ? prompt.meta.turnId : base
      out.push({ turnId, events: events.slice(-400) })
    }
    return out
  },
  saveRefImage(project: string, turnId: string, n: number, bytes: ArrayBuffer): { path: string } {
    const dir = join(project, '.film', 'refs')
    mkdirSync(dir, { recursive: true })
    const rel = `.film/refs/${fileOf(turnId)}-${n}.jpg`
    writeFileSync(join(project, rel), Buffer.from(bytes))
    return { path: rel }
  },
  saveAttachment(project: string, name: string, bytes: ArrayBuffer): { path: string } {
    const safe = name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 160)
    const dir = join(project, '.film', 'attachments')
    mkdirSync(dir, { recursive: true })
    const rel = `.film/attachments/${safe}`
    writeFileSync(join(project, rel), Buffer.from(bytes))
    return { path: rel }
  },
  describePaths(paths: string[]): Array<{ path: string; folder: boolean; size?: number } | { path: string; error: string }> {
    return paths.map((path) => {
      try {
        const stats = statSync(path)
        return stats.isDirectory() ? { path, folder: true } : { path, folder: false, size: stats.size }
      } catch (error) {
        return { path, error: error instanceof Error ? error.message : String(error) }
      }
    })
  },
}

// ── turn 的文件快照与变更、撤销: 已整体迁往 film-turn-changes.ts(0.3 官方语义的 1:1 移植,
//    2026-11-07 用户裁决方案 1)—— 本文件只留聊天存档与落盘面。────────────────────────

/** 越界守卫: 影片目录内的相对路径(附件/引用图落盘用). */
export function insideProject(project: string, relativePath: string): string {
  const target = join(project, relativePath)
  if (!target.startsWith(project)) throw new Error('路径越出影片目录')
  return target
}
