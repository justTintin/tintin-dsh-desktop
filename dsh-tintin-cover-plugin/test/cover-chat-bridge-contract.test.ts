// 桥契约结构门禁(2026-11-09 方案 3 运行期保险):共享 app-bridge.ts 的 AppBridge
// 接口每加一个必选成员,封面桥(cover-chat-bridge.ts)必须同步实现——0.3.0 升级漏
// starterSkills,新项目空会话挂 ProjectStarters 同步抛错 → React 整树白屏(当日
// 11:41 实证)。桥对象虽已加类型标注,但 chat-shell 不在 tsc include(vendored 树的
// 裸导入靠 vite 插件解析,tsc 无法跟进),故用例直接对「接口源码 ⇄ 桥对象」做结构
// 比对:上游契约一变,这里先红。
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sharedAppBridge = join(pluginRoot, '..', 'dsh-plugin-desktop-tintin', 'tintin-resources', 'openfilm-shell-src', 'chat', 'app-bridge.ts')

interface ContractMember {
  name: string
  required: boolean
  kind: 'function' | 'object'
}

/** 从接口源码块提取顶层成员(嵌套的 chat/skills 子成员不在断言域)。 */
function parseAppBridgeMembers(): ContractMember[] {
  const source = readFileSync(sharedAppBridge, 'utf8')
  const start = source.indexOf('interface AppBridge {')
  expect(start, 'app-bridge.ts 里必须存在 interface AppBridge').toBeGreaterThanOrEqual(0)
  const end = source.indexOf('\n}', start)
  const block = source.slice(start, end)
  const members: ContractMember[] = []
  for (const line of block.split('\n')) {
    const m = /^  ([A-Za-z_]\w*)(\?)?\s*([(:])(.*)$/u.exec(line)
    if (!m) continue
    /* 成员名后第一个标点定形状:'('=方法;':'后紧跟'{'=对象成员(chat/skills/asks/developer)。
       不能用整行 includes(': {')——方法参数的内联对象签名(如 onStudioBrowser 的
       listener: (state: {…}) 会误判成对象成员。 */
    const kind = m[3] === ':' && /^\s*\{/u.test(m[4] ?? '') ? 'object' : 'function'
    members.push({ name: m[1]!, required: !m[2], kind })
  }
  expect(members.length, 'AppBridge 成员解析数异常(源码结构变了?更新解析器)').toBeGreaterThan(20)
  return members
}

describe('封面桥 ⇄ 共享 AppBridge 契约(结构门禁)', () => {
  let bridge: Record<string, unknown>

  beforeAll(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:43120/', pretendToBeVisual: true })
    const w = dom.window as unknown as Record<string, unknown>
    const saved: Array<[string, unknown]> = []
    for (const key of ['window', 'document', 'navigator'] as const) {
      saved.push([key, (globalThis as Record<string, unknown>)[key]])
      try {
        Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true })
      } catch { /* node 只读 getter:保留原值,导入期不用到的成员无碍 */ }
    }
    w.fetch = (() => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))) as unknown as typeof fetch
    try {
      await import('../chat-shell/cover-chat-bridge')
      bridge = (w.openfilmDesktop ?? (globalThis as Record<string, unknown>).openfilmDesktop) as Record<string, unknown>
    } finally {
      for (const [key, value] of saved) {
        try { Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }) } catch { /* 同上 */ }
      }
    }
    expect(bridge, '桥对象必须挂上 window.openfilmDesktop').toBeTruthy()
  })

  it('AppBridge 每个必选成员都在封面桥上(缺=升级漏配,先红于此)', () => {
    const missing: string[] = []
    const wrongKind: string[] = []
    for (const member of parseAppBridgeMembers()) {
      if (!member.required) continue
      const value = bridge[member.name]
      if (value === undefined) { missing.push(member.name); continue }
      const actual = typeof value
      const wanted = member.kind === 'function' ? 'function' : 'object'
      if (actual !== wanted) wrongKind.push(`${member.name}(要 ${wanted} 得 ${actual})`)
    }
    expect(missing, `封面桥缺必选契约成员:${missing.join(', ')}——对照 openfilm-shell/bridge.ts 同名成员补齐`).toEqual([])
    expect(wrongKind, `封面桥成员形状不符:${wrongKind.join(', ')}`).toEqual([])
  })

  it('事故回归:starterSkills 必须是函数(2026-11-09 白屏根因)', () => {
    expect(typeof bridge['starterSkills']).toBe('function')
  })

  it('已入库的会话页载荷必须含 starterSkills 调用链(防旧载荷带病上机)', () => {
    const distAssets = join(pluginRoot, '..', 'dsh-plugin-desktop-tintin', 'tintin-resources', 'cover-plugin', 'chat-shell', 'dist', 'assets')
    const bundles = readdirSync(distAssets).filter((f) => /^cover-chat-[\w-]+\.js$/u.test(f))
    expect(bundles.length, 'chat-shell staging 载荷缺失(先跑 scripts/stage.mjs)').toBeGreaterThan(0)
    const payload = readFileSync(join(distAssets, bundles[0]!), 'utf8')
    expect(payload.includes('starterSkills'), 'staging 载荷没有 starterSkills——构建产物过期,重建 chat-shell 并 stage').toBe(true)
  })
})
