// hotspot-capture.ts — 今日热点采集 runner（SRC desktop/main/hotspot-capture.js runner 段 1:1，基线 9ca9050）
// 隐藏 BrowserView（bounds 移出可视区）+ CDP Network.getResponseBody 拦截热榜 API 响应；
// 解析规则在 hotspot-logic.ts（纯函数层）。防并发：采集中重复触发直接拒绝。
import { BrowserView, BrowserWindow } from 'electron'
import {
  HOTSPOT_PAGES,
  appendHotspotManifest,
  dedupeHotspots,
  domFallbackScript,
  hotspotParserForUrl,
  parseHotspotPayload,
  safeJsonParse,
  today,
  type HotspotItem,
} from './hotspot-logic'

const _sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface CaptureHotspotsOpts {
  userDataDir: string
  onProgress?: (p: { platform: string; index: number; total: number }) => void
}

/** 采集今日各平台热榜；[ok, 数据|错误信息] 元组约定（SRC 同） */
export async function captureHotspots(opts: CaptureHotspotsOpts): Promise<[boolean, number | string]> {
  const userDataDir = (opts && opts.userDataDir) || ''
  const onProgress = (opts && opts.onProgress) || null
  if (!userDataDir) return [false, '采集失败：userData 目录不可用']

  // 防并发：采集中重复触发直接拒绝（挂在函数属性上，SRC 同款）
  const runner = captureHotspots as unknown as { _running?: boolean }
  if (runner._running) return [false, '热点采集中，请稍后再试']
  runner._running = true

  let view: BrowserView | null = null
  let attachedWin: BrowserWindow | null = null
  const items: HotspotItem[] = []
  try {
    view = new BrowserView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    const wc = view.webContents
    // CDP 拦截（等价原版 preload 内 fetch/XHR payload 拦截）
    try { await wc.debugger.attach('1.3') } catch { /* 已附加则继续 */ }
    await wc.debugger.sendCommand('Network.enable').catch(() => {})
    /** requestId → url（responseReceived 记录，loadingFinished 取 body） */
    const pendingBodies = new Map<string, string>()
    wc.debugger.on('message', (_ev, method, params) => {
      const p = params as { requestId?: string; response?: { url: string } } | undefined
      const requestId = p?.requestId
      const responseUrl = p?.response?.url
      if (!p || !requestId) return
      if (method === 'Network.responseReceived') {
        const parser = responseUrl ? hotspotParserForUrl(responseUrl) : null
        if (parser && responseUrl) pendingBodies.set(requestId, responseUrl)
      }
      if (method === 'Network.loadingFinished' && pendingBodies.has(requestId)) {
        const url = pendingBodies.get(requestId) as string
        pendingBodies.delete(requestId)
        wc.debugger.sendCommand('Network.getResponseBody', { requestId })
          .then((r) => {
            if (!r) return
            const body = (r as { base64Encoded?: boolean; body?: string }).base64Encoded
              ? Buffer.from((r as { body: string }).body, 'base64').toString('utf-8')
              : (r as { body: string }).body
            const payload = safeJsonParse(body)
            if (payload) items.push(...parseHotspotPayload(url, payload))
          })
          .catch(() => {})
      }
    })

    // 挂到主窗口但 bounds 移出可视区（保持正常渲染尺寸触发懒加载，用户不可见）
    attachedWin = BrowserWindow.getAllWindows()[0] || null
    if (attachedWin) {
      attachedWin.addBrowserView(view)
      view.setBounds({ x: -2400, y: 0, width: 1200, height: 800 })
    }

    const total = HOTSPOT_PAGES.length
    for (let i = 0; i < total; i++) {
      const p = HOTSPOT_PAGES[i] as (typeof HOTSPOT_PAGES)[number]
      if (onProgress) { try { onProgress({ platform: p.platform, index: i + 1, total }) } catch { /* 进度失败不阻断 */ } }
      try { await wc.loadURL(p.url) } catch { /* 部分平台 load 中断不阻塞后续 */ }
      await _sleep(3500) // 对照原版 settle 3500ms
      // 轻滚一下，触发懒加载的热榜接口（对照原版 scrollTo(0,1200) + 1500ms）
      try { await wc.executeJavaScript('window.scrollTo(0, 1200); true') } catch { /* ignore */ }
      await _sleep(1500)
      // API 没抓到该平台 → DOM 兜底
      const have = items.filter((x) => x.platform === p.platform).length
      if (have === 0) {
        const script = domFallbackScript(p.platform)
        if (script !== 'null') {
          try {
            const domItems = await wc.executeJavaScript(script) as Array<{ title: string; url?: string }>
            if (Array.isArray(domItems)) {
              domItems.forEach((it, idx) => {
                items.push({ platform: p.platform, title: it.title, rank: idx + 1, hot: '', url: it.url || '' })
              })
            }
          } catch { /* ignore */ }
        }
      }
    }

    // 清单追加（对照原版 append-hotspot-manifest）
    const deduped = dedupeHotspots(items)
    const res = deduped.length > 0 ? appendHotspotManifest(userDataDir, deduped) : { ok: true, count: 0, date: today() }
    if (!res.ok) return [false, `采集完成但写入清单失败：${res.error}`]
    return [true, deduped.length]
  } catch (e) {
    return [false, `采集失败：${(e as Error)?.message || e}`]
  } finally {
    runner._running = false
    try { if (view && attachedWin) attachedWin.removeBrowserView(view) } catch { /* ignore */ }
    try { if (view) (view.webContents as unknown as { destroy?: () => void }).destroy?.() } catch { /* ignore */ }
  }
}
