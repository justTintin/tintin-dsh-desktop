// cover-acp.ts — 封面制作 ACP 会话桥(2026-10-27 用户裁决:封面编辑器内嵌
// 视频剪辑同款 agent 会话,复用 FilmAgentManager 模式,cwd 指向 cover 工作目录。
// 区别:cover 不走 openfilm skill,走封面制作技能;会话持久在 cover-agent-home。)
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { collectMachineInfoSync, deriveMachineId } from 'dsh-tintin-bundle/lib/machine-id.js'

const require_ = createRequire(import.meta.url)

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  elicitation: { form: {} },
  session: { notices: {} },
}
const CLIENT_INFO = { name: 'tintin-cover', title: 'TinTin Cover Editor' }

const TURN_STALL_TIMEOUT_MS = 5 * 60_000

export interface CoverAgentEvent {
  key: string
  event:
    | { kind: 'update'; update: { sessionUpdate: string } & Record<string, unknown> }
    | { kind: 'permission'; requestId: string; params: { toolCall?: { title?: string }; options: Array<{ optionId: string; name: string; kind: string }> } }
    | { kind: 'exit'; code: number | null; stderr: string }
    | { kind: 'done'; ok: boolean; stopReason?: string; error?: string }
}

interface Handle {
  cwd: string
  sessionId: string | null
  child: ReturnType<typeof spawn>
  agent: Promise<{ prompt(text: string): Promise<{ stopReason: string }> }>
  conn: { agent: { request(method: unknown, params: Record<string, unknown>): Promise<unknown> } } | null
  init: Record<string, unknown> | null
  session: Record<string, unknown> | null
}

/** 封面智能体模型路由(与 film 同源:TinTin 服务端 openai-completions) */
function coverAgentPatchText(serverUrl: string): string {
  return [
    '# TinTin 封面智能体: 模型路由到 TinTin 服务端(openai-completions)',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      tintin-server:',
    '        displayName: TinTin',
    '        apiKeyEnv: TINTIN_SERVER_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${serverUrl.replace(/\/+$/, '')}/llm`,
    '        models:',
    '          - id: deepseek-v4-flash',
    '            name: DeepSeek-V4-Flash',
    '- id: acp',
    '  config:',
    '    provider: tintin-server',
    '    model: deepseek-v4-flash',
    '- id: permission',
    '  config:',
    '    defaultPreset: danger-full-access',
  ].join('\n')
}

/** app 内的 @deepseek-ai/dsh CLI 可执行文件 */
export function resolveDshBin(): string {
  const override = process.env.TINTIN_DSH_BIN
  if (override) return override
  const manifest = require_.resolve('@deepseek-ai/dsh/package.json')
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: Record<string, string> | string }
  const bin = typeof parsed.bin === 'object' && parsed.bin !== null ? parsed.bin.dsh : parsed.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('@deepseek-ai/dsh declares no dsh executable')
  return join(dirname(manifest), bin)
}

export function dshBinExists(): boolean {
  try { return existsSync(resolveDshBin()) } catch { return false }
}

/** 封面制作技能注入(cover-skill/SKILL.md → agent home) */
function ensureCoverSkill(channelHome: string): void {
  const sources = [
    join(dirname(fileURLToPath(import.meta.url)), '../../../dsh-tintin-cover-plugin/skills/cover/SKILL.md'),
    join(process.resourcesPath ?? '', 'skills', 'cover', 'SKILL.md'),
  ]
  for (const src of sources) {
    if (!existsSync(src)) continue
    const target = join(channelHome, 'tintin', 'cover-agent-home', 'skills', 'cover')
    mkdirSync(target, { recursive: true })
    const { copyFileSync } = require('node:fs') as typeof import('node:fs')
    copyFileSync(src, join(target, 'SKILL.md'))
    return
  }
}

export class CoverAgentManager {
  private handles = new Map<string, Handle>()
  private sessionIds = new Map<string, string>()
  private log: (message: string) => void
  private serverUrl: () => string
  private channelHome: string
  private onEvent: ((update: { key: string; event: CoverAgentEvent }) => void) | null

  constructor(options: {
    channelHome: string
    serverUrl: () => string
    onEvent?: (update: { key: string; event: CoverAgentEvent }) => void
    log?: (message: string) => void
  }) {
    this.channelHome = options.channelHome
    this.serverUrl = options.serverUrl
    this.onEvent = options.onEvent ?? null
    this.log = options.log ?? (() => {})
  }

