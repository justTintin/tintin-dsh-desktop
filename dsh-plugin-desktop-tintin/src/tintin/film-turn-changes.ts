// 影片轮次的文件快照、变更与撤销: 官方 apps/desktop/src/file-changes.mjs + chat-ipc.mjs
// 轮次生命周期的 1:1 移植(0.3 语义, 2026-11-07 用户裁决方案 1)。一轮开工时给项目拍快照:
// 文本文件(按扩展名)整读在册, 其余文件(媒体/大文件)hard link 进 .film/cache/turn-files/
// <turnId>(不占磁盘、原文件删除后链仍在), film.html 整读到 32MB(影片是项目本体)。
// 撤销=回滚到快照: 新增进系统回收站、改动写回、删除的原样还原; 还原不了的如实列名。
import { link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { structuredPatch } from 'diff'
import { dirname, join, relative, sep } from 'node:path'

const TEXT = /\.(html?|css|[cm]?js|jsx|tsx?|json|md|txt|srt|vtt|svg|xml|ya?ml|toml|py|sh|csv)$/i
const SKIP = new Set(['node_modules'])
/** 超过此大小的文本文件按普通文件比对(不留全文) */
const TEXT_MAX = 1024 * 1024
/** 超过此数停止遍历: 已读的仍参与比对, 列表标注截断 */
const FILES_MAX = 5000
/** 全文留存的字节预算 */
const KEEP_MAX = 48 * 1024 * 1024
const DEPTH_MAX = 8
/** 每个文件与整轮保留的变更行数上限 */
const LINES_MAX = 400
const TURN_LINES_MAX = 2000
/** 单文件 diff 超时: 放弃后只报「变了」不给行 */
const DIFF_MS = 1500
/** 项目影片文件与其整读保留上限 */
export const FILM = 'film.html'
const FILM_MAX = 32 * 1024 * 1024
/** 开工中与可撤销的轮次各保留几份(与官方 chat-ipc 同) */
const SNAPSHOTS_MAX = 8

export interface Seen { size: number; mtimeMs: number; text?: string; held?: true }
export interface TurnSnapshot { files: Map<string, Seen>; cut: boolean }
export interface Hunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
export interface FilmFileChange { path: string; change: 'added' | 'removed' | 'changed'; added?: number; removed?: number; hunks?: Hunk[]; cut?: boolean }

/** 一轮的链所在目录(`hold`): 名字不合法的 turnId 不建(null=无法还原二进制, 撤销时报 missed)。 */
export const holdDir = (root: string, turnId: unknown): string | null =>
  typeof turnId === 'string' && /^[\w:-]{1,120}$/.test(turnId)
    ? join(root, '.film', 'cache', 'turn-files', turnId.replace(/:/g, '-'))
    : null

/** 放开一轮的链(`hold`): 它删掉的文件从此彻底没了。 */
export const dropHold = (hold: string | null): Promise<void> =>
  hold ? rm(hold, { recursive: true, force: true }).catch(() => undefined) : Promise.resolve()

/** 项目此刻的文件: 每个的大小与时间, 文本文件另有全文。给 `hold` 时其余文件也在那里建链(`held`)。 */
export async function snapshot(root: string, opts?: { hold?: string | null }): Promise<TurnSnapshot> {
  const hold = opts?.hold ?? null
  const files = new Map<string, Seen>()
  let kept = 0
  let cut = false
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (files.size >= FILES_MAX) { cut = true; return }
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < DEPTH_MAX) await walk(abs, depth + 1)
        else cut = true
        continue
      }
      if (!entry.isFile()) continue
      let info
      try { info = await stat(abs) } catch { continue }
      const seen: Seen = { size: info.size, mtimeMs: info.mtimeMs }
      const path = relative(root, abs).split(sep).join('/')
      if (path === FILM ? info.size <= FILM_MAX : TEXT.test(entry.name) && info.size <= TEXT_MAX && kept + info.size <= KEEP_MAX) {
        try { seen.text = await readFile(abs, 'utf8'); kept += info.size } catch { /* 读的半路没了 */ }
      }
      if (hold && seen.text == null) {
        const to = join(hold, ...path.split('/'))
        try { await mkdir(dirname(to), { recursive: true }); await link(abs, to); seen.held = true } catch { /* 此盘无硬链接 */ }
      }
      files.set(path, seen)
    }
  }
  await walk(root, 0)
  return { files, cut }
}

