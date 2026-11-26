// library-proxy — 在线素材库主进程代理(2026-10-24 用户要求, 2026-11-24 自 main-hook.ts 迁出——
// 铁律 4 行数门,模块自成边界):openfilm:library:list/download ← 服务端 /material/list|serve。
// 下载=项目 assets/download(页面拿不到影片目录时从 studio.json 回退)或系统下载目录;
// 大体积素材流式落盘(此前 arrayBuffer 全量进内存=内存尖峰),list 15s/头部 20s 超时把
// 服务端挂起如实交回(2026-11-24 报障:无超时=IPC 永不 resolve=界面 busy 永真假死)。
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type IpcMain } from 'electron'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { diagnosticLog } from '../developer-logging.ts'

export function registerLibraryProxy({ ipcMain, channelHome, tinServerUrl }: {
  ipcMain: IpcMain
  /** 频道家目录(studio.json 项目回退用) */
  channelHome: () => string
  /** TinTin 服务端地址(下载未显式带 serverUrl 时的兜底) */
  tinServerUrl: () => string
}): void {
  ipcMain.handle('openfilm:library:list', async (_event, payload: unknown) => {
    const q = (payload ?? {}) as { page?: unknown; size?: unknown; mediaType?: unknown; search?: unknown }
    const serverUrl = tinServerUrl()
    if (!serverUrl) return { error: '服务端未配置' }
    try {
      const url = new URL(serverUrl + '/material/list')
      url.searchParams.set('page', String(Number(q.page) || 1))
      url.searchParams.set('size', String(Number(q.size) || 24))
      if (typeof q.mediaType === 'string' && q.mediaType) url.searchParams.set('media_type', q.mediaType)
      if (typeof q.search === 'string' && q.search.trim()) url.searchParams.set('search', q.search.trim())
      /* 15s 超时:服务端挂起时把失败如实交回(错误信息是诊断的血液),渲染层 busy 必然释放 */
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      /* 实测(2026-10-24 铁律 14): /material/list 返回顶层 items, 不包 data */
      const body = await res.json() as { items?: unknown[]; data?: { items?: unknown[] } }
      const items = Array.isArray(body.items) ? body.items : Array.isArray(body.data?.items) ? body.data.items : []
      return { serverUrl, items }
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('openfilm:library:download', async (_event, payload: unknown) => {
    const p = (payload ?? {}) as { project?: unknown; materialId?: unknown; filename?: unknown; serverUrl?: unknown; target?: unknown }
    const target: 'project' | 'downloads' = p.target === 'downloads' ? 'downloads' : 'project'
    let project = typeof p.project === 'string' && p.project ? p.project.replace(/[\\/]+$/, '') : ''
    const id = String(p.materialId ?? '')
    const filename = String(p.filename ?? `material-${id}`)
    /* 页面拿不到影片目录时, 主进程自己从 studio.json 解析(2026-10-24 报障: 页面侧
       openfilm:currentProject 偶发为空 → 下载直接失败且磁盘无文件)。 */
    if (target === 'project' && !project) {
      try {
        const raw = JSON.parse(readFileSync(join(channelHome(), 'openfilm-studio', 'studio.json'), 'utf8')) as { recent?: Array<{ path?: unknown }> }
        const first = raw.recent?.[0]?.path
        if (typeof first === 'string' && first) {
          project = first.replace(/[\\/]+$/, '')
          diagnosticLog({ source: 'tintin-main', event: 'library-download-project-fallback', level: 'info', developer: false, fields: { project } })
        }
      } catch { /* 无 studio.json: 下面的参数校验报错 */ }
    }
    if (!id || (target === 'project' && !project)) {
      diagnosticLog({ source: 'tintin-main', event: 'library-download', level: 'error', developer: false, fields: { reason: '参数缺失', id, project } })
      return { error: '参数缺失(项目/素材 id)' }
    }
    const serverUrl = typeof p.serverUrl === 'string' && p.serverUrl ? p.serverUrl.replace(/\/+$/, '') : tinServerUrl()
    if (!serverUrl) return { error: '服务端未配置' }
    try {
      /* 头部 20s 超时;正文流式落盘(全量 arrayBuffer=大素材内存尖峰) */
      const res = await fetch(serverUrl + '/material/serve?material_id=' + encodeURIComponent(id), { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      if (!res.body) throw new Error('服务端响应无正文')
      const dir = target === 'downloads' ? app.getPath('downloads') : join(project, 'assets', 'download')
      mkdirSync(dir, { recursive: true })
      const safe = filename.replace(/[/:*?"<>|]/g, '-').slice(0, 100) || `material-${id}`
      const file = join(dir, safe)
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(file))
      diagnosticLog({ source: 'tintin-main', event: 'library-download', level: 'info', developer: false, fields: { ok: true, file, target } })
      return target === 'downloads' ? { ok: true, path: file } : { ok: true, rel: 'assets/download/' + safe }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      diagnosticLog({ source: 'tintin-main', event: 'library-download', level: 'error', developer: false, fields: { ok: false, error: message, id, project } })
      return { error: message }
    }
  })
}
