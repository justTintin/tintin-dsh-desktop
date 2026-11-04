// Browser UI page preload (tintin channel-only). Serves BOTH the embedded
// browser view and the standalone browser window — the page (build/
// tintin-browser.html) consumes window.dshDesktopBrowser + window.tintinBrowserPage.
//
// A sandboxed preload can only require('electron')/builtins — a relative-chunk
// import ("module not found") kills the whole preload (2026-10-19 studio-preload
// incident). Channel names below are LOCAL LITERALS kept in sync with
// dsh-tintin-browser/src/browser/browser-service.ts (main-process side).
import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload)

/** Subscribe to a main→page event channel; returns an unsubscribe. */
function on(channel: string, listener: (payload: unknown) => void): () => void {
  const wrapped = (_event: unknown, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => { ipcRenderer.removeListener(channel, wrapped) }
}

const BROWSER_PAGE_BOUNDS = 'tintin-browser-page:bounds'
const BROWSER_PAGE_OPEN = 'tintin-browser-page:open'
const BROWSER_PAGE_ACTION = 'tintin-browser-page:action'
const BROWSER_PAGE_STATE = 'tintin-browser-page:state'
const EXTENSIONS_CHANGED = 'browser:extensions-changed'
const BILI_EXT_DL = 'browser:bili-ext-dl'
const DOWNLOAD_PROGRESS = 'downloads:progress'
const DOWNLOAD_DONE = 'downloads:done'
const DOWNLOAD_ERROR = 'downloads:error'
const AUTO_LISTING_PROGRESS = 'autoListing:onProgress'

const desktopBrowser = {
  // 平台/登录态/开窗（独立窗口路径仍由主进程 browser:open 承载；位置参数=平台 id）
  platforms: () => invoke('browser:platforms'),
  loginStatus: () => invoke('browser:loginStatus'),
  open: (platform: string) => invoke('browser:open', String(platform || '')),
  extractDOM: (payload: unknown) => invoke('browser:extractDOM', payload),
  exportCookies: (payload?: unknown) => invoke('browser:exportCookies', payload),
  // 嗅探/下载（每日素材视图已按 2026-11-04 用户裁决移除，getDailyAssets/openDailyAsset/
  // captureHotspots/onHotspotProgress 通道暴露点随之删除；revealDailyAsset 保留=历史视图「定位」在用）
  revealDailyAsset: (payload: unknown) => invoke('browser:revealDailyAsset', payload),
  sniffList: (payload?: unknown) => invoke('browser:sniffList', payload),
  sniffClear: (payload?: unknown) => invoke('browser:sniffClear', payload),
  sniffDownload: (payload: unknown) => invoke('browser:sniffDownload', payload),
  // 扩展管理
  extensionList: () => invoke('browser:extensionList'),
  extensionInstall: (payload: unknown) => invoke('browser:extensionInstall', payload),
  extensionUninstall: (payload: unknown) => invoke('browser:extensionUninstall', payload),
  extensionPickAndInstall: () => invoke('browser:extensionPickAndInstall'),
  onExtensionsChanged: (listener: (payload: unknown) => void) => on(EXTENSIONS_CHANGED, listener),
  // 下载扩展链（2026-10-26 复活：SRC media-downloader / thick-shell-viewpool 语义）
  /** B站下载助手推送（console 捕获 + 2s 轮询 shadow DOM 双通道） */
  onBiliExtDownloads: (listener: (payload: unknown) => void) => on(BILI_EXT_DL, listener),
  /** 抖音分享链接解析（主链路短链 302 → 视频页；API 兜底直链） */
  douyinParse: (payload: unknown) => invoke('browser:douyinParse', payload),
  /** 媒体下载（yt-dlp 主链路 / Cookie+Referer 直链 / 音视频分离 FFmpeg 合并） */
  downloadMediaStart: (payload: unknown) => invoke('browser:downloadMediaStart', payload),
  downloadMediaCancel: (payload: unknown) => invoke('browser:downloadMediaCancel', payload),
  // 自动上架（抖店工作台）
  autoListingListRuns: (payload?: unknown) => invoke('autoListing:listRuns', payload),
  autoListingValidate: (payload: unknown) => invoke('autoListing:validate', payload),
  autoListingStart: (payload: unknown) => invoke('autoListing:start', payload),
  autoListingStop: (payload: unknown) => invoke('autoListing:stop', payload),
  autoListingResume: (payload: unknown) => invoke('autoListing:resume', payload),
  autoListingStatus: (payload?: unknown) => invoke('autoListing:status', payload),
  autoListingOpenResultDir: (payload: unknown) => invoke('autoListing:openResultDir', payload),
  onAutoListingProgress: (listener: (payload: unknown) => void) => on(AUTO_LISTING_PROGRESS, listener),
  // 素材采集清单（达人库 UI 已按 2026-11-04 用户裁决移除，本通道是清单页唯一数据源）
  creatorsGetCollected: (payload: unknown) => invoke('creators:getCollected', payload),
  // 素材库（下载/嗅探记录；收藏三通道随网页收藏视图删除，历史视图只读下载+嗅探两记录）
  mediaStorageGetDownloads: (payload?: unknown) => invoke('media:storageGetDownloads', payload),
  mediaStorageGetSniffed: (payload?: unknown) => invoke('media:storageGetSniffed', payload),
  mediaStorageClearHistory: (payload: unknown) => invoke('media:storageClearHistory', payload),
  // 下载进度事件（页面下载栏）
  onDownloadEvent: (listeners: { progress?: (payload: unknown) => void; done?: (payload: unknown) => void; error?: (payload: unknown) => void }) => {
    const offs = [
      listeners.progress ? on(DOWNLOAD_PROGRESS, listeners.progress) : null,
      listeners.done ? on(DOWNLOAD_DONE, listeners.done) : null,
      listeners.error ? on(DOWNLOAD_ERROR, listeners.error) : null,
    ].filter((v): v is () => void => v !== null)
    return () => { for (const off of offs) off() }
  },
}

const tintinBrowserPage = {
  /** 页面宿主矩形上报（内嵌时=UI 视图内坐标；主进程合成外层偏移） */
  bounds: (rect: unknown) => invoke(BROWSER_PAGE_BOUNDS, rect),
  /** 平台切换（主进程 ensure 视图+导航） */
  open: (payload: { platform: string }) => invoke(BROWSER_PAGE_OPEN, payload),
  /** 工具条动作（back/forward/reload/stop/home/go/server） */
  action: (payload: unknown) => invoke(BROWSER_PAGE_ACTION, payload),
  /** 主进程导航态推送 */
  onState: (listener: (payload: unknown) => void) => on(BROWSER_PAGE_STATE, listener),
}

contextBridge.exposeInMainWorld('dshDesktopBrowser', desktopBrowser)
contextBridge.exposeInMainWorld('tintinBrowserPage', tintinBrowserPage)
