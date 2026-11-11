// 封面会话移植批(2026-10-28)回归面:
// 1. 路由注册 TDZ 回归(0dd1bc8b3a 曾因 pcRoute 先用后声明打穿整个 bundle apply)
// 2. cover-asset 三写(源/编辑器预览/导出根)与 cover 目录收纳
// 3. props 记录(编辑器↔agent 对流点)读写形状
// 4. cover-acp-bridge 纯面(令牌/未启动语义/事件序号)
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adoptCoverAsset, coverAssetTargets, ensureCoverAssets, writeCoverAsset } from '../lib/cover-asset.js'
import { readCoverPropsRecord, registerCoverAcpRoutes, writeCoverPropsRecord } from '../lib/cover-acp-routes.js'
import { agentToken, lastEventSeq, prompt, subscribe } from '../lib/cover-acp-bridge.js'

const roots: string[] = []
afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })
const tempRoot = (): string => { const dir = mkdtempSync(join(tmpdir(), 'tintin-cover-')); roots.push(dir); return dir }

describe('cover plugin route registration (TDZ regression)', () => {
  it('registers the full route family without throwing', async () => {
    const { registerCoverPluginRoute } = await import('../lib/cover-plugin-route.js')
    const paths: string[] = []
    const webServer = { register: (spec: { path: string }) => { paths.push(spec.path); return () => {} } }
    const dispose = registerCoverPluginRoute({
      webServer, isTrustedRequest: () => true, sendJson: () => {}, httpRequest: async () => ({}), getServerUrl: () => '',
    })
    expect(paths).toContain('/tintin/cover/editor')
    expect(paths).toContain('/tintin/cover/chat')
    expect(paths).toContain('/tintin/cover/api/fonts')
    expect(paths).toContain('/tintin/cover/api/render')
    expect(paths).toContain('/tintin/ipc/cover')
    expect(paths.filter((p) => p.startsWith('/tintin/cover/api/acp/')).length).toBeGreaterThanOrEqual(20)
    dispose()
  })
})

describe('cover-asset triple write', () => {
  it('writes one asset into all three visible places', () => {
    const pluginDir = tempRoot()
    writeCoverAsset(pluginDir, 'bg-test.png', Buffer.from('hello'))
    for (const target of coverAssetTargets(pluginDir)) {
      expect(existsSync(join(target, 'bg-test.png'))).toBe(true)
      expect(readFileSync(join(target, 'bg-test.png'), 'utf8')).toBe('hello')
    }
  })

  it('rejects invalid asset names loudly', () => {
    const pluginDir = tempRoot()
    expect(() => writeCoverAsset(pluginDir, '../evil.png', Buffer.from('x'))).toThrow(/素材名/)
    expect(() => writeCoverAsset(pluginDir, 'notes.txt', Buffer.from('x'))).toThrow(/素材名/)
    expect(() => writeCoverAsset(pluginDir, 'a/b.png', Buffer.from('x'))).toThrow(/素材名/)
  })

  it('accepts Chinese/space asset names, still rejects traversal (2026-11-02 放宽)', () => {
    const pluginDir = tempRoot()
    writeCoverAsset(pluginDir, '微信图片_20261102113546_96_194.png', Buffer.from('cn'))
    expect(existsSync(join(pluginDir, 'dist', 'editor', '微信图片_20261102113546_96_194.png'))).toBe(true)
    expect(() => writeCoverAsset(pluginDir, '..陷阱.png', Buffer.from('x'))).toThrow(/素材名/)
  })

  it('adopts images produced in the cover working dir', () => {
    const pluginDir = tempRoot()
    const coverDir = tempRoot()
    writeFileSync(join(coverDir, 'agent-bg.png'), Buffer.from('made-by-agent'))
    expect(adoptCoverAsset(pluginDir, coverDir, 'agent-bg.png')).toBe(true)
    expect(existsSync(join(pluginDir, 'dist', 'editor', 'agent-bg.png'))).toBe(true)
    expect(ensureCoverAssets(pluginDir, coverDir, { image: 'agent-bg.png', bgImage: 'missing.png' })).toEqual(['agent-bg.png'])
    expect(adoptCoverAsset(pluginDir, coverDir, 'nope.png')).toBe(false)
  })

  it('adopts custom-layer images too (fresh install only ships bundled assets)', () => {
    const pluginDir = tempRoot()
    const coverDir = tempRoot()
    writeFileSync(join(coverDir, 'prod.png'), Buffer.from('p'))
    writeFileSync(join(coverDir, 'layer-a.png'), Buffer.from('a'))
    const props = { image: 'prod.png', customLayers: [{ id: 'x', image: 'layer-a.png' }, { id: 'y', image: 'missing.png' }, { id: 'z' }, null] }
    expect(ensureCoverAssets(pluginDir, coverDir, props)).toEqual(['prod.png', 'layer-a.png'])
    for (const target of coverAssetTargets(pluginDir)) expect(existsSync(join(target, 'layer-a.png'))).toBe(true)
  })
})