/** 一段文本改动了的行, 每处前后各带三行; diff 超时放弃时为 null。 */
function hunksOf(path: string, before: string, after: string): Hunk[] | null {
  const patch = structuredPatch(path, path, before, after, undefined, undefined, { context: 3, timeout: DIFF_MS })
  return patch ? patch.hunks.map(({ oldStart, oldLines, newStart, newLines, lines }) => ({ oldStart, oldLines, newStart, newLines, lines })) : null
}

/** 只留前 max 行 hunk, 其余丢掉: → [留存的, 是否丢过]。 */
function clip(hunks: Hunk[], max: number): [Hunk[], boolean] {
  const out: Hunk[] = []
  let left = max
  for (const hunk of hunks) {
    if (left <= 0) return [out, true]
    if (hunk.lines.length <= left) { out.push(hunk); left -= hunk.lines.length; continue }
    out.push({ ...hunk, lines: hunk.lines.slice(0, left) })
    return [out, true]
  }
  return [out, false]
}

/** 快照与此刻之间变了什么: 新增/删除/修改, 按路径序(空列表=没变); `cut`=文件夹大到没读全。 */
export async function changes(root: string, before: TurnSnapshot): Promise<{ files: FilmFileChange[]; cut: boolean }> {
  const after = await snapshot(root)
  const paths = [...new Set([...before.files.keys(), ...after.files.keys()])].sort()
  const out: FilmFileChange[] = []
  let lines = TURN_LINES_MAX
  for (const path of paths) {
    const was = before.files.get(path)
    const now = after.files.get(path)
    if (was && now && was.size === now.size && was.mtimeMs === now.mtimeMs) continue
    if (was?.text != null && now?.text != null && was.text === now.text) continue
    const change: FilmFileChange['change'] = !was ? 'added' : !now ? 'removed' : 'changed'
    /* 只有两端都是文本(或一端本来没有)才给行 */
    const from = was ? was.text : ''
    const to = now ? now.text : ''
    if (from == null || to == null) { out.push({ path, change }); continue }
    const hunks = hunksOf(path, from, to)
    if (!hunks) { out.push({ path, change }); continue }
    let added = 0
    let removed = 0
    for (const hunk of hunks) for (const line of hunk.lines) { if (line[0] === '+') added += 1; else if (line[0] === '-') removed += 1 }
    if (!added && !removed && change === 'changed') continue
    const [kept, dropped] = clip(hunks, Math.min(LINES_MAX, lines))
    lines -= kept.reduce((n, hunk) => n + hunk.lines.length, 0)
    out.push({ path, change, added, removed, hunks: kept, ...(dropped ? { cut: true } : {}) })
  }
  return { files: out, cut: before.cut || after.cut }
}

/** 撤销一轮: 文件夹回到快照(`before`)的样子。此后新增的进回收站(`trash`), 删除/改动的写回
    (文本用留存的全文, 其余用开工时的链); 放不回的留着不动并命名(`missed`)。 */
