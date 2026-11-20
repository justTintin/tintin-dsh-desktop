// permissions.ts — 内嵌浏览器网站权限策略（2026-11-20 壳层欠账「权限面」首批）。
// Electron 无 handler 时默认**放行**所有权限请求（与 Chrome 的「询问」不同）——
// 通知/定位/摄像头麦克风会被任意网站静默拿走。这里按 Chromium 常见语义固定策略：
//   允许：fullscreen / pointerLock / clipboard-sanitized-write / media（读侧，播放器协商）
//   拒绝：notifications / geolocation / media（摄像头麦克风采集）/ midi / sensors /
//         display-capture / backgroundSync 等
// 设置化（per-origin 询问 UI）留待后续批；策略变更见本文件表。
import type { Session } from 'electron'

/** 默认放行的权限名（播放器协商所需；采集类一律不在表内） */
const ALLOW = new Set([
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
])

export function registerPermissionPolicies(session: Session, log: (msg: string) => void): void {
  try {
    session.setPermissionRequestHandler((_wc, permission, callback) => {
      const allow = ALLOW.has(permission)
      if (!allow) log(`permission denied: ${permission}`)
      callback(allow)
    })
    session.setPermissionCheckHandler((_wc, permission) => ALLOW.has(permission))
  } catch (err) { log(`permission policy attach failed: ${err instanceof Error ? err.message : err}`) }
}