describe('cover props record (editor ↔ agent seam)', () => {
  it('round-trips and reports null for absent/garbled records', () => {
    const coverDir = tempRoot()
    expect(readCoverPropsRecord(coverDir)).toBeNull()
    writeFileSync(join(coverDir, 'cover.props.json'), '{broken')
    expect(readCoverPropsRecord(coverDir)).toBeNull()
    writeCoverPropsRecord(coverDir, { templateId: 'video', props: { title: 'x' }, hiddenLayers: ['brand'] }, 'agent')
    const record = readCoverPropsRecord(coverDir)
    expect(record?.templateId).toBe('video')
    expect(record?.origin).toBe('agent')
    expect(typeof record?.updatedAt).toBe('number')
    expect(record?.props).toEqual({ title: 'x' })
  })
  it('persists layerNames when provided (R7 contract) and omits the key otherwise', () => {
    const coverDir = tempRoot()
    writeCoverPropsRecord(coverDir, { templateId: 'video', props: {}, hiddenLayers: [], layerNames: { title: '主标题·改名', bad: 3 } }, 'editor')
    const withNames = readCoverPropsRecord(coverDir)
    expect(withNames?.layerNames).toEqual({ title: '主标题·改名', bad: 3 }) // 服务端存原样,消毒在消费端
    writeCoverPropsRecord(coverDir, { templateId: 'video', props: {}, hiddenLayers: [] }, 'editor')
    expect(readCoverPropsRecord(coverDir)?.layerNames).toBeUndefined()
  })
})

describe('cover acp bridge surface', () => {
  it('issues a stable session token and refuses prompts before start', async () => {
    expect(agentToken).toMatch(/^[0-9a-f-]{36}$/)
    /* 拒绝语义不变;错误文案可能附带自动重启失败原因(2026-10-30 自动重启语义),前缀匹配 */
    await expect(prompt('hi')).resolves.toMatchObject({ ok: false, error: expect.stringContaining('ACP 会话未启动') })
  })

  it('subscribe/unsubscribe works and the seq base is sane', async () => {
    const bridge = await import('../lib/cover-acp-bridge.js')
    const seen: number[] = []
    const unsubscribe = subscribe((entry: { seq: number }) => { seen.push(entry.seq) })
    unsubscribe()
    /* 未启动会话:无事件流出,序号保持不变(拒绝发生在 emit 之前) */
    await expect(bridge.steer('x')).resolves.toEqual({ ok: false, outcome: 'not-supported' })
    expect(seen).toEqual([])
    expect(lastEventSeq()).toBeGreaterThanOrEqual(0)
  })
})

/* 2026-10-31 用户报障回归:素材导入路径多一层 projects(cover\projects\projects\<项目>)。
   根因=路由按项目制前旧口径 join(coverDir,'..','projects') 拼项目根,而 resolveCoverDir
   恒为 projects/<项目>。写(files/upload)读(files)两边一致错,素材条看不出,只在资源
   管理器露馅——用例把旧错误根也造出来,断言不再命中。 */
