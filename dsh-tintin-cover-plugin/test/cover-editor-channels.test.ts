// B2 编辑器业务通道(/tintin/ipc/cover:<name>)派发回归面:收集表→别名前缀路由→
// 同一处理器;方法/信任判定由原处理器自守(与直连 REST 同语义)。
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { registerCoverPluginRoute } from '../lib/cover-plugin-route.js'

interface Spec { path: string; handler: (req: EventEmitter & { url?: string; method?: string; headers?: Record<string, string>; socket?: unknown }, res: unknown) => Promise<void> | void }

describe('编辑器业务通道(/tintin/ipc/cover:*)', () => {
  it('注册后可经别名派发:GET fonts 200;未知频道 404;POST 无信任被内层 403', async () => {
    const routes = new Map<string, Spec>()
    registerCoverPluginRoute({
      webServer: { register: (spec: Spec) => { routes.set(spec.path, spec); return () => {} } },
      isTrustedRequest: (req: { headers?: Record<string, string> }, mutation?: boolean) => {
        if (!mutation) return true
        const origin = req.headers?.origin
        return origin === 'http://127.0.0.1:43120'
      },
      sendJson: (res: { done: (code: number, body: unknown) => void }, code: number, body: unknown) => res.done(code, body),
      httpRequest: async () => ({}),
      getServerUrl: () => '',
    })
    const alias = routes.get('/tintin/ipc/cover:')!
    expect(alias).toBeDefined()

    const call = (method: string, url: string, headers: Record<string, string> = {}): Promise<{ code: number; body: unknown }> =>
      new Promise((resolve) => {
        const req = new EventEmitter() as EventEmitter & { url: string; method: string; headers: Record<string, string>; socket: unknown }
        req.url = url; req.method = method; req.headers = headers; req.socket = { remoteAddress: '127.0.0.1' }
        const res = { done: (code: number, body: unknown) => resolve({ code, body }) }
        void alias.handler(req, res)
        // 处理器先 await 再挂监听:等 end 监听就位再发请求体(无体=立即 end)
        const poll = setInterval(() => {
          if (req.listenerCount('end') > 0) { clearInterval(poll); req.emit('end') }
        }, 2)
      })

    const fonts = await call('GET', '/tintin/ipc/cover:fonts')
    expect(fonts.code).toBe(200)
    expect((fonts.body as { ok: boolean; families: unknown[] }).ok).toBe(true)
    expect(Array.isArray((fonts.body as { families: unknown[] }).families)).toBe(true)

    const unknown = await call('GET', '/tintin/ipc/cover:no-such-channel')
    expect(unknown.code).toBe(404)

    const denied = await call('POST', '/tintin/ipc/cover:delete-asset', { 'content-type': 'application/json' })
    expect(denied.code).toBe(403)
  })
})
