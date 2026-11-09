// ═══════════════════════════════════════════════════════════════
// context-menu.ts — 平台视图右键菜单（2026-11-08 第一批 P0 #6）
// Chromium 在 Electron 里默认没有网页右键菜单，按需组装：导航/链接/图片/编辑/
// 缩放。缩放动作经 deps.zoom 回调（browser-service 统一缩放并上屏百分比）。
// ═══════════════════════════════════════════════════════════════
import { Menu, clipboard, shell, type WebContentsView } from 'electron'

export interface ContextMenuDeps {
  /** 右键弹出宿主窗口（内嵌=主窗；独立窗形态=独立窗口） */
  popupHost: () => import('electron').BrowserWindow | null
  /** 缩放动作：delta=±0.5 步进，0=实际大小 */
  zoom: (view: WebContentsView, delta: number) => void
}

export function attachContextMenu(view: WebContentsView, deps: ContextMenuDeps): void {
  view.webContents.on('context-menu', (_e, params) => {
    const wc = view.webContents
    if (wc.isDestroyed()) return
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: '返回', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: '前进', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: '刷新', click: () => wc.reload() },
      { type: 'separator' },
    ]
    if (params.linkURL) {
      items.push(
        { label: '打开链接', click: () => { try { wc.loadURL(params.linkURL!).catch(() => { /* 页面自显示错误 */ }) } catch { /* 销毁竞态 */ } } },
        { label: '在新窗口打开链接', click: () => { try { shell.openExternal(params.linkURL!) } catch { /* 非法链接 */ } } },
        { label: '复制链接地址', click: () => clipboard.writeText(params.linkURL!) },
        { type: 'separator' },
      )
    }
    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        { label: '复制图片', click: () => { try { wc.copyImageAt(params.x, params.y) } catch { /* 坐标越界 */ } } },
        { label: '图片另存为…', click: () => { try { wc.downloadURL(params.srcURL!) } catch { /* 非法地址 */ } } },
        { type: 'separator' },
      )
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { type: 'separator' },
      )
    }
    if (params.selectionText) items.push({ role: 'copy', label: '复制选中文字' })
    items.push(
      { type: 'separator' },
      { label: '放大', click: () => deps.zoom(view, 0.5) },
      { label: '缩小', click: () => deps.zoom(view, -0.5) },
      { label: '实际大小', click: () => deps.zoom(view, 0) },
    )
    const host = deps.popupHost()
    Menu.buildFromTemplate(items).popup(...(host ? [{ window: host }] : []))
  })
}
