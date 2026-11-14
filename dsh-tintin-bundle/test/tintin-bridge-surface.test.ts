// test/tintin-bridge-surface.test.ts — 分面调用面回归（2026-11-14 用户裁决：素材
// 创作/运营/媒体三面服务端地址分面独立）。工作树无 jsdom 依赖（宿主 chrome 区段
// 重 DOM 不宜整体求值），故取 client.js installTintinBridge 的桥体源码切片（首尾
// 都是稳定语句锚点，块内纯桥定义无 DOM 依赖）在 vm 沙箱内以 stub fetch/XHR 驱动
// 真实实现：forSurface 句柄按调用面携带 x-tintin-scope 头、全局调用不带面值、调用
// 后复位、未知面抛错、XHR 上传同带头。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const clientSrc = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
// 切片锚点：桥体起点（分面机械的清单声明）与终点（polyfill 安装完成打点）。
const START = "const TINTIN_SURFACES = ['creation', 'ops', 'media']"
const END = "console.info('[tintin] window.tintin polyfill installed')"
const bridgeSrc = clientSrc.slice(clientSrc.indexOf(START), clientSrc.indexOf(END))
if (!bridgeSrc.includes('forSurface')) throw new Error('tintin-bridge-surface: client.js slice lost the forSurface block — anchors moved?')

function makeSandbox() {
  const fetchCalls: Array<{ url: string; init?: { headers?: Record<string, string> } }> = []
  const xhrs: Array<Record<string, string>> = []
  const sandbox: Record<string, unknown> = {
    console: { info: () => {}, error: () => {} },
    fetch: (url: string, init?: { headers?: Record<string, string> }) => {
      fetchCalls.push({ url, init })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ result: {} }) })
    },
    XMLHttpRequest: class {
      headers: Record<string, string> = {}
      status = 200
      responseText = '{"result":{}}'
      onload: (() => void) | null = null
      constructor() { xhrs.push(this.headers) }
      open() { /* noop */ }
      setRequestHeader(k: string, v: string) { this.headers[k] = v }
      send() { this.onload?.() }
    },
    window: {} as Record<string, unknown>,
  }
  sandbox.window = sandbox.window as Record<string, unknown>
  vm.createContext(sandbox)
  new vm.Script(bridgeSrc, { filename: 'client.js#bridge' }).runInContext(sandbox as never)
  const tintin = (sandbox.window as { tintin?: Record<string, unknown> }).tintin as never as {
    server: Record<string, (...args: never[]) => Promise<unknown>>
    __dshPolyfill: boolean
    forSurface: (scope: string) => Record<string, never> & { server: Record<string, (...args: never[]) => Promise<unknown>> }
  }
  return { fetchCalls, xhrs, tintin }
}

describe('tintin bridge forSurface (client.js slice)', () => {
  it('installs the polyfill and leaves plain calls without a scope header', async () => {
    const { fetchCalls, tintin } = makeSandbox()
    expect(tintin.__dshPolyfill).toBe(true)
    await tintin.server.get('/x')
    expect(fetchCalls[0].url).toBe('/tintin/ipc/server:get')
    expect(fetchCalls[0].init?.headers?.['x-tintin-scope']).toBeUndefined()
  })

  it('attaches x-tintin-scope to wrapped calls and restores after each call', async () => {
    const { fetchCalls, tintin } = makeSandbox()
    const ops = tintin.forSurface('ops')
    const media = tintin.forSurface('media')
    await ops.server.get('/a')
    expect(fetchCalls[0].init?.headers?.['x-tintin-scope']).toBe('ops')
    await media.server.post('/b', {})
    expect(fetchCalls[1].init?.headers?.['x-tintin-scope']).toBe('media')
    // 调用后复位：面上句柄发完，普通句柄不带面值
    await tintin.server.get('/c')
    expect(fetchCalls[2].init?.headers?.['x-tintin-scope']).toBeUndefined()
    // Proxy 兜底成员（config:get 通道）同样携带面值
    await ops.config.get()
    expect(fetchCalls[3].init?.headers?.['x-tintin-scope']).toBe('ops')
  })

  it('carries the scope header onto multipart XHR uploads', async () => {
    const { xhrs, tintin } = makeSandbox()
    const creation = tintin.forSurface('creation')
    await creation.server.upload('/upload/target', {})
    expect(xhrs[0]?.['x-tintin-scope']).toBe('creation')
  })

  it('rejects unknown surfaces and passes through non-function members', () => {
    const { tintin } = makeSandbox()
    expect(() => tintin.forSurface('cover')).toThrow(/Unknown tintin surface/)
    const media = tintin.forSurface('media')
    expect(media.__dshPolyfill).toBe(true)
  })
})
