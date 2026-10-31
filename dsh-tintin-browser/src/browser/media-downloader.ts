// ═══════════════════════════════════════════════════════════════
// media-downloader.ts — 浏览器域媒体下载器
// （SRC desktop/main/media-downloader.js 有界 1:1 移植，基线 SRC 9ca9050；
//   2026-10-26「下载扩展链复活」工作包，铁律 12 依据②）
// 移植范围（其余归「浮窗下载面板/下载历史」工作包，见 docs/tintin-browser-port.md §七）：
//   ✅ douyinParse / downloadMediaStart（yt-dlp 主链路 + 单流 + 音视频分离 FFmpeg 合并）
//      / downloadMediaCancel / downloadMediaPause / 流式下载引擎（分区 Cookie 注入）
//   ❌ downloads-history.json 持久化、downloadsSnapshot、OpenFile/Reveal/RemoveRecord、
//      downloadGetDir/SetDir、浮窗面板（随面板工作包）
// 移植差异（接入层重写，铁律 1 允许）：
//   ① 广播通道：SRC browser:downloads-updated（进度对象流）→ 本仓复用下载总线
//      downloads:progress/done/error（页面底部下载栏即进度面，与 download-manager 同轨）；
//   ② 下载根：SRC store('downloadDir') → 本仓 workspace/materials（与每日素材同源）；
//   ③ 内置工具查找加 TINTIN_BIN_DIR 候选（main-hook 已注入 <resources>/bin）。
// ═══════════════════════════════════════════════════════════════
import { exec, execSync, spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { URL } from 'node:url'
import {
  DOUYIN_PARSE_API,
  buildDouyinVideoPageUrl,
  extractDouyinShareUrl,
  extractDouyinVideoIdFromUrl,
  validateDouyinParseResponse,
} from './douyin-parse-logic.ts'
import { detectPlatformFromUrl, PLATFORM_COOKIE_DOMAINS } from './platform-meta.ts'

/** 会话内最小 cookie 形状（Electron Cookie 的子集） */
interface CookieLike {
  domain?: string
  path?: string
  secure?: boolean
  expirationDate?: number
  name: string
  value: string
}

interface SessionLike {
  cookies: { get(filter: { domain?: string; url?: string }): Promise<CookieLike[]> }
}
interface AppLike {
  isPackaged: boolean
  getPath(name: 'downloads' | 'userData'): string
}

export interface MediaDownloaderDeps {
  ipcMain: Pick<Electron.IpcMain, 'handle'>
  appLike: AppLike
  sessionFromPartition: (partition: string) => SessionLike
  /** 页面下载栏总线（与 download-manager 同一 emit 出口） */
  emit: (channel: 'downloads:progress' | 'downloads:done' | 'downloads:error', payload: Record<string, unknown>) => void
  /** 下载根（workspace/materials；子目录=subDir） */
  downloadDir: () => string
  log?: (msg: string) => void
}

/** 老平台兼容：iqiyi/youku/mgtv/weibo 未纳入 platform-meta 平台体系，仍按视频页走 yt-dlp */
const LEGACY_VIDEO_PAGE_HOSTS = ['iqiyi.com', 'youku.com', 'mgtv.com', 'weibo.com']

function isValidVideoPageUrl(url: string): boolean {
  if (!url) return false
  const lower = url.toLowerCase()
  return detectPlatformFromUrl(url) !== null || LEGACY_VIDEO_PAGE_HOSTS.some((h) => lower.includes(h))
}

/** youtube/googlevideo 分块参数清洗（SRC _cleanMediaUrl 1:1，导出供单测） */
export function cleanMediaUrl(urlStr: string): string {
  if (!urlStr) return urlStr
  try {
    const parsed = new URL(urlStr)
    const host = parsed.hostname
    if (host.includes('googlevideo.com') || host.includes('youtube.com')) {
      parsed.searchParams.set('range', '0-99999999999')
      parsed.searchParams.delete('rn')
      parsed.searchParams.delete('obuf')
      parsed.searchParams.delete('start')
      parsed.searchParams.delete('end')
    }
    return parsed.toString()
  } catch {
    return urlStr
  }
}

/** 内置工具查找：打包 resources/bin、TINTIN_BIN_DIR、仓库 resources/bin（SRC 形态 + TINTIN_BIN_DIR 候选） */
function bundledToolPaths(appLike: AppLike, exeName: string): string[] {
  const candidates: string[] = []
  if (appLike.isPackaged && process.resourcesPath) candidates.push(join(process.resourcesPath, 'bin', exeName))
  if (process.env.TINTIN_BIN_DIR) candidates.push(join(process.env.TINTIN_BIN_DIR, exeName))
  candidates.push(join(process.cwd(), 'resources', 'bin', exeName))
  return candidates.filter((p) => {
    try { return existsSync(p) } catch { return false }
  })
}

/** yt-dlp 调用参数解析（优先级：内置 exe > PATH yt-dlp > python -m yt_dlp；SRC _getYtdlpArgs 1:1） */
function getYtdlpArgs(appLike: AppLike): { cmd: string; args: string[] } | null {
  for (const bundled of bundledToolPaths(appLike, 'yt-dlp.exe')) {
    try {
      const v = spawnSync(bundled, ['--version'], { stdio: 'pipe', timeout: 8000 })
      if (v.status === 0) {
        const ffmpegDir = bundledToolPaths(appLike, 'ffmpeg.exe')[0]
        const args = ffmpegDir ? ['--ffmpeg-location', dirname(ffmpegDir)] : []
        return { cmd: bundled, args }
      }
    } catch { /* 内置 exe 损坏 → 降级后续候选 */ }
  }
  try {
    execSync('yt-dlp --version', { stdio: 'pipe', timeout: 5000 })
    return { cmd: 'yt-dlp', args: [] }
  } catch {
    try {
      execSync('python -m yt_dlp --version', { stdio: 'pipe', timeout: 5000 })
      return { cmd: 'python', args: ['-m', 'yt_dlp'] }
    } catch {
      try {
        execSync('python3 -m yt_dlp --version', { stdio: 'pipe', timeout: 5000 })
        return { cmd: 'python3', args: ['-m', 'yt_dlp'] }
      } catch {
        return null
      }
    }
  }
}

/** ffmpeg 路径（exec 引号形态；SRC _getFfmpegPath 1:1 + TINTIN_BIN_DIR 候选） */
function getFfmpegPath(appLike: AppLike): string {
  const candidates: string[] = []
  if (appLike.isPackaged && process.resourcesPath) candidates.push(join(process.resourcesPath, 'bin', 'ffmpeg.exe'))
  if (process.env.TINTIN_BIN_DIR) candidates.push(join(process.env.TINTIN_BIN_DIR, 'ffmpeg.exe'))
  candidates.push(join(process.cwd(), 'resources', 'bin', 'ffmpeg.exe'))
  for (const c of candidates) {
    if (existsSync(c)) return `"${c}"`
  }
  return 'ffmpeg'
}

export function createMediaDownloaderIpc(deps: MediaDownloaderDeps) {
  const { ipcMain, appLike, sessionFromPartition, emit, downloadDir } = deps
  const log = deps.log ?? ((msg: string) => console.log(`[TinTinBrowser::media] ${msg}`))

  const activeDownloads = new Map<string, { req?: http.ClientRequest; child?: import('node:child_process').ChildProcess }>()
  /** 任务档案（取消面与终态判定；持久化随面板工作包） */
  const taskRecords = new Map<string, { path?: string; title?: string }>()
  let taskIdCounter = 0

  function genTaskId(prefix: string): string {
    taskIdCounter++
    return `${prefix}_${Date.now().toString(36)}_${taskIdCounter}`
  }

  function progress(taskId: string, percent: number, message: string, file: string): void {
    try { emit('downloads:progress', { taskId, state: 'downloading', percent, speed: message, file }) } catch { /* 广播不阻断 */ }
  }
  function done(taskId: string, finalPath: string, size: number, file: string): void {
    taskRecords.delete(taskId)
    try { emit('downloads:done', { taskId, finalPath, size, file }) } catch { /* ignore */ }
  }
  function fail(taskId: string, message: string, file: string): void {
    taskRecords.delete(taskId)
    try { emit('downloads:error', { taskId, error: message, file }) } catch { /* ignore */ }
  }

  function killActiveTask(id: string): boolean {
    const t = activeDownloads.get(id)
    if (!t) return false
    try {
      if (t.child) t.child.kill()
      else if (t.req) t.req.destroy()
    } catch { /* ignore */ }
    activeDownloads.delete(id)
    return true
  }

  // ── 流式下载引擎（SRC _downloadStream 1:1：重定向跟随/Range 206/分区 Cookie/节流广播）──
  function downloadStream(
    taskId: string, url: string, destPath: string, referer: string | undefined, partition: string,
    onProgress: (p: { progress: number; size: number; receivedBytes: number; message: string }) => void,
  ): Promise<{ totalBytes: number }> {
    return new Promise(async (resolve, reject) => {
      let cookieString = ''
      try {
        const sess = sessionFromPartition(partition)
        const cookies = await sess.cookies.get({ url })
        cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      } catch { /* 无分区 cookie 时匿名下载 */ }

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      }
      if (referer) headers['Referer'] = referer
      if (cookieString) headers['Cookie'] = cookieString
      // B站 PCDN 等分块响应缺 content-length，Range 请求可拿到 206+content-range 以计算进度百分比
      headers['Range'] = 'bytes=0-'

      let req: http.ClientRequest | null = null
      let fileStream: import('node:fs').WriteStream | null = null
      let destroyed = false

      const cleanup = (): void => {
        activeDownloads.delete(taskId)
        if (fileStream) {
          try { fileStream.close() } catch { /* ignore */ }
          fileStream = null
        }
        if (existsSync(destPath)) {
          try { unlinkSync(destPath) } catch { /* ignore */ }
        }
      }

      const makeRequest = (requestUrl: string): void => {
        try {
          const parsed = new URL(requestUrl)
          const lib = parsed.protocol === 'https:' ? https : http
          req = lib.get(requestUrl, { method: 'GET', headers, timeout: 45000 }, (res) => {
            if (destroyed) return
            const status = res.statusCode || 0
            const location = res.headers.location as string | undefined
            if (status >= 300 && status < 400 && location) {
              res.resume()
              makeRequest(new URL(location, requestUrl).toString())
              return
            }
            if (status !== 200 && status !== 206) {
              let errBody = ''
              res.on('data', (chunk) => { errBody += chunk.toString().slice(0, 500) })
              res.on('end', () => reject(new Error(`HTTP ${status}: ${errBody.slice(0, 200)}`)))
              return
            }
            try {
              fileStream = createWriteStream(destPath)
              fileStream.on('error', (err) => { cleanup(); reject(err) })
            } catch (err) { reject(err as Error); return }

            const totalBytes = parseInt(String(res.headers['content-length'] || '0'), 10) || 0
              || (String(res.headers['content-range'] || '').match(/\/(\d+)\s*$/) ? parseInt(String(RegExp.$1), 10) : 0)
            let receivedBytes = 0
            let lastTime = Date.now()
            let lastBytes = 0

            res.on('data', (chunk) => {
              if (destroyed) return
              receivedBytes += chunk.length
              if (fileStream) fileStream.write(chunk)
              const now = Date.now()
              const elapsed = now - lastTime
              if (elapsed >= 500 || (totalBytes > 0 && receivedBytes >= totalBytes)) {
                const progressPct = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0
                const bytesDiff = receivedBytes - lastBytes
                const speedBps = elapsed > 0 ? (bytesDiff / elapsed) * 1000 : 0
                let speed = '0 B/s'
                if (speedBps > 1024 * 1024) speed = `${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`
                else if (speedBps > 1024) speed = `${(speedBps / 1024).toFixed(1)} KB/s`
                else speed = `${Math.round(speedBps)} B/s`
                onProgress({ progress: progressPct, size: totalBytes, receivedBytes, message: `下载中 ${speed}` })
                lastTime = now
                lastBytes = receivedBytes
              }
            })

            res.on('end', () => {
              if (destroyed) return
              activeDownloads.delete(taskId)
              if (fileStream) fileStream.end(() => resolve({ totalBytes }))
              else resolve({ totalBytes })
            })
          })
          activeDownloads.set(taskId, { req: req! })
          req!.on('error', (err) => {
            if (destroyed) return
            cleanup(); reject(err)
          })
          req!.on('timeout', () => {
            if (destroyed) return
            cleanup()
            try { req?.destroy(new Error('下载超时（45s 无响应）')) } catch { /* ignore */ }
            reject(new Error('下载超时（45s 无响应）'))
          })
        } catch (err) {
          reject(err as Error)
        }
      }

      makeRequest(url)
    })
  }

  // ── IPC: browser:douyinParse（SRC media-downloader.js L342-389 1:1：
  //     主链路=短链 302 取 video_id → 视频页 URL 交 yt-dlp；API 降为兜底）──
  ipcMain.handle('browser:douyinParse', async (_e: unknown, shareText: unknown) => {
    const text = String(shareText || '')
    // 1) 分享文本里直接粘了视频页 / note 页 URL 的情况
    let videoId = extractDouyinVideoIdFromUrl(text)
    // 2) 短链 → 302 Location 取 video_id（实测无需 cookie）
    if (!videoId) {
      const shareUrl = extractDouyinShareUrl(text)
      if (shareUrl) {
        try {
          const res = await fetch(shareUrl, {
            method: 'GET',
            redirect: 'manual' as RequestRedirect,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
            signal: AbortSignal.timeout(15000),
          })
          const loc = res.headers.get('location') || ''
          videoId = extractDouyinVideoIdFromUrl(loc)
          if (!videoId) {
            // 跳到 /user/ 等 → 视频已删除或短链失效
            return { ok: false, reason: '分享链接无法定位到视频（可能已删除或失效），请重新从抖音 App 分享复制链接' }
          }
        } catch { /* 302 探测失败 → 走 API 兜底 */ }
      }
    }
    if (videoId) {
      const videoPageUrl = buildDouyinVideoPageUrl(videoId)
      if (videoPageUrl) return { ok: true, videoPageUrl, videoId }
    }
    // 3) 兜底：第三方解析 API（dy.xs25.cn，其后端常被风控，成功则返回直链）
    const shareUrl2 = extractDouyinShareUrl(text)
    if (!shareUrl2) {
      return { ok: false, reason: '未找到有效的抖音分享链接（需 v.douyin.com 短链或视频页链接，可在抖音 App 分享→复制链接获得）' }
    }
    try {
      const res = await fetch(DOUYIN_PARSE_API + encodeURIComponent(shareUrl2), { signal: AbortSignal.timeout(20000) })
      const data = (await res.json().catch(() => null)) as unknown
      const v = validateDouyinParseResponse(data)
      if (!v.ok) return v
      return { ok: true, videoUrl: v.videoUrl, author: v.author, desc: v.desc, shareUrl: shareUrl2 }
    } catch (err) {
      return { ok: false, reason: '解析请求失败：' + ((err instanceof Error && err.message) || String(err)) }
    }
  })

  // ── IPC: browser:downloadMediaStart（SRC L392-638 1:1 有界移植；startMedia 供
  //     browser-service 复用：嗅探下载/B站扩展链接下载同引擎）──
  const startMedia = async (params: {
    taskId?: string; url?: string; audioUrl?: string; filename?: string; title?: string
    referer?: string; subDir?: string; useYtdlp?: boolean; platformId?: string
  }): Promise<{ success: boolean; taskId?: string; path?: string; size?: number; error?: string }> => {
    const { url, audioUrl, filename, title, referer, subDir, useYtdlp, platformId } = params || {}
    if (!url) return { success: false, error: '参数缺失：url' }
    const taskId = String(params.taskId || genTaskId('mdl'))
    const partition = platformId ? `persist:tintin-${platformId}` : 'persist:tintin-browser'

    let dir = downloadDir()
    try {
      dir = join(dir, subDir || '')
      mkdirSync(dir, { recursive: true })
    } catch {
      dir = join(tmpdir(), 'tintin-downloads', subDir || '')
      mkdirSync(dir, { recursive: true })
    }

    let safeFilename = String(filename || 'media').replace(/[\\/:*?"<>|]/g, '_')
    let finalPath = join(dir, safeFilename)
    let counter = 1
    const ext = extname(safeFilename)
    const base = basename(safeFilename, ext)
    while (existsSync(finalPath)) {
      safeFilename = `${base}_${counter}${ext}`
      finalPath = join(dir, safeFilename)
      counter++
    }
    const fileLabel = title || safeFilename
    taskRecords.set(taskId, { path: finalPath, title: fileLabel })
    activeDownloads.set(taskId, {})

    const isVideoPage = useYtdlp === true || (useYtdlp !== false && !!referer && isValidVideoPageUrl(referer))
    progress(taskId, 0, isVideoPage ? '正在通过 yt-dlp 解析视频...' : '准备下载...', fileLabel)

    if (isVideoPage) {
      const urlToDownload = referer || url
      // 平台 Cookie 域名统一从 platform-meta 取（单一维护点）→ Netscape 临时文件
      const dlPlatformId = detectPlatformFromUrl(urlToDownload)
      const cookieDomains = (dlPlatformId && PLATFORM_COOKIE_DOMAINS[dlPlatformId]) || []
      let cookieTempPath: string | null = null
      if (cookieDomains.length > 0) {
        try {
          const sess = sessionFromPartition(partition)
          let cookieLines = '# Netscape HTTP Cookie File\n# Generated by TinTin Client\n'
          for (const domain of cookieDomains) {
            const domainCookies = await sess.cookies.get({ domain }).catch(() => [] as CookieLike[])
            for (const c of domainCookies) {
              const d = c.domain && c.domain.startsWith('.') ? c.domain : '.' + (c.domain || domain)
              const flag = 'TRUE'
              const p = c.path || '/'
              const secure = c.secure ? 'TRUE' : 'FALSE'
              const exp = c.expirationDate ? Math.round(c.expirationDate) : Math.round(Date.now() / 1000 + 86400 * 30)
              cookieLines += `${d}\t${flag}\t${p}\t${secure}\t${exp}\t${c.name}\t${c.value}\n`
            }
          }
          const nonHeaderLines = cookieLines.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
          if (nonHeaderLines.length > 0) {
            cookieTempPath = finalPath + '.cookies.txt'
            writeFileSync(cookieTempPath, cookieLines, 'utf-8')
          }
        } catch { /* cookie 导出失败 → 匿名解析 */ }
      }

      const ytdlpInfo = getYtdlpArgs(appLike)
      if (!ytdlpInfo) {
        progress(taskId, 0, 'yt-dlp 不可用', fileLabel)
        fail(taskId, 'yt-dlp 不可用（内置组件缺失且系统未安装），请重新安装客户端或执行 pip install yt-dlp', fileLabel)
        activeDownloads.delete(taskId)
        return { success: false, error: 'yt-dlp not found' }
      }

      const formatList = ['bv+ba/b', 'best', 'bestvideo+bestaudio/best', 'worst']
      let lastError = ''
      for (const fmt of formatList) {
        if (!activeDownloads.has(taskId)) break
        progress(taskId, 5, `正在通过 yt-dlp 下载 (格式: ${fmt})...`, fileLabel)
        const allArgs = [
          ...ytdlpInfo.args,
          ...(cookieTempPath ? ['--cookies', cookieTempPath] : []),
          '--no-warnings',
          '--extractor-retries', '3',
          '--retries', '5',
          '-f', fmt,
          '--merge-output-format', 'mp4',
          '-o', finalPath,
          urlToDownload,
        ]
        const result = await new Promise<{ success: boolean; size?: number; error?: string }>((resolve) => {
          let stderrBuf = ''
          let stdoutBuf = ''
          const child = spawn(ytdlpInfo.cmd, allArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
          const parseProgress = (text: string): void => {
            const match = text.match(/\[download\]\s+(\d+\.\d+)%\s+of\s+([^\s]+)\s+at\s+([^\s]+)/)
            if (match) progress(taskId, Math.round(parseFloat(String(match[1]))), `下载中 ${match[3] ?? ''}`, fileLabel)
          }
          child.stdout.on('data', (data) => { const s = data.toString(); stdoutBuf += s; parseProgress(s) })
          child.stderr.on('data', (data) => { const s = data.toString(); stderrBuf += s; parseProgress(s) })
          child.on('close', (code) => {
            try { if (cookieTempPath && existsSync(cookieTempPath)) unlinkSync(cookieTempPath) } catch { /* ignore */ }
            if (code === 0) {
              let finalSize = 0
              try { if (existsSync(finalPath)) finalSize = statSync(finalPath).size } catch { /* ignore */ }
              resolve({ success: true, size: finalSize })
            } else {
              let fileCreated = false
              try { fileCreated = existsSync(finalPath) && statSync(finalPath).size > 0 } catch { /* ignore */ }
              if (fileCreated) resolve({ success: true, size: statSync(finalPath).size })
              else resolve({ success: false, error: `yt-dlp exit code ${code}: ${(stderrBuf + '\n--- stdout ---\n' + stdoutBuf).slice(-400)}` })
            }
          })
          child.on('error', (e) => { resolve({ success: false, error: e.message }) })
          activeDownloads.set(taskId, { child })
        })
        if (result.success) {
          activeDownloads.delete(taskId)
          done(taskId, finalPath, result.size || 0, fileLabel)
          return { success: true, taskId, path: finalPath }
        }
        lastError = result.error || lastError
      }
      activeDownloads.delete(taskId)
      fail(taskId, `下载失败: ${lastError}`, fileLabel)
      return { success: false, error: lastError, taskId }
    }

    // ── 流式下载模式 ──
    const cleanUrl = cleanMediaUrl(url)
    const cleanAudioUrl = audioUrl ? cleanMediaUrl(audioUrl) : null
    try {
      if (cleanAudioUrl) {
        // 音视频分离下载 + FFmpeg 合并（失败仅存视频）
        const videoTempPath = finalPath + '.video.tmp'
        const audioTempPath = finalPath + '.audio.tmp'
        let vPct = 0
        let aPct = 0
        const agg = (): void => {
          progress(taskId, Math.round((vPct + aPct) / 2), `视频 ${vPct}% · 音频 ${aPct}%`, fileLabel)
        }
        const videoPromise = downloadStream(taskId + '_video', cleanUrl, videoTempPath, referer, partition, (p) => {
          vPct = p.progress; agg()
        })
        const audioPromise = downloadStream(taskId + '_audio', cleanAudioUrl, audioTempPath, referer, partition, (p) => {
          aPct = p.progress; agg()
        })
        try {
          const [videoRes] = await Promise.all([videoPromise, audioPromise])
          progress(taskId, 99, '正在使用 FFmpeg 合并音视频...', fileLabel)
          const ffmpegBin = getFfmpegPath(appLike)
          const cmd = `${ffmpegBin} -y -i "${videoTempPath}" -i "${audioTempPath}" -c:v copy -c:a aac -strict experimental "${finalPath}"`
          await new Promise<void>((resolve) => {
            exec(cmd, (err) => {
              if (err) {
                // FFmpeg 合并失败，仅保存视频（SRC L597-599 同款：视频临时件改名落盘）
                try { if (existsSync(videoTempPath)) renameSync(videoTempPath, finalPath) } catch { /* ignore */ }
                try { if (existsSync(audioTempPath)) unlinkSync(audioTempPath) } catch { /* ignore */ }
                done(taskId, finalPath, videoRes.totalBytes || 0, fileLabel)
                log(`ffmpeg merge failed, saved video-only: ${err?.message || err}`)
              } else {
                try { if (existsSync(videoTempPath)) unlinkSync(videoTempPath) } catch { /* ignore */ }
                try { if (existsSync(audioTempPath)) unlinkSync(audioTempPath) } catch { /* ignore */ }
                let totalSize = 0
                try { totalSize = statSync(finalPath).size } catch { /* ignore */ }
                done(taskId, finalPath, totalSize, fileLabel)
              }
              resolve()
            })
          })
          activeDownloads.delete(taskId)
          return { success: true, taskId, path: finalPath }
        } catch (err) {
          try { if (existsSync(videoTempPath)) unlinkSync(videoTempPath) } catch { /* ignore */ }
          try { if (existsSync(audioTempPath)) unlinkSync(audioTempPath) } catch { /* ignore */ }
          activeDownloads.delete(taskId)
          fail(taskId, `下载失败: ${(err instanceof Error && err.message) || String(err)}`, fileLabel)
          return { success: false, error: (err instanceof Error && err.message) || String(err), taskId }
        }
      }
      // 单文件下载
      const result = await downloadStream(taskId, cleanUrl, finalPath, referer, partition, (p) => {
        progress(taskId, p.progress, p.message, fileLabel)
      })
      done(taskId, finalPath, result.totalBytes || 0, fileLabel)
      return { success: true, taskId, path: finalPath }
    } catch (err) {
      activeDownloads.delete(taskId)
      const msg = (err instanceof Error && err.message) || String(err)
      fail(taskId, `下载失败: ${msg}`, fileLabel)
      return { success: false, error: msg, taskId }
    }
  }
  ipcMain.handle('browser:downloadMediaStart', (_e: unknown, params: Parameters<typeof startMedia>[0]) => startMedia(params))

  // ── IPC: browser:downloadMediaCancel / Pause（SRC L641-656 1:1）──
  ipcMain.handle('browser:downloadMediaCancel', (_e: unknown, taskId: unknown) => {
    const id = String(taskId || '')
    if (killActiveTask(id)) {
      fail(id, '已取消', taskRecords.get(id)?.title || '')
      return { success: true }
    }
    return { success: false }
  })
  ipcMain.handle('browser:downloadMediaPause', (_e: unknown, taskId: unknown) => {
    const id = String(taskId || '')
    if (killActiveTask(id)) {
      progress(id, 0, '已暂停', taskRecords.get(id)?.title || '')
      taskRecords.delete(id)
      return { success: true }
    }
    return { success: false }
  })

  return {
    /** 直接发起媒体下载（browser:downloadMediaStart 的进程内入口；browser-service 复用） */
    startMedia,
    /** 全停（窗口销毁/进程退出前调用；当前无调用方，保留给面板工作包） */
    stopAll: (): void => { for (const id of [...activeDownloads.keys()]) killActiveTask(id) },
    taskRecords,
  }
}

export type MediaDownloader = ReturnType<typeof createMediaDownloaderIpc>
