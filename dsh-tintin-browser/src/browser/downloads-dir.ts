// downloads-dir.ts — 顶栏 ⬇ 通道（2026-11-20 用户裁决：点击跳转下载目录）。
// 从 browser-service 拆出（铁律 4：基线文件只减不增）——handler 全文在此，
// browser-service 只留一行注册。落盘根=工作区 materials（/tintin/media 白名单根内）。
import { ipcMain, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function registerOpenDownloadsDir(ipcMain: { handle(channel: string, fn: () => unknown): void }, workspaceDir: () => string): void {
  // 资源管理器打开 materials（不存在先建，保证总能打开）
  ipcMain.handle('browser:openDownloadsDir', () => {
    try {
      const dir = join(workspaceDir(), 'materials')
      mkdirSync(dir, { recursive: true })
      return shell.openPath(dir).then((err) => ({ success: !err, error: err || '' }))
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
  })
}
