// ═══════════════════════════════════════════════════════════════
// browser-service.ts — 浏览器域壳层引擎（2026-09-25 用户裁决提前移植首片）
// 形态沿革：2026-09-25 用户确认**独立窗口**（SRC browser-window.js 先例，
// close=hide 保登录态驻留）；2026-10-19 用户方案 4 裁决增补**主窗内嵌模式**
// （OpenFilm B 方案同款：UI 页+平台分区视图挂主窗 contentView，chrome 容器
// 矩形驱动）——内嵌为侧栏入口默认形态，独立窗口保留（面板按钮/loopback 兜底）。
//
// 登录态消费链（参考视频下载 yt-dlp 的前提，SRC 用户拍板方案「浏览器取 cookies」）：
//   各平台分区 session.cookies → Netscape 文件落 `<userData>/harness/tintin/browser/
//   cookies/cookies_<platform>.txt`（导航后防抖自动 + 窗口隐藏时 + 面板手动）→
//   宿主 ytdlp 门读该目录前置 --cookies。harness 子进程拿不到 Electron session，
//   导出只能在壳进程，走约定目录交接。
//   2026-09-28 分区事故修复：view 创建时未挂 partition（登录落默认 session，导出读
//   分区=永远空）→ view 按平台分区创建（Map 常驻）+ 默认 session 存量登录一次性迁回
//   分区（exportCurrentCookies/ensureBrowserView 时幂等触发）；宿主门另在 probe/download
//   前经回环主动同步（免手动导出，用户裁决）。
// ═══════════════════════════════════════════════════════════════
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell, WebContentsView } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  PLATFORM_COOKIE_DOMAINS,
  hasLoginCookie,  PLATFORM_DEFS,
  PLATFORM_IDS,
  detectPlatformFromUrl,
  isDeepLinkScheme,
  type PlatformDef,
} from './platform-meta.ts'
import { browserCookiesDir, collectPlatformCookies, migrateDefaultSessionCookies, exportPlatformCookies } from './cookie-sync.ts'
import { registerSettingsIpc } from './settings-store.ts'
import { registerHistoryBookmarkIpc } from './history-bookmark.ts'
import { attachContextMenu } from './context-menu.ts'
import { registerTabEngine, type TabEngineHandle } from './tab-engine.ts'
import { createPageDownloadMirror } from './page-downloads.ts'
import { createThemeSync } from './theme-sync.ts'
import type { TabPoolState } from './tab-model.ts'
import { buildExtractorScript, extractionError, extractorScriptDir } from './extract-script.ts'
import { createExtensionManager, platformSessions, findDouyinHelperDir, type ExtensionManager } from './ext-manager.ts'
import { bilibiliHelperInstalled, findBilibiliHelperDir, injectBilibiliHelper } from './bilibili-ext.ts'
import { createDownloadManager, type DownloadManager } from './download-manager.ts'
import { createMediaStorage, type MediaStorage } from './media-storage.ts'
import { captureHotspots } from './hotspot-capture.ts'
import { startLoopbackService, type LoopbackService } from './loopback-service.ts'
import { createMediaSniffer } from './media-sniffer.ts'
import { activeCapturePageUrl, registerSniffCapture } from './sniff-capture.ts'
import { registerDeepLinkSwallow } from './deep-link-guard.ts'
import { createCreatorsStoreIpc } from './creators-store.ts'
// 下载扩展链复活（2026-10-26；SRC thick-shell-viewpool.js / media-downloader.js / douyin-parse-logic.js）
import { attachBiliDlConsoleCapture, startBiliExtPolling } from './bili-ext-dl.ts'
import { createMediaDownloaderIpc } from './media-downloader.ts'
// 自动上架编排（SRC auto-listing/* 纯 JS 移植件；类型声明见 auto-listing/ipc.d.ts）
// @ts-expect-error 纯 JS ESM 移植件（附 ipc.d.ts 通配声明）
import { createAutoListingIpc } from './auto-listing/ipc.js'
import { homedir } from 'node:os'

/** 模块级日志（registerBrowserService 前也可能打点） */
let pageDownloadMirror: ReturnType<typeof import('./page-downloads.ts').createPageDownloadMirror> | null = null
function downloadMirror(): ReturnType<typeof import('./page-downloads.ts').createPageDownloadMirror> {
  if (!pageDownloadMirror) pageDownloadMirror = createPageDownloadMirror(pageHost)
  return pageDownloadMirror
}

function ctxLog(msg: string): void {
  console.log(`[TinTinBrowser] ${msg}`)
}

// 导航意图 URL（主框架 commit 前地址栏占位；commit 后真实 URL 接管并清除）
const pendingNavUrl = new Map<number, string>()
function recordNavIntent(wc: import('electron').WebContents, url: string): void {
  pendingNavUrl.set(wc.id, url)
  pushPageState()
}


// 底色主题判定引擎在 theme-sync.ts（2026-11-08 白底修复 §16.23）
let themeSync: ReturnType<typeof import('./theme-sync.ts').createThemeSync> | null = null
function themedBackground(): string {
  if (!themeSync) themeSync = createThemeSync({
    hostWebContents: () => (mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef.webContents : null),
    views: () => [...browserViews.values(), ...tabViews.values(), ...(embedPageView && !embedPageView.webContents.isDestroyed() ? [embedPageView] : [])],
  })
  return themeSync.themedBackground()
}
function probeWebTheme(): void { themedBackground(); themeSync?.probe() }

/** 壳 → 页面 UI 消息（页内查找开合/地址栏聚焦/区块跳转/提示 toast） */
function sendUi(payload: Record<string, unknown>): void {
  const host = pageHost()
  if (!host) return
  try { host.webContents.send('tintin-browser-page:ui', payload) } catch { /* 页面未就绪 */ }
}

/** 平台视图缩放（level 步进 ±0.5；0=实际大小），百分比 toast 上屏 */
function zoomStep(view: WebContentsView, delta: number): void {
  try {
    const level = delta === 0 ? 0 : Math.max(-4, Math.min(4, view.webContents.getZoomLevel() + delta))
    view.webContents.setZoomLevel(level)
    sendUi({ op: 'toast', message: `缩放 ${Math.round(Math.pow(1.2, level) * 100)}%` })
  } catch { /* 销毁竞态 */ }
}

/** cookies 交接目录与导出/迁移链见 cookie-sync.ts（2026-11-08 提取付账） */

// ── 引擎状态（SRC viewPool 语义：每平台分区一个 view 常驻保登录态；active 跟随 currentPlatform）──
// 2026-09-28 登录态分区事故：view 此前创建时未挂 partition，登录全部落到默认 session，
// 而 cookies 导出/登录态展示读的是各平台分区 → 导出永远为空 → yt-dlp 拿不到登录态。
// 修复=按分区建 view + 默认 session 存量登录一次性迁移（见 migrateDefaultSessionCookies）。

