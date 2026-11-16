// cover-background 对拍(mock httpRequest/fetch;不触真实服务端与磁盘公共目录用临时注入)
import { describe, expect, it, vi } from 'vitest'
import { generateCoverBackground } from '../lib/cover-background.js'

function deps(overrides = {}) {
  return {
    httpRequest: vi.fn(async () => ({ data: {} })),
    getServerUrl: () => 'https://tintin-server.example',
    resolveDir: () => mkdtempSync(join(tmpdir(), 'cover-bg-deps-')),
    /* 2026-11-15 即梦优先路由:测试固定未登录(探测走真身 CLI 会随环境翻转) */
    jimengReady: async () => false,
    ...overrides,
  }
}

describe('generateCoverBackground(入参防线)', () => {
  it('空 prompt / 超长 → 显式错误(铁律 2)', async () => {
    expect((await generateCoverBackground({ prompt: '  ' }, deps())).error).toContain('prompt')
    expect((await generateCoverBackground({ prompt: 'x'.repeat(2001) }, deps())).error).toContain('prompt')
  })
  it('缺服务端依赖 → 显式错误', async () => {
    const r = await generateCoverBackground({ prompt: '夜色城市' }, { jimengReady: async () => false })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不可用')
  })
  it('插件目录缺失 → 快速失败报错(不触网络)', async () => {
    const r = await generateCoverBackground({ prompt: 'x' }, deps({
      resolveDir: () => null,
      httpRequest: vi.fn(async () => { throw new Error('不应触达服务端') }),
    }))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('封面插件目录不存在')
  })
})

describe('generateCoverBackground(任务轮询语义,openfilm-tools 同口径)', () => {
  it('排队任务轮询到 completed → 下载落盘 → 返回 bg-*.png', async () => {
    // 临时目录承接双写
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'cover-bg-'))
    let calls = 0
    const httpRequest = vi.fn(async (method, path) => {
      if (method === 'POST') return { data: { task_id: 't1', status: 'pending' } }
      calls += 1
      return calls < 2
        ? { data: { status: 'running' } }
        : { data: { status: 'completed', result: { output_url: 'https://tintin-server.example/files/bg.png', engine: 'test-engine' } } }
    })
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateCoverBackground({ prompt: '夜色城市霓虹' }, {
      httpRequest, getServerUrl: () => 'https://s', resolveDir: () => dir, jimengReady: async () => false,
    })
    vi.unstubAllGlobals()
    expect(r.ok).toBe(true)
    expect(r.name).toMatch(/^bg-\d+\.png$/)
    expect(r.engine).toBe('test-engine')
    expect(httpRequest.mock.calls[1]?.[1]).toContain('/tasks/unified/t1')
  })
  it('任务 failed → 服务端错误透出', async () => {
    const httpRequest = vi.fn(async (method) => {
      if (method === 'POST') return { data: { task_id: 't2', status: 'pending' } }
      return { data: { status: 'failed', error: '内容不合规' } }
    })
    const r = await generateCoverBackground({ prompt: 'x' }, { httpRequest, getServerUrl: () => 'https://s', resolveDir: () => 'x', jimengReady: async () => false })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('内容不合规')
  })
})

describe('generateCoverBackground(即梦优先路由,2026-11-15 用户裁决)', () => {
  it('已登录即梦 → 优先即梦 CLI(不触服务端,jimengGenerate 注入桩)', async () => {
    const jimengGenerate = vi.fn(async () => ({ ok: true, name: 'bg-jimeng.png', engine: 'dreamina-text2image', url: '' }))
    const httpRequest = vi.fn(async () => { throw new Error('不应触达服务端') })
    const r = await generateCoverBackground({ prompt: '夜色城市霓虹' }, {
      jimengReady: async () => true,
      jimengGenerate,
      httpRequest,
      getServerUrl: () => 'https://s',
      resolveDir: () => 'x',
    })
    expect(jimengGenerate).toHaveBeenCalledTimes(1)
    expect(jimengGenerate.mock.calls[0]?.[0]).toMatchObject({ command: 'text2image', ratio: '16:9' })
    expect(r.ok).toBe(true)
    expect(httpRequest).not.toHaveBeenCalled()
  })
  it('显式 engine=jimeng 强制即梦(未登录也走即梦,登录缺失在 CLI 报错透出)', async () => {
    const jimengGenerate = vi.fn(async () => ({ ok: false, error: '即梦通道不可用:未登录' }))
    const httpRequest = vi.fn(async () => { throw new Error('不应触达服务端') })
    const r = await generateCoverBackground({ prompt: 'x', engine: 'jimeng' }, {
      jimengReady: async () => false, jimengGenerate, httpRequest, getServerUrl: () => 'https://s', resolveDir: () => 'x',
    })
    expect(jimengGenerate).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(false)
    expect(httpRequest).not.toHaveBeenCalled()
  })
  it('未登录 → 落服务端文生图(jimengReady=false)', async () => {
    const jimengGenerate = vi.fn(async () => { throw new Error('不应走即梦') })
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'cover-bg-route-'))
    const httpRequest = vi.fn(async () => ({ data: { task_id: 't9', status: 'completed', result: { output_url: 'https://s/f.png', engine: 'srv' } } }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer })))
    const out = await generateCoverBackground({ prompt: '夜色城市霓虹' }, {
      jimengReady: async () => false,
      jimengGenerate,
      httpRequest,
      getServerUrl: () => 'https://s',
      resolveDir: () => dir,
    })
    vi.unstubAllGlobals()
    expect(jimengGenerate).not.toHaveBeenCalled()
    expect(out.ok).toBe(true)
  })
})
