// photocraft-control — 控制通道暖连接+镜像条件 GET 回归(2026-11-21 步骤5,§7.28)。
// 模拟 PhotoCraft 控制协议(docs/control-protocol.md):TCP JSON-lines,首帧 auth(token),
// 逐帧 {id, ok, result}。覆盖:①同目标空闲窗内复用同一连接(鉴权一次)②缓存废弃后重连
// ③ui.screenshot 携带 focus:false(缺省每次抬窗=dispatch.rs:225 实证的真 bug)
// ④screenshot 路由条件 GET(seq 命中同帧回 unchanged,稳态零传输)。
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectControl, disposeControlCache, type ControlConnection } from '../lib/photocraft.js'

/** 模拟 PhotoCraft 控制服务器:auth 帧 + 请求应答;记录连接数/auth 数/最后参数 */
interface MockServer {
  port: number
  connections: () => number
  auths: () => number
  lastParams: () => Record<string, unknown> | null
  setPng: (b64: string) => void
  reset: () => void
  close: () => Promise<void>
}

function startMock(): Promise<MockServer> {
  let connections = 0
  let auths = 0
  let lastParams: Record<string, unknown> | null = null
  let png = 'cG5nLUE=' // base64("png-A")
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    connections += 1
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        let frame: { id: string; method?: string; params?: Record<string, unknown> }
        try { frame = JSON.parse(line) } catch { continue }
        if (frame.method === 'auth') {
          auths += 1
          socket.write(JSON.stringify({ id: frame.id, ok: true }) + '\n')
          continue
        }
        lastParams = frame.params ?? null
        socket.write(JSON.stringify({ id: frame.id, ok: true, result: { data: png } }) + '\n')
      }
    })
  })
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolvePromise({
        port: addr.port,
        connections: () => connections,
        auths: () => auths,
        lastParams: () => lastParams,
        setPng: (b64: string) => { png = b64 },
        reset: () => { connections = 0; auths = 0 },
        close: () => new Promise((done) => {
          for (const sk of sockets) sk.destroy() // 活连接不杀=server.close 等到钩子超时
          server.close(() => done())
        }),
      })
    })
  })
}

let tokenFile: string

beforeAll(() => {
  tokenFile = join(mkdtempSync(join(tmpdir(), 'pc-token-')), 'control.token')
  writeFileSync(tokenFile, randomBytes(32).toString('hex'))
})
afterAll(() => {
  disposeControlCache()
  rmSync(tokenFile, { force: true })
})
beforeEach(() => { disposeControlCache() })

describe('connectControl 暖连接(步骤5)', () => {
  let mock: MockServer
  beforeAll(async () => { mock = await startMock() })
  afterAll(async () => { await mock.close() })
  beforeEach(() => { mock.reset() })

  it('同目标两次调用复用同一连接(鉴权一次)', async () => {
    const a = await connectControl({ port: mock.port, tokenFile })
    if (!a.ok) throw new Error(a.error)
    expect((await a.request('ui.screenshot', {})).ok).toBe(true)
    const b = await connectControl({ port: mock.port, tokenFile })
    if (!b.ok) throw new Error(b.error)
    expect((b as { warm?: boolean }).warm).toBe(true) // 命中缓存
    expect((await b.request('ui.screenshot', {})).ok).toBe(true)
    expect(mock.connections()).toBe(1)
    expect(mock.auths()).toBe(1)
  })

  it('缓存废弃后下一次调用重连(鉴权重来)', async () => {
    const a = await connectControl({ port: mock.port, tokenFile })
    if (!a.ok) throw new Error(a.error)
    expect((await a.request('ui.screenshot', {})).ok).toBe(true)
    disposeControlCache() // 等价应用 30s 关空闲连接后 close 清缓存的状态
    const b = await connectControl({ port: mock.port, tokenFile })
    if (!b.ok) throw new Error(b.error)
    expect((await b.request('ui.screenshot', {})).ok).toBe(true)
    expect(mock.connections()).toBe(2)
    expect(mock.auths()).toBe(2)
  })

  it('无效令牌=结构化失败,不发请求帧', async () => {
    const bad = await connectControl({ port: mock.port, tokenFile: join(tokenFile, 'missing') })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('控制令牌')
  })

  it('ui.screenshot 携带 focus:false(镜像轮询禁抬窗;调用方契约)', async () => {
    const a = await connectControl({ port: mock.port, tokenFile })
    if (!a.ok) throw new Error(a.error)
    await a.request('ui.screenshot', { focus: false })
    expect(mock.lastParams()).toEqual({ focus: false })
  })
})