const browserViews = new Map<string, WebContentsView>()
// 标签池（2026-11-08 第二批 #2）：tabId → view。同平台多标签各持一个 view、共享分区
// （登录态分区隔离不变）；平台行单视图语义保留（标签池空时 browserViews 兜底路径照旧）。
const tabViews = new Map<string, WebContentsView>()
let tabPool: TabPoolState = { tabs: [], activeId: null }
let browserWindow: BrowserWindow | null = null
let currentPlatform: string | null = null
let userQuit = false
let extManager: ExtensionManager | null = null
let downloadManager: DownloadManager | null = null
let mediaStorage: MediaStorage | null = null
let loopback: LoopbackService | null = null
// Retained handles anchor the side-effect services for the process lifetime
// (exactOptional/noUnused contract of this repository).
void mediaStorage
void loopback
// 浏览器窗口页面（build/tintin-browser.html，2026-09-28 用户裁决：整体按原客户端
// 实现——页面承载工具条/左栏/右栏/下载栏，原生视图按页面宿主矩形覆盖）
let pageHostRect: { x: number; y: number; width: number; height: number } | null = null
/** 内嵌态原生视图挂载后的宿主回调（main-hook 注入的标题条置顶，见 registerBrowserService options）。 */
let onNativeViewMounted: (() => void) | null = null
// 媒体嗅探（SRC webview 注入方案的壳侧等价；按平台分区缓冲，页面拉取；
// 数据面 IPC 与后台捕获窗口在 sniff-capture.ts）

// ── 内嵌模式（2026-10-19 用户方案 4：浏览器=主窗内嵌界面，OpenFilm B 方案同款）──
// UI 页（tintin-browser.html）作为 WebContentsView 挂主窗 contentView，外层矩形由
// chrome 容器上报（dsh-desktop:browser-view，main-hook 转发）；平台分区视图在内层
// （页面上报的 #view-host 矩形）按两层合成定位。独立窗口与内嵌互斥：内嵌 show 时
// 藏独立窗（close=hide 语义），browser:open 打开独立窗时先卸内嵌。
let mainWindowRef: BrowserWindow | null = null
let embedPageView: WebContentsView | null = null
let embedActive = false
let embedOuterRect = { x: 0, y: 0, width: 0, height: 0 }
let pagePreloadPath: string | null = null

export interface EmbedRect { x: number; y: number; width: number; height: number }

/** 两层 bounds 合成（纯函数，2026-10-19 内嵌模式）：外层=chrome 容器矩形（主窗
 *  内容坐标），内层=页面 #view-host 矩形（页面视图内坐标，zoom 1 下 CSS px==DIP）。
 *  结果=平台分区视图在主窗 contentView 的 setBounds 入参；宽高按外层余量截断防溢出。 */
export function composeEmbedBounds(outer: EmbedRect, inner: EmbedRect): EmbedRect {
  const clamp = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0)
  const x = clamp(outer.x) + clamp(inner.x)
  const y = clamp(outer.y) + clamp(inner.y)
  const width = clamp(Math.min(clamp(inner.width), clamp(outer.width) - clamp(inner.x)))
  const height = clamp(Math.min(clamp(inner.height), clamp(outer.height) - clamp(inner.y)))
  return { x, y, width, height }
}

/** 当前页面载体：内嵌=UI 页视图；独立窗形态=窗口本体（webContents 可发消息的最小面） */
function pageHost(): { webContents: import('electron').WebContents } | null {
  if (embedActive) return embedPageView && !embedPageView.webContents.isDestroyed() ? embedPageView : null
  return browserWindow && !browserWindow.isDestroyed() ? browserWindow : null
}

/** 平台视图当前的宿主窗口：内嵌=主窗；独立窗形态=独立窗口 */
function hostWin(): BrowserWindow | null {
  if (embedActive) return mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null
  return browserWindow && !browserWindow.isDestroyed() ? browserWindow : null
}

/** 从两个可能宿主上都摘下平台视图（形态切换/无矩形时的幂等卸载）。
 *  摘下即静音（2026-11-08 报障修复）：摘下但存活的视图会继续出声（登录态驻留设计
 *  不销毁视图），语义=看得见的平台才是出声的那个；挂回点统一解除静音。 */
function detachPlatformView(view: WebContentsView): void {
  for (const win of [browserWindow, mainWindowRef]) {
    if (win && !win.isDestroyed()) {
      try { win.contentView.removeChildView(view) } catch { /* 未挂载 */ }
    }
  }
  try { view.webContents.audioMuted = true } catch { /* 销毁竞态 */ }
}

function platformOf(p: string | null): PlatformDef | null {
  return p ? PLATFORM_DEFS[p] ?? null : null
}

/** 当前活跃 view：标签池活跃标签优先（第二批 #2），否则平台行单视图兜底 */
function activeView(): WebContentsView | null {
  if (tabPool.activeId) {
    const v = tabViews.get(tabPool.activeId)
    return v && !v.webContents.isDestroyed() ? v : null
  }
  const v = currentPlatform ? browserViews.get(currentPlatform) : null
  return v && !v.webContents.isDestroyed() ? v : null
}

/** 活跃标签的分区平台（标签池路径用；无标签回落 currentPlatform） */
function activeTabPlatform(): string | null {
  if (tabPool.activeId) {
    const t = tabPool.tabs.find((x) => x.id === tabPool.activeId)
    if (t) return t.platform
  }
  return currentPlatform
}

/** 本地页面资源路径（同 index.ts desktopResourcePath 口径） */
function browserPagePath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'tintin-browser.html') : join(app.getAppPath(), 'build', 'tintin-browser.html')
}

/** 导航态推给页面工具条（activeView 的 URL/导航能力/加载中 + 平台 id） */
function pushPageState(): void {
  const host = pageHost()
  if (!host) return
  const wc = activeView()?.webContents
  let url = ''
  let canBack = false
  let canForward = false
  let loading = false
  try {
    if (wc && !wc.isDestroyed()) {
      url = wc.getURL?.() || ''
      loading = wc.isLoading()
      // commit 前 getURL=''→意图 URL 占位（2026-11-08 报障：发起跳转瞬间地址栏必须有目标网址）
      if (!url && loading) url = pendingNavUrl.get(wc.id) || ''
      if (url) {
        canBack = wc.navigationHistory.canGoBack()
        canForward = wc.navigationHistory.canGoForward()
      }
    }
  } catch { /* 销毁竞态，按空态推 */ }
  try {
    host.webContents.send('tintin-browser-page:state', { url, canBack, canForward, loading, platform: activeTabPlatform(), tabs: tabPool.tabs, activeTabId: tabPool.activeId })
  } catch { /* 页面未就绪 */ }
}

