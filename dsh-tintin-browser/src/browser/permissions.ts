// permissions.ts — 内嵌浏览器网站权限策略（2026-11-20 壳层欠账「权限面」批；
// 同日用户裁决升级=**per-origin 询问 + 记忆**，对齐 Chrome 语义）。
//
// Electron 无 handler 时默认**放行**所有权限请求（与 Chrome 的「询问」不同）——
// 通知/定位/摄像头麦克风会被任意网站静默拿走。本模块策略：
//   直接放行（无需询问，播放器/页面基础体验）：fullscreen / pointerLock /
//     clipboard-sanitized-write / media（读侧协商）
//   询问（弹宿主对话框，选择记住 per origin）：notifications / geolocation /
//     media（摄像头麦克风采集 KeyRequested）/ midi / midiSysex / display-capture /
//     sensors / backgroundSync
//   直接拒绝（表外未知权限，不问不猜）
// 记忆表存 settings.json 的 permissions 字段（settings-store 持久化）；
// 设置页「网站权限」区可逐条移除（重置后同站再请求会重新询问）。
import { dialog, type Session } from 'electron'

/** 直接放行（无需询问，播放器/页面基础体验） */
const ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write'])

/** 会弹询问的权限 → 中文说明 */
const ASKABLE: Record<string, string> = {
  notifications: '发送通知',
  geolocation: '获取地理位置',
  media: '使用摄像头/麦克风',
  midi: '访问 MIDI 设备',
  midiSysex: '访问 MIDI 设备（SysEx）',
  'display-capture': '捕获屏幕内容',
  sensors: '读取运动传感器',
  backgroundSync: '后台同步',
}

export interface PermissionStore {
  /** 记忆表读取：origin → permission → allow|deny */
  getPermissions: () => Record<string, Record<string, 'allow' | 'deny'>>
  /** 记忆表写入（含持久化） */
  setPermission: (origin: string, permission: string, decision: 'allow' | 'deny') => void
}

interface PendingWaiter { resolve: (allow: boolean) => void }

export function registerPermissionPolicies(
  session: Session,
  deps: { log: (msg: string) => void; store: PermissionStore },
): void {
  const { log, store } = deps
  /** 同 origin+permission 的并发询问去重：挂起等待器按 key 归队，结果统一放行/拒绝 */
  const pending = new Map<string, PendingWaiter[]>()

  const askOnce = (origin: string, permission: string, label: string): Promise<boolean> => {
    const key = `${origin}::${permission}`
    const waiter: PendingWaiter = { resolve: () => {} }
    if (pending.has(key)) {
      pending.get(key)!.push(waiter)
      return new Promise((resolve) => { waiter.resolve = resolve })
    }
    pending.set(key, [waiter])
    void dialog
      .showMessageBox({
        type: 'question',
        buttons: ['允许', '拒绝'],
        defaultId: 1,
        cancelId: 1,
        title: '网站权限',
        message: `${origin} 请求${label}权限`,
        detail: '选择将被记住；之后可在 设置 → 网站权限 中修改。',
      })
      .then(({ response }) => {
        const decision: 'allow' | 'deny' = response === 0 ? 'allow' : 'deny'
        try { store.setPermission(origin, permission, decision) } catch (err) { log(`permission save failed: ${err instanceof Error ? err.message : err}`) }
        const queue = pending.get(key) ?? []
        pending.delete(key)
        for (const w of queue) w.resolve(decision === 'allow')
      })
      .catch(() => {
        const queue = pending.get(key) ?? []
        pending.delete(key)
        for (const w of queue) w.resolve(false)
      })
    return new Promise((resolve) => { waiter.resolve = resolve })
  }

  try {
    session.setPermissionRequestHandler((wc, permission, callback) => {
      let origin = ''
      try { origin = new URL(wc.getURL()).origin } catch { /* 无 URL：按拒绝 */ }
      if (ALLOW.has(permission)) return callback(true)
      const remembered = store.getPermissions()[origin]?.[permission]
      if (remembered === 'allow') return callback(true)
      if (remembered === 'deny') return callback(false)
      const label = ASKABLE[permission]
      if (!label) { log(`permission denied (unknown): ${permission}`); return callback(false) }
      void askOnce(origin, permission, label).then((allow) => { log(`permission ${allow ? 'granted' : 'denied'}: ${permission} @ ${origin}`); callback(allow) })
    })
    session.setPermissionCheckHandler((wc, permission) => {
      let origin = ''
      try { origin = new URL(wc?.getURL?.() ?? '').origin } catch { /* ignore */ }
      if (ALLOW.has(permission)) return true
      return store.getPermissions()[origin]?.[permission] === 'allow'
    })
  } catch (err) { log(`permission policy attach failed: ${err instanceof Error ? err.message : err}`) }
}
