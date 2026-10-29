// test/tintin-browser-loopback.test.ts — 回环门面回归（批次⑥）
// loopback-service：token 鉴权（401）/未知路由（404）/open+extract 分发/握手文件。
// 用真实 http 服务器（127.0.0.1:0）+ 假 handlers，host 侧 helper（读握手文件 + 调用）一并验到。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startLoopbackService, routeLoopback } from '../src/browser/loopback-service'
import { loopbackCall, readLoopbackConfig, summarizeExtract } from 'dsh-tintin-bundle/lib/loopback-helpers.js'

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
  return loopbackRequest(port, token, '/tintin-browser/open', {}).then((r) => ({ status: r.status }))
}
function loopbackCallAt(port: number, token: string, path: string, body: unknown): Promise<unknown> {
  return loopbackRequest(port, token, path, body).then((r) => r.json)
}
/** node:http 直连（与生产 loopbackCall 同路径）。不能走 fetch：fetch 规范坏端口黑名单
 *  会直接拒绝部分合法回环端口（本机动态区间 1024-15000 与黑名单交集 17 个，listen(0) 可踩中，
 *  19:55 打包门禁实撞），且无 reject 的 fetch 会把用例挂到超时——http.request 无黑名单 + error 显式 reject。 */
function loopbackRequest(port: number, token: string, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-tintin-loopback-token': token,
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) }) }
        catch { reject(new Error(`回环响应非 JSON（status=${res.statusCode}）: ${text.slice(0, 120)}`)) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}