/** 窗口布局：活跃平台 view 覆盖页面宿主矩形（页面侧 ResizeObserver 上报）。
 *  内嵌模式（2026-10-19）：宿主=主窗 contentView，平台视图 bounds=外层容器
 *  矩形 + 页面内层矩形两层合成（composeEmbedBounds）；独立窗形态原样。 */
function layoutBrowserWindow(): void {
  const view = activeView()
  if (!view) return
  const rect = pageHostRect
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    detachPlatformView(view)
    return
  }
  if (embedActive) {
    const win = hostWin()
    if (!win) return
    view.setBounds(composeEmbedBounds(embedOuterRect, rect))
    try { win.contentView.addChildView(view) } catch { /* 已挂载 */ }
    // 挂载点统一恢复出声（与 detachPlatformView 的摘下静音配对）
    try { view.webContents.audioMuted = false } catch { /* 销毁竞态 */ }
    try { onNativeViewMounted?.() } catch { /* 宿主回调异常不阻断挂载 */ }
    return
  }
  const win = browserWindow
  if (!win || win.isDestroyed()) return
  view.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  try { win.contentView.addChildView(view) } catch { /* 已挂载 */ }
  try { view.webContents.audioMuted = false } catch { /* 销毁竞态 */ }
}

function ensureBrowserView(platform: string): WebContentsView {
  const existing = browserViews.get(platform)
  if (existing && !existing.webContents.isDestroyed()) return existing
  const def = platformOf(platform)
  if (!def) throw new Error(`未知平台: ${platform}`)
  const view = new WebContentsView({
    webPreferences: {
      // 根因修复（2026-09-28）：必须挂平台持久分区——不挂=默认 session，
      // 登录进不去分区，导出/展示/下载链路全部读到空
      partition: def.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 内嵌站点是任意第三方页面：guest 内不给 preload/Node 面
      webSecurity: true,
      spellcheck: false,
    },
  })
  view.setBackgroundColor(themedBackground())
  view.webContents.setWindowOpenHandler(({ url }) => {
    // 2026-11-04 限制清除批（用户裁决）：弹窗/新页语义回归普通浏览器 —— http(s) 就地
    // 在本分区视图打开（弹窗式 OAuth 登录态因此落进本分区，cookie 导出链可达）；
    // 其余协议一律拒绝，不再外投系统浏览器（原 SRC C7「外链交系统浏览器」红线退役）。
    if (/^https?:\/\//i.test(url)) {
      try { recordNavIntent(view.webContents, url); view.webContents.loadURL(url).catch(() => { /* 页面自显示错误 */ }) } catch { /* 视图销毁竞态 */ }
    }
    return { action: 'deny' }
  })
  // App 深链拦截（2026-11-04 用户裁决「按推荐处理」）：外部协议导航不再转交系统 ——
  // 防 Windows「获取打开此'bytedance'链接的应用」弹窗与甩出产品。主帧（点击/页面跳转）
  // 命中名单协议直接取消，页面停在原地；子帧与残余路径由分区协议吞掉（registerDeepLinkSwallow）。
  view.webContents.on('will-navigate', (event, url) => {
    try {
      const scheme = new URL(url).protocol.replace(/:$/, '')
      if (isDeepLinkScheme(scheme)) {
        event.preventDefault()
        ctxLog(`deep link blocked (main frame): ${scheme}://`)
      }
    } catch { /* 非法 URL 不拦 */ }
  })
  // 右键菜单（2026-11-08 第一批 P0 #6）：导航/链接/图片/编辑/缩放
  attachContextMenu(view, { popupHost: () => hostWin(), zoom: (v, d) => zoomStep(v, d) })
  // 快捷键（2026-11-08 第一批 P0 #8）：平台视图内 Ctrl+F 查找 / Ctrl+L 地址栏 / Ctrl+H 历史 /
  // Ctrl+=/-/0 缩放 / F5·Ctrl+R 重载
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    const key = String(input.key || '').toLowerCase()
    if (ctrl && key === 'f') { event.preventDefault(); sendUi({ op: 'find-open' }) }
    else if (ctrl && (key === '=' || key === '+')) { event.preventDefault(); zoomStep(view, 0.5) }
    else if (ctrl && key === '-') { event.preventDefault(); zoomStep(view, -0.5) }
    else if (ctrl && key === '0') { event.preventDefault(); zoomStep(view, 0) }
    else if (input.key === 'F5' || (ctrl && key === 'r')) { event.preventDefault(); view.webContents.reload() }
    else if (ctrl && key === 'l') { event.preventDefault(); sendUi({ op: 'focus-addr' }) }
    else if (ctrl && key === 'h') { event.preventDefault(); sendUi({ op: 'open-section', section: 'history' }) }
  })
  // 页内查找结果回推（2026-11-08 第一批 P0 #5）
  view.webContents.on('found-in-page', (_e, result) => {
    const host = pageHost()
    if (!host) return
    try { host.webContents.send('tintin-browser-page:find-result', { ordinal: result.activeMatchOrdinal, total: result.matches }) } catch { /* 页面未就绪 */ }
  })
  // 登录态落盘：导航稳定后延迟导出（避免每帧请求写盘）；导航态同步推页面工具条
  let exportTimer: NodeJS.Timeout | null = null
  const onNavEvent = (): void => {
    if (exportTimer) clearTimeout(exportTimer)
    exportTimer = setTimeout(() => { void exportCurrentCookies() }, 2000)
    pushPageState()
  }
  view.webContents.on('did-navigate', (_e, url) => {
    pendingNavUrl.delete(view.webContents.id)
    void url
    onNavEvent()
    // B站下载助手：随包扩展注入（SRC viewpool platformId==='bilibili' 分支同口径；
    // 装了插件 → B站下载交给插件，无需嗅探）。view 挂分区后此 session 即 view 所用 session
    if (platform === 'bilibili' && bilibiliHelperInstalled()) {
      const extPath = findBilibiliHelperDir()
      const sess = session.fromPartition(PLATFORM_DEFS.bilibili!.partition)
      if (extPath && sess) injectBilibiliHelper(view.webContents, extPath, sess)
    }
  })
  view.webContents.on('did-navigate-in-page', onNavEvent)
  view.webContents.on('did-start-loading', () => pushPageState())
  view.webContents.on('did-stop-loading', () => pushPageState())
  // B站扩展下载链接 console 捕获（2026-10-26 复活，SRC viewpool L237-254 冗余通道；
  // 主动轮询已升级为宿主级「跟随活跃 B站内容面」，见 registerTabEngine 之后的宿主轮询）
  if (platform === 'bilibili') {
    attachBiliDlConsoleCapture(view.webContents, (pl) => downloadMirror().pushBiliExtDl(pl))
  }
  // 分区存量救援：分区空而默认 session 有该平台登录（分区事故期间落的）→ 迁回
  void migrateDefaultSessionCookies(platform, ctxLog)
  browserViews.set(platform, view)
  return view
}

