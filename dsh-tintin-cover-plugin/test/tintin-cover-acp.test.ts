// 封面会话移植批(2026-10-28)回归面:
// 1. 路由注册 TDZ 回归(0dd1bc8b3a 曾因 pcRoute 先用后声明打穿整个 bundle apply)
// 2. cover-asset 三写(源/编辑器预览/导出根)与 cover 目录收纳
// 3. props 记录(编辑器↔agent 对流点)读写形状
// 4. cover-acp-bridge 纯面(令牌/未启动语义/事件序号)
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { adoptCoverAsset, coverAssetTargets, ensureCoverAssets, writeCoverAsset } from '../lib/cover-asset.js'
import { readCoverPropsRecord, writeCoverPropsRecord } from '../lib/cover-acp-routes.js'
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
