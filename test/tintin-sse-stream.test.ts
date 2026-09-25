// test/tintin-sse-stream.test.ts — createOpenSseStream 回归（/tintin/sse 透传的上游半边）
// SRC server:sse（server-proxy.js L556-601）的传输半边移植：GET + Accept:
// text/event-stream + X-Machine-ID，2xx resolve 出响应流，非 2xx 缓冲摘要后
// 带 status reject；上游不可达 reject（宿主路由转 502）。解析半边在渲染层
// polyfill（client.js sse），宿主只透传不解析。
import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createOpenSseStream } from '../packages/tintin-bundle/lib/server-proxy.js'

const servers: Server[] = []

afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

function listen(app: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<string> {
  return new Promise((resolve) => {
    const s = createServer(app)
    servers.push(s)
    s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`))
  })
}

function collect(res: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    res.on('data', (c: Buffer) => chunks.push(c))
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

describe('createOpenSseStream', () => {
  const deps = (base: string) => ({
    getServerUrl: () => base,
    getMachineId: () => 'test-machine',
    log: () => {},
    warn: () => {},
  })

  it('2xx 透传响应流并携带事件头（X-Machine-ID / Accept）', async () => {
    let seenHeaders: Record<string, string> = {}
    const base = await listen((req, res) => {
      seenHeaders = { machine: String(req.headers['x-machine-id'] ?? ''), accept: String(req.headers.accept ?? '') }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"progress":40}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
    const open = createOpenSseStream(deps(base))
    const upstream = await open('/workflow/run/r1/stream')
    expect(upstream.statusCode).toBe(200)
    expect(upstream.headers['content-type']).toContain('text/event-stream')
    expect(seenHeaders.machine).toBe('test-machine')
    expect(seenHeaders.accept).toBe('text/event-stream')
    await expect(collect(upstream)).resolves.toContain('{"progress":40}')
  })

  it('非 2xx reject 并带 status 与响应摘要', async () => {
    const base = await listen((req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"detail":"Not Found"}')
    })
    const open = createOpenSseStream(deps(base))
    await expect(open('/workflow/run/none/stream')).rejects.toMatchObject({ status: 404 })
  })

  it('上游不可达（连接拒绝）reject', async () => {
    const open = createOpenSseStream(deps('http://127.0.0.1:1'))
    await expect(open('/workflow/run/r1/stream')).rejects.toThrow()
  })

  it('调用方 destroy 上游即断开（退订语义）', async () => {
    let closed = false
    const base = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"progress":0}\n\n')
      res.on('close', () => { closed = true })
      // 不主动 end，模拟长连接
    })
    const open = createOpenSseStream(deps(base))
    const upstream = await open('/workflow/run/r1/stream')
    upstream.destroy()
    await new Promise((r) => setTimeout(r, 50))
    expect(closed).toBe(true)
  })
})
