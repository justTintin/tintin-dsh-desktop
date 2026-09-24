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

/**
 * 拖拽/文件选择得到的 File → 本地绝对路径。
 *
 * 2026-09-24（用户报障：选择素材无法拖入）：Electron 43 移除了 File.path，
 * 拖拽与 input 选择的 File 对象不再携带路径——所有拖入/选择静默失效。桌面端
 * preload 已暴露 dshDesktopFilePath.forFile（webUtils.getPathForFile 封装），
 * 此处经桥解析；旧 File.path 仅作降级兜底。取不到路径返回空串，调用方按取消
 * 或错误处理。
 */
export function filePathOf(f: File): string {
  if (!f) return ''
  try {
    const viaBridge = (window as any).dshDesktopFilePath?.forFile?.(f)
    if (typeof viaBridge === 'string' && viaBridge) return viaBridge
  } catch { /* 桥缺失/异常走降级 */ }
  const legacy = (f as File & { path?: string }).path
  return typeof legacy === 'string' ? legacy : ''
}