export async function undoTurn(
  root: string,
  before: TurnSnapshot,
  hold: string | null,
  o: { trash: (path: string) => Promise<void> },
): Promise<{ restored: number; missed: string[] }> {
  const after = await snapshot(root)
  let restored = 0
  const missed: string[] = []
  for (const path of [...new Set([...before.files.keys(), ...after.files.keys()])].sort()) {
    const was = before.files.get(path)
    const now = after.files.get(path)
    const to = join(root, ...path.split('/'))
    if (was && now && was.size === now.size && was.mtimeMs === now.mtimeMs) continue
    if (was?.text != null && now?.text != null && was.text === now.text) continue
    try {
      if (!was) { await o.trash(to); restored += 1; continue }
      if (was.text != null) {
        await mkdir(dirname(to), { recursive: true })
        await writeFile(to, was.text)
        restored += 1
        continue
      }
      const held = was.held && hold ? join(hold, ...path.split('/')) : null
      const kept = held ? await stat(held).catch(() => null) : null
      if (!held || !kept || kept.size !== was.size || kept.mtimeMs !== was.mtimeMs) { missed.push(path); continue }
      await mkdir(dirname(to), { recursive: true })
      await rm(to, { force: true })
      await link(held, to)
      restored += 1
    } catch { missed.push(path) }
  }
  return { restored, missed }
}

export interface TurnChangesTracker {
  /** 一轮开工: 拍快照(其余文件建链), 顺手放开不属于本轮启动所知的老链。 */
  begin(project: string, turnId: string): Promise<void>
  /** 一轮结算: 与开工快照比对; 有变更且快照读全时把快照转入可撤销, 回 `undoable: true`。 */
  settle(project: string, turnId: string): Promise<{ files: FilmFileChange[]; cut: boolean; undoable?: boolean } | null>
  /** 撤销一轮(可撤销册里的): 文件夹回到开工前; 快照不在(超出保留数/项目被换)回 `gone`。 */
  undo(project: string, turnId: string): Promise<{ ok: true; restored: number; missed: string[] } | { ok: false; code: 'gone' }>
}

/** 轮次生命周期的持有者(官方 chat-ipc 的 snapshots/undoable 两册): 开工中一份、结算后有
    变更的最近几份可撤销, 各至多 SNAPSHOTS_MAX 份, 淘汰即放开其链。trash=系统回收站。 */
export function createTurnChangesTracker(o: { trash: (path: string) => Promise<void> }): TurnChangesTracker {
  interface Kept { dir: string; taken: TurnSnapshot; hold: string | null }
  const snapshots = new Map<string, Kept>()
  const undoable = new Map<string, Kept>()
  const forget = (kept: Map<string, Kept>, turnId: string): void => {
    void dropHold(kept.get(turnId)?.hold ?? null)
    kept.delete(turnId)
  }
  return {
    async begin(project, turnId) {
      const hold = holdDir(project, turnId)
      /* 上次启动关在一轮半路的链现在没用: 只有本次启动认得的轮次保链 */
      const turnFiles = join(project, '.film', 'cache', 'turn-files')
      const known = new Set([...snapshots.values(), ...undoable.values()].map((k) => k.hold))
      let left: string[] = []
      try { left = readdirSync(turnFiles) } catch { /* 没有 */ }
      await Promise.all(left.map((name) => join(turnFiles, name)).filter((p) => !known.has(p)).map(dropHold))
      const taken = await snapshot(project, { hold })
      forget(snapshots, turnId)
      snapshots.set(turnId, { dir: project, taken, hold })
      while (snapshots.size > SNAPSHOTS_MAX) forget(snapshots, snapshots.keys().next().value as string)
    },
    async settle(project, turnId) {
      const kept = snapshots.get(turnId)
      snapshots.delete(turnId)
      if (!kept || kept.dir !== project) { void dropHold(kept?.hold ?? null); return null }
      const found = await changes(project, kept.taken)
      /* 文件夹大到没读全的永不撤销: 读没到的地方会显得像新增 */
      if (!found.files.length || kept.taken.cut) { void dropHold(kept.hold); return found }
      forget(undoable, turnId)
      undoable.set(turnId, kept)
      while (undoable.size > SNAPSHOTS_MAX) forget(undoable, undoable.keys().next().value as string)
      return { ...found, undoable: true }
    },
    async undo(project, turnId) {
      const kept = undoable.get(turnId)
      if (!kept || kept.dir !== project) return { ok: false, code: 'gone' }
      const done = await undoTurn(project, kept.taken, kept.hold, o)
      forget(undoable, turnId)
      return { ok: true, ...done }
    },
  }
}
