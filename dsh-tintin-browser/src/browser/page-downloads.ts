// ═══════════════════════════════════════════════════════════════
// page-downloads.ts — 浏览器页下载栏数据面（2026-11-08 第二批自
// browser-service.ts 提取付账）。下载总线事件 → 页面镜像列表（终态 4s 撤行）
// → tintin-browser-page:downloads 推送；B站扩展推送出口同池。
// ═══════════════════════════════════════════════════════════════
import type { WebContents } from 'electron'

export interface PageDownloadRow {
  taskId: string
  file: string
  percent: number
  state: string
  speed?: number
}

/** 页面下载栏镜像（宿主提供 pageHost 取值面） */
export function createPageDownloadMirror(pageHost: () => { webContents: WebContents } | null): {
  mirror: (channel: 'downloads:progress' | 'downloads:done' | 'downloads:error', payload: Record<string, unknown>) => void
  pushBiliExtDl: (payload: unknown) => void
} {
  const pageDownloads = new Map<string, PageDownloadRow>()
  function pushPageDownloads(): void {
    const host = pageHost()
    if (!host) return
    try { host.webContents.send('tintin-browser-page:downloads', [...pageDownloads.values()]) } catch { /* 页面未就绪 */ }
  }
  function mirror(
    channel: 'downloads:progress' | 'downloads:done' | 'downloads:error',
    payload: Record<string, unknown>,
  ): void {
    if (!pageHost()) return
    const taskId = String(payload.taskId || '')
    if (!taskId) return
    const file = String(payload.file || '下载文件')
    if (channel === 'downloads:progress') {
      pageDownloads.set(taskId, {
        taskId,
        file,
        state: payload.state === 'paused' ? 'paused' : 'downloading',
        percent: Number(payload.percent) || 0,
        speed: Number(payload.speed) || 0,
      })
    } else {
      pageDownloads.set(taskId, {
        taskId,
        file,
        state: channel === 'downloads:done' ? 'done' : 'error',
        percent: channel === 'downloads:done' ? 100 : Number(payload.percent) || 0,
      })
      setTimeout(() => {
        pageDownloads.delete(taskId)
        pushPageDownloads()
      }, 4000)
    }
    pushPageDownloads()
  }
  function pushBiliExtDl(payload: unknown): void {
    const host = pageHost()
    if (!host) return
    try { host.webContents.send('browser:bili-ext-dl', { platformId: 'bilibili', payload, ts: Date.now() }) } catch { /* 页面未就绪 */ }
  }
  return { mirror, pushBiliExtDl }
}
