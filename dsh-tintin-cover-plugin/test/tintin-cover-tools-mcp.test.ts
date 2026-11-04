// cover-tools-mcp 用例(2026-11-04 感知闭环+工具收敛批):MCP 端点协议面 + 三工具行为。
// fetch 打桩(服务端 /matting 模型链),engine 打桩(临时项目目录+渲染写真 PNG),
// webServer 桩捕 handler;req 用 node stream Readable 喂 JSON-RPC body。
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })
const tempRoot = (): string => { const dir = mkdtempSync(join(tmpdir(), 'tintin-cover-tools-')); roots.push(dir); return dir }

// 1x1 红 PNG(合法魔数)
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

type Handler = (req: unknown, res: unknown) => Promise<void> | void
interface RpcOut { status: number; body: Record<string, unknown>; res: { statusCode: number } }

async function setup(opts: { renderCover?: (...args: unknown[]) => Promise<unknown> } = {}) {
  const coverDir = tempRoot()
  const pluginDir = tempRoot()
  const handlers = new Map<string, Handler>()
  const sent: Array<{ status: number; body: Record<string, unknown> }> = []
  const { registerCoverToolsMcp } = await import('../lib/cover-tools-mcp.js')
  registerCoverToolsMcp({
    webServer: { register: (spec: { path: string; handler: Handler }) => { handlers.set(spec.path, spec.handler); return () => {} } },
    isTrustedRequest: () => true,
    sendJson: (_res: unknown, status: number, body: Record<string, unknown>) => { sent.push({ status, body }) },
    getServerUrl: () => 'http://192.168.111.31:8000',
    loadEngine: (async () => ({
      resolveCoverDir: async () => coverDir,
      renderCover: opts.renderCover ?? (async (input: { fileName?: string; outDir?: string }) => {
        const file = join((input as { outDir?: string }).outDir ?? coverDir, (input as { fileName?: string }).fileName ?? 'preview.png')
        writeFileSync(file, TINY_PNG)
        return { ok: true, file }
      }),
    })) as never,
    resolvePluginDir: () => pluginDir,
  })
  const handler = handlers.get('/tintin/cover/api/tools-mcp')
  expect(handler).toBeTruthy()
  const call = (body: Record<string, unknown>): Promise<RpcOut> => new Promise((resolve) => {
    sent.length = 0
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      resolve({ status: sent[0]?.status ?? res.statusCode, body: sent[0]?.body ?? {}, res })
    }
    const res = { setHeader: () => {}, statusCode: 0, end: () => { finish() } }
    // JSON 响应路径经 sendJson 桩进 sent——5ms 轮询兜底;202 通知路径走 res.end。
    const timer = setInterval(() => { if (sent.length) finish() }, 5)
    const req = Readable.from([JSON.stringify(body)]) as Readable & { method?: string }
    req.method = 'POST'
    void Promise.resolve(handler!(req, res)).catch(() => finish())
    setTimeout(finish, 4000)
  })
  return { coverDir, pluginDir, call, sent }
}

