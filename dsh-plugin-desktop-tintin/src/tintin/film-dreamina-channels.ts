// film-dreamina-channels — 视频剪辑侧「即梦 CLI」技能的设置/登录/能力通道。
// 与封面侧的表层同构,但开关走独立键 dreamina.preferInFilm(封面删除后彼此独立),
// 技能装位在 <channelHome>/film-skills/dreamina(影片智能体 home 在会话启动时同步)。
// 通道只做本地 CLI/配置读写;不碰服务端,也不在这个文件里生成媒体。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import {
  createDreaminaApi,
  ensureDreaminaCliOnce,
  parseCliOutput,
  resolveDreaminaBin,
} from 'dsh-tintin-shared/lib/dreamina.js'
import {
  DREAMINA_GENERATE_COMMANDS,
  DREAMINA_IMAGE_RATIOS,
  DREAMINA_VIDEO_RATIOS,
  isImageCommand,
} from 'dsh-tintin-shared/lib/dreamina-logic.js'
import { mergeTintinConfigStore, readTintinConfigStore } from 'dsh-tintin-shared/lib/tintin-config-store.js'

export const FILM_DREAMINA_CHANNEL = 'openfilm:native:dreamina'
const LOGIN_KILL_MS = 16 * 60 * 1000

/** 影片侧独立开关:缺省开,与封面的 preferInSkills 不共用(封面后续删除)。 */
export function filmDreaminaPreferOn(): boolean {
  try {
    const doc = readTintinConfigStore(process.env.DSH_HOME)
    const dreamina = doc?.dreamina as { preferInFilm?: unknown } | undefined
    return dreamina?.preferInFilm !== false
  } catch { return true }
}

function officialSkillPath(): string {
  const configured = String(process.env.TINTIN_DREAMINA_SKILL ?? '').trim()
  for (const p of [configured, join(homedir(), '.dreamina_cli', 'dreamina', 'SKILL.md')]) {
    if (p && existsSync(p)) return p
  }
  return ''
}

/** 影片侧技能装位:会话启动时再同步进各 persona 的 agent home。 */
export function filmDreaminaSkillsDir(channelHome: string): string {
  return join(channelHome, 'film-skills', 'dreamina')
}

function skillState(channelHome: string): Record<string, unknown> {
  const src = officialSkillPath()
  const dir = filmDreaminaSkillsDir(channelHome)
  const installedFile = join(dir, 'SKILL.md')
  const hash = (p: string): string => {
    try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch { return '' }
  }
  const head = src ? (/^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(src, 'utf8'))?.[1] ?? '') : ''
  return {
    ok: true,
    available: Boolean(src),
    source: src,
    installed: existsSync(installedFile),
    upToDate: Boolean(src && hash(src) === hash(installedFile)),
    dir: existsSync(installedFile) ? dir : '',
    name: /^name:\s*(.+)$/m.exec(head)?.[1]?.trim() || 'dreamina-cli',
    description: /^description:\s*(.+)$/m.exec(head)?.[1]?.trim() || '',
  }
}

/** CLI 提供的生成能力(静态白名单 = -h 实测表;登录态由 status 给出)。
 *  没有 capabilities 子命令——官方要求以 dreamina <cmd> -h 为准,故这里只列可提交的命令。 */
function capabilities(): Record<string, unknown> {
  return {
    ok: true,
    commands: DREAMINA_GENERATE_COMMANDS.map((command) => ({
      command,
      kind: isImageCommand(command) ? 'image' : 'video',
      ratios: isImageCommand(command) ? DREAMINA_IMAGE_RATIOS : DREAMINA_VIDEO_RATIOS,
    })),
    preferred: filmDreaminaPreferOn(),
  }
}