  /** 启动(或续接)封面会话 */
  async start(key: string, cwd: string): Promise<{ sessionId: string }> {
    const handle = await this.ensure(key, cwd)
    return { sessionId: handle.sessionId ?? '' }
  }

  /** 发送对话消息;语义更新经 onEvent 流出 */
  async prompt(key: string, text: string): Promise<{ stopReason: string }> {
    const handle = await this.ensure(key, this.coverCwd())
    const agent = await handle.agent
    return agent.prompt(text)
  }

  /** 停止指定会话 */
  stop(key: string): void {
    const handle = this.handles.get(key)
    if (!handle) return
    this.handles.delete(key)
    try { handle.child.kill() } catch { /* 已退出 */ }
  }

  dispose(): void {
    for (const key of [...this.handles.keys()]) this.stop(key)
  }

  /** cover 工作目录(ACP agent 的 cwd) */
  private coverCwd(): string {
    return process.env.TINTIN_COVER_CWD || process.cwd()
  }

  private ensure(key: string, cwd: string): Promise<Handle> {
    const existing = this.handles.get(key)
    if (existing && existing.child.exitCode === null) return Promise.resolve(existing)
    if (existing) this.stop(key)
    const handle = this.start(key, cwd)
    this.handles.set(key, handle)
    return handle.agent.then(() => handle)
  }

  private start(key: string, cwd: string): Handle {
    const serverUrl = this.serverUrl().replace(/\/+$/, '')
    if (!serverUrl) throw new Error('server.url 未配置: 封面智能体无法启动')
    const patchPath = this.ensureCoverPatch(serverUrl)
    const home = join(this.channelHome, 'cover-agent-home')
    mkdirSync(home, { recursive: true })
    ensureCoverSkill(this.channelHome)
    const bin = resolveDshBin()
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: home,
      TINTIN_SERVER_API_KEY: 'sk-tintin-local',
    }
    const child = spawn(process.execPath, [bin, '--profile', 'acp', '--patch', patchPath], {
      cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) this.log(`[cover-agent-stderr] ${text.slice(0, 500)}`)
    })
    let settleAgent!: (impl: { prompt(text: string): Promise<{ stopReason: string }> }) => void
    let failAgent!: (error: Error) => void
    const agent = new Promise<{ prompt(text: string): Promise<{ stopReason: string }> }>((resolve, reject) => {
      settleAgent = resolve; failAgent = reject
    })
    const handle: Handle = { cwd, sessionId: null, child, agent, conn: null, init: null, session: null }
    const forward = (update: unknown) => {
      const u = update as { sessionUpdate?: string } | null
      this.onEvent?.({ key, event: { kind: 'update', update: { sessionUpdate: String(u?.sessionUpdate ?? 'unknown'), ...(update as Record<string, unknown>) } } })
    }

    const started = (async () => {
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>,
      )
      const conn = acp.client({ name: CLIENT_INFO.name })
        .onRequest(acp.methods.client.session.requestPermission, () =>
          new Promise((resolve) => { resolve({ action: 'allow_always' as const }) }))
        .onRequest(acp.methods.client.elicitation.create, () =>
          new Promise((resolve) => { resolve({ action: 'decline' as const }) }))
        .onNotification(acp.methods.agent.session.update, (update) => forward(update))
      handle.conn = { agent: conn }
      const init = (await conn.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: CLIENT_INFO,
      })) as Handle['init']
      handle.init = init
      const session = (await conn.agent.request(acp.methods.agent.session.new, {
        cwd, mcpServers: [],
      })) as Record<string, unknown>
      handle.session = session
      handle.sessionId = String(session.sessionId ?? '')
      settleAgent({
        prompt: async (text: string) => {
          const result = (await conn.agent.request(acp.methods.agent.session.prompt, {
            sessionId: handle.sessionId, prompt: [{ type: 'text', text }],
          })) as { stopReason?: string }
          return { stopReason: String(result?.stopReason ?? 'end_turn') }
        },
      })
    })().catch((e) => { failAgent(e instanceof Error ? e : new Error(String(e))) })

    return handle
  }

  private ensureCoverPatch(serverUrl: string): string {
    const dir = join(this.channelHome, 'tintin')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'cover-agent.patch.yml')
    const text = coverAgentPatchText(serverUrl)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text, 'utf8')
    return path
  }
}
