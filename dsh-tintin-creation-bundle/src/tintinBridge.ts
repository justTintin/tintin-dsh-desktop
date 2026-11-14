// tintinBridge — 分面桥句柄（2026-11-14 用户裁决：素材创作/运营/媒体三面服务端
// 地址分面独立）。本包 vite.config.mts 的 tintinSurfacePlugin 把源码里的
// window.tintin / globalThis.tintin 全局引用在构建期改写为 __tintinSurface()：
// 真实 polyfill（dsh-tintin-bundle/client.js 的 forSurface）在场时取分面句柄
// （请求携带 x-tintin-scope 头，宿主 AsyncLocalStorage 按面解析服务端地址），
// 否则回落原始全局——单测的 window.tintin 桩与旧 polyfill 语义不变。本文件自身
// 被插件豁免；每次调用惰性读取。creationServer.getTintin() 亦改走本句柄
// （(window as any).tintin 写法不落构建期重写，须显式收口）。
type TintinGlobal = { forSurface?: (surface: string) => unknown } & Record<string, unknown>

const SURFACE = 'creation'

export function __tintinSurface(): unknown {
  // 浏览器里 window === globalThis（两读等价）；node 单测把桩挂在
  // globalThis.window.tintin（无 window 全局），故 window.tintin 优先读。
  const w = (globalThis as { window?: { tintin?: TintinGlobal } }).window
  const raw = w?.tintin ?? (globalThis as { tintin?: TintinGlobal }).tintin
  if (!raw) return undefined
  return typeof raw.forSurface === 'function' ? raw.forSurface(SURFACE) : raw
}
