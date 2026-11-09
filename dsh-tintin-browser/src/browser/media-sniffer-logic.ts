// media-sniffer-logic.ts — 媒体嗅探纯判定层（SRC browser-webview.js isMediaUrl /
// getMediaTypeFromUrl 1:1 移植；铁律 8：无 Electron 依赖，单测下沉）。

/** 埋点/日志上报主机（2026-11-08 报障：B站 data.bilibili.com/log/web 的 query 恰含
 *  .ts/.m4s 字样，无边界子串匹配把埋点刷成「音频」列表）——命中即非媒体 */
const TRACKING_HOST_PATTERNS: RegExp[] = [
  /\/log\//i,
  /data\.bilibili\.com/i,
  /report/i,
]

/** 路径段内的媒体扩展名（2026-11-08 边界修复：扩展名必须出现在 / 之后、? 之前，
 *  替代 SRC 的无边界 includes——query 字符串里的 ".ts" 不再误判） */
function hasPathExtension(lower: string): boolean {
  const path = lower.split('?')[0] ?? ''
  return /\.(mp4|m3u8|mp3|flv|webm|ogg|m4s|ts)(?=$|\/)/.test(path)
}

/** 媒体 URL 判定（SRC L49-64 规则为基：扩展名 + 平台特征路径段；2026-11-08 边界+埋点修复） */
export function isMediaUrl(url: unknown): boolean {
  if (!url || typeof url !== 'string') return false
  if (url.startsWith('data:')) return false
  const lower = url.toLowerCase()
  if (TRACKING_HOST_PATTERNS.some((p) => p.test(lower))) return false
  if (hasPathExtension(lower)) return true
  if (lower.includes('video/tos') || lower.includes('sns-video') ||
    lower.includes('sns-img') || lower.includes('sns-webpic') ||
    lower.includes('v-code') || lower.includes('upos-sz-mirrstar') ||
    lower.includes('videoplayback') || lower.includes('.douyinvod.com')) return true
  return false
}

/** 媒体类型判定（SRC L66-73：音频特征 → audio，其余 video） */
export function mediaTypeFromUrl(url: unknown): 'video' | 'audio' {
  const lower = String(url || '').toLowerCase()
  if (lower.includes('.mp3') || lower.includes('mime=audio') || lower.includes('media-audio') ||
    lower.includes('-30216') || lower.includes('-30232') || lower.includes('-30280') ||
    lower.includes('-30250') || lower.includes('audio')) return 'audio'
  return 'video'
}

/** 页面展示用的短名（URL 尾段去参数，超长截断；尾段为空回落主机名） */
export function mediaDisplayName(url: unknown, max = 60): string {
  const raw = String(url || '')
  let host = ''
  try { host = new URL(raw).hostname } catch { /* 非 URL 原样走尾段 */ }
  const tail = raw.split('?')[0] || raw
  const seg = tail.slice(tail.lastIndexOf('/') + 1) || host || tail
  return seg.length > max ? seg.slice(0, max - 1) + '…' : seg
}
