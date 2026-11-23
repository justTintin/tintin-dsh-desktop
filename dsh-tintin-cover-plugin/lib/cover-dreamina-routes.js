// cover-dreamina-routes.js — 即梦创作 CLI 路由族(2026-11-15 封面设置批;门禁触发的
// 拆分优于加基线,同 cover-photocraft-routes.js 先例)。
//   POST /tintin/cover/api/dreamina {action:status|login-start|login-status|login-cancel|logout|login-headless|login-check
//     |get-pref|set-pref|skill-get|skill-install|skill-remove}
//   2026-11-23 用户裁决(§7.33):①开关 dreamina.preferInSkills(默认开)——开+已登录时
//     封面制作全链(编辑器生成/技能/会话)优先即梦 CLI;②官方即梦技能(install.sh 下载的
//     ~/.dreamina_cli/dreamina/SKILL.md)默认安装进封面技能装位 cover-skills/dreamina,
//     技能管理「即梦」tab 展示(发现 tab 之后)。
//     → status/logout 直通共享门;登录走**官方默认语义**(2026-11-23 定罪:SKILL.md
//       "Default login waits for authorization to complete"):login-start 拉起一条
//       阻塞 `dreamina login`(CLI 自己每秒轮询,授权完成瞬间自己收 token 退出),
//       实时读 stdout——材料(verification_uri/user_code)一到即先返回给 UI,进程
//       继续常驻等待;UI 以 login-status 轮询直到进程退出。全程无 UI 模拟轮询、
//       无 checklogin、无补收——之前 headless+checklogin+90s/10s 窗口三连报障
//       全是偏离默认的代偿(§7.27-7.31)。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createDreaminaApi, parseCliOutput, resolveDreaminaBin } from 'dsh-tintin-shared/lib/dreamina.js'
import { mergeTintinConfigStore, readTintinConfigStore } from 'dsh-tintin-shared/lib/tintin-config-store.js'

const LOGIN_KILL_MS = 16 * 60 * 1000 // device_code TTL 15 分钟 + 余量

/** 即梦优先开关(2026-11-23 用户裁决 §7.33):config dreamina.preferInSkills,缺省开。
 *  开+已登录=封面制作全链(编辑器生成/技能/会话)优先即梦 CLI;关=一律服务端兜底。 */
function dreaminaPreferOn() {
  try {
    const doc = readTintinConfigStore(process.env.DSH_HOME)
    return doc?.dreamina?.preferInSkills !== false
  } catch { return true }
}

/** 官方即梦技能(install.sh 下载):定位链=env TINTIN_DREAMINA_SKILL > 官方位
 *  ~/.dreamina_cli/dreamina/SKILL.md。装位=cover-skills/dreamina(与 / 菜单同源)。 */
function officialSkillPath(env = process.env) {
  const candidates = [env.TINTIN_DREAMINA_SKILL, join(homedir(), '.dreamina_cli', 'dreamina', 'SKILL.md')]
  for (const p of candidates) {
    const t = String(p ?? '').trim()
    if (t && existsSync(t)) return t
  }
  return null
}
function coverSkillsHome() {
  const channelHome = process.env.TINTIN_COVER_AGENT_HOME
    || process.env.DSH_HOME
    || join(process.env.USERPROFILE || process.env.HOME || homedir(), 'Documents', 'tintin-workspace', '.tintin')
  return join(channelHome, 'cover-skills')
}
function dreaminaSkillState() {
  const src = officialSkillPath()
  const installedDir = join(coverSkillsHome(), 'dreamina')
  const installedPath = join(installedDir, 'SKILL.md')
  const srcHash = src ? createHash('sha256').update(readFileSync(src)).digest('hex') : ''
  const installedHash = existsSync(installedPath) ? createHash('sha256').update(readFileSync(installedPath)).digest('hex') : ''
  const cliVersion = (() => {
    try {
      const v = String(readFileSync(join(homedir(), '.dreamina_cli', 'version.json'), 'utf8'))
      const m = /"version"\s*:\s*"([^"]+)"/.exec(v)
      return m ? m[1] : ''
    } catch { return '' }
  })()
  let description = ''
  let name = 'dreamina-cli'
  if (src) {
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(src, 'utf8'))?.[1] ?? ''
    name = /^name:\s*(.+)$/m.exec(head)?.[1]?.trim() || name
    description = /^description:\s*(.+)$/m.exec(head)?.[1]?.trim() || ''
  }
  return {
    ok: true,
    available: Boolean(src),
    source: src || '',
    installed: existsSync(installedPath),
    upToDate: Boolean(src && installedHash && srcHash === installedHash),
    installedDir: existsSync(installedPath) ? installedDir : '',
    cliVersion,
    name,
    description,
  }
}

