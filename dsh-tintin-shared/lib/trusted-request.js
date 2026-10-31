// trusted-request — 宿主 loopback 请求信任闸(2026-10-31 自 dsh-tintin-bundle/index.js
// 迁入共享包:视频剪辑宿主桥与封面插件的 webServer 路由同用这组判定)。
// Same-origin loopback requests only, mirroring dsh-desktop-market-installer's
// gate so the route stays unreachable from LAN pairing tunnels and proxies.

function isLoopback(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function hasForwardedAddress(req) {
  return Boolean(
    req.headers.forwarded ||
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-host']
  )
}

export function isTrustedRequest(req, mutation = false) {
  if (!isLoopback(req.socket.remoteAddress) || hasForwardedAddress(req)) return false
  if (!mutation) return true

  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && parsed.host === host && isLoopback(parsed.hostname)
  } catch {
    return false
  }
}
