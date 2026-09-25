// test/tintin-browser-loopback.test.ts — 回环门面回归（批次⑥）
// loopback-service：token 鉴权（401）/未知路由（404）/open+extract 分发/握手文件。
// 用真实 http 服务器（127.0.0.1:0）+ 假 handlers，host 侧 helper（读握手文件 + 调用）一并验到。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startLoopbackService, routeLoopback } from '../src/main/tintin/browser/loopback-service'
import { loopbackCall, readLoopbackConfig, summarizeExtract } from '../packages/tintin-bundle/lib/loopback-helpers.js'

const tmpDirs: string[] = []
const services: Array<{ close: () => Promise<void> }> = []
afterEach(async () => {
  for (const s of services.splice(0)) await s.close()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const handlers = {
  open: async (platform: string) => ({ ok: true, opened: platform }),
  extract: async (platform: string) => ({ ok: true, data: { title: 'T', items: [1, 2, 3] } }),
  loginStatus: async () => ({ counts: { douyin: 7 }, cookiesDir: 'D:/x' }),
  exportCookies: async () => ({ douyin: 7 }),
  captureHotspots: async (): Promise<[boolean, number | string]> => [true, 42],
}

describe('loopback service (shell facade)', () => {
  it('writes the handshake file and serves token-authed routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-lb-'))
    tmpDirs.push(dir)
    const svc = await startLoopbackService({ handlers, handshakeDir: dir })
    services.push(svc)

    // 握手文件（铁律 2：验到磁盘）
    const hs = JSON.parse(readFileSync(svc.handshakePath, 'utf8'))
    expect(hs.port).toBe(svc.port)
    expect(hs.token).toBe(svc.token)

    // token 正确 → 分发
    const ok = await loopbackCallAt(svc.port, svc.token, '/tintin-browser/open', { platform: 'douyin' })
    expect(ok).toEqual({ ok: true, opened: 'douyin' })
    // 错 token → 401
    const bad = await rawGet(svc.port, 'wrong-token')
    expect(bad.status).toBe(401)
    // 未知路由 → 404
    const nf = await loopbackCallAt(svc.port, svc.token, '/tintin-browser/nope', {})
    expect(nf).toMatchObject({ ok: false, error: { type: 'NOT_FOUND' } })
  })

  it('exposes login status / cookies export / hotspot capture through the same facade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-lb2-'))
    tmpDirs.push(dir)
    const svc = await startLoopbackService({ handlers, handshakeDir: dir })
    services.push(svc)
    expect(await loopbackCallAt(svc.port, svc.token, '/tintin-browser/login/status', {}))
      .toEqual({ counts: { douyin: 7 }, cookiesDir: 'D:/x' })
    expect(await loopbackCallAt(svc.port, svc.token, '/tintin-browser/cookies/export', {}))
      .toEqual({ douyin: 7 })
    expect(await loopbackCallAt(svc.port, svc.token, '/tintin-browser/hotspot/capture', {}))
      .toEqual([true, 42])
  })

  it('routeLoopback returns 404 shape synchronously for unknown paths', () => {
    expect(routeLoopback(handlers, '/nope', {})).toMatchObject({ status: 404 })
  })
})

describe('host-side helpers (tintin-bundle lib/loopback-helpers.js)', () => {
  it('readLoopbackConfig returns null without DSH_HOME/handshake; loopbackCall degrades to NO_SERVICE', async () => {
    const savedHome = process.env.DSH_HOME
    delete process.env.DSH_HOME
    expect(readLoopbackConfig()).toBeNull()
    const res = await loopbackCall('/tintin-browser/open', { platform: 'douyin' })
    expect(res).toMatchObject({ ok: false, error: { type: 'NO_SERVICE' } })
    // 有握手文件 → 现读配置并真实调用（127.0.0.1 回环）
    const root = mkdtempSync(join(tmpdir(), 'tintin-lb3-'))
    tmpDirs.push(root)
    const dir = join(root, 'tintin', 'browser') // 生产形态：<DSH_HOME>/tintin/browser
    const svc = await startLoopbackService({ handlers, handshakeDir: dir })
    services.push(svc)
    process.env.DSH_HOME = root
    const cfg = readLoopbackConfig()
    expect(cfg?.port).toBe(svc.port)
    const viaFile = await loopbackCall('/tintin-browser/open', { platform: 'bilibili' })
    expect(viaFile).toEqual({ ok: true, opened: 'bilibili' })
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
  })

  it('summarizeExtract reduces payloads to decision-relevant fields (成本护栏)', () => {
    expect(summarizeExtract({ ok: false, error: { type: 'NEED_LOGIN', message: '请先登录' } }))
      .toEqual({ ok: false, error: 'NEED_LOGIN: 请先登录' })
    const s = summarizeExtract({ ok: true, data: { title: 'T', items: ['a', 'b', 'c', 'd'] } })
    expect(s.ok).toBe(true)
    expect(String(s.summary)).toContain('T')
    expect(String(s.summary)).toContain('items: 4 条')
    expect(String(s.summary)).not.toContain('d') // 前 3 条预览，第 4 条不出现
  })
})

// ── 助手 ──
function rawGet(port: number, token: string): Promise<{ status: number }> {
  return new Promise((resolve) => {
    const req = new globalThis.Request(`http://127.0.0.1:${port}/tintin-browser/open`, {
      method: 'POST',
      headers: { 'x-tintin-loopback-token': token, 'content-type': 'application/json' },
      body: '{}',
    })
    fetch(req).then(async (r) => resolve({ status: r.status }))
  })
}
function loopbackCallAt(port: number, token: string, path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body)
    const req = new globalThis.Request(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'x-tintin-loopback-token': token, 'content-type': 'application/json' },
      body: payload,
    })
    fetch(req).then(async (r) => resolve(await r.json()))
  })
}
