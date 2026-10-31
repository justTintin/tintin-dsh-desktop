// 封面会话移植批(2026-10-28)回归面:
// 1. 路由注册 TDZ 回归(0dd1bc8b3a 曾因 pcRoute 先用后声明打穿整个 bundle apply)
// 2. cover-asset 三写(源/编辑器预览/导出根)与 cover 目录收纳
// 3. props 记录(编辑器↔agent 对流点)读写形状
// 4. cover-acp-bridge 纯面(令牌/未启动语义/事件序号)
import { mkdtempSync, rmSync, mkdirSync, realpathSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
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
    expect(paths).toContain('/tintin/cover/api/render')
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

  it('upload-image lands in projects/<project> (single projects level)', async () => {
    const root = realpathSync(tempRoot())
    const pluginDir = realpathSync(tempRoot())
    const coverDir = join(root, 'cover', 'projects', 'proj-a')
    mkdirSync(coverDir, { recursive: true })
    mkdirSync(join(pluginDir, 'dist'), { recursive: true })
    writeFileSync(join(pluginDir, 'dist', 'engine.mjs'), `export const resolveCoverDir = async () => ${JSON.stringify(coverDir)}\n`)
    const handlers = new Map<string, (req: never, res: never) => Promise<void>>()
    const responses: Array<{ status: number; body?: { error?: string } }> = []
    /* realpath:Vite 加载器对 temp 8.3 短名(ADMINI~1)的 file URL 解析失败;
       resetModules:loadCoverEngine 模块级单例缓存首个 stub,跨用例会串目录 */
    vi.resetModules()
    const { registerCoverPluginRoute } = await import('../lib/cover-plugin-route.js')
    const prevPluginEnv = process.env.TINTIN_COVER_PLUGIN_DIR
    process.env.TINTIN_COVER_PLUGIN_DIR = pluginDir
    try {
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
        url: '/tintin/cover/api/upload-image?name=up.png&project=proj-a',
        headers: {},
        on: (ev: string, cb: (c?: Buffer) => void) => {
          if (ev === 'data') cb(Buffer.from('png-bytes'))
          if (ev === 'end') setTimeout(cb as () => void, 0)
        },
      }
      await handler?.(req as never, {} as never)
      for (let i = 0; responses.length === 0 && i < 200; i++) await new Promise((r) => setTimeout(r, 10))
      expect(responses.at(-1), JSON.stringify(responses)).toMatchObject({ status: 200 })
      expect(existsSync(join(root, 'cover', 'projects', 'proj-a', 'up.png'))).toBe(true)
      expect(existsSync(join(root, 'cover', 'projects', 'projects', 'proj-a', 'up.png'))).toBe(false)
      dispose()
    } finally {
      if (prevPluginEnv === undefined) delete process.env.TINTIN_COVER_PLUGIN_DIR
      else process.env.TINTIN_COVER_PLUGIN_DIR = prevPluginEnv
    }
  })

  it('non-projects cover dir (TINTIN_COVER_DIR single-dir form) ignores the project param', async () => {
    const root = realpathSync(tempRoot())
    const pluginDir = realpathSync(tempRoot())
    const coverDir = join(root, 'cover-flat')
    mkdirSync(coverDir, { recursive: true })
    mkdirSync(join(pluginDir, 'dist'), { recursive: true })
    writeFileSync(join(pluginDir, 'dist', 'engine.mjs'), `export const resolveCoverDir = async () => ${JSON.stringify(coverDir)}\n`)
    const handlers = new Map<string, (req: never, res: never) => Promise<void>>()
    const responses: Array<{ status: number; body?: { error?: string } }> = []
    vi.resetModules()
    const { registerCoverPluginRoute } = await import('../lib/cover-plugin-route.js')
    const prevPluginEnv = process.env.TINTIN_COVER_PLUGIN_DIR
    process.env.TINTIN_COVER_PLUGIN_DIR = pluginDir
    try {
      const dispose = registerCoverPluginRoute({
        webServer: {
          register: (spec: { path: string; handler: (req: never, res: never) => Promise<void> }) => {
            handlers.set(spec.path, spec.handler)
            return () => {}
          },
        },
        isTrustedRequest: () => true,
        sendJson: (_res: unknown, status: number) => { responses.push({ status }) },
        httpRequest: async () => ({}),
        getServerUrl: () => '',
      })
      const handler = handlers.get('/tintin/cover/api/upload-image')
      const req = {
        method: 'POST',
        url: '/tintin/cover/api/upload-image?name=flat.png&project=proj-a',
        headers: {},
        on: (ev: string, cb: (c?: Buffer) => void) => {
          if (ev === 'data') cb(Buffer.from('x'))
          if (ev === 'end') setTimeout(cb as () => void, 0)
        },
      }
      await handler?.(req as never, {} as never)
      for (let i = 0; responses.length === 0 && i < 200; i++) await new Promise((r) => setTimeout(r, 10))
      expect(responses.at(-1)?.status).toBe(200)
      expect(existsSync(join(coverDir, 'flat.png'))).toBe(true)
      expect(existsSync(join(coverDir, 'proj-a'))).toBe(false)
      dispose()
    } finally {
      if (prevPluginEnv === undefined) delete process.env.TINTIN_COVER_PLUGIN_DIR
      else process.env.TINTIN_COVER_PLUGIN_DIR = prevPluginEnv
    }
  })
})
