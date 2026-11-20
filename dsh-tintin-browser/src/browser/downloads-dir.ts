// downloads-dir.ts — 下载域辅助 IPC（2026-11-20 用户裁决：点击跳转下载目录；
// 同批扩展=下载管理历史三通道，壳层欠账「下载管理页」批）。
// 从 browser-service 拆出（铁律 4：基线文件只减不增）——handler 全文在此，
// browser-service 只留一行注册。落盘根=工作区 materials（/tintin/media 白名单根内）。
// 历史存储 = userData/tintin/browser/downloads-history.json（append 由页面在
// downloads:done 事件经 downloadsHistoryAdd 写入；上限 500 条，超出丢最旧）。
import { shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function registerOpenDownloadsDir(ipcMain: { handle(channel: string, fn: (event: unknown, payload: unknown) => unknown): void }, workspaceDir: () => string, userDataDir?: () => string): void {
  // 资源管理器打开 materials（不存在先建，保证总能打开）
  ipcMain.handle('browser:openDownloadsDir', () => {
    try {
      const dir = join(workspaceDir(), 'materials')
      mkdirSync(dir, { recursive: true })
      return shell.openPath(dir).then((err) => ({ success: !err, error: err || '' }))
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
  })

  // ── 下载管理历史（壳层欠账「下载管理页」批）──
  if (!userDataDir) return
  const file = join(userDataDir(), 'tintin', 'browser', 'downloads-history.json')
  const readAll = (): Array<Record<string, unknown>> => {
    try { const v = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(v) ? v.slice(-500) : [] } catch { return [] }
  }
  const writeAll = (list: Array<Record<string, unknown>>): void => {
    try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(list.slice(-500), null, 2)}\n`, 'utf8') } catch { /* 写盘失败下次再试 */ }
  }
  ipcMain.handle('browser:downloadsHistoryAdd', (_e, p: unknown) => {
    const q = (p || {}) as Record<string, unknown>
    const entry = {
      id: `dh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      file: String(q.file || ''), finalPath: String(q.finalPath || ''),
      size: Number(q.size) || 0, url: String(q.url || ''),
      time: Number(q.time) || Date.now(),
    }
    if (!entry.file && !entry.finalPath) return { success: false }
    const list = readAll()
    list.push(entry as Record<string, unknown>)
    writeAll(list)
    return { success: true, entry }
  })
  ipcMain.handle('browser:downloadsHistory', () => ({ items: readAll().slice().reverse() }))
  ipcMain.handle('browser:downloadsHistoryRemove', (_e, p: unknown) => {
    const id = String((p || {}) as unknown as string || (p as { id?: unknown })?.id || '')
    const list = readAll().filter((x) => String(x.id) !== id)
    writeAll(list)
    return { success: true }
  })
  ipcMain.handle('browser:downloadsHistoryClear', () => {
    writeAll([])
    try { const f = file; if (existsSync(f)) rmSync(f) } catch { /* ignore */ }
    return { success: true }
  })
}
