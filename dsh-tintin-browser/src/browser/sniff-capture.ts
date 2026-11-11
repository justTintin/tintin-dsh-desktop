// ═══════════════════════════════════════════════════════════════
// sniff-capture.ts — 媒体嗅探数据面 + 后台捕获会话（2026-11-11 用户裁决
// 方案 1：捕获页彻底移出标签池）。「下载视频」拿不到直链：抖音 yt-dlp 抽取器
// 不会算 a_bogus（上游 tiktok.py TODO），只能真开视频页让播放器发流，再从
// session.webRequest 嗅探真实地址。旧实现把这一步做成同窗后台标签，空标签池时
// background 失效 → 捕获标签被扶正贴到浏览器主区，用户正在看的页面被换掉
// （2026-11-11 报障）。现改为独立隐藏 BrowserWindow：不进 tab 池、不碰
// pageHost、不推 tabs/state，浏览器界面零感知；分区与平台视图一致，嗅探缓冲照常命中。
// 嗅探三 IPC（list/clear/download）自 browser-service 迁入本文件（千行付账）。
// ═══════════════════════════════════════════════════════════════
import { BrowserWindow } from 'electron'
import { isDeepLinkScheme, PLATFORM_DEFS } from './platform-meta.ts'

export interface CaptureRequest {
  platform: string
  url: string
  autoplay: boolean
}

export type CaptureParseResult =
  | { ok: true; request: CaptureRequest }
  | { ok: false; error: string }

/** 捕获请求校验（纯函数，单测下沉）：只收已知平台 + http(s) 目标 */
export function parseCaptureRequest(payload: unknown): CaptureParseResult {
  const p = (payload || {}) as { platform?: unknown; url?: unknown; autoplay?: unknown }
  const platform = String(p.platform || '')
  if (!PLATFORM_DEFS[platform]) return { ok: false, error: `未知平台: ${platform}` }
  const url = String(p.url || '')
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '非法捕获地址' }
  return { ok: true, request: { platform, url, autoplay: p.autoplay === true } }
}

/** 后台标签无人看就不播放 → 媒体流不发 → 捕获空转；注入静音起播+点播放键 */
const AUTOPLAY_SCRIPT = `(function(){var n=0;var t=setInterval(function(){var v=document.querySelector('video');if(v){try{v.muted=true;v.play()}catch(e){}}var b=document.querySelector('xg-start,.xgplayer-start,xg-icon[class*=play],div[aria-label*=播放],[class*=playBtn],[class*=play-btn]');if(b){try{b.click()}catch(e){}}if(++n>10)clearInterval(t)},800)})()`

export interface SniffCaptureDeps {
  ipcMain: Pick<Electron.IpcMain, 'handle'>
  sniffer: {
    items: (platform: string) => unknown
    clear: (platform?: string) => void
  }
  downloader: {
    startMedia: (params: {
      url?: string
      audioUrl?: string
      filename?: string
      referer?: string
      subDir?: string
      useYtdlp?: boolean
      platformId?: string
    }) => Promise<{ success: boolean; taskId?: string; error?: string }>
  }
  currentPlatform: () => string | null
  activeViewUrl: () => string
  hostWindow: () => Electron.BrowserWindow | null
  log: (msg: string) => void
}

let captureWin: BrowserWindow | null = null
let captureId = ''
let capturePlatform = ''
let captureUrl = ''
let captureSeq = 0

function closeCaptureWindow(): void {
  const win = captureWin
  captureWin = null
  captureId = ''
  capturePlatform = ''
  captureUrl = ''
  if (win && !win.isDestroyed()) win.destroy()
}

/** 捕获页当前地址（嗅探详情页门控用；无捕获/非该平台时 null） */
export function activeCapturePageUrl(platform: string): string | null {
  if (!captureWin || capturePlatform !== platform) return null
  try {
    const live = captureWin.webContents.getURL?.() || ''
    return live || captureUrl || null
  } catch {
    return captureUrl || null
  }
}

