// cover-tools-mcp 用例(2026-11-04 感知闭环+工具收敛批):MCP 端点协议面 + 六工具行为。
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
    /* 轮询间隔注入口(测试 5ms;生产缺省 3s) */
    pollIntervalMs: 5,
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
    expect(names).toEqual(['read_image', 'matting', 'render_preview', 'imitate_cover', 'imitate_cover_wait', 'ocr_image', 'text_remove'])
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

  it('imitate_cover(提交步): 上传→接单→立即回 task_id 不等待;无文案拒绝;编排失败错误原文上返', async () => {
    const jsonRes = (obj: unknown, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => obj, arrayBuffer: async () => Buffer.from('x'), text: async () => '' })
    const fetchMock = vi.fn()
      // product-upload
      .mockImplementationOnce(async () => jsonRes({ paths: ['/srv/uploads/ref.png'], count: 1 }))
      // /generate/cover 202
      .mockImplementationOnce(async () => jsonRes({ task_id: 'c_test-1', poll: '/tasks/unified/c_test-1' }, 202))
    vi.stubGlobal('fetch', fetchMock)
    const { coverDir, call } = await setup()
    writeFileSync(join(coverDir, 'ref-cover.png'), TINY_PNG)
    const ok = await call(rpc(1, 'tools/call', { name: 'imitate_cover', arguments: { images: ['ref-cover.png'], title: '探针标题', prompt: 'test' } }))
    const payload = JSON.parse(resultOf(ok).content[0].text)
    expect(payload.ok).toBe(true)
    expect(payload.taskId).toBe('c_test-1')
    expect(payload.phase).toBe('submitted')
    expect(payload.note).toContain('imitate_cover_wait')
    // 提交步只打上传+接单两次,不轮询不下载
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const upCall = fetchMock.mock.calls[0] as [string, { body: FormData }]
    expect(upCall[0]).toContain('/api/storyboard/scripts/product-upload')
    expect(upCall[1].body.get('files')).toBeTruthy()
    const genCall = fetchMock.mock.calls[1] as [string, { body: string }]
    expect(genCall[0]).toContain('/generate/cover')
    const genBody = JSON.parse(genCall[1].body)
    expect(genBody.images).toEqual(['/srv/uploads/ref.png'])
    expect(genBody.title).toBe('探针标题')

    // 无文案 → 本地校验拒绝, 不打服务端
    const noText = await call(rpc(2, 'tools/call', { name: 'imitate_cover', arguments: { images: ['ref-cover.png'] } }))
    expect(resultOf(noText).isError).toBe(true)
    expect(resultOf(noText).content[0].text).toContain('文案至少其一')

    // 编排失败 → 错误原文上返
    const failMock = vi.fn()
      .mockImplementationOnce(async () => jsonRes({ paths: ['/srv/uploads/ref.png'], count: 1 }))
      .mockImplementationOnce(async () => ({ ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ detail: 'engine overloaded' }), arrayBuffer: async () => Buffer.from('x'), text: async () => JSON.stringify({ detail: 'engine overloaded' }) }))
    vi.stubGlobal('fetch', failMock)
    const bad = await call(rpc(3, 'tools/call', { name: 'imitate_cover', arguments: { images: ['ref-cover.png'], title: 'x' } }))
    expect(resultOf(bad).isError).toBe(true)
    expect(resultOf(bad).content[0].text).toContain('接单失败 HTTP 500')
  })

  it('imitate_cover_wait: 未终态 settled:false 可续等;completed 下载产物双写+回显;failed 错误原文;cancel 走 batch_cancel', async () => {
    const jsonRes = (obj: unknown, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => obj, arrayBuffer: async () => Buffer.from('x'), text: async () => '' })
    const { coverDir, pluginDir, call } = await setup()

    // ① running 未终态 + 1s 到点 → settled:false(任务不丢,可续等)
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ id: 'c_test-1', status: 'running', progress: 40 })))
    const running = await call(rpc(1, 'tools/call', { name: 'imitate_cover_wait', arguments: { task_id: 'c_test-1', timeout_s: 1 } }))
    const runningPayload = JSON.parse(resultOf(running).content[0].text)
    expect(runningPayload.ok).toBe(true)
    expect(runningPayload.settled).toBe(false)
    expect(runningPayload.status).toBe('running')
    expect(runningPayload.progress).toBe(40)
    expect(runningPayload.note).toContain('续等')

    // ② 续等 → completed → 下载产物双写+note
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async () => jsonRes({ id: 'c_test-1', status: 'completed', progress: 100, result: { output_url: '/output/generate/c_test-1.png', width: 704, height: 1248, engine: 'comfygen' } }))
      .mockImplementationOnce(async () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, json: async () => ({}), arrayBuffer: async () => TINY_PNG, text: async () => '' })))
    const ok = await call(rpc(2, 'tools/call', { name: 'imitate_cover_wait', arguments: { task_id: 'c_test-1' } }))
    const payload = JSON.parse(resultOf(ok).content[0].text)
    expect(payload.ok).toBe(true)
    expect(payload.name).toMatch(/^imitate-\d+\.png$/)
    expect(payload.taskId).toBe('c_test-1')
    expect(payload.note).toContain('无分层')
    expect(existsSync(join(coverDir, payload.name))).toBe(true)
    expect(existsSync(join(pluginDir, 'public', payload.name))).toBe(true)

    // ③ failed → 错误原文上返
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ id: 'c_test-3', status: 'failed', error: '封面生成失败: status=partial_failed failed_shots=[cover]' })))
    const bad = await call(rpc(3, 'tools/call', { name: 'imitate_cover_wait', arguments: { task_id: 'c_test-3' } }))
    expect(resultOf(bad).isError).toBe(true)
    expect(resultOf(bad).content[0].text).toContain('partial_failed')

    // ④ cancel:true → POST /tasks/batch_cancel {task_ids}
    const cancelMock = vi.fn().mockImplementationOnce(async () => jsonRes({ cancelled: 1, total: 1 }))
    vi.stubGlobal('fetch', cancelMock)
    const cancelled = await call(rpc(4, 'tools/call', { name: 'imitate_cover_wait', arguments: { task_id: 'c_test-1', cancel: true } }))
    const cancelPayload = JSON.parse(resultOf(cancelled).content[0].text)
    expect(cancelPayload.cancelled).toBe(true)
    expect(cancelPayload.cancelledCount).toBe(1)
    const cancelCall = cancelMock.mock.calls[0] as [string, { body: string }]
    expect(cancelCall[0]).toContain('/tasks/batch_cancel')
    expect(JSON.parse(cancelCall[1].body)).toEqual({ task_ids: ['c_test-1'] })

    // ⑤ 非法 task_id 本地拒绝
    const badId = await call(rpc(5, 'tools/call', { name: 'imitate_cover_wait', arguments: { task_id: '' } }))
    expect(resultOf(badId).isError).toBe(true)
    expect(resultOf(badId).content[0].text).toContain('task_id')
  })

  it('imitate_cover 人物档: subject=person+style_image/style_weight 提交透传;wait 落盘回显 face_similarity;本地拒绝不变', async () => {
    const jsonRes = (obj: unknown, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => obj, arrayBuffer: async () => Buffer.from('x'), text: async () => '' })
    const fetchMock = vi.fn()
      // product-upload(人物图+风格图同批)
      .mockImplementationOnce(async () => jsonRes({ paths: ['/srv/uploads/person.png', '/srv/uploads/style.png'], count: 2 }))
      // /generate/cover 202
      .mockImplementationOnce(async () => jsonRes({ task_id: 'c_person-1', poll: '/tasks/unified/c_person-1' }, 202))
      // wait poll → completed(person 档回显)
      .mockImplementationOnce(async () => jsonRes({ id: 'c_person-1', status: 'completed', progress: 100, result: { output_url: '/output/generate/c_person-1.png', width: 704, height: 1248, engine: 'comfygen', subject: 'person', style_mode: 'style_ref', refs_used: ['style_ref.png'], face_similarity: { score: 0.723, threshold: 0.65, pass: true }, face_similarity_mode: 'arcface' } }))
      // 产物下载
      .mockImplementationOnce(async () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, json: async () => ({}), arrayBuffer: async () => TINY_PNG, text: async () => '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { coverDir, call } = await setup()
    writeFileSync(join(coverDir, 'person.png'), TINY_PNG)
    writeFileSync(join(coverDir, 'ref-cover.png'), TINY_PNG)
    const submit = await call(rpc(1, 'tools/call', { name: 'imitate_cover', arguments: { images: ['person.png'], subject: 'person', style_image: 'ref-cover.png', style_weight: 0.6, title: '人物档', prompt: '动作与场景描述' } }))
    const submitted = JSON.parse(resultOf(submit).content[0].text)
    expect(submitted.taskId).toBe('c_person-1')
    const ok = await call(rpc(2, 'tools/call', { name: 'imitate_cover_wait', arguments: { task_id: submitted.taskId, subject: 'person' } }))
    const payload = JSON.parse(resultOf(ok).content[0].text)
    expect(payload.ok).toBe(true)
    expect(payload.subject).toBe('person')
    expect(payload.styleMode).toBe('style_ref')
    expect(payload.note).toContain('人脸相似度门')
    // 验收回显(2026-11-11 API 文档契约):person 模式 result 另附 face_similarity+face_similarity_mode
    expect(payload.face_similarity).toEqual({ score: 0.723, threshold: 0.65, pass: true })
    expect(payload.face_similarity_mode).toBe('arcface')
    expect(payload.note).toContain('0.723')
    // 人物档生成载荷契约:subject/style_image/style_weight 透传,images 恰 1 张
    const genCall = fetchMock.mock.calls[1] as [string, { body: string }]
    expect(genCall[0]).toContain('/generate/cover')
    const genBody = JSON.parse(genCall[1].body)
    expect(genBody.subject).toBe('person')
    expect(genBody.images).toEqual(['/srv/uploads/person.png'])
    expect(genBody.style_image).toBe('/srv/uploads/style.png')
    expect(genBody.style_weight).toBe(0.6)

    // 人物档多图 → 本地拒绝, 不打服务端(上传 4 次调用后不再新增)
    const multi = await call(rpc(3, 'tools/call', { name: 'imitate_cover', arguments: { images: ['person.png', 'person.png'], subject: 'person', title: 'x' } }))
    expect(resultOf(multi).isError).toBe(true)
    expect(resultOf(multi).content[0].text).toContain('恰 1 张人物正脸图')
    // style_weight 缺 style_image → 本地拒绝
    const weightOnly = await call(rpc(4, 'tools/call', { name: 'imitate_cover', arguments: { images: ['person.png'], style_weight: 0.6, title: 'x' } }))
    expect(resultOf(weightOnly).isError).toBe(true)
    expect(resultOf(weightOnly).content[0].text).toContain('style_weight 需与 style_image 同传')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('imitate_cover_wait: face_similarity 兜底链(result 顶层缺→shots_done[0])+pass=false 警示+subject_type 回退', async () => {
    const jsonRes = (obj: unknown, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => obj, arrayBuffer: async () => Buffer.from('x'), text: async () => '' })
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async () => jsonRes({ id: 'c_person-2', status: 'completed', progress: 100, result: { output_url: '/output/generate/c_person-2.png', width: 704, height: 1248, engine: 'comfygen', subject_type: 'person', shots_done: [{ name: 'cover', face_similarity: { score: 0.52, threshold: 0.65, pass: false } }] } }))
      .mockImplementationOnce(async () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, json: async () => ({}), arrayBuffer: async () => TINY_PNG, text: async () => '' })))
    const { coverDir, call } = await setup()
    writeFileSync(join(coverDir, 'person.png'), TINY_PNG)
    const ok = await call(rpc(1, 'tools/call', { name: 'imitate_cover_wait', arguments: { task_id: 'c_person-2', subject: 'person' } }))
    const payload = JSON.parse(resultOf(ok).content[0].text)
    expect(payload.ok).toBe(true)
    expect(payload.subject).toBe('person')
    expect(payload.face_similarity).toEqual({ score: 0.52, threshold: 0.65, pass: false })
    expect(payload.note).toContain('人脸相似度门分值未过')
  })

  it('ocr_image: 返回逐行文本+位置框;服务端错误原文上返', async () => {
    const { coverDir, call } = await setup()
    writeFileSync(join(coverDir, 'poster.png'), TINY_PNG)
    const ocrPayload = { filename: 'poster.png', text: 'Hello Cover 2026\nSecond Line Text', total: 2, lines: [
      { text: 'Hello Cover 2026', confidence: 0.9941, box: [98, 97, 180, 113], box_rel: [0.0766, 0.1347, 0.1406, 0.1569] },
      { text: 'Second Line Text', confidence: 0.9999, box: [100, 401, 182, 411], box_rel: [0.0781, 0.5569, 0.1422, 0.5708] },
    ] }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ocrPayload, arrayBuffer: async () => Buffer.from('x'), text: async () => '' })))
    const ok = await call(rpc(1, 'tools/call', { name: 'ocr_image', arguments: { image: 'poster.png' } }))
    const payload = JSON.parse(resultOf(ok).content[0].text)
    expect(payload.ok).toBe(true)
    expect(payload.total).toBe(2)
    expect(payload.lines[0].box_rel).toEqual([0.0766, 0.1347, 0.1406, 0.1569])
    expect(payload.note).toContain('box_rel')

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ detail: 'OCR engine down' }), arrayBuffer: async () => Buffer.from('x'), text: async () => JSON.stringify({ detail: 'OCR engine down' }) })))
    const bad = await call(rpc(2, 'tools/call', { name: 'ocr_image', arguments: { image: 'poster.png' } }))
    expect(resultOf(bad).isError).toBe(true)
    expect(resultOf(bad).content[0].text).toContain('OCR engine down')
  })

  it('text_remove: 无 boxes 自动 OCR 全框→去字→双写;显式框直通;OCR 空行=无需去字;服务端错误原文上返', async () => {
    const jsonRes = (obj: unknown, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => obj, arrayBuffer: async () => Buffer.from('x'), text: async () => '' })
    const pngRes = () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, json: async () => ({}), arrayBuffer: async () => TINY_PNG, text: async () => '' })
    const { coverDir, pluginDir, call } = await setup()
    writeFileSync(join(coverDir, 'poster.png'), TINY_PNG)

    // 自动 OCR 分支: ocr 返回两行 → text-remove 用其 box → PNG 落盘
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => jsonRes({ filename: 'poster.png', text: 'A B', total: 2, lines: [
        { text: 'A', confidence: 0.99, box: [10, 20, 110, 40], box_rel: [0.01, 0.02, 0.11, 0.04] },
        { text: 'B', confidence: 0.98, box: [10, 60, 90, 80], box_rel: [0.01, 0.06, 0.09, 0.08] },
      ] }))
      .mockImplementationOnce(async () => pngRes())
    vi.stubGlobal('fetch', fetchMock)
    const ok = await call(rpc(1, 'tools/call', { name: 'text_remove', arguments: { image: 'poster.png' } }))
    const payload = JSON.parse(resultOf(ok).content[0].text)
    expect(payload.ok).toBe(true)
    expect(payload.autoOcr).toBe(true)
    expect(payload.name).toMatch(/^text-remove-poster-\d+\.png$/)
    expect(existsSync(join(coverDir, payload.name))).toBe(true)
    expect(existsSync(join(pluginDir, 'public', payload.name))).toBe(true)
    const trUrl = (fetchMock.mock.calls[1]![0] as string)
    expect(trUrl).toContain('/image/text-remove')
    const trBody = (fetchMock.mock.calls[1]![1] as { body: FormData }).body
    expect(trBody.get('boxes')).toBe('[[10,20,110,40],[10,60,90,80]]')
    expect(trBody.get('file')).toBeTruthy()

    // 显式框直通(不调 OCR)
    const direct = vi.fn().mockImplementationOnce(async () => pngRes())
    vi.stubGlobal('fetch', direct)
    const ok2 = await call(rpc(2, 'tools/call', { name: 'text_remove', arguments: { image: 'poster.png', boxes: '[[1,2,3,4]]' } }))
    expect(JSON.parse(resultOf(ok2).content[0].text).autoOcr).toBe(false)
    expect(direct).toHaveBeenCalledTimes(1)

    // OCR 空行 → 无需去字,不调 text-remove
    const emptyOcr = vi.fn().mockImplementationOnce(async () => jsonRes({ filename: 'poster.png', text: '', total: 0, lines: [] }))
    vi.stubGlobal('fetch', emptyOcr)
    const ok3 = await call(rpc(3, 'tools/call', { name: 'text_remove', arguments: { image: 'poster.png' } }))
    const p3 = JSON.parse(resultOf(ok3).content[0].text)
    expect(p3.removed).toBe(0)
    expect(emptyOcr).toHaveBeenCalledTimes(1)

    // 服务端错误原文上返
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ detail: 'lama down' }), arrayBuffer: async () => Buffer.from('x'), text: async () => JSON.stringify({ detail: 'lama down' }) })))
    const bad = await call(rpc(4, 'tools/call', { name: 'text_remove', arguments: { image: 'poster.png', boxes: '[[1,2,3,4]]' } }))
    expect(resultOf(bad).isError).toBe(true)
    expect(resultOf(bad).content[0].text).toContain('lama down')
  })

  it('独立监听: 无 token 401;带 token 全链(tools/list);export 语义=render_preview 落项目目录', async () => {
    const coverDir = tempRoot()
    const { startCoverToolsServer } = await import('../lib/cover-tools-mcp.js')
    const server = await startCoverToolsServer({
      getServerUrl: () => 'http://192.168.111.31:8000',
      loadEngine: (async () => ({ resolveCoverDir: async () => coverDir })) as never,
      resolvePluginDir: () => tempRoot(),
    })
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
      const noToken = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpc(1, 'initialize')) })
      expect(noToken.status).toBe(401)
      const h = { 'Content-Type': 'application/json', 'x-tintin-cover-tools-token': server.token }
      const init = await fetch(server.url, { method: 'POST', headers: h, body: JSON.stringify(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })) })
      expect(init.status).toBe(200)
      const sid = init.headers.get('mcp-session-id')
      expect(sid).toBeTruthy()
      await fetch(server.url, { method: 'POST', headers: { ...h, 'mcp-session-id': sid! }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
      const list = await fetch(server.url, { method: 'POST', headers: { ...h, 'mcp-session-id': sid! }, body: JSON.stringify(rpc(2, 'tools/list')) })
      const names = ((await list.json()) as { result?: { tools?: Array<{ name: string }> } }).result?.tools?.map((t) => t.name)
      expect(names).toEqual(['read_image', 'matting', 'render_preview', 'imitate_cover', 'imitate_cover_wait', 'ocr_image', 'text_remove'])
    } finally {
      await server.dispose()
    }
  })
})
