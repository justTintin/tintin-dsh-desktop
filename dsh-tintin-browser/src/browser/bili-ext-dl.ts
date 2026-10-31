// ═══════════════════════════════════════════════════════════════
// bili-ext-dl.ts — B站下载助手扩展下载链接捕获与轮询
// （SRC desktop/main/thick-shell-viewpool.js 一比一移植，基线 SRC 9ca9050；
//   2026-10-26「下载扩展链复活」工作包，铁律 12 依据②。
//   SRC 形态：console-message 捕获 [TINTIN_BILI_DL] 推送（L237-254）+
//   2s 主动轮询 BILI_DL_EXTRACT_SCRIPT（L371-396）；本仓 browser-service
//   接线时 push 到页面通道 browser:bili-ext-dl。）
// 无 electron 依赖（wc 以结构类型注入），可单测（铁律 8）。
// ═══════════════════════════════════════════════════════════════
import { BILI_DL_EXTRACT_SCRIPT } from './bilibili-ext.ts'

/** 扩展 content script 经 console.log 推送的前缀（SRC L238 同款） */
export const BILI_DL_CONSOLE_PREFIX = '[TINTIN_BILI_DL]'

/** B站视频页判定（SRC 轮询 URL 门 L373 同款） */
function isBilibiliPageUrl(url: string): boolean {
  return /bilibili\.com/i.test(String(url || ''))
}

/** 极小 WebContents 结构（只依赖被测面，脱离 Electron 单测） */
export interface BiliDlWebContentsLike {
  isDestroyed(): boolean
  getURL(): string
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
  on?(event: 'console-message', listener: (payload: unknown) => void): unknown
}

/**
 * 解析扩展 content script 的 console 推送（SRC console-message 分支 1:1）：
 * `[TINTIN_BILI_DL]{...json...}` → payload；非该前缀/坏 JSON → null。
 */
export function parseBiliDlConsoleMessage(message: unknown): { payload: unknown } | null {
  const text = String(message || '')
  const idx = text.indexOf(BILI_DL_CONSOLE_PREFIX)
  if (idx < 0) return null
  try {
    return { payload: JSON.parse(text.slice(idx + BILI_DL_CONSOLE_PREFIX.length)) }
  } catch {
    return null
  }
}

/** console-message 捕获挂接（冗余通道，主通道为主动轮询——SRC 注释同款） */
export function attachBiliDlConsoleCapture(
  wc: BiliDlWebContentsLike,
  push: (payload: unknown) => void,
): void {
  if (!wc.on) return
  wc.on('console-message', (raw: unknown) => {
    try {
      const m = raw as { message?: unknown } | unknown
      const text = typeof m === 'object' && m !== null ? String((m as { message?: unknown }).message ?? m) : String(m)
      const parsed = parseBiliDlConsoleMessage(text)
      if (parsed) push(parsed.payload)
    } catch { /* 推送异常不影响页面 */ }
  })
}

export interface BiliDlPollingDeps {
  /** 当前 B站 view 的 webContents（null/已销毁 → 本轮跳过） */
  getWebContents: () => BiliDlWebContentsLike | null
  /** 命中下载链接时推送（browser-service 发 browser:bili-ext-dl） */
  push: (payload: unknown) => void
  /** executeJavaScript 注入面（缺省 wc.executeJavaScript；单测注入假实现） */
  execute?: (wc: BiliDlWebContentsLike, script: string) => Promise<unknown>
  /** 抽取脚本（缺省 BILI_DL_EXTRACT_SCRIPT；单测注入假脚本） */
  script?: string
  intervalMs?: number
  log?: (msg: string) => void
}

export interface BiliExtDlResult {
  hostFound?: boolean
  downloads?: unknown[]
}

/**
 * B站扩展下载链接主动轮询（SRC L371-396 一比一）：
 * 每 intervalMs 从页面 shadow DOM 提取下载链接（不依赖 console-message/注入时机）；
 * 页面非 B站域名跳过；webContents 销毁自动停表。
 */
export function startBiliExtPolling(deps: BiliDlPollingDeps): () => void {
  const interval = deps.intervalMs ?? 2000
  const execute = deps.execute ?? ((wc, script) => wc.executeJavaScript(script))
  const log = deps.log ?? (() => {})
  const timer = setInterval(() => {
    let wc: BiliDlWebContentsLike | null = null
    try {
      wc = deps.getWebContents()
      if (!wc || wc.isDestroyed()) {
        stop()
        return
      }
      if (!isBilibiliPageUrl(wc.getURL())) return
      void execute(wc, deps.script ?? BILI_DL_EXTRACT_SCRIPT)
        .then((res) => {
          const r = (res ?? null) as BiliExtDlResult | null
          if (!r || typeof r !== 'object') return
          if (Array.isArray(r.downloads) && r.downloads.length > 0) {
            log(`bili-ext-dl: ${r.downloads.length} links`)
            deps.push(r)
          }
        })
        .catch(() => { /* 页面跳转中执行失败属常态（SRC 同） */ })
    } catch { /* wc 取取失败下轮再试 */ }
  }, interval)
  function stop(): void {
    clearInterval(timer)
  }
  return stop
}