export function registerSniffCapture(deps: SniffCaptureDeps): void {
  const { ipcMain, log } = deps
  // ── 媒体嗅探数据面（自 browser-service 迁入，行为不变；SRC SniffTab 数据面）──
  ipcMain.handle('browser:sniffList', (_e, platform: unknown) => {
    return { success: true, data: deps.sniffer.items(String(platform || '')) }
  })
  ipcMain.handle('browser:sniffClear', (_e, platform: unknown) => {
    deps.sniffer.clear(String(platform || '') || undefined)
    return { success: true }
  })
  ipcMain.handle('browser:sniffDownload', async (_e, payload: unknown) => {
    const p = (payload || {}) as { url?: unknown; audioUrl?: unknown; filename?: unknown; platformId?: unknown; referer?: unknown }
    const url = String(p.url || '')
    if (!/^https?:\/\/.*/.test(url)) return { success: false, error: '非法媒体地址' }
    const audioUrl = String(p.audioUrl || '').trim() // 伴生音频流（2026-11-08 配对下载：双流+FFmpeg 合并）
    const tail = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'media.mp4').slice(0, 120) || 'media.mp4'
    // 显式文件名（2026-11-07：解析链捕获下载按标题命名，URL 尾段是 CDN 哈希名）
    const filename = String(p.filename || '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120)
    // 平台归属优先取调用方声明（2026-11-11：捕获会话与用户当前平台解耦——在 B站
    // 页面解析抖音链接时，cookie 分区与 referer 仍必须走抖音）
    const requested = String(p.platformId || '')
    const current = deps.currentPlatform()
    const platformId = PLATFORM_DEFS[requested] ? requested : (current && PLATFORM_DEFS[current] ? current : undefined)
    const referer = String(p.referer || '').trim() || deps.activeViewUrl()
    // media-downloader 引擎（SRC downloadSniffedMedia：Cookie/Referer 注入；m3u8/flv/videoplayback 交 yt-dlp）
    const needsYtdlp = /\.(m3u8|flv)/i.test(url) || url.includes('videoplayback')
    const r = await deps.downloader.startMedia({
      url,
      ...(audioUrl ? { audioUrl } : {}),
      filename: filename || tail,
      ...(referer ? { referer } : {}),
      ...(platformId ? { platformId, subDir: platformId } : {}),
      useYtdlp: needsYtdlp,
    })
    return r.success ? { success: true, taskId: r.taskId } : { success: false, error: r.error }
  })

  // ── 后台捕获窗口（方案 1）：独立隐藏 BrowserWindow，永不进标签池/不挂主窗 ──
  ipcMain.handle('browser:captureOpen', (_e, payload: unknown) => {
    const parsed = parseCaptureRequest(payload)
    if (!parsed.ok) return parsed
    const { platform, url, autoplay } = parsed.request
    const def = PLATFORM_DEFS[platform]
    if (!def) return { ok: false, error: `未知平台: ${platform}` }
    closeCaptureWindow()
    const host = deps.hostWindow()
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      skipTaskbar: true,
      ...(host && !host.isDestroyed() ? { parent: host } : {}),
      webPreferences: {
        partition: def.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        // 隐藏窗口默认会节流定时器，播放器起播逻辑会被拖死 → 显式关掉
        backgroundThrottling: false,
      },
    })
    captureWin = win
    capturePlatform = platform
    captureUrl = url
    captureSeq += 1
    captureId = `cap_${Date.now().toString(36)}_${captureSeq}`
    win.on('closed', () => {
      if (captureWin !== win) return
      captureWin = null
      captureId = ''
      capturePlatform = ''
      captureUrl = ''
    })
    // 捕获页不承载用户交互：弹窗/深链一律拦下，防止甩出产品或打开系统应用
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, target) => {
      try {
        const scheme = new URL(target).protocol.replace(/:$/, '')
        if (isDeepLinkScheme(scheme)) event.preventDefault()
      } catch { /* 非法 URL 不拦 */ }
    })
    try { win.webContents.setAudioMuted(true) } catch { /* 销毁竞态 */ }
    void win.webContents.loadURL(url).catch(() => { /* 页面自显示错误 */ })
    if (autoplay) {
      win.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return
        try {
          void win.webContents.executeJavaScript(AUTOPLAY_SCRIPT, true).catch(() => { /* 页面防御 */ })
        } catch { /* 销毁竞态 */ }
      })
    }
    log(`sniff capture window opened (${platform})`)
    return { ok: true, captureId }
  })
  ipcMain.handle('browser:captureClose', (_e, payload: unknown) => {
    const id = String((payload as { id?: unknown } | undefined)?.id || '')
    if (id && id !== captureId) return { ok: true } // 旧会话的迟到关闭不误伤新会话
    closeCaptureWindow()
    return { ok: true }
  })
}
