// ═══════════════════════════════════════════════════════════════
// history-bookmark.ts — 浏览历史 + 用户书签（2026-11-08 第二批 P0 #3/#4）。
// 历史 = 各分区 did-navigate 记录（去重、每平台环形上限）；书签 = 用户星标
// （星标按钮/收藏栏）。文件存储 = userData/tintin/browser/{history,bookmarks}.json。
// 纯函数（trim/去重/上限）+ 存储层；无 Electron 网络依赖。
// ═══════════════════════════════════════════════════════════════
import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { detectPlatformFromUrl } from './platform-meta.ts'

export interface HistoryEntry {
  url: string
  title: string
  platform: string
  at: number
}
export interface BookmarkEntry {
  url: string
  title: string
  platform: string
  at: number
}

const HISTORY_CAP = 500
const HISTORY_PER_PLATFORM = 100

/** 追加一条历史（头部插入；全局与每平台双上限；同 URL 连续访问去重置顶） */
export function appendHistory(list: HistoryEntry[], url: string, title: string): HistoryEntry[] {
  const u = String(url || '').trim()
  if (!/^https?:\/\//i.test(u)) return list
  const platform = detectPlatformFromUrl(u) ?? 'web'
  const filtered = list.filter((h) => h.url !== u)
  const entry: HistoryEntry = { url: u, title: String(title || u).slice(0, 200), platform, at: Date.now() }
  const perPlatform = [entry, ...filtered.filter((h) => h.platform === platform)].slice(0, HISTORY_PER_PLATFORM)
  const rest = filtered.filter((h) => h.platform !== platform)
  return [...perPlatform, ...rest].slice(0, HISTORY_CAP)
}

/** 地址栏历史建议（前缀/子串匹配，最近优先，限 8 条） */
export function suggestHistory(list: HistoryEntry[], query: string, limit = 8): HistoryEntry[] {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  return list.filter((h) => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)).slice(0, limit)
}

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return fallback }
}
function writeJson(file: string, data: unknown): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  } catch { /* 写盘失败下次再试 */ }
}

export function registerHistoryBookmarkIpc(ipcMain: Pick<Electron.IpcMain, 'handle'>): void {
  const historyFile = join(app.getPath('userData'), 'tintin', 'browser', 'history.json')
  const bookmarkFile = join(app.getPath('userData'), 'tintin', 'browser', 'bookmarks.json')
  let history = readJson<HistoryEntry[]>(historyFile, [])
  let bookmarks = readJson<BookmarkEntry[]>(bookmarkFile, [])
  const saveHistory = (): void => writeJson(historyFile, history)
  const saveBookmarks = (): void => writeJson(bookmarkFile, bookmarks)

  ipcMain.handle('history:record', (_e, p: unknown) => {
    const q = (p || {}) as { url?: unknown; title?: unknown }
    history = appendHistory(history, String(q.url || ''), String(q.title || ''))
    saveHistory()
    return { ok: true }
  })
  ipcMain.handle('history:list', () => ({ success: true, data: history.slice(0, 100) }))
  ipcMain.handle('history:clear', () => {
    history = []
    saveHistory()
    return { ok: true }
  })
  ipcMain.handle('history:suggest', (_e, p: unknown) => {
    const q = (p || {}) as { query?: unknown }
    return { success: true, data: suggestHistory(history, String(q.query || '')) }
  })
  ipcMain.handle('bookmarks:list', () => ({ success: true, data: bookmarks }))
  ipcMain.handle('bookmarks:toggle', (_e, p: unknown) => {
    const q = (p || {}) as { url?: unknown; title?: unknown }
    const url = String(q.url || '').trim()
    if (!/^https?:\/\//i.test(url)) return { success: false, error: '非法网址' }
    const existing = bookmarks.find((b) => b.url === url)
    if (existing) {
      bookmarks = bookmarks.filter((b) => b.url !== url)
      saveBookmarks()
      return { success: true, starred: false }
    }
    const entry: BookmarkEntry = {
      url,
      title: String(q.title || url).slice(0, 200),
      platform: detectPlatformFromUrl(url) ?? 'web',
      at: Date.now(),
    }
    bookmarks = [entry, ...bookmarks].slice(0, 200)
    saveBookmarks()
    return { success: true, starred: true }
  })
  ipcMain.handle('bookmarks:isStarred', (_e, p: unknown) => {
    const q = (p || {}) as { url?: unknown }
    return { success: true, starred: bookmarks.some((b) => b.url === String(q.url || '')) }
  })
}
