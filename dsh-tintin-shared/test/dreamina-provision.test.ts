// ensureDreaminaCli 首跑装配回归(2026-11-24 用户报障「安装包装到新设备没有即梦 CLI」):
// 包按「可下载件不入包」先例不带 CLI,新设备没有任何装配链路=即梦功能全灭。
// 装配=官方安装器同源同位(二进制→<home>/bin,SKILL.md/version.json→~/.dreamina_cli)。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ensureDreaminaCli, ensureDreaminaCliOnce } from '../lib/dreamina.js'

const roots: string[] = []
afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })
const tempHome = (): string => { const dir = mkdtempSync(join(tmpdir(), 'dreamina-prov-')); roots.push(dir); return dir }

const BIN_BODY = Buffer.from('0'.repeat(1024 * 1024 + 100)) // >1MB 完整性阈值
const stubFetch = (body: Buffer | string): typeof fetch => (async (url: URL | string) => {
  const target = String(url)
  if (target.endsWith('SKILL.md')) return new Response('# dreamina skill ' + 'x'.repeat(220), { status: 200 })
  if (target.endsWith('version.json')) return new Response('{"version":"1.4.21"}', { status: 200 })
  if (target.includes('dreamina_cli_')) return new Response(new Uint8Array(BIN_BODY), { status: 200 })
  return new Response('nope', { status: 404 })
}) as unknown as typeof fetch

describe('ensureDreaminaCli(首跑自愈装配,2026-11-24)', () => {
  it('二进制缺失→按官方落位装配三件(bin/SKILL.md/version.json)', async () => {
    const home = tempHome()
    const out = await ensureDreaminaCli({ homeDir: home, platform: 'linux', arch: 'x64', fetchImpl: stubFetch(BIN_BODY) })
    expect(out.ok).toBe(true)
    const bin = join(home, 'bin', 'dreamina')
    expect(existsSync(bin)).toBe(true)
    expect(readFileSync(bin).length).toBeGreaterThanOrEqual(1024 * 1024)
    expect(readFileSync(join(home, '.dreamina_cli', 'dreamina', 'SKILL.md'), 'utf8')).toContain('dreamina skill')
    expect(readFileSync(join(home, '.dreamina_cli', 'version.json'), 'utf8')).toContain('1.4.21')
  })

  it('二进制已存在→幂等跳过(零下载)', async () => {
    const home = tempHome()
    mkdirSync(join(home, 'bin'), { recursive: true })
    writeFileSync(join(home, 'bin', 'dreamina'), 'existing')
    let fetchCalls = 0
    const counting = (() => { const inner = stubFetch(BIN_BODY); return (async (url: URL | string) => { fetchCalls += 1; return inner(url) }) as typeof fetch })()
    const out = await ensureDreaminaCli({ homeDir: home, platform: 'linux', arch: 'x64', fetchImpl: counting })
    expect(out.ok).toBe(true)
    expect((out as { skipped?: boolean }).skipped).toBe(true)
    expect(fetchCalls).toBe(0)
  })

  it('HTTP 失败→ok:false 带原文错误,不留半截二进制', async () => {
    const home = tempHome()
    const failing = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    const out = await ensureDreaminaCli({ homeDir: home, platform: 'linux', arch: 'x64', fetchImpl: failing })
    expect(out.ok).toBe(false)
    expect(String((out as { error?: string }).error)).toContain('404')
    expect(existsSync(join(home, 'bin', 'dreamina'))).toBe(false)
  })

  it('ensureDreaminaCliOnce 同 home 并发去重(同一次装配)', async () => {
    const home = tempHome()
    const [a, b] = await Promise.all([
      ensureDreaminaCliOnce({ homeDir: home, platform: 'linux', arch: 'x64', fetchImpl: stubFetch(BIN_BODY) }),
      ensureDreaminaCliOnce({ homeDir: home, platform: 'linux', arch: 'x64', fetchImpl: stubFetch(BIN_BODY) }),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(readFileSync(join(home, 'bin', 'dreamina')).length).toBeGreaterThan(0)
  })
})