function attachToWindow(): void {
  const win = hostWin()
  if (!win) return
  const view = activeView()
  if (!view) return
  // 原生下载接管（幂等：session 每分区只挂一次）；挂活跃标签/平台的分区 session
  const focusPlatform = activeTabPlatform() ?? currentPlatform
  const sess = platformOf(focusPlatform)
    ? session.fromPartition(platformOf(focusPlatform)!.partition)
    : session.defaultSession
  if (downloadManager && !(sess as unknown as { __tintinDlAttached?: boolean }).__tintinDlAttached) {
    ;(sess as unknown as { __tintinDlAttached?: boolean }).__tintinDlAttached = true
    downloadManager.attachSession(sess)
  }
  // 切换焦点：其余 view（平台单视图+标签视图）全部摘下并静音（本体常驻保登录态）
  for (const v of browserViews.values()) {
    if (v !== view) detachPlatformView(v)
  }
  for (const v of tabViews.values()) {
    if (v !== view) detachPlatformView(v)
  }
  win.contentView.addChildView(view)
  layoutBrowserWindow()
  pushPageState()
}

/** 标签引擎句柄（registerTabEngine 返回；导航中枢的 tab 化入口）。 */
let tabEnsure: TabEngineHandle['ensureTab'] | null = null

/** 导航到平台（2026-11-13 用户裁决「像正常浏览器一样」·tab 化根治）：一切导航
 *  （平台行/收藏/回环门面/嗅探下载/种子页）都落到标签池——该平台已有标签则聚焦
 *  保持现场（跨平台切换互不重载，原「同平台保持现场/fxg 永不重载」语义由标签
 *  本体天然承担），无则新建标签并载种子页。打开过的页面全部在顶部 tab 栏可见、
 *  可切、可关。 */
function navigateTo(platform: string, targetUrl?: string): { ok: boolean; error?: string } {
  const def = platformOf(platform)
  if (!def) return { ok: false, error: `未知平台: ${platform}` }
  // 非 embed 形态首次进入保独立窗存在（原语义）
  if (!embedActive && (!browserWindow || browserWindow.isDestroyed()) && mainWindowRef && !mainWindowRef.isDestroyed()) {
    ensureBrowserWindow(mainWindowRef)
  }
  const ensured = tabEnsure?.(platform)
  if (!ensured) return { ok: false, error: '标签创建失败（已达上限或平台未知）' }
  if (targetUrl) {
    const view = tabViews.get(ensured.id)
    if (view && !view.webContents.isDestroyed()) {
      recordNavIntent(view.webContents, targetUrl)
      void view.webContents.loadURL(targetUrl).catch(() => {})
    }
  }
  return { ok: true }
}

/** 导出 cookies（有当前平台只导它；否则全平台逐个导；返回各平台条数）。
 *  每平台导出前先做默认 session→分区存量迁移（幂等，见 migrateDefaultSessionCookies），
 *  保证 probe/download 的自动同步即使不打开浏览器窗口也能救回事故期登录。 */
async function exportCurrentCookies(): Promise<Record<string, number>> {
  const dir = browserCookiesDir()
  mkdirSync(dir, { recursive: true })
  const focused = activeTabPlatform() ?? currentPlatform
  const targets = focused ? [focused] : Object.keys(PLATFORM_COOKIE_DOMAINS)
  const result: Record<string, number> = {}
  for (const platform of targets) {
    await migrateDefaultSessionCookies(platform, ctxLog)
    const out = await exportPlatformCookies(platform, join(dir, `cookies_${platform}.txt`))
    result[platform] = out?.count ?? 0
  }
  return result
}

/** 加载浏览器整体页面（build/tintin-browser.html；打包=resources 根） */
async function loadDesktopPage(win: BrowserWindow): Promise<void> {
  try {
    await win.loadFile(browserPagePath())
  } catch (err) {
    ctxLog('browser page load failed: ' + (err instanceof Error ? err.message : err))
  }
}

/** 独立窗口（SRC browser-window.js 先例）：单实例、close=hide（登录态/缓存驻留） */
function ensureBrowserWindow(mainWindow: BrowserWindow): BrowserWindow {
  if (browserWindow && !browserWindow.isDestroyed()) return browserWindow
  browserWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: 'TinTin 浏览器',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      // 2026-10-19：main-hook 下发 browser-page-preload 路径后页面桥（dshDesktopBrowser/
      // tintinBrowserPage）才真正接通（此前无暴露点，页面防御性降级）；缺省回退旧路径
      preload: pagePreloadPath ?? join(import.meta.dirname, '../preload/index.cjs'),
    },
  })
  // 整体页面（工具条/左栏/右栏/下载栏）承载 UI；原生 view 由 bounds 同步覆盖宿主矩形
  void loadDesktopPage(browserWindow)
  // 视图跟随窗口尺寸（2026-09-28 用户报障：最大化后仍显示创建时的局部——
  // 挂载只设了一次 bounds，缺 resize 跟随）。统一走 layoutBrowserWindow。
  browserWindow.on('resize', () => layoutBrowserWindow())
  browserWindow.on('close', (ev) => {
    if (userQuit) return
    ev.preventDefault()
    try {
      browserWindow?.hide()
      void exportCurrentCookies()
    } catch { /* hide 失败让系统关闭 */ }
  })
  browserWindow.on('hide', () => { void exportCurrentCookies() })
  browserWindow.once('ready-to-show', () => browserWindow?.show())
  // 宿主窗口关闭时同步收掉独立窗口（登录态由分区 session 持久化，不随窗口销毁）
  mainWindow.on('closed', () => {
    userQuit = true
    try { browserWindow?.destroy() } catch { /* 已销毁 */ }
  })
  return browserWindow
}

/** 注册壳侧 IPC（createWindow 之后调用；mainWindow 用于独立窗口生命周期联动） */
/** 登录态自动落盘（2026-09-28 用户裁决：客户端与内置浏览器一体，登录即同步，
 *  不存在手动导出）。分区 cookie 任何变化 / 内嵌页导航后防抖导出一次。 */
const cookieSyncTimers = new Map<string, NodeJS.Timeout>()

function scheduleCookieSync(platform: string | null = null): void {
  const key = platform || '*'
  const prev = cookieSyncTimers.get(key)
  if (prev) clearTimeout(prev)
  cookieSyncTimers.set(key, setTimeout(() => {
    cookieSyncTimers.delete(key)
    void exportCurrentCookies().catch(() => { /* 同步失败下次变化重试 */ })
  }, 2000))
}

/** 一次性挂各平台分区 cookie 变化监听（login/logout/刷新都会触发 changed） */
let cookieWatchInstalled = false

// ── 内嵌生命周期（main-hook 经 dsh-desktop:browser-view 通道驱动；2026-10-19 方案 4）──

