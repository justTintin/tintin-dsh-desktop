// B1 页内化装载冒烟(2026-11-02 方案 B):构建产物 client.js 必须在 loader 契约下
// 完成注册+视图挂载+React 渲染。require 桩=插件自己的 react/react-dom(与宿主
// 同为 React 18 单例语义);fetch 桩喂空数据;Player 相关浏览器 API 打桩。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(join(pluginRoot, 'package.json'))

let dom: JSDOM
let registrations: Array<{ id: string; factory: (require: (id: string) => unknown) => unknown }>
let viewRoot: HTMLElement
const savedGlobals: Array<[string, unknown]> = []

beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:43120/', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window as unknown as Record<string, unknown>
  // node 域的 react-dom 与 jsdom 域一致化:react-dom 内部裸引用 window/document
  // (navigator 在 node22 是只读 getter,react-dom 守卫式引用不触发,不覆盖)
  for (const key of ['window', 'document'] as const) {
    savedGlobals.push([key, (globalThis as Record<string, unknown>)[key]])
    ;(globalThis as Record<string, unknown>)[key] = w[key]
  }
  // jsdom 29 无 fetch/Response:用 node 的 undici Response 兜全部接口(空数据形状)
  w.fetch = (() => Promise.resolve(new Response(JSON.stringify({ ok: true, files: [], record: null, templates: [], projects: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))) as unknown as typeof fetch
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  w.matchMedia = w.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  w.__ModuleLoader__ = { load: (reg: { id: string; factory: (require: (id: string) => unknown) => unknown }) => { registrations.push(reg) } }
  registrations = []
  viewRoot = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(viewRoot)
  dom.window.eval(readFileSync(join(pluginRoot, 'client.js'), 'utf8'))
  await Promise.resolve()
})
// 全局还原刻意不做:React 并发渲染的异步尾巴在测试结束后仍在引用这些全局,
// 提前还原会炸渲染尾(vitest 每测试文件独立 worker,泄漏不出本文件)。

describe('client.js 页内模块装载(B1)', () => {
  it('以 dsh-tintin-cover-plugin 之 id 注册,经 factory(require) 后视图进入 __tintinViews', async () => {
    expect(registrations).toHaveLength(1)
    expect(registrations[0]!.id).toBe('dsh-tintin-cover-plugin')
    const hostRequire = (id: string): unknown => {
      if (id === 'react') return nodeRequire('react')
      if (id === 'react-dom') return nodeRequire('react-dom')
      if (id === 'react-dom/client') return nodeRequire('react-dom/client')
      if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime')
      throw new Error(`unexpected require ${id}`)
    }
    registrations[0]!.factory(hostRequire)
    const views = (dom.window as unknown as { __tintinViews?: { providers: Map<string, unknown> } }).__tintinViews
    expect(views?.providers.has('cover')).toBe(true)
  })

  it('mount 挂载 React 编辑器:三栏骨架+会话 iframe 出现,静态基址就位', async () => {
    const views = (dom.window as unknown as { __tintinViews?: { providers: Map<string, { mount(el: HTMLElement): void }> } }).__tintinViews!
    views.providers.get('cover')!.mount(viewRoot)
    // React 18 并发渲染+被动效果异步排空:轮询等会话 iframe 出现(独立脚本实测 <1s)
    const waitUntil = async (pred: () => boolean, ms: number): Promise<boolean> => {
      const t0 = Date.now()
      for (;;) {
        if (pred()) return true
        if (Date.now() - t0 > ms) return false
        await new Promise((ok) => setTimeout(ok, 100))
      }
    }
    const chatReady = await waitUntil(() => viewRoot.querySelector('iframe[src="/tintin/cover/chat"]') !== null, 4000)
    expect(chatReady).toBe(true)
    const host = viewRoot.querySelector('div[style*="100vh"]')
    expect(host).not.toBeNull()
    expect(host!.children.length).toBeGreaterThan(0)
    // 三栏中的素材/图层骨架(真实文本断言,防"挂了个空壳")
    const text = viewRoot.textContent ?? ''
    expect(text).toContain('图层')
    expect(text).toContain('素材')
    // 会话 iframe(B1 阶段暂留)与静态基址
    expect(viewRoot.querySelector('iframe[src="/tintin/cover/chat"]')).not.toBeNull()
    expect((dom.window as unknown as { remotion_staticBase: string }).remotion_staticBase).toBe('/tintin/cover/editor')
    // 图层点选豁免样式已注入
    expect(dom.window.document.querySelector('style[data-plugin="dsh-tintin-cover-plugin"]')).not.toBeNull()
  })
})