export function registerCoverDreaminaRoutes({ registeringWebServer, mutationAllowed, sendJson }) {
  const dreaminaApi = createDreaminaApi({ warn: (msg) => console.warn('[cover-dreamina]', msg) })
  /* 官方默认登录会话(单例;幂等复用防双进程抢 device_code) */
  let session = null // {proc, stdout, stderr, done, timer, warn}
  function killSession() {
    if (!session) return
    try { clearTimeout(session.timer) } catch { /* ignore */ }
    try { session.proc.kill() } catch { /* ignore */ }
    session = null
  }
  function materialsOf() {
    if (!session) return null
    const parsed = parseCliOutput(session.stdout)
    const v = parsed.kind === 'kv' ? parsed.value : {}
    const verificationUri = String(v.verification_uri ?? '')
    const userCode = String(v.user_code ?? '')
    if (!verificationUri || !userCode) return null
    return { verificationUri, userCode, deviceCode: String(v.device_code ?? ''), expiresAt: String(v.expires_at ?? '') }
  }
  function startSession() {
    if (session && !session.done) return false // 已有活会话:复用
    killSession()
    session = { proc: null, stdout: '', stderr: '', done: null, timer: null }
    const proc = spawn(resolveDreaminaBin(), ['login'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    session.proc = proc
    proc.stdout.on('data', (d) => { session.stdout += d })
    proc.stderr.on('data', (d) => { session.stderr += d })
    proc.on('error', (e) => { if (session) session.done = { ok: false, stderr: String(e?.message ?? e) } })
    proc.on('close', (code) => {
      if (!session) return
      session.done = { ok: code === 0, code, stderr: session.stderr.slice(-800), stdout: session.stdout.slice(-800) }
      try { clearTimeout(session.timer) } catch { /* ignore */ }
    })
    session.timer = setTimeout(killSession, LOGIN_KILL_MS)
    return true
  }
  const dispose = registeringWebServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/dreamina',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !(await mutationAllowed(req))) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body || '{}')
          const action = String(p.action || 'status')
          if (action === 'status') return sendJson(res, 200, await dreaminaApi['dreamina:status']())
          if (action === 'login-start') {
            const fresh = startSession()
            // 材料通常 1-2s 内打印;给最多 10s 等材料,避免 UI 拿空
            for (let i = 0; i < 40 && !materialsOf() && !(session && session.done); i += 1) {
              await new Promise((r) => setTimeout(r, 250))
            }
            const m = materialsOf()
            if (!m) {
              const d = session?.done
              return sendJson(res, 200, { ok: false, error: d ? `登录进程退出:${(d.stderr || d.stdout || '无输出').split('\n')[0]}` : '登录进程未输出授权材料' })
            }
            return sendJson(res, 200, { ok: true, reused: !fresh, ...m })
          }
          if (action === 'login-status') {
            if (!session) return sendJson(res, 200, { ok: true, active: false, done: null })
            const d = session.done
            return sendJson(res, 200, {
              ok: true,
              active: !d,
              done: d ? { ok: d.ok, error: d.ok ? '' : (d.stderr || d.stdout || '登录未完成').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '登录未完成' } : null,
              materials: materialsOf(),
            })
          }
          if (action === 'login-cancel') { killSession(); return sendJson(res, 200, { ok: true }) }
          if (action === 'login-headless') return sendJson(res, 200, await dreaminaApi['dreamina:loginHeadless']())
          if (action === 'login-check') return sendJson(res, 200, await dreaminaApi['dreamina:loginCheck']({ deviceCode: p.deviceCode, poll: p.poll }))
          if (action === 'logout') { killSession(); return sendJson(res, 200, await dreaminaApi['dreamina:logout']()) }
          // ── 即梦优先开关(§7.33) ──
          if (action === 'get-pref') {
            return sendJson(res, 200, { ok: true, preferInSkills: dreaminaPreferOn() })
          }
          if (action === 'set-pref') {
            const on = Boolean(p.preferInSkills)
            try { mergeTintinConfigStore(process.env.DSH_HOME, { dreamina: { preferInSkills: on } }) } catch (err) {
              return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) })
            }
            return sendJson(res, 200, { ok: true, preferInSkills: on })
          }
          // ── 官方即梦技能(§7.33:默认安装进 cover-skills/dreamina) ──
          if (action === 'skill-get') {
            return sendJson(res, 200, dreaminaSkillState())
          }
          if (action === 'skill-install') {
            const st = dreaminaSkillState()
            if (!st.available) return sendJson(res, 200, { ok: false, error: '未找到官方即梦技能(SKILL.md)——先安装即梦创作 CLI(curl -s https://jimeng.jianying.com/cli | bash)' })
            const dir = join(coverSkillsHome(), 'dreamina')
            mkdirSync(dir, { recursive: true })
            writeFileSync(join(dir, 'SKILL.md'), readFileSync(st.source))
            writeFileSync(join(dir, 'skill.json'), JSON.stringify({ name: '即梦创作 CLI' }, null, 2) + '\n')
            return sendJson(res, 200, { ok: true, dir, ...dreaminaSkillState() })
          }
          if (action === 'skill-remove') {
            const dir = join(coverSkillsHome(), 'dreamina')
            if (!existsSync(dir)) return sendJson(res, 200, { ok: false, error: '已安装目录不存在' })
            rmSync(dir, { recursive: true, force: true })
            return sendJson(res, 200, { ok: true })
          }
          sendJson(res, 400, { error: `未知 action: ${action}` })
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })
  return [dispose, () => killSession()]
}