/** screenshot 路由条件 GET:最小 webserver 座子,直调注册层 handler(sendJson 捕获应答) */
describe('screenshot 路由条件 GET(§7.28)', () => {
  let mock: MockServer
  const savedEnv: Record<string, string | undefined> = {}
  let callScreenshot: (url: string) => Promise<Record<string, unknown>>
  const disposes: Array<() => void> = []

  beforeAll(async () => {
    mock = await startMock()
    const tf = join(mkdtempSync(join(tmpdir(), 'pc-token-')), 'control.token')
    writeFileSync(tf, randomBytes(32).toString('hex'))
    savedEnv.port = process.env.TINTIN_PHOTOCRAFT_PORT
    savedEnv.file = process.env.TINTIN_PHOTOCRAFT_CONTROL_FILE
    process.env.TINTIN_PHOTOCRAFT_PORT = String(mock.port)
    process.env.TINTIN_PHOTOCRAFT_CONTROL_FILE = tf
    const mod = await import('../lib/cover-photocraft-routes.js')
    const registered: Array<{ path: string; handler: (req: { method: string; url: string }, res: unknown) => Promise<void> }> = []
    disposes.push(...mod.registerCoverPhotocraftRoutes({
      registeringWebServer: { register: (r: { path: string; handler: (req: { method: string; url: string }, res: unknown) => Promise<void> }) => { registered.push(r); return () => {} } },
      isTrustedRequest: () => true,
      sendJson: (_res: unknown, _status: number, body: unknown) => { lastBody = body as Record<string, unknown> },
      loadEngine: async () => { throw new Error('not used in screenshot test') },
      getServerUrl: () => '',
    }) as Array<() => void>)
    const shot = registered.find((r) => r.path.endsWith('/pc/screenshot'))
    if (!shot) throw new Error('screenshot route missing')
    callScreenshot = async (url: string) => {
      lastBody = null
      await shot.handler({ method: 'GET', url }, null)
      if (lastBody === null) throw new Error('no response captured')
      return lastBody
    }
  })
  let lastBody: Record<string, unknown> | null = null
  afterAll(async () => {
    disposeControlCache()
    for (const d of disposes) d()
    await mock.close()
    if (savedEnv.port === undefined) delete process.env.TINTIN_PHOTOCRAFT_PORT
    else process.env.TINTIN_PHOTOCRAFT_PORT = savedEnv.port
    if (savedEnv.file === undefined) delete process.env.TINTIN_PHOTOCRAFT_CONTROL_FILE
    else process.env.TINTIN_PHOTOCRAFT_CONTROL_FILE = savedEnv.file
  })
  beforeEach(() => { disposeControlCache(); lastBody = null; mock.reset() })

  it('首轮=全量 data+seq;同帧带 seq=unchanged;帧变=新 seq 全量', async () => {
    const r1 = await callScreenshot('/tintin/ipc/cover/pc/screenshot') as { ok: boolean; data: string; seq: number }
    expect(r1.ok).toBe(true)
    expect(r1.data).toBe('cG5nLUE=')
    expect(r1.seq).toBe(1)
    const r2 = await callScreenshot('/tintin/ipc/cover/pc/screenshot?seq=1') as { ok: boolean; unchanged: boolean; seq: number }
    expect(r2.ok).toBe(true)
    expect(r2.unchanged).toBe(true)
    expect(r2.seq).toBe(1)
    expect('data' in r2).toBe(false) // 稳态零传输
    mock.setPng('cG5nLUI=') // base64("png-B")
    const r3 = await callScreenshot('/tintin/ipc/cover/pc/screenshot?seq=1') as { ok: boolean; data: string; seq: number }
    expect(r3.ok).toBe(true)
    expect(r3.data).toBe('cG5nLUI=')
    expect(r3.seq).toBe(2)
    expect(mock.lastParams()).toEqual({ focus: false }) // 路由层禁抬窗
  })
})