/** 创建/复用内嵌 UI 页视图（tintin-browser.html + browser-page-preload），记下宿主主窗 */
export function embedAttach(win: BrowserWindow): { ok: boolean; error?: string } {
  if (!pagePreloadPath) return { ok: false, error: 'browser page preload unavailable' }
  mainWindowRef = win
  if (embedPageView && !embedPageView.webContents.isDestroyed()) return { ok: true }
  embedPageView = new WebContentsView({
    webPreferences: {
      preload: pagePreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  })
  embedPageView.setBackgroundColor(themedBackground())
  try { embedPageView.webContents.loadFile(browserPagePath()).catch(() => { /* 页面自显示错误 */ }) } catch { /* 视图销毁竞态 */ }
  return { ok: true }
}

/** 按外层容器矩形显示内嵌（幂等挂载 + 每次定位）；独立窗口互斥（藏起，登录态驻留） */
export function embedShow(bounds: EmbedRect): { ok: boolean; error?: string } {
  const win = mainWindowRef
  if (!win || win.isDestroyed()) return { ok: false, error: 'main window unavailable' }
  if (!embedPageView || embedPageView.webContents.isDestroyed()) return { ok: false, error: 'embed page not ready' }
  try { if (browserWindow && !browserWindow.isDestroyed() && browserWindow.isVisible()) browserWindow.hide() } catch { /* 已隐藏 */ }
  const wasActive = embedActive
  embedActive = true
  // bounds 去重（2026-10-21 报障：重复 setBounds 迫使合成器不断重排原生视图）：
  // 已挂载且四值不变时跳过定位。
  const nextRect = {
    x: Math.round(Number(bounds.x) || 0),
    y: Math.round(Number(bounds.y) || 0),
    width: Math.max(0, Math.round(Number(bounds.width) || 0)),
    height: Math.max(0, Math.round(Number(bounds.height) || 0)),
  }
  const unchanged = wasActive
    && embedOuterRect.x === nextRect.x && embedOuterRect.y === nextRect.y
    && embedOuterRect.width === nextRect.width && embedOuterRect.height === nextRect.height
  embedOuterRect = nextRect
  if (!wasActive) {
    try { win.contentView.addChildView(embedPageView) } catch { /* 已挂载 */ }
    try { onNativeViewMounted?.() } catch { /* 宿主回调异常不阻断挂载 */ }
    // 默认落点（2026-11-13 用户裁决「默认进入应该有默认地址」）：首次进入且从未激活
    // 过任何平台视图 → 导航网页浏览器种子页（此前只有白占位+空地址栏）。重入
    // （KeepAlive，平台视图已有现场）不重播种子——挂回由 layoutBrowserWindow 统一处理。
    if (tabPool.tabs.length === 0) navigateTo('web') // 首次种子（tab 化后按标签池判，2026-11-13）
  }
  if (!unchanged) embedPageView.setBounds(embedOuterRect)
  layoutBrowserWindow()
  pushPageState()
  return { ok: true }
}

/** 卸下内嵌（UI 页+平台视图都从主窗摘下；页面态/平台视图本体保留=KeepAlive），并导 cookies */
export function embedHide(): void {
  if (!embedActive) return
  embedActive = false
  embedOuterRect = { x: 0, y: 0, width: 0, height: 0 }
  const win = mainWindowRef
  if (win && !win.isDestroyed()) {
    if (embedPageView && !embedPageView.webContents.isDestroyed()) {
      try { win.contentView.removeChildView(embedPageView) } catch { /* 未挂载 */ }
    }
    const view = activeView()
    if (view) detachPlatformView(view)
  }
  void exportCurrentCookies().catch(() => { /* 同步失败下次变化重试 */ })
}

/** 销毁内嵌 UI 页视图（当前无调用方——保留给未来「关闭浏览器」入口） */
export function embedClose(): void {
  embedHide()
  const view = embedPageView
  embedPageView = null
  if (view && !view.webContents.isDestroyed()) view.webContents.close()
}

export function registerBrowserService(
  mainWindow: BrowserWindow,
  options: {
    pagePreloadPath?: string
    /** 内嵌态原生视图（UI 页/平台分区）挂进主窗后的宿主回调——标题条 chrome 层重排回顶层用（2026-11-13 报障：弹层被嵌入视图盖住）。 */
    onNativeViewMounted?: () => void
  } = {},
): void {
  mainWindowRef = mainWindow
  pagePreloadPath = options.pagePreloadPath ?? null
  onNativeViewMounted = options.onNativeViewMounted ?? null
  // App 深链吞掉注册（进程内一次；registerBrowserService 只在首窗创建时进一次）
  registerDeepLinkSwallow(ctxLog)
  probeWebTheme() // 主题初始化+导航探针（web 层真值，2026-11-08 白底修复 §16.23）
  try {
    const themeMo = (): void => probeWebTheme()
    mainWindow.webContents.on('dom-ready', themeMo)
    mainWindow.webContents.on('did-navigate', themeMo)
    mainWindow.webContents.on('did-navigate-in-page', themeMo)
  } catch { /* 窗口生命周期竞态 */ }
  // 下载落盘根（2026-11-08 前移：设置页/下载目录展示在注册早期就要用）
  const workspaceDir = (): string =>
    process.env.TINTIN_WORKSPACE_DIR
      || join(homedir(), 'Documents', 'tintin-workspace')
  // 设置存储/代理应用/清除数据（2026-11-08 第一批 P0「设置入口」；注册即读盘并应用代理）
  const settingsStore = registerSettingsIpc(ipcMain, { workspaceDir, log: ctxLog })
  // 媒体嗅探先于挂接创建（2026-11-04 修复：原创建语句在挂接循环之后约 200 行，
  // 可选链在 null 上静默吞掉 → 嗅探器从未挂上 session，功能自移植起不可用）
  const sniffer = createMediaSniffer()
  // 登录即同步：cookie 变化防抖自动导出（网页/独立窗口两形态通用）；嗅探挂接覆盖全部
  // 平台分区（含 web/jimeng——原循环骑在 cookie 域名单上漏了 web，网页浏览器分区的
  // 媒体永远嗅不到）；pageUrl 供应方=该平台当前页 URL（详情页白名单门，见 sniffer attach）
  if (!cookieWatchInstalled) {
    cookieWatchInstalled = true
    for (const platform of Object.keys(PLATFORM_COOKIE_DOMAINS)) {
      try {
        session.fromPartition(PLATFORM_DEFS[platform]!.partition).cookies.on('changed', () => scheduleCookieSync(platform))
      } catch (err) {
        ctxLog(`cookie watch failed for ${platform}: ${err instanceof Error ? err.message : err}`)
      }
    }
    for (const platform of PLATFORM_IDS) {
      try {
        sniffer.attach(session.fromPartition(PLATFORM_DEFS[platform]!.partition), platform, () => {
          // 捕获会话优先（2026-11-11 方案 1：详情页门控看捕获页，用户切到别的平台也不漏抓）
          const captureUrl = activeCapturePageUrl(platform)
          if (captureUrl) return captureUrl
          const view = browserViews.get(platform)
          return view && !view.webContents.isDestroyed() ? view.webContents.getURL() ?? '' : ''
        })
      } catch (err) {
        ctxLog(`media sniffer attach failed for ${platform}: ${err instanceof Error ? err.message : err}`)
      }
    }
    // 平台分区代理（2026-11-08）：由 settings-store 统一应用（system/direct/manual，
    // 注册时读 settings.json 并生效——默认 system 保持「跟随系统」语义不变）
    // 视图底色跟随系统主题（2026-11-08 报障白底）：主题切换事件同步所有存活视图
    try {
      nativeTheme.on('updated', () => { themedBackground(); themeSync?.probe() })
    } catch { /* nativeTheme 事件不可用则保持创建时底色 */ }
  }
  // ── 浏览器窗口页面通道（2026-09-28 整体形态：页面承载 UI，原生视图按宿主矩形覆盖）──
  ipcMain.handle('tintin-browser-page:bounds', (_e, rect: unknown) => {
    const r = (rect || {}) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    pageHostRect = { x: Number(r.x) || 0, y: Number(r.y) || 0, width: Number(r.width) || 0, height: Number(r.height) || 0 }
    layoutBrowserWindow()
    return { ok: true }
  })
  ipcMain.handle('tintin-browser-page:open', (_e, payload: unknown) => {
    const id = String((payload as { platform?: unknown })?.platform || '')
    if (!platformOf(id)) return { ok: false, error: `未知平台: ${id}` }
    if (embedActive) return navigateTo(id) // 内嵌（2026-10-19）：主窗即宿主，不 ensure 独立窗/抢焦点
    const win = ensureBrowserWindow(mainWindow)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return navigateTo(id)
  })
  ipcMain.handle('tintin-browser-page:action', (_e, payload: unknown) => {
    const a = (payload || {}) as { type?: unknown; url?: unknown }
    const type = String(a.type || '')
    // 地址栏直达（2026-11-04 限制清除批，用户裁决）：无活跃视图也照跳，并按域名路由
    // 平台分区 —— 已知平台网址落自己的分区（登录态进导出链读的 cookie jar），其余落 web。
    if (type === 'go' && a.url) {
      const routed = detectPlatformFromUrl(String(a.url)) ?? 'web'
      return navigateTo(routed, String(a.url))
    }
    if (type === 'home') {
      // 主页按钮：设置里有主页网址则去主页（域名路由分区），否则当前平台首页
      const hp = String(settingsStore.getSettings().homepage || '').trim()
      if (hp && /^https?:\/\//i.test(hp)) return navigateTo(detectPlatformFromUrl(hp) ?? 'web', hp)
      const target = activeView() && currentPlatform ? currentPlatform : 'web'
      const seed = platformOf(target)?.seedUrl || PLATFORM_DEFS.web!.seedUrl
      return navigateTo(target, seed)
    }
    const wc = activeView()?.webContents
    if (!wc) return { ok: false, error: '尚未打开任何平台页面' }
    try {
      if (type === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      else if (type === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
      else if (type === 'reload') wc.reload()
      else if (type === 'stop') wc.stop()
      else {
        return { ok: false, error: '未知动作' }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  app.on('before-quit', () => { userQuit = true })

  // ── 扩展管理（SRC thickShell 启动段 + ext:* 三通道移植）────────────────
  // userData/extensions 清单 + 各平台分区 session 逐个 loadExtension；
  // 清单变化经 browser:extensions-changed 广播给 harness 主窗口（chrome 面板刷新）。
  extManager = createExtensionManager({
    getRoot: () => join(app.getPath('userData'), 'extensions'),
    listSessions: () => platformSessions((partition) => session.fromPartition(partition, { cache: true })),
    broadcast: (extensions) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('browser:extensions-changed', { extensions })
        }
      } catch { /* 窗口已销毁 */ }
    },
    findDouyinHelperDir,
    log: (msg) => ctxLog(msg),
  })
  extManager.init()
  extManager.preloadBuiltinDouyin()
  void extManager.reloadInstalled()
  // 扩展安装：页面内一键选包（SRC extensions-panel.html 安装流 1:1：dialog crx/zip → install）
  ipcMain.handle('browser:extensionPickAndInstall', async () => {
    try {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '安装扩展（crx / zip）',
        properties: ['openFile'],
        filters: [{ name: '扩展', extensions: ['crx', 'zip'] }],
      })
      if (r.canceled || !r.filePaths?.length) return { success: false, cancelled: true }
      return extManager ? extManager.install(r.filePaths[0]!) : { success: false, message: '扩展管理器未初始化' }
    } catch (err) {
      return { success: false, message: '安装失败：' + (err instanceof Error ? err.message : String(err)) }
    }
  })

  // ── 下载管理器 + 媒体存储（SRC thickShell ctx.downloadManager / media-storage 移植）──
  // 下载落盘根 = 默认工作区 materials（/tintin/media 白名单根内，产物可直接预览）
  // 下载总线出口：download-manager（视图/URL 下载）与 media-downloader（媒体下载器
  // 复活件：yt-dlp 主链路/直链/音视频合并）共用，页面底部下载栏统一渲染进度
  // 页面载体必须逐面投递（2026-11-12 报障根因）：浏览器 UI 页是独立 renderer
  // （内嵌=WebContentsView / 独立=browserWindow），宿主窗的 webContents.send 到不了
  // 它——页面下载栏的 onDownloadEvent 自上架起一个事件都没收到过，「进度见底部
  // 下载栏」全程空话（文件其实下完了，用户只看到一句开始下载）。
  const downloadEmit = (channel: 'downloads:progress' | 'downloads:done' | 'downloads:error', payload: Record<string, unknown>): void => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
    } catch { /* 窗口已销毁 */ }
    const page = pageHost()
    try {
      if (page && !page.webContents.isDestroyed()) page.webContents.send(channel, payload)
    } catch { /* 页面未就绪 */ }
    downloadMirror().mirror(channel, payload)
  }
  downloadManager = createDownloadManager({
    workspacePath: workspaceDir,
    emit: downloadEmit,
  })
  downloadManager.registerIpc(ipcMain)
  const mediaDownloader = createMediaDownloaderIpc({
    ipcMain,
    appLike: { isPackaged: app.isPackaged, getPath: (name) => app.getPath(name) },
    sessionFromPartition: (partition) => session.fromPartition(partition),
    emit: downloadEmit,
    downloadDir: () => join(workspaceDir(), 'materials'),
    log: (msg) => ctxLog(msg),
  })
  mediaStorage = createMediaStorage(ipcMain, {
    storeFile: join(app.getPath('userData'), 'tintin', 'browser', 'media-storage.json'),
    downloadsDir: () => app.getPath('downloads'),
  })
  // ── 媒体嗅探数据面 + 后台捕获窗口（2026-11-11 方案 1；嗅探三 IPC 迁至
  // sniff-capture.ts——捕获用独立隐藏窗，不进标签池、不碰页面宿主）──
  registerSniffCapture({
    ipcMain,
    sniffer,
    downloader: mediaDownloader,
    currentPlatform: () => currentPlatform,
    activeViewUrl: () => activeView()?.webContents.getURL?.() ?? '',
    hostWindow: () => hostWin(),
    log: ctxLog,
  })

  // ── 回环门面（架构文档 §浏览器域三层形态第2层）：agent 工具经 HTTP+token
  // 调壳层引擎；握手文件落 DSH_HOME/tintin/browser/loopback.json（host 读它）。
  // auto_listing_run 预留：交互式流程 agent 直跑需产品裁决，未暴给 agent。
  void startLoopbackService({
    handshakeDir: join(browserCookiesDir(), '..'),
    log: (msg) => ctxLog(msg),
    handlers: {
      open: async (platform) => openPlatform(platform),
      extract: (platform) => extractNow(platform),
      loginStatus: async () => {
        const counts: Record<string, number> = {}
        for (const platform of Object.keys(PLATFORM_COOKIE_DOMAINS)) {
          counts[platform] = (await collectPlatformCookies(platform)).length
        }
        return { counts, cookiesDir: browserCookiesDir() }
      },
      exportCookies: () => exportCurrentCookies(),
      captureHotspots: () => captureHotspots({ userDataDir: app.getPath('userData') }),
    },
  }).then((svc) => { loopback = svc })
    .catch((err) => ctxLog('loopback start failed: ' + (err instanceof Error ? err.message : err)))

  // ── 自动上架（SRC auto-listing/ipc.js；fxg 分区视图 + store shim）──
  const autoListingStore = (() => {
    const file = join(app.getPath('userData'), 'tintin', 'browser', 'auto-listing.json')
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(readFileSync(file, 'utf8')) } catch { /* 首次为空 */ }
    return {
      get: (key: string) => data[key],
      set: (key: string, value: unknown) => {
        data[key] = value
        try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(data, null, 2), 'utf8') } catch { /* 写盘失败下次再试 */ }
      },
    }
  })()
  createAutoListingIpc(ipcMain, {
    store: autoListingStore,
    app,
    getBrowserWindow: () => browserWindow,
    getOrCreateView: (platformId: string) => {
      if (embedActive) {
        // 内嵌（2026-10-19）：视图挂主窗（attachToWindow 按 hostWin 分发），不拉独立窗
        if (currentPlatform !== platformId) void navigateTo(platformId)
        else { ensureBrowserView(platformId); attachToWindow() }
        return activeView() ?? ensureBrowserView(platformId)
      }
      ensureBrowserWindow(mainWindow)
      if (currentPlatform !== platformId) void navigateTo(platformId)
      else { ensureBrowserView(platformId); attachToWindow() }
      return activeView() ?? ensureBrowserView(platformId)
    },
  })

  // browser:revealDailyAsset — 历史视图「定位」（每日素材视图已按 2026-11-04 用户裁决移除，
  // getDailyAssets/openDailyAsset 两个 handler 随之删除；扫描逻辑 daily-assets-logic 保留
  // （纯函数+单测在册），loopback 的热点采集路径不受影响）
  ipcMain.handle('browser:revealDailyAsset', (_e, p: unknown) => {
    const path = String(p || '')
    try {
      if (!path) return { success: false, error: '路径为空' }
      shell.showItemInFolder(path)
      return { success: true }
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
  })
  // 页内查找（2026-11-08 第一批 P0 #5）：作用于当前活跃平台视图
  ipcMain.handle('browser:findInPage', (_e, p: unknown) => {
    const q = (p || {}) as { text?: unknown; forward?: unknown }
    const wc = activeView()?.webContents
    if (!wc) return { ok: false, error: '没有正在浏览的网页' }
    const text = String(q.text || '')
    if (!text) return { ok: false, error: '缺少查找词' }
    wc.findInPage(text, { forward: q.forward !== false, findNext: true })
    return { ok: true }
  })
  ipcMain.handle('browser:findStop', () => {
    const wc = activeView()?.webContents
    try { wc?.stopFindInPage('clearSelection') } catch { /* 视图销毁竞态 */ }
    return { ok: true }
  })

  createCreatorsStoreIpc(ipcMain, { app, getBrowserWindow: () => browserWindow })

  ipcMain.handle('browser:extensionList', () => {
    try { return { success: true, data: extManager?.list() } } catch (err) {
      return { success: true, data: { installed: false, extensions: [] } }
    }
  })
  ipcMain.handle('browser:extensionInstall', async (_e, filePath: unknown) => {
    try { return await extManager!.install(String(filePath || '')) } catch (err) {
      return { success: false, message: '安装失败：' + (err instanceof Error ? err.message : err) }
    }
  })
  ipcMain.handle('browser:extensionUninstall', (_e, id: unknown) => {
    try { return extManager!.uninstall(String(id || '')) } catch (err) {
      return { success: false, message: '卸载失败：' + (err instanceof Error ? err.message : err) }
    }
  })

  // 打开平台（独立窗口 + 导航 seed URL）；窗口已存活则聚焦复用。
  // 内嵌模式（2026-10-19）：主窗即宿主，直接导航（回环门面/嗅探下载同链路复用）
  // 抽为 openPlatform 供回环门面复用。挂载/切换由 navigateTo 统一处理
  const openPlatform = (id: string) => {
    if (!platformOf(id)) return { ok: false, error: `未知平台: ${id}` }
    if (embedActive) return navigateTo(id)
    const win = ensureBrowserWindow(mainWindow)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return navigateTo(id)
  }
  ipcMain.handle('browser:open', (_e, platform: unknown) => openPlatform(String(platform || '')))

  // ── 标签页（2026-11-08 第二批 #2）：引擎在 tab-engine.ts（千行付账提取），
  // 池状态归宿主（tabPool/tabViews/currentPlatform），依赖注入回写；
  // 2026-11-13 起引擎句柄（ensureTab）回接导航中枢 navigateTo（tab 化根治）──
  tabEnsure = registerTabEngine({
    ipcMain,
    getPool: () => tabPool,
    setPool: (next) => { tabPool = next },
    setTabView: (id, view) => { tabViews.set(id, view) },
    getTabView: (id) => tabViews.get(id),
    delTabView: (id) => { tabViews.delete(id) },
    tabViews: () => tabViews.entries(),
    focusPlatform: (platform) => { currentPlatform = platform },
    attachActive: () => attachToWindow(),
    activeView: () => activeView(),
    clearFocus: () => { currentPlatform = null },
    hostWin: () => hostWin(),
    mainWindow: () => mainWindowRef,
    pageHost: () => pageHost(),
    seedUrl: (platform) => platformOf(platform)?.seedUrl ?? PLATFORM_DEFS.web!.seedUrl,
    zoom: (view, delta) => zoomStep(view, delta),
    recordIntent: (wc, url) => recordNavIntent(wc, url),
    clearIntent: (wc) => { pendingNavUrl.delete(wc.id) },
    sendUi: (payload) => sendUi(payload),
    pushState: () => pushPageState(),
    // 平台扩展面接缝（2026-11-13 用户报障：B站视频开在标签页时下载助手空）：
    // 标签视图创建即注入 B站下载助手扩展 + 挂 console 捕获——原实现只接主平台
    // 视图，tab 视图既无扩展也无捕获，助手区永远空。
    onTabViewCreated: (platform, view) => {
      if (platform !== 'bilibili' || !bilibiliHelperInstalled()) return
      const extPath = findBilibiliHelperDir()
      const sess = session.fromPartition(PLATFORM_DEFS.bilibili!.partition)
      if (extPath && sess) {
        injectBilibiliHelper(view.webContents, extPath, sess)
        attachBiliDlConsoleCapture(view.webContents, (pl) => downloadMirror().pushBiliExtDl(pl))
      }
    },
    log: ctxLog,
  }, themedBackground).ensureTab

  // B站扩展下载轮询（主通道，宿主级单实例）：跟随「活跃的 B站内容面」——活跃标签
  // 是 B站 → 轮询该标签视图；否则轮询主平台视图；两处皆无 → 本轮跳过。
  // （2026-11-13 用户报障：原实现挂在主平台视图创建处，用户只用标签页时轮询根本
  //  不存在；注入侧由上面 onTabViewCreated 与主视图 did-navigate 两处覆盖。）
  if (bilibiliHelperInstalled()) {
    startBiliExtPolling({
      getWebContents: () => {
        const pool = tabPool
        const activeTab = pool.activeId ? pool.tabs.find((t) => t.id === pool.activeId) : undefined
        if (activeTab?.platform === 'bilibili') {
          const tv = tabViews.get(activeTab.id)
          if (tv && !tv.webContents.isDestroyed()) return tv.webContents
        }
        const main = browserViews.get('bilibili')
        return main && !main.webContents.isDestroyed() ? main.webContents : null
      },
      push: (pl) => downloadMirror().pushBiliExtDl(pl),
      log: (msg) => ctxLog(msg),
    })
  }

  // 历史/书签（2026-11-08 第二批 #3/#4）：标签 did-navigate 与地址栏星标共用
  registerHistoryBookmarkIpc(ipcMain)

  // 各平台登录态条数（只读，不写文件；浏览器 tab 面板状态展示用）
  ipcMain.handle('browser:loginStatus', async () => {
    // 已登录=平台会话 cookie 在 jar（2026-11-08：原「任意 cookie>0」被匿名功能 cookie
    // 误报已登录；counts 值=1/0，页面徽标判定 n>0 不变）
    const counts: Record<string, number> = {}
    for (const platform of Object.keys(PLATFORM_COOKIE_DOMAINS)) {
      const names = (await collectPlatformCookies(platform)).map((c) => c.name)
      counts[platform] = hasLoginCookie(names, platform) ? 1 : 0
    }
    return { counts, cookiesDir: browserCookiesDir() }
  })

  ipcMain.handle('browser:exportCookies', () => exportCurrentCookies())

  // browser:extractDOM — 运行平台抽取脚本（SRC thickShell-ipc browser:extractDOM
  // 移植；E3 结构化错误：NEED_LOGIN / RISK_CAPTCHA / DOM_MISMATCH / NETWORK_ERROR）。
  // 分区化 view 池即 SRC 的 viewPool entry（当前平台=导航目标；每平台分区一个常驻 view）。
  // 核心逻辑抽为 extractNow 供回环门面（loopback-service）复用
  const extractNow = async (platformId: unknown) => {
    try {
      const id = String(platformId || '')
      if (!PLATFORM_IDS.includes(id)) return extractionError('NEED_PLATFORM', '缺少平台参数')
      const view = activeView()
      if (!view || currentPlatform !== id) {
        return extractionError('NOT_ATTACHED', '平台页面尚未打开', '先点击平台打开浏览器窗口')
      }
      const def = platformOf(id)
      const wc = view.webContents

      // 1) 当前 URL 检查（离线兜底页/未加载）
      try {
        const cur = wc.getURL?.() || ''
        if (cur.startsWith('data:text/html')) {
          return extractionError('NETWORK_ERROR', '当前处于离线兜底页，无法抽取', '请恢复网络后重试')
        }
        if (!cur || cur === 'about:blank') {
          return extractionError('DOM_MISMATCH', '页面尚未加载完成', '等待页面加载完成后再点解析')
        }
      } catch { /* URL 读取失败继续尝试抽取 */ }
      // 2) 读取抽取脚本（缺失 → 结构化 DOM_MISMATCH+hint，与 SRC 同口径）
      let commonScript = ''
      try {
        commonScript = readFileSync(join(extractorScriptDir(), '_common.ts'), 'utf8')
      } catch { commonScript = '' }
      let script: string | null = null
      try {
        script = readFileSync(join(extractorScriptDir(), def?.extractor ?? ''), 'utf8')
      } catch {
        return extractionError('DOM_MISMATCH', `${def?.name ?? id}抽取脚本尚未上线`, `脚本路径 ${def?.extractor ?? ''} 暂未写入`)
      }
      // 3) 页面内执行（永远 try/catch，主进程不崩）
      let result: unknown = null
      try {
        result = await wc.executeJavaScript(buildExtractorScript(commonScript, script), false)
      } catch (err) {
        return extractionError('DOM_MISMATCH', err instanceof Error ? err.message : '抽取脚本执行异常', '平台 DOM 可能已变更')
      }
      // 4) 结果结构校验
      if (!result || typeof result !== 'object') {
        return extractionError('DOM_MISMATCH', '抽取脚本返回了非对象结构', `需修复 ${def?.extractor ?? ''}`)
      }
      const r = result as { ok?: boolean; data?: unknown; error?: unknown }
      if (r.ok === false) {
        return { ok: false, error: (r.error as { type: string; message: string }) || { type: 'DOM_MISMATCH', message: '抽取失败' } }
      }
      return { ok: true, data: r.data ?? null }
    } catch (err) {
      return extractionError('EXTRACTOR_ERROR', err instanceof Error ? err.message : '未知错误')
    }
  }
  ipcMain.handle('browser:extractDOM', (_e, platformId: unknown) => extractNow(platformId))

  // 平台表（chrome 浏览器面板的唯一数据源；fxg 抖店仅自动上架用，不列）
  ipcMain.handle('browser:platforms', () => Object.entries(PLATFORM_DEFS)
    .filter(([id]) => id !== 'fxg')
    .map(([id, def]) => ({ id, name: def.name, seedUrl: def.seedUrl })))
}
