// ═══════════════════════════════════════════════════════════════
// tab-engine.ts — 浏览器标签引擎（2026-11-08 第二批 #2；千行红线自
// browser-service.ts 提取付账）。标签视图创建/事件接线/三个 tab IPC，
// 池状态经依赖注入回写宿主（tabPool/tabViews/currentPlatform 归宿主所有）。
// ═══════════════════════════════════════════════════════════════
import { WebContentsView, type BrowserWindow } from 'electron'
import { URL } from 'node:url'
import { isDeepLinkScheme, PLATFORM_DEFS } from './platform-meta.ts'
import { attachContextMenu } from './context-menu.ts'
import { activateTab, closeTab, openTab, updateTab, type TabPoolState } from './tab-model.ts'
import { migrateDefaultSessionCookies } from './cookie-sync.ts'

export interface TabEngineDeps {
  ipcMain: Pick<Electron.IpcMain, 'handle'>
  /** 模块级状态宿主（读写回调，宿主持有 tabPool/tabViews/currentPlatform） */
  getPool: () => TabPoolState
  setPool: (next: TabPoolState) => void
  setTabView: (id: string, view: WebContentsView) => void
  getTabView: (id: string) => WebContentsView | undefined
  delTabView: (id: string) => void
  tabViews: () => Iterable<[string, WebContentsView]>
  /** 焦点/宿主面（宿主实现） */
  focusPlatform: (platform: string) => void
  attachActive: () => void
  activeView: () => WebContentsView | null
  clearFocus: () => void
  hostWin: () => BrowserWindow | null
  mainWindow: () => BrowserWindow | null
  pageHost: () => { webContents: import('electron').WebContents } | null
  seedUrl: (platform: string) => string
  /** 缩放步进（宿主 zoomStep，含 toast 上屏） */
  zoom: (view: WebContentsView, delta: number) => void
  /** 导航意图登记（commit 前地址栏占位；宿主持 pendingNavUrl 池） */
  recordIntent: (wc: import('electron').WebContents, url: string) => void
  clearIntent: (wc: import('electron').WebContents) => void
  /** 壳 → 页面 UI 消息（宿主 sendUi） */
  sendUi: (payload: Record<string, unknown>) => void
  /** 导航态推送（宿主 pushPageState：地址栏/导航按钮数据源，2026-11-08 报障「标签页跳转地址栏空」补线） */
  pushState: () => void
  /** 标签视图创建回调（宿主接平台扩展面——2026-11-13 用户报障：B站视频开在标签页时
   *  下载助手空：扩展注入/console 捕获此前只接主平台视图，tab 视图从未接入） */
  onTabViewCreated?: (platform: string, view: WebContentsView) => void
  log: (msg: string) => void
}

/** 标签引擎句柄：宿主（browser-service）导航中枢按平台打开/聚焦标签用。 */
export interface TabEngineHandle {
  /** 打开或聚焦该平台的标签（已有→聚焦保持现场；无→新建并载种子页）。 */
  ensureTab(platform: string): { id: string } | null
}

