// native-shell-channels — openfilmNative 的文件/外开/截帧面 IPC handlers。
// 2026-11-19 自 main-hook.ts 迁出(铁律 4「迁移是唯一合法的降行数机会」):
// main-hook 是基线锁定超配文件(只减不增),即梦外开通道(open-external)入列时
// 连同整个 reveal/pick/capture 文件面一起搬出。行为逐字节等价迁移;
// shell 页 bridge.ts 的后端(见 film-acp.ts 头注),studioView 经 getter 访问。
import { BrowserWindow } from 'electron'
import type { Dialog, IpcMain, Shell, WebContentsView } from 'electron'

/** 注册 openfilm:native:reveal-path / pick-folder / open-external / capture 四通道。
 *  open-external 只放行 https/http(2026-11-19 即梦设备码登录事故:Studio 视图
 *  setWindowOpenHandler 无条件 deny,封面编辑器 iframe 的 target=_blank 被吞,
 *  授权流程卡死)——与 electron-shell-generation 的外开白名单同口径。 */
export function registerNativeShellChannels(deps: {
  ipcMain: IpcMain
  shell: Shell
  dialog: Dialog
  getStudioView: () => WebContentsView | null
}): void {
  const { ipcMain, shell, dialog, getStudioView } = deps
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
}
