// cover-dreamina-skill — 即梦优先开关+官方技能路由回归(2026-11-23 §7.33 用户裁决)。
// 覆盖:①pref 缺省开/get-set 往返(persist 进 DSH_HOME config)②官方 SKILL.md 定位→
// 安装→upToDate→删除全链(TINTIN_DREAMINA_SKILL 指向 fixture,不动真身)。
// 探针口径=路由 end 回调 fire-and-forget:等待 sendJson 回调而非 handler promise。
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { registerCoverDreaminaRoutes } from '../lib/cover-dreamina-routes.js'

const OFFICIAL_MD = [
  '---',
  'name: dreamina-cli',
  'description: Use when an agent needs Dreamina image or video generation through the dreamina CLI.',
  '---',
  '',
  '# Dreamina CLI',
  '',
  'Official fixture for tests.',
].join('\n')

let home = ''
let skillSrc = ''
const savedEnv: Record<string, string | undefined> = {}
let raw: ((req: unknown, res: unknown) => Promise<void>) | null = null
let notify: ((body: Record<string, unknown>) => void) | null = null
let last: Record<string, unknown> | null = null

function register(): void {
  registerCoverDreaminaRoutes({
    registeringWebServer: { register: (r: { handler: (req: unknown, res: unknown) => Promise<void> }) => { raw = r.handler; return () => {} } },
    mutationAllowed: async () => true,
    sendJson: (_res: unknown, _status: number, body: unknown) => {
      last = body as Record<string, unknown>
      const n = notify
      notify = null
      n?.(last!)
    },
  })
}

const call = (payload: Record<string, unknown>): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('probe timeout 15s')), 15_000)
  notify = (body) => { clearTimeout(to); resolve(body) }
  const req = new EventEmitter(); (req as { method?: string }).method = 'POST'
  void raw!(req, {})
  setTimeout(() => { req.emit('data', JSON.stringify(payload)); req.emit('end') }, 10)
})

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'dreamina-pref-'))
  const srcDir = mkdtempSync(join(tmpdir(), 'dreamina-skill-'))
  skillSrc = join(srcDir, 'SKILL.md')
  writeFileSync(skillSrc, OFFICIAL_MD)
  savedEnv.home = process.env.DSH_HOME
  savedEnv.skill = process.env.TINTIN_DREAMINA_SKILL
  process.env.DSH_HOME = home
  process.env.TINTIN_DREAMINA_SKILL = skillSrc
  register()
})
afterAll(() => {
  if (savedEnv.home === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedEnv.home
  if (savedEnv.skill === undefined) delete process.env.TINTIN_DREAMINA_SKILL
  else process.env.TINTIN_DREAMINA_SKILL = savedEnv.skill
  rmSync(home, { recursive: true, force: true })
  rmSync(join(skillSrc, '..'), { recursive: true, force: true })
})
beforeEach(() => { last = null })

describe('即梦优先开关(get/set-pref,§7.33)', () => {
  it('缺省开;set-pref 持久化进 config;往返精确', async () => {
    const a = await call({ action: 'get-pref' })
    expect(a.ok).toBe(true)
    expect(a.preferInSkills).toBe(true) // 缺省开
    const b = await call({ action: 'set-pref', preferInSkills: false })
    expect(b.ok).toBe(true)
    expect(b.preferInSkills).toBe(false)
    // 落盘验证(config.json dreamina.preferInSkills=false)
    expect(JSON.parse(readFileSync(join(home, 'tintin', 'config.json'), 'utf8')).dreamina.preferInSkills).toBe(false)
    const c = await call({ action: 'get-pref' })
    expect(c.preferInSkills).toBe(false)
    const d = await call({ action: 'set-pref', preferInSkills: true })
    expect(d.ok).toBe(true)
    expect((await call({ action: 'get-pref' })).preferInSkills).toBe(true)
  })
})

describe('官方即梦技能(skill-get/install/remove,§7.33)', () => {
  it('get:available+未装;install:落 cover-skills/dreamina(SKILL.md+skill.json)且 upToDate', async () => {
    const g = await call({ action: 'skill-get' })
    expect(g.ok).toBe(true)
    expect(g.available).toBe(true)
    expect(g.installed).toBe(false)
    expect(g.name).toBe('dreamina-cli')
    expect(String(g.description)).toContain('dreamina CLI')

    const inst = await call({ action: 'skill-install' })
    expect(inst.ok).toBe(true)
    const dir = join(home, 'cover-skills', 'dreamina')
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(OFFICIAL_MD) // 字节一致
    expect(JSON.parse(readFileSync(join(dir, 'skill.json'), 'utf8')).name).toBe('即梦创作 CLI')
    const g2 = await call({ action: 'skill-get' })
    expect(g2.installed).toBe(true)
    expect(g2.upToDate).toBe(true) // 内容 hash 一致=无需重装(默认自动安装的幂等判据)

    // 官方源更新(内容变)→upToDate=false→再装=更新
    writeFileSync(skillSrc, OFFICIAL_MD + '\nupdated.')
    const g3 = await call({ action: 'skill-get' })
    expect(g3.upToDate).toBe(false)
    const inst2 = await call({ action: 'skill-install' })
    expect(inst2.ok).toBe(true)
    expect((await call({ action: 'skill-get' })).upToDate).toBe(true)

    const rm = await call({ action: 'skill-remove' })
    expect(rm.ok).toBe(true)
    expect(existsSync(dir)).toBe(false)
    const g4 = await call({ action: 'skill-get' })
    expect(g4.installed).toBe(false)
  })

  it('官方 SKILL.md 缺失=available:false,安装给人话指引', async (ctx) => {
    // 真机官方位(~/.dreamina_cli/dreamina/SKILL.md)存在时 env 缺失会回落官方位——
    // 该分支只在无官方位机器可达,此环境直接跳过(逻辑已被 install 分支的 available 判据覆盖)
    if (existsSync(join(homedir(), '.dreamina_cli', 'dreamina', 'SKILL.md'))) ctx.skip()
    process.env.TINTIN_DREAMINA_SKILL = join(home, 'missing', 'SKILL.md')
    try {
      const g = await call({ action: 'skill-get' })
      expect(g.ok).toBe(true)
      expect(g.available).toBe(false)
      const inst = await call({ action: 'skill-install' })
      expect(inst.ok).toBe(false)
      expect(String(inst.error)).toContain('官方即梦技能')
    } finally {
      process.env.TINTIN_DREAMINA_SKILL = skillSrc
    }
  })

  it('安装产物内容 hash=官方源(与 upToDate 判据同源;防写错路径)', async () => {
    const srcHash = createHash('sha256').update(readFileSync(skillSrc)).digest('hex')
    const inst = await call({ action: 'skill-install' })
    expect(inst.ok).toBe(true)
    const dstHash = createHash('sha256').update(readFileSync(join(home, 'cover-skills', 'dreamina', 'SKILL.md'))).digest('hex')
    expect(dstHash).toBe(srcHash)
    rmSync(join(home, 'cover-skills', 'dreamina'), { recursive: true, force: true })
  })
})