describe('cover project asset root (2026-10-31 doubled-projects regression)', () => {
  it('projectsRootOf resolves the parent of projects/<项目>, null for flat dirs', async () => {
    const { projectsRootOf } = await import('../lib/cover-asset.js')
    const root = tempRoot()
    expect(projectsRootOf(join(root, 'cover', 'projects', 'proj-a'))).toBe(join(root, 'cover', 'projects'))
    expect(projectsRootOf(join(root, 'cover-flat'))).toBeNull()
  })

  const mountAcp = (resolveCoverDir: () => Promise<string>) => {
    const handlers = new Map<string, (req: never, res: never) => Promise<void>>()
    const responses: Array<{ status: number; body: { files?: Array<{ path: string }> } }> = []
    const dispose = registerCoverAcpRoutes({
      webServer: {
        register: (spec: { path: string; handler: (req: never, res: never) => Promise<void> }) => {
          handlers.set(spec.path, spec.handler)
          return () => {}
        },
      },
      isTrustedRequest: () => true,
      sendJson: (_res: unknown, status: number, body: { files?: Array<{ path: string }> }) => { responses.push({ status, body }) },
      httpRequest: async () => ({}),
      getServerUrl: () => '',
      resolveCoverDir,
      resolvePluginDir: () => null,
    })
    return { handlers, responses, dispose }
  }

  it('files lists projects/<project>, not a doubled projects/projects root', async () => {
    const root = tempRoot()
    const coverDir = join(root, 'cover', 'projects', 'proj-a')
    mkdirSync(join(root, 'cover', 'projects', 'proj-b'), { recursive: true })
    writeFileSync(join(root, 'cover', 'projects', 'proj-b', 'imported.png'), Buffer.from('x'))
    mkdirSync(join(root, 'cover', 'projects', 'projects', 'proj-b'), { recursive: true })
    writeFileSync(join(root, 'cover', 'projects', 'projects', 'proj-b', 'wrong.png'), Buffer.from('x'))
    const { handlers, responses, dispose } = mountAcp(async () => coverDir)
    const handler = handlers.get('/tintin/cover/api/acp/files')
    expect(handler).toBeDefined()
    await handler?.({ method: 'GET', url: '/tintin/cover/api/acp/files?project=proj-b', headers: {} } as never, {} as never)
    const paths = responses.at(-1)?.body.files?.map((f) => f.path) ?? []
    expect(paths).toContain('imported.png')
    expect(paths).not.toContain('wrong.png')
    dispose()
  })

  /* 字节请求桩:body 走 async 迭代(路由 readBodyBytes 契约) */
  const fireAcpPost = async (
    mount: ReturnType<typeof mountAcp>,
    sub: string,
    { query = '', body = Buffer.from('x'), headers = {} as Record<string, string> }: { query?: string; body?: Buffer; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const handler = mount.handlers.get(`/tintin/cover/api/acp/${sub}`)
    expect(handler).toBeDefined()
    const req = {
      method: 'POST',
      url: `/tintin/cover/api/acp/${sub}${query ? `?${query}` : ''}`,
      headers,
      [Symbol.asyncIterator]: async function* () { yield body },
    }
    await handler?.(req as never, {} as never)
    return (mount.responses.at(-1) ?? { status: 0, body: {} }) as { status: number; body: Record<string, unknown> }
  }

  it('chat-attachment: 中文名收下(对齐 ASSET_NAME_RE);超限 413 人话;穿越名拒绝', async () => {
    const coverDir = tempRoot()
    const mount = mountAcp(async () => coverDir)
    const cn = await fireAcpPost(mount, 'chat-attachment', { query: 'name=微信截图 2026-11-12.png', body: Buffer.from('bytes') })
    expect(cn.status).toBe(200)
    expect(existsSync(join(coverDir, '.cover-chat', 'attachments', '微信截图 2026-11-12.png'))).toBe(true)
    const big = Buffer.alloc(16 * 1024 * 1024, 1)
    const over = await fireAcpPost(mount, 'chat-attachment', { query: 'name=big.png', body: big })
    expect(over.status).toBe(413)
    expect(String(over.body.error)).toContain('15MB')
    const evil = await fireAcpPost(mount, 'chat-attachment', { query: 'name=..%2Fevil.png', body: Buffer.from('x') })
    expect(evil.status).toBe(400)
    mount.dispose()
  })

  it('chat-ref-image: 扩展名跟真实格式(魔数);超限 413', async () => {
    const coverDir = tempRoot()
    const mount = mountAcp(async () => coverDir)
    const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const ok = await fireAcpPost(mount, 'chat-ref-image', { query: 'turnId=t1&n=1', body: TINY_PNG })
    expect(ok.status).toBe(200)
    expect(existsSync(join(coverDir, '.cover-chat', 'attachments', 't1-1.png'))).toBe(true)
    const jpegBody = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
    const ok2 = await fireAcpPost(mount, 'chat-ref-image', { query: 'turnId=t1&n=2', body: jpegBody })
    expect(ok2.status).toBe(200)
    expect(existsSync(join(coverDir, '.cover-chat', 'attachments', 't1-2.jpg'))).toBe(true)
    const over = await fireAcpPost(mount, 'chat-ref-image', { query: 'turnId=t1&n=3', body: Buffer.alloc(9 * 1024 * 1024, 1) })
    expect(over.status).toBe(413)
    mount.dispose()
  })

  /* upload:真实 handler;引擎以包内 stub 顶替(Vite 解析不了 temp 外部路径的运行期动态
     import),stub 读 env 取 coverDir——loadEngine 单例缓存同一 stub 模块无碍。 */
  let stubPluginDir = ''
  beforeAll(() => {
    stubPluginDir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.tmp-engine-stub-'))
    mkdirSync(join(stubPluginDir, 'dist'), { recursive: true })
    writeFileSync(join(stubPluginDir, 'dist', 'engine.mjs'), 'export const resolveCoverDir = async () => process.env.TINTIN_TEST_COVER_DIR\n')
    process.env.TINTIN_COVER_PLUGIN_DIR = stubPluginDir
  })
  afterAll(() => {
    delete process.env.TINTIN_COVER_PLUGIN_DIR
    delete process.env.TINTIN_TEST_COVER_DIR
    rmSync(stubPluginDir, { recursive: true, force: true })
  })

  const fireUpload = async (query: string, coverDir: string): Promise<{ status: number; body?: { error?: string } }> => {
    process.env.TINTIN_TEST_COVER_DIR = coverDir
    const handlers = new Map<string, (req: never, res: never) => Promise<void>>()
    const responses: Array<{ status: number; body?: { error?: string } }> = []
    const { registerCoverPluginRoute } = await import('../lib/cover-plugin-route.js')
    const dispose = registerCoverPluginRoute({
      webServer: {
        register: (spec: { path: string; handler: (req: never, res: never) => Promise<void> }) => {
          handlers.set(spec.path, spec.handler)
          return () => {}
        },
      },
      isTrustedRequest: () => true,
      sendJson: (_res: unknown, status: number, body?: { error?: string }) => { responses.push({ status, body }) },
      httpRequest: async () => ({}),
      getServerUrl: () => '',
    })
    const handler = handlers.get('/tintin/cover/api/upload-image')
    expect(handler).toBeDefined()
    const req = {
      method: 'POST',
      url: `/tintin/cover/api/upload-image?${query}`,
      headers: {},
      on: (ev: string, cb: (c?: Buffer) => void) => {
        if (ev === 'data') cb(Buffer.from('png-bytes'))
        if (ev === 'end') setTimeout(cb as () => void, 0)
      },
    }
    await handler?.(req as never, {} as never)
    for (let i = 0; responses.length === 0 && i < 200; i++) await new Promise((r) => setTimeout(r, 10))
    dispose()
    return responses.at(-1) ?? { status: 0 }
  }

  it('upload-image lands in projects/<project> (single projects level)', async () => {
    const root = tempRoot()
    const coverDir = join(root, 'cover', 'projects', 'proj-a')
    mkdirSync(coverDir, { recursive: true })
    const result = await fireUpload('name=up.png&project=proj-a', coverDir)
    expect(result, JSON.stringify(result)).toMatchObject({ status: 200 })
    expect(existsSync(join(root, 'cover', 'projects', 'proj-a', 'up.png'))).toBe(true)
    expect(existsSync(join(root, 'cover', 'projects', 'projects', 'proj-a', 'up.png'))).toBe(false)
  })

  it('non-projects cover dir (TINTIN_COVER_DIR single-dir form) ignores the project param', async () => {
    const root = tempRoot()
    const coverDir = join(root, 'cover-flat')
    mkdirSync(coverDir, { recursive: true })
    const result = await fireUpload('name=flat.png&project=proj-a', coverDir)
    expect(result, JSON.stringify(result)).toMatchObject({ status: 200 })
    expect(existsSync(join(coverDir, 'flat.png'))).toBe(true)
    expect(existsSync(join(coverDir, 'proj-a'))).toBe(false)
  })
})

/* 2026-10-31 用户报障回归:①「发现」恒 0——httpRequest 成功返回信封 {data,status},
   路由直接读顶层 .skills 恒 undefined(对齐 cover-background 的 .data 解包);②已删技能
   复活——删除只清 cover-skills,历史通用装位 skills/<id> 是 migrateCoverSkillsHome 的
   拷贝源(源永不删),每次启动被原样拷回;修=删除连根清两个装位。 */
describe('cover skills registry unwrap + rooted remove (2026-10-31 regression)', () => {
  const mountPlugin = async (httpRequest: (method: string, path: string) => Promise<unknown>) => {
    const { registerCoverPluginRoute } = await import('../lib/cover-plugin-route.js')
    const handlers = new Map<string, (req: never, res: never) => Promise<void>>()
    const responses: Array<{ status: number; body?: Record<string, unknown> }> = []
    const dispose = registerCoverPluginRoute({
      webServer: {
        register: (spec: { path: string; handler: (req: never, res: never) => Promise<void> }) => {
          handlers.set(spec.path, spec.handler)
          return () => {}
        },
      },
      isTrustedRequest: () => true,
      sendJson: (_res: unknown, status: number, body?: Record<string, unknown>) => { responses.push({ status, body }) },
      httpRequest: httpRequest as never,
      getServerUrl: () => 'http://server.test',
    })
    return { handlers, responses, dispose }
  }
  const fakeBodyReq = (url: string, body: string) => ({
    method: 'POST',
    url,
    headers: {},
    on: (ev: string, cb: (c?: Buffer) => void) => {
      if (ev === 'data') cb(Buffer.from(body))
      if (ev === 'end') setTimeout(cb as () => void, 0)
    },
  })

  it('skills route unwraps the httpRequest envelope, registry reaches the panel', async () => {
    const { handlers, responses, dispose } = await mountPlugin(async () => ({
      data: { skills: [{ id: 'svc-1', name: '服务端技能一', version: '1.0.0', description: 'd' }] },
      status: 200,
    }))
    const handler = handlers.get('/tintin/cover/api/skills')
    expect(handler).toBeDefined()
    await handler?.({ method: 'GET', url: '/tintin/cover/api/skills', headers: {} } as never, {} as never)
    const body = responses.at(-1)?.body as { registry?: Array<{ id: string }> } | undefined
    expect(body?.registry?.map((s) => s.id)).toContain('svc-1')
    dispose()
  })

  it('remove deletes the installed dir AND the legacy migration source (no resurrection)', async () => {
    const home = tempRoot()
    const prevHome = process.env.TINTIN_COVER_AGENT_HOME
    process.env.TINTIN_COVER_AGENT_HOME = home
    try {
      mkdirSync(join(home, 'cover-skills', 'openfilm'), { recursive: true })
      writeFileSync(join(home, 'cover-skills', 'openfilm', 'SKILL.md'), '---\nname: openfilm\n---\nbody')
      mkdirSync(join(home, 'skills', 'openfilm'), { recursive: true })
      writeFileSync(join(home, 'skills', 'openfilm', 'SKILL.md'), 'legacy')
      const { handlers, responses, dispose } = await mountPlugin(async () => ({ data: { skills: [] }, status: 200 }))
      const handler = handlers.get('/tintin/cover/api/skills/remove')
      expect(handler).toBeDefined()
      await handler?.(fakeBodyReq('/tintin/cover/api/skills/remove', '{"id":"openfilm"}') as never, {} as never)
      for (let i = 0; responses.length === 0 && i < 200; i++) await new Promise((r) => setTimeout(r, 10))
      expect(responses.at(-1), JSON.stringify(responses)).toMatchObject({ status: 200 })
      expect(existsSync(join(home, 'cover-skills', 'openfilm'))).toBe(false)
      expect(existsSync(join(home, 'skills', 'openfilm'))).toBe(false)
      dispose()
    } finally {
      if (prevHome === undefined) delete process.env.TINTIN_COVER_AGENT_HOME
      else process.env.TINTIN_COVER_AGENT_HOME = prevHome
    }
  })
})
