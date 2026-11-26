// native-shell-channels — openfilmNative 的文件/外开/截帧面 IPC handlers。
// 2026-11-19 自 main-hook.ts 迁出(铁律 4「迁移是唯一合法的降行数机会」):
// main-hook 是基线锁定超配文件(只减不增),即梦外开通道(open-external)入列时
// 连同整个 reveal/pick/capture 文件面一起搬出。行为逐字节等价迁移;
// shell 页 bridge.ts 的后端(见 film-acp.ts 头注),studioView 经 getter 访问。
import { BrowserWindow } from 'electron'
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, resolve } from 'node:path'
import type { Dialog, IpcMain, Shell, WebContentsView } from 'electron'
import { registerFilmDreaminaChannels } from './film-dreamina-channels.ts'

/** 注册 openfilm:native:reveal-path / pick-folder / open-external / capture 四通道。
 *  open-external 只放行 https/http(2026-11-19 即梦设备码登录事故:Studio 视图
 *  setWindowOpenHandler 无条件 deny,封面编辑器 iframe 的 target=_blank 被吞,
 *  授权流程卡死)——与 electron-shell-generation 的外开白名单同口径。 */
export function registerNativeShellChannels(deps: {
  ipcMain: IpcMain
  shell: Shell
  dialog: Dialog
  getStudioView: () => WebContentsView | null
  /** 频道家目录(studio.json 项目回退用,2026-11-24) */
  channelHome: () => string
}): void {
  const { ipcMain, shell, dialog, getStudioView } = deps
  /* 页面侧 tintinFilmDir 偶发为空(嵌入页 /open 无 /projects 路由): 主进程从 studio.json
     recent[0] 回退解析影片项目目录(与 library:download 同款兜底,2026-11-24 用户报障
     「预览失败:未定位到影片项目目录」即此缝)。 */
  const resolveFilmProject = (): string => {
    try {
      const raw = JSON.parse(readFileSync(join(deps.channelHome(), 'openfilm-studio', 'studio.json'), 'utf8')) as { recent?: Array<{ path?: unknown }> }
      const first = raw.recent?.[0]?.path
      return typeof first === 'string' && first ? first.replace(/[\\/]+$/, '') : ''
    } catch { return '' }
  }
  ipcMain.handle('openfilm:native:reveal-path', (_event, payload: unknown) => {
    const path = String((payload as { path?: unknown } | null)?.path ?? '')
    if (path) shell.showItemInFolder(path)
    return { ok: true }
  })
  ipcMain.handle('openfilm:native:pick-folder', async (event, payload: unknown) => {
    const options = (payload ?? {}) as { title?: string; defaultPath?: string }
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      ...(options.title ? { title: options.title } : {}),
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const result = window ? await dialog.showOpenDialog(window, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('openfilm:native:open-external', (_event, payload: unknown) => {
    const raw = String((payload as { url?: unknown } | null)?.url ?? '')
    let target: URL
    try {
      target = new URL(raw)
    } catch {
      return { ok: false, error: 'invalid url' }
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return { ok: false, error: 'protocol not allowed' }
    return shell.openExternal(target.href).then(() => ({ ok: true })).catch((cause: unknown) => ({
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    }))
  })
  ipcMain.handle('openfilm:native:capture', async (_event, payload: unknown) => {
    const rect = (payload ?? {}) as { x?: number; y?: number; width?: number; height?: number }
    const studioView = getStudioView()
    if (studioView === null || studioView.webContents.isDestroyed()) return null
    const image = await studioView.webContents.capturePage({
      x: Math.max(0, Math.round(rect.x ?? 0)),
      y: Math.max(0, Math.round(rect.y ?? 0)),
      width: Math.max(1, Math.round(rect.width ?? 1)),
      height: Math.max(1, Math.round(rect.height ?? 1)),
    })
    return image.toJPEG(85).toString('base64')
  })
  // ── 影片项目媒体文件面(2026-11-24 用户报障「返回的视频/图片/音频无法查看、无法下载引用」):
  // 聊天变更文件行对二进制产物(mp4/png/wav)没有 hunks=纯展示。补两个通道:预览(base64 回页)+
  // 另存到电脑(系统对话框)。守卫=路径必须落在影片项目目录内 + 扩展名白名单 + 64MB 上限。
  const MEDIA_MIME: Record<string, string> = {
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.m4v': 'video/x-m4v',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.json': 'application/json',
  }
  const resolveProjectFile = (payload: unknown): { abs: string; name: string; mime: string } | { error: string } => {
    const p = (payload ?? {}) as { project?: unknown; path?: unknown }
    let project = String(p.project ?? '').replace(/[\\/]+$/, '')
    const rel = String(p.path ?? '').replace(/[\\/]+$/, '')
    if (!rel) return { error: '参数缺失(路径)' }
    if (!project || !existsSync(project)) project = resolveFilmProject()
    if (!project) return { error: '未定位到影片项目目录' }
    const abs = isAbsolute(rel) ? resolve(rel) : resolve(join(project, rel))
    const lowerAbs = abs.toLowerCase()
    const lowerRoot = project.toLowerCase() + '\\'
    if (!lowerAbs.startsWith(lowerRoot) && lowerAbs !== project.toLowerCase()) return { error: '路径不在影片项目目录内' }
    const ext = extname(abs).toLowerCase()
    const mime = MEDIA_MIME[ext]
    if (!mime) return { error: `不支持的文件类型:${ext || '(无扩展名)'}` }
    return { abs, name: abs.slice(abs.lastIndexOf('\\') + 1), mime }
  }
  ipcMain.handle('openfilm:native:project-file-read', (_event, payload: unknown) => {
    const resolved = resolveProjectFile(payload)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    try {
      const size = statSync(resolved.abs).size
      if (size > 64 * 1024 * 1024) return { ok: false, error: `文件超过 64MB 预览上限(${Math.round(size / 1024 / 1024)}MB)` }
      return { ok: true, base64: readFileSync(resolved.abs).toString('base64'), mime: resolved.mime, name: resolved.name, size }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('openfilm:native:project-file-save-as', async (event, payload: unknown) => {
    const resolved = resolveProjectFile(payload)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { defaultPath: resolved.name }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      copyFileSync(resolved.abs, result.filePath)
      return { ok: true, path: result.filePath }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  /* 即梦 CLI 技能面(独立开关 dreamina.preferInFilm;视频剪辑技能管理页消费)。 */
  registerFilmDreaminaChannels({ ipcMain, channelHome: deps.channelHome() })
}