const rpc = (id: number, method: string, params?: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
const resultOf = (out: RpcOut): Record<string, any> => (out.body.result as Record<string, any>) ?? {}

describe('cover tools mcp endpoint', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('initialize 回能力声明 + tools/list 含三工具 + 未知方法 -32601 + 通知 202', async () => {
    const { call } = await setup()
    const init = await call(rpc(1, 'initialize'))
    expect(resultOf(init).serverInfo.name).toBe('cover-tools')
    const list = await call(rpc(2, 'tools/list'))
    const names = resultOf(list).tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['read_image', 'matting', 'render_preview'])
    const bad = await call(rpc(3, 'no/such'))
    expect((bad.body as Record<string, any>).error.code).toBe(-32601)
    const note = await call({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(note.res.statusCode).toBe(202)
  })

  it('read_image: 项目图回 image 块;越界路径拒绝', async () => {
    const { coverDir, call } = await setup()
    writeFileSync(join(coverDir, 'gen.png'), TINY_PNG)
    const ok = await call(rpc(1, 'tools/call', { name: 'read_image', arguments: { path: 'gen.png' } }))
    const content = resultOf(ok).content
    expect(content[0].type).toBe('image')
    expect(content[0].mimeType).toBe('image/png')
    expect(content[1].text).toContain('gen.png')
    const outside = join(tempRoot(), 'outside.png')
    writeFileSync(outside, TINY_PNG)
    const bad = await call(rpc(2, 'tools/call', { name: 'read_image', arguments: { path: outside } }))
    expect(resultOf(bad).isError).toBe(true)
    expect(resultOf(bad).content[0].text).toContain('路径越界')
  })

  it('matting: 首模型失败自动换备选,产物落项目目录+素材位;全败返回错误原文', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, arrayBuffer: async () => Buffer.from(JSON.stringify({ detail: '抠图失败: [ONNXRuntimeError] MatMul' }), 'utf8'), text: async () => '' }))
      .mockImplementationOnce(async () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => TINY_PNG, text: async () => '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { coverDir, pluginDir, call } = await setup()
    writeFileSync(join(coverDir, 'subject.jpg'), TINY_PNG)
    const ok = await call(rpc(1, 'tools/call', { name: 'matting', arguments: { image: 'subject.jpg' } }))
    const text = resultOf(ok).content[0].text
    expect(text).toContain('"model": "u2net"')
    expect(text).toContain('"tried"')
    const outName = readdirSync(coverDir).find((f) => f.startsWith('matting-') && f.includes('u2net'))
    expect(outName).toBeTruthy()
    expect(existsSync(join(coverDir, outName!))).toBe(true)
    expect(existsSync(join(pluginDir, 'public', outName!))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(((fetchMock.mock.calls[0][1] as { body: FormData }).body.get('model'))).toBe('isnet-general-use')
    expect(((fetchMock.mock.calls[1][1] as { body: FormData }).body.get('model'))).toBe('u2net')

    const fetchAllBad = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, arrayBuffer: async () => Buffer.from(JSON.stringify({ detail: '抠图失败: ONNX 崩溃' }), 'utf8'), text: async () => '' }))
    vi.stubGlobal('fetch', fetchAllBad)
    const bad = await call(rpc(2, 'tools/call', { name: 'matting', arguments: { image: 'subject.jpg' } }))
    expect(resultOf(bad).isError).toBe(true)
    const badText = resultOf(bad).content[0].text
    expect(badText).toContain('isnet-general-use→u2net→isnet-anime')
    expect(badText).toContain('ONNX')
  })

  it('render_preview: 读 cover.props.json 渲染并回 image 块(完成判据文案在场);无 props 报错', async () => {
    const seen: Array<Record<string, unknown>> = []
    const { coverDir, call } = await setup({
      renderCover: async (input) => {
        seen.push(input as Record<string, unknown>)
        const file = join(coverDir, (input as { fileName?: string }).fileName ?? 'p.png')
        writeFileSync(file, TINY_PNG)
        return { ok: true, file }
      },
    })
    writeFileSync(join(coverDir, 'cover.props.json'), JSON.stringify({ templateId: 'video', props: { brand: 'x' }, hiddenLayers: ['grid'], origin: 'agent' }))
    const ok = await call(rpc(1, 'tools/call', { name: 'render_preview', arguments: {} }))
    const content = resultOf(ok).content
    expect(content[0].type).toBe('image')
    expect(content[1].text).toContain('完成判据')
    expect((seen[0] as { templateId?: string }).templateId).toBe('video')
    expect(((seen[0] as { props?: Record<string, unknown> }).props ?? {}).hiddenLayers).toEqual(['grid'])
    rmSync(join(coverDir, 'cover.props.json'))
    const missing = await call(rpc(2, 'tools/call', { name: 'render_preview', arguments: {} }))
    expect(resultOf(missing).isError).toBe(true)
    expect(resultOf(missing).content[0].text).toContain('cover.props.json')
  })
})
