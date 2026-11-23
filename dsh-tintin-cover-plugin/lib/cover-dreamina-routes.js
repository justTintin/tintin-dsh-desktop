// cover-dreamina-routes.js — 即梦创作 CLI 路由族(2026-11-15 封面设置批;门禁触发的
// 拆分优于加基线,同 cover-photocraft-routes.js 先例)。
//   POST /tintin/cover/api/dreamina {action:status|login-start|login-status|login-cancel|logout|login-headless|login-check}
//     → status/logout 直通共享门;登录走**官方默认语义**(2026-11-23 定罪:SKILL.md
//       "Default login waits for authorization to complete"):login-start 拉起一条
//       阻塞 `dreamina login`(CLI 自己每秒轮询,授权完成瞬间自己收 token 退出),
//       实时读 stdout——材料(verification_uri/user_code)一到即先返回给 UI,进程
//       继续常驻等待;UI 以 login-status 轮询直到进程退出。全程无 UI 模拟轮询、
//       无 checklogin、无补收——之前 headless+checklogin+90s/10s 窗口三连报障
//       全是偏离默认的代偿(§7.27-7.31)。
import { spawn } from 'node:child_process'
import { createDreaminaApi, parseCliOutput, resolveDreaminaBin } from 'dsh-tintin-shared/lib/dreamina.js'

const LOGIN_KILL_MS = 16 * 60 * 1000 // device_code TTL 15 分钟 + 余量

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
          sendJson(res, 400, { error: `未知 action: ${action}` })
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })
  return [dispose, () => killSession()]
}
