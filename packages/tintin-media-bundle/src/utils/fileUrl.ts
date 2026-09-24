/**
 * 本地文件路径 → 可播放 URL。
 *
 * 移植版（DSH Desktop，2026-09-24）：页面经 http://127.0.0.1 提供，http 页面
 * 引用 file:/// 子资源被 Chromium 禁止——原客户端（file:// 页面）不受限的
 * 行为在移植版失效，批量克隆后声音无法播放即此因。检测到 TinTin polyfill
 * 时，本地媒体统一改经宿主受信路由 /tintin/media 流式供给（同源回环 GET，
 * Range 支持进度条拖动）；非移植环境保留 file:/// 兜底（原客户端口径）。
 */
export function toFileUrl(p: string): string {
  if (!p) return ''
  if (/^(https?|blob|data|file):/i.test(p)) return p
  if (typeof window !== 'undefined' && (window as any).tintin?.__dshPolyfill) {
    return `/tintin/media?path=${encodeURIComponent(p)}`
  }
  const normalized = p.replace(/\\/g, '/')
  const encoded = normalized
    .split('/')
    .filter((seg) => seg !== '')
    .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ':'))
    .join('/')
  return `file:///${encoded}`
}