/** 标签底色/主题（宿主 themedBackground 直传，避免本文件再依赖 nativeTheme） */
export function registerTabEngine(deps: TabEngineDeps, themedBackground: () => string): TabEngineHandle {
  const { ipcMain, log } = deps

  function createTabView(platform: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: PLATFORM_DEFS[platform]?.partition ?? 'persist:tintin-web',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    })
    view.setBackgroundColor(themedBackground())
    // 平台扩展面（宿主注入：B站下载助手等）。必须先于种子页 loadURL ——
    // injectBilibiliHelper 在此登记 addScriptToEvaluateOnNewDocument，晚于首航就漏首屏
    try { deps.onTabViewCreated?.(platform, view) } catch (err) { log(`tab view extension hook failed: ${err instanceof Error ? err.message : String(err)}`) }
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        try { deps.recordIntent(view.webContents, url); view.webContents.loadURL(url).catch(() => { /* 页面自显示错误 */ }) } catch { /* 销毁竞态 */ }
      }
      return { action: 'deny' }
    })
    view.webContents.on('will-navigate', (event, url) => {
      try {
        const scheme = new URL(url).protocol.replace(/:$/, '')
        if (isDeepLinkScheme(scheme)) { event.preventDefault(); log(`deep link blocked (tab): ${scheme}://`) }
      } catch { /* 非法 URL 不拦 */ }
    })
    // 正常浏览器语义（2026-11-08 报障）：发起导航**瞬间**地址栏即显示目标网址+加载中
    // ——did-start-loading（转圈）/did-commit（目标 URL 已定）/did-stop-loading（终态），
    // 不再等 did-navigate 确认（慢站/不可达站此前地址栏一直空）。
    view.webContents.on('did-start-loading', () => deps.pushState())
    view.webContents.on('did-navigate-in-page', (_e, url) => {
      if (!url) return
      const pool = deps.getPool()
      const tab = pool.tabs.find((t) => deps.getTabView(t.id) === view)
      if (tab) deps.setPool(updateTab(pool, tab.id, { url }))
      pushTabs()
      deps.pushState()
    })
    view.webContents.on('did-stop-loading', () => deps.pushState())
    view.webContents.on('did-navigate', (_e, url) => {
      deps.clearIntent(view.webContents)
      const pool = deps.getPool()
      const tab = pool.tabs.find((t) => deps.getTabView(t.id) === view)
      const title = view.webContents.getTitle?.() || ''
      if (tab) deps.setPool(updateTab(pool, tab.id, { url, ...(title ? { title } : {}) }))
      pushTabs()
      deps.pushState()
      void migrateDefaultSessionCookies(platform, log)
      try { deps.mainWindow()?.webContents.send('history:record', { url, title }) } catch { /* 窗口未就绪 */ }
    })
    view.webContents.on('page-title-updated', (_e, title) => {
      const pool = deps.getPool()
      const tab = pool.tabs.find((t) => deps.getTabView(t.id) === view)
      if (tab) { deps.setPool(updateTab(pool, tab.id, { title })); pushTabs(); deps.pushState() }
    })
    attachContextMenu(view, {
      popupHost: () => deps.hostWin(),
      zoom: (v, d) => deps.zoom(v, d),
    })
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const ctrl = input.control || input.meta
      const key = String(input.key || '').toLowerCase()
      if (ctrl && key === 'f') { event.preventDefault(); deps.sendUi({ op: 'find-open' }) }
      else if (ctrl && (key === '=' || key === '+')) { event.preventDefault(); deps.zoom(view, 0.5) }
      else if (ctrl && key === '-') { event.preventDefault(); deps.zoom(view, -0.5) }
      else if (ctrl && key === '0') { event.preventDefault(); deps.zoom(view, 0) }
      else if (input.key === 'F5' || (ctrl && key === 'r')) { event.preventDefault(); view.webContents.reload() }
      else if (ctrl && key === 'l') { event.preventDefault(); deps.sendUi({ op: 'focus-addr' }) }
      else if (ctrl && key === 'h') { event.preventDefault(); deps.sendUi({ op: 'open-section', section: 'history' }) }
    })
    view.webContents.on('found-in-page', (_e, result) => {
      const host = deps.pageHost()
      if (!host) return
      try { host.webContents.send('tintin-browser-page:find-result', { ordinal: result.activeMatchOrdinal, total: result.matches }) } catch { /* 页面未就绪 */ }
    })
    return view
  }

  function pushTabs(): void {
    const host = deps.pageHost()
    if (!host) return
    const pool = deps.getPool()
    try { host.webContents.send('tintin-browser-page:tabs', { tabs: pool.tabs, activeTabId: pool.activeId }) } catch { /* 页面未就绪 */ }
  }
  function refocusTab(id: string): void {
    const pool = deps.getPool()
    const t = pool.tabs.find((x) => x.id === id)
    if (t) deps.focusPlatform(t.platform)
    deps.attachActive()
    pushTabs()
    deps.pushState()
  }

  /** 打开或聚焦该平台的标签（宿主导航中枢的 tab 化入口，2026-11-13 用户裁决
   *  「像正常浏览器一样」：平台点击/收藏/嗅探等全部导航都落进标签池——
   *  打开过的页面在顶部 tab 栏可见、可切、可关；已有标签聚焦保持现场）。 */
  function ensureTab(platform: string): { id: string } | null {
    if (!PLATFORM_DEFS[platform]) return null
    const pool = deps.getPool()
    const existing = pool.tabs.find((t) => t.platform === platform)
    if (existing) {
      const next = activateTab(pool, existing.id)
      if (next !== pool) deps.setPool(next)
      deps.focusPlatform(platform)
      deps.attachActive()
      pushTabs()
      deps.pushState()
      return { id: existing.id }
    }
    const next = openTab(deps.getPool(), platform)
    if (!next) return null
    deps.setPool(next)
    const id = next.activeId!
    const view = createTabView(platform)
    deps.setTabView(id, view)
    deps.focusPlatform(platform)
    deps.attachActive()
    const seed = deps.seedUrl(platform)
    deps.recordIntent(view.webContents, seed)
    view.webContents.loadURL(seed).catch(() => { /* 页面自显示错误 */ })
    pushTabs()
    deps.pushState()
    return { id }
  }

  ipcMain.handle('browser:tabOpen', (_e, p: unknown) => {
    const q = (p || {}) as { platform?: unknown }
    const platform = String(q.platform || 'web')
    const r = ensureTab(platform)
    if (!r) return { ok: false, error: r === null ? `未知平台: ${platform}` : '标签已达上限（12）' }
    return { ok: true, tabId: r.id }
  })
  ipcMain.handle('browser:tabClose', (_e, p: unknown) => {
    const q = (p || {}) as { id?: unknown }
    const id = String(q.id || '')
    const view = deps.getTabView(id)
    deps.setPool(closeTab(deps.getPool(), id))
    deps.delTabView(id)
    if (view && !view.webContents.isDestroyed()) view.webContents.close()
    const pool = deps.getPool()
    if (pool.activeId) {
      const nv = deps.getTabView(pool.activeId)
      if (nv && !nv.webContents.isDestroyed()) refocusTab(pool.activeId)
    } else if (deps.activeView()) deps.attachActive()
    else deps.clearFocus()
    pushTabs()
    deps.pushState()
    return { ok: true }
  })
  ipcMain.handle('browser:tabActivate', (_e, p: unknown) => {
    const q = (p || {}) as { id?: unknown }
    const id = String(q.id || '')
    const next = activateTab(deps.getPool(), id)
    if (next === deps.getPool()) return { ok: false, error: '标签不存在' }
    deps.setPool(next)
    const view = deps.getTabView(id)
    if (!view || view.webContents.isDestroyed()) return { ok: false, error: '标签视图已销毁' }
    refocusTab(id)
    return { ok: true }
  })

  return { ensureTab }
}
