// Vitest-only Electron stub. The browser-domain modules import Electron at the
// top level because they run in the Electron main process, but their pure
// logic (extractor script building, package state machines, cookie formatting)
// is unit-tested outside Electron. In the source repository the tests resolved
// the real (unusable-in-node) electron package; here the workspace does not
// depend on Electron at all, so tests alias it onto this stub instead.
// Only runtime values are stubbed; `type` imports are erased at compile time.
const lazyFn = () => new Proxy(function noop() { /* electron API stub */ } as unknown as Record<string, unknown>, {
  get: (target, prop) => {
    if (prop === 'then') return undefined
    if (prop === 'on' || prop === 'once' || prop === 'removeListener' || prop === 'off') return () => undefined
    const value = (target as Record<unknown, unknown>)[prop]
    if (value !== undefined) return value
    return lazyFn()
  },
  apply: () => lazyFn(),
})

export const app = lazyFn()
export const ipcMain = lazyFn()
export const session = lazyFn()
export const net = lazyFn()
export const protocol = lazyFn()
export const shell = lazyFn()
export const BrowserWindow = lazyFn()
export const BrowserView = lazyFn()
export const WebContentsView = lazyFn()