export function registerFilmDreaminaChannels({ ipcMain, channelHome }: { ipcMain: IpcMain; channelHome: string }): void {
  const api = createDreaminaApi({ warn: (m) => console.warn('[film-dreamina]', m) })
  let session: { proc: ReturnType<typeof spawn>; stdout: string; stderr: string; done: Record<string, unknown> | null; timer: NodeJS.Timeout | null } | null = null

  const killSession = (): void => {
    if (!session) return
    try { clearTimeout(session.timer as NodeJS.Timeout) } catch { /* ignore */ }
    try { session.proc.kill() } catch { /* ignore */ }
    session = null
  }
  const materialsOf = (): Record<string, string> | null => {
    if (!session) return null
    const v = parseCliOutput(session.stdout)
    const value = (v.value && typeof v.value === 'object') ? v.value as Record<string, unknown> : {}
    const verificationUri = String(value.verification_uri ?? '')
    const userCode = String(value.user_code ?? '')
    if (!verificationUri || !userCode) return null
    return {
      verificationUri,
      userCode,
      deviceCode: String(value.device_code ?? ''),
      expiresAt: String(value.expires_at ?? ''),
    }
  }
  const startSession = (): boolean => {
    if (session && !session.done) return false
    killSession()
    const proc = spawn(resolveDreaminaBin(), ['login'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    session = { proc, stdout: '', stderr: '', done: null, timer: null }
    proc.stdout.on('data', (d: Buffer) => { if (session) session.stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { if (session) session.stderr += d.toString() })
    proc.on('error', (e: Error) => { if (session) session.done = { ok: false, error: e.message } })
    proc.on('close', (code) => {
      if (!session) return
      session.done = { ok: code === 0, code, stderr: session.stderr.slice(-800), stdout: session.stdout.slice(-800) }
      try { clearTimeout(session.timer as NodeJS.Timeout) } catch { /* ignore */ }
    })
    session.timer = setTimeout(killSession, LOGIN_KILL_MS)
    return true
  }

  ipcMain.handle('openfilm:native:dreamina', async (_event, payload: unknown) => {
    const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const action = String(p.action ?? 'status')
    try {
      const needsCli = ['status', 'login-start', 'logout', 'generate', 'query', 'tasks', 'credit'].includes(action)
      if (needsCli) {
        const bin = resolveDreaminaBin()
        if (bin === 'dreamina' || !existsSync(bin)) {
          await ensureDreaminaCliOnce({ log: (m: string) => console.info('[film-dreamina]', m) }).catch(() => {})
        }
      }

      if (action === 'status') return { ...(await api['dreamina:status']()), preferInFilm: filmDreaminaPreferOn() }
      if (action === 'capabilities') return capabilities()
      if (action === 'get-pref') return { ok: true, preferInFilm: filmDreaminaPreferOn() }
      if (action === 'set-pref') {
        const on = Boolean(p.preferInFilm)
        try { mergeTintinConfigStore(process.env.DSH_HOME, { dreamina: { preferInFilm: on } }) } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
        return { ok: true, preferInFilm: on }
      }
      if (action === 'login-start') {
        const fresh = startSession()
        for (let i = 0; i < 40 && !materialsOf() && !(session && session.done); i += 1) {
          await new Promise((r) => setTimeout(r, 250))
        }
        const m = materialsOf()
        if (!m) {
          const d = session?.done
          if (d?.ok) return { ok: true, alreadyLoggedIn: true }
          return { ok: false, error: d ? `登录进程退出:${String(d.stderr || d.stdout || '无输出').split('\n')[0]}` : '登录进程未输出授权材料' }
        }
        return { ok: true, reused: !fresh, ...m }
      }
      if (action === 'login-status') {
        if (!session) return { ok: true, active: false, done: null }
        const d = session.done
        return {
          ok: true,
          active: !d,
          done: d ? { ok: d.ok, error: d.ok ? '' : String(d.stderr || d.stdout || '登录未完成').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '登录未完成' } : null,
          materials: materialsOf(),
        }
      }
      if (action === 'login-cancel') { killSession(); return { ok: true } }
      if (action === 'logout') { killSession(); return await api['dreamina:logout']() }
      if (action === 'skill-get') return skillState(channelHome)
      if (action === 'skill-install') {
        const st = skillState(channelHome)
        if (!st.available) return { ok: false, error: '未找到官方即梦技能(SKILL.md)——先安装即梦创作 CLI' }
        const dir = filmDreaminaSkillsDir(channelHome)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'SKILL.md'), readFileSync(String(st.source ?? '')))
        writeFileSync(join(dir, 'skill.json'), `${JSON.stringify({ name: '即梦创作 CLI', kind: 'cli' }, null, 2)}\n`)
        return { ok: true, ...skillState(channelHome) }
      }
      if (action === 'skill-remove') {
        const dir = filmDreaminaSkillsDir(channelHome)
        if (!existsSync(dir)) return { ok: false, error: '已安装目录不存在' }
        rmSync(dir, { recursive: true, force: true })
        return { ok: true }
      }
      if (action === 'generate') {
        if (!filmDreaminaPreferOn()) return { ok: false, error: '即梦优先开关已关闭' }
        const status = await api['dreamina:status']()
        if (!status.loggedIn) return { ok: false, error: '即梦 CLI 未登录' }
        return await api['dreamina:generate']([p])
      }
      if (action === 'query') return await api['dreamina:query']([p])
      return { ok: false, error: `未知 action: ${action}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
