// deep-link-guard.ts — App 深链协议吞掉注册（2026-11-04「按推荐处理」裁决；
// 2026-11-04 自 browser-service.ts 提取付账）。名单与判定在 platform-meta
// （PLATFORM_DEEP_LINK_SCHEMES）；主帧路径由 browser-service 的 will-navigate 先行取消，
// 本注册兜底子帧与漏拦路径——协议处理器一旦存在，Chromium 不再走外部协议链路。
import { session } from 'electron'
import { PLATFORM_DEEP_LINK_SCHEMES, PLATFORM_DEFS, PLATFORM_IDS } from './platform-meta.ts'

export function registerDeepLinkSwallow(log: (msg: string) => void): void {
  for (const id of PLATFORM_IDS) {
    const def = PLATFORM_DEFS[id]!
    const ses = session.fromPartition(def.partition)
    for (const scheme of PLATFORM_DEEP_LINK_SCHEMES) {
      try {
        ses.protocol.handle(scheme, () => {
          log(`deep link swallowed (${id}): ${scheme}://`)
          return new Response(null, { status: 204 })
        })
      } catch (err) {
        log(`deep link swallow register failed (${id}/${scheme}): ${err instanceof Error ? err.message : err}`)
      }
    }
  }
}
