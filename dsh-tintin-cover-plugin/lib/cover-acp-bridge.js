// cover-acp-bridge — 封面制作 ACP 会话桥(CA-1/CA-2,2026-10-27 用户裁决:编辑器内嵌
// 视频剪辑同款 agent 会话;2026-10-28 重写对齐 film-acp.ts 能力面)。
// 单会话(key='cover'):spawn `dsh --profile acp`(模型路由到 TinTin 服务端),
// initialize → session/new(或 resume)→ session/prompt;语义事件(更新/权限/提问/退出/
// 完成)经订阅流出(SSE 轮询兜底由路由侧承载);权限与提问路由给聊天卡回答。
// 会话驱动:服务端 MCP(comfygen 生图)+ fs 工具(cover.props.json 图层编辑)+
// curl 编辑器 API(令牌旁路,导出/生成)——词汇见 skills/cover/SKILL.md。
// 依赖懒加载:@agentclientprotocol/sdk 与 @deepseek-ai/dsh 经兄弟插件目录解析
// (dev=仓库根/dsh-plugin-desktop-tintin;打包=node_modules 内同级,同一相对布局)。
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import { migrateCoverSkillsHome } from 'dsh-tintin-shared/lib/skills-install.js'

const require_ = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const errText = (e) => (e instanceof Error ? e.message : String(e))

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  elicitation: { form: {} },
  session: { notices: {} },
}
const CLIENT_INFO = { name: 'tintin-cover', title: 'TinTin Cover Editor' }
const RING_CAP = 2000

/** 会话令牌:agent 子进程环境持有,编辑器 API 路由据此放行 loopback 无 Origin 的调用 */
export const agentToken = randomUUID()

let sdkCache = null
function acpSdk() {
  if (sdkCache) return sdkCache
  // require(id, { paths }) 的 paths 只影响 resolve 不影响加载(Node 22 实测)——先 resolve 拿绝对路径再加载
  const paths = [join(here, '..', '..', 'dsh-plugin-desktop-tintin')]
  sdkCache = require_(require_.resolve('@agentclientprotocol/sdk', { paths }))
  return sdkCache
}
function dshBin() {
  const paths = [join(here, '..', '..', 'dsh-plugin-desktop-tintin')]
  const manifest = require_.resolve('@deepseek-ai/dsh/package.json', { paths })
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  const bin = typeof pkg.bin === 'object' && pkg.bin !== null ? pkg.bin.dsh : pkg.bin
  if (typeof bin !== 'string' || !bin) throw new Error('@deepseek-ai/dsh 无 dsh 可执行文件')
  return join(dirname(manifest), bin)
}

export function dshBinExists() {
  try { dshBin(); return true } catch { return false }
}

/** 兜底模型清单(仅服务端 /v1/models 不可达时保会话可启动;正常以标准接口拉取为准) */
const COVER_AGENT_FALLBACK_MODELS = [
  { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
  { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
]

/** 标准模型列表(2026-10-29 用户裁决:模型列表唯一接口=服务端标准 GET /v1/models;
 *  /llm/models 等遗留接口退役。失败返回 null,调用方用兜底清单) */
async function fetchStandardModels(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/v1/models`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    const models = (Array.isArray(body?.data) ? body.data : [])
      .filter((m) => typeof m?.id === 'string' && m.id)
      .map((m) => ({ id: m.id, name: typeof m?.name === 'string' && m.name ? m.name : m.id }))
    return models.length ? models : null
  } catch { return null }
}

/** 模型路由补丁(与 film 同源:服务端 openai-completions;权限全放行走聊天卡之外的兜底) */
function writePatch(state, models) {
  const dir = join(state.channelHome, 'tintin')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'cover-agent.patch.yml')
  /* 2026-10-30 用户裁决:默认(首个)模型显示名=TinTin智能体 —— 选择器按钮与模型行
     显示角色名而不是裸模型 id(同影片侧做法);模型路由与其余模型行不动。 */
  const rows = models
    .map((m, i) => `          - id: ${m.id}\n            name: ${i === 0 ? 'TinTin智能体' : m.name}`)
    .join('\n')
  const text = [
    '# TinTin 封面智能体: 模型路由到 TinTin 服务端(openai-completions)',
    '# 由桌面端生成; 手改会被下次启动覆盖.',
    '# 服务端 MCP 工具箱(rc.2 会话参数挂载失效, 补丁行挂载; 工具名 mcp__tintin-server__*):',
    "- id: mcp-tintin-server",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: tintin-server',
    '    transport: streamable-http',
    `    url: ${state.serverUrl.replace(/\/+$/, '')}/mcp`,
    '    failOnStartupError: true',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      tintin-server:',
    '        displayName: TinTin',
    '        apiKeyEnv: TINTIN_SERVER_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${state.serverUrl}/llm`,
    '        models:',
    rows,
    '- id: acp',
    '  config:',
    '    provider: tintin-server',
    `    model: ${models[0].id}`,
    '',
  ].join('\n')
  /* 权限不放行(与 film 终态同口径):requestPermission 路由给聊天卡,由用户在会话里回答 */
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text, 'utf8')
  return path
}

/** 用户级技能(技能管理装位=<渠道主目录>/cover-skills,2026-10-31 收紧裁决:封面专属目录,
 *  旧通用装位 skills 由 migrateCoverSkillsHome 幂等搬入)整目录复制进 agent home,启动时刷新——
    智能体因此能调用已安装的生成图/封面/视频族技能;与插件自带同名时插件自带在后写入获胜。 */
function syncUserSkills(state) {
  try { migrateCoverSkillsHome(state.channelHome) } catch { /* 迁移失败不阻断注入 */ }
  const dir = join(state.channelHome, 'cover-skills')
  if (!existsSync(dir)) return 0
  const target = join(state.channelHome, 'cover-agent-home', 'skills')
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(join(dir, entry.name, 'SKILL.md'))) continue
    try { cpSync(join(dir, entry.name), join(target, entry.name), { recursive: true }); count += 1 } catch { /* 单技能故障不断链 */ }
  }
  return count
}

/** 技能注入:skills/cover/SKILL.md → agent home;动态附录(服务端/编辑器 API/令牌)拼在文末 */
function ensureCoverSkill(state) {  const sources = [
    join(here, '..', '..', 'dsh-tintin-cover-plugin', 'skills', 'cover', 'SKILL.md'),
    join(process.resourcesPath ?? '', 'skills', 'cover', 'SKILL.md'),
  ]
  const src = sources.find((p) => existsSync(p))
  const target = join(state.channelHome, 'cover-agent-home', 'skills', 'cover')
  mkdirSync(target, { recursive: true })
  const base = src ? readFileSync(src, 'utf8') : '# TinTin 封面智能体技能(源文件缺失,仅环境附录)\n'
  const appendix = [
    '',
    '<!-- tintin-cover-bridge: 动态环境(每次会话启动重写) -->',
    `- TinTin 服务端: ${state.serverUrl}(API key 环境变量 TINTIN_SERVER_API_KEY)`,
    /* 2026-10-30 用户报障「一次请求烧几块钱 token」:基址必须带 /tintin/cover/api
       前缀(裸 origin 全部 404→模型重试 360 次×全上下文计费);并明示 TINTIN_COVER_API。 */
    `- 编辑器 API 基址: ${state.apiOrigin ? `${state.apiOrigin}/tintin/cover/api` : '(未知,即环境变量 TINTIN_COVER_API)'}(POST 需带头 x-tintin-cover-agent: ${agentToken};此基址与环境变量 TINTIN_COVER_API 相同)`,
    `- 会话工作目录 = 封面工作目录(cover/);图层状态读 cover.props.json`,
    '',
  ].join('\n')
  writeFileSync(join(target, 'SKILL.md'), base + appendix, 'utf8')
}

// ── ACP 表单 → 聊天问题清单(官方 formQuestions 移植,与 film-acp.ts 同口径) ──

function formQuestions(params) {
  if (params?.mode !== undefined && params.mode !== 'form') return null
  const properties = params?.requestedSchema?.properties
  if (!properties || typeof properties !== 'object') return null
  const entries = Object.entries(properties)
  const customOf = new Map()
  for (const [id, prop] of entries) {
    const target = prop?._meta?._askUserQuestionCustomAnswer?.questionId
      ?? (prop?._meta?.codex?.role === 'user_note' ? prop._meta.codex.questionId : undefined)
    if (typeof target === 'string' && properties[target]) customOf.set(target, id)
  }
  const custom = new Set(customOf.values())
  const fields = entries.filter(([id]) => !custom.has(id))
  if (fields.length === 0) return null
  const questions = []
  for (const [id, prop] of fields) {
    const multi = prop?.type === 'array'
    const choices = multi ? (prop.items?.anyOf ?? prop.items?.oneOf) : (prop?.oneOf ?? prop?.anyOf)
    const options = Array.isArray(choices)
      ? choices.filter((c) => typeof c?.const === 'string').map((c) => ({ label: String(c.const), ...(c.description ? { description: String(c.description) } : {}) }))
      : Array.isArray(prop?.enum) ? prop.enum.filter((v) => typeof v === 'string').map((label) => ({ label })) : []
    if (prop?.type !== 'string' && !multi) return null
    if (multi && options.length === 0) return null
    const codex = Boolean(prop?._meta?.codex)
    const title = typeof prop?.title === 'string' && prop.title ? prop.title : null
    const description = typeof prop?.description === 'string' && prop.description ? prop.description : null
    const question = codex
      ? title ?? description ?? (typeof params.message === 'string' ? params.message : '') ?? id
      : description ?? (fields.length === 1 && typeof params.message === 'string' ? params.message : title ?? (typeof params.message === 'string' ? params.message : '') ?? id)
    const header = codex ? description : title
    questions.push({ id, question: String(question), header: header && header !== question ? header : null, options, customId: customOf.get(id) ?? null, multi })
  }
  return questions
}

function formContent(questions, answers) {
  const content = {}
  for (const q of questions) {
    const a = answers?.[q.id]
    if (!a) continue
    if (typeof a.label === 'string' && q.options.some((o) => o.label === a.label)) {
      content[q.id] = q.multi ? [a.label] : a.label
    } else if (typeof a.text === 'string' && a.text.trim()) {
      const text = a.text.trim()
      if (q.customId) content[q.customId] = text
      else if (q.options.length === 0) content[q.id] = text
    }
  }
  return content
}

// ── 会话状态 ─────────────────────────────────────────────────────────────

const state = {
  ready: false,
  child: null,
  conn: null,
  sessionId: null,
  cwd: null,
  serverUrl: '',
  channelHome: '',
  apiOrigin: '',
  steering: false,
  init: null,
  session: null,
  /* 事件环(SSE 断线重放)+ 活订阅 */
  seq: 0,
  ring: [],
  subscribers: new Set(),
  /* 待答的权限/提问(requestId → resolve) */
  permissions: new Map(),
  questions: new Map(),
  /* 轮次缓存(页面重载恢复;聊天 ack 后清除) */
  turns: new Map(),
  currentTurnId: null,
  stderr: '',
}

export function isRunning() {
  return state.ready && state.child !== null && state.child.exitCode === null
}

/** 编辑器 API 基址(acp-start 路由从请求头捕获,进 agent 环境供 curl) */
export function setApiOrigin(origin) {
  if (typeof origin === 'string' && origin) state.apiOrigin = origin.replace(/\/+$/, '')
}

function emit(event) {
  const entry = { seq: ++state.seq, event }
  state.ring.push(entry)
  if (state.ring.length > RING_CAP) state.ring.splice(0, state.ring.length - RING_CAP)
  const turn = state.currentTurnId ? state.turns.get(state.currentTurnId) : null
  if (turn) turn.events.push({ ...event, kind: event.kind })
  for (const sub of state.subscribers) {
    try { sub(entry) } catch { /* 单个订阅者故障不杀通道 */ }
  }
}

/** 订阅实时事件(路由侧 SSE);返回退订函数。`since` 给断线重放起点。 */
export function subscribe(listener, since = 0) {
  state.subscribers.add(listener)
  const replay = state.ring.filter((e) => e.seq > since)
  for (const entry of replay) {
    try { listener(entry) } catch { /* 重放失败忽略 */ }
  }
  return () => { state.subscribers.delete(listener) }
}

export function lastEventSeq() {
  return state.seq
}

// ── 会话生命周期 ─────────────────────────────────────────────────────────

/**
 * 启动(或续接)封面会话。
 * @returns {Promise<{ok:true,key:string,info:object}|{ok:false,error:string}>}
 */
export async function startSession({ cwd, serverUrl, channelHome }) {
  if (isRunning() && state.cwd === cwd) return { ok: true, key: 'cover', info: sessionInfo() }
  stopSession()
  if (!serverUrl) return { ok: false, error: 'server.url 未配置: 封面智能体无法启动' }
  state.serverUrl = String(serverUrl).replace(/\/+$/, '')
  state.channelHome = channelHome
  state.cwd = cwd
  const sdk_ = acpSdk()
  const bin = dshBin()
  const models = (await fetchStandardModels(state.serverUrl)) ?? COVER_AGENT_FALLBACK_MODELS
  const patch = writePatch(state, models)
  mkdirSync(join(state.channelHome, 'cover-agent-home'), { recursive: true })
  syncUserSkills(state)
  ensureCoverSkill(state)
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    /* 2026-10-29 用户裁决:完全权限——基础补丁按此 env 映射 沙箱 danger-full-access + 审批 never(缺它=每次会话重新要权限,审批卡没接住即永挂) */
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_HOME: join(state.channelHome, 'cover-agent-home'),
    TINTIN_SERVER_API_KEY: 'sk-tintin-local',
    TINTIN_SERVER_URL: state.serverUrl,
    ...(state.apiOrigin ? { TINTIN_COVER_API: `${state.apiOrigin}/tintin/cover/api` } : {}),
    TINTIN_COVER_AGENT_TOKEN: agentToken,
  }
  state.child = spawn(process.execPath, [bin, '--profile', 'acp', '--patch', patch], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  state.stderr = ''
  /* 退出看门狗(2026-10-30 用户报障「正在处理无消息」):agent 静默死亡时,挂起的
     session/prompt 请求永远不会落定(轮次卡「正在处理」)——每次 spawn 挂一个 exit
     Promise,prompt 用它竞速;死亡必现在统一日志(此前 wasReady=false 时完全静默)。 */
  state.exitWaiter = new Promise((resolve) => {
    state.child.once('exit', (code) => {
      const wasReady = state.ready
      state.ready = false
      state.conn = null
      console.warn(`[cover-agent] exit code=${code} wasReady=${wasReady} stderr=${state.stderr.slice(-400)}`)
      if (wasReady) emit({ key: 'cover', kind: 'exit', code: code ?? null, stderr: state.stderr.slice(-2000) })
      resolve({ code: code ?? null })
    })
  })

  // 行过滤(2026-10-29 回归修复):dsh 偶发往 stdout 打非 JSON-RPC 行(日志/横幅),
  // ndJsonStream 逐行解析时被当成通知 → SDK 抛 "Unknown ACP notification method
  // 'undefined'" → 整个回合报错。只放行结构合法的协议行,其余转统一日志。
  const protocolOnly = new TransformStream({
    /* web TransformStream 的 transform 只有 (chunk, controller) 两个参数:完成=同步返回,
       没有 done 回调(那是 node:stream 的 stream.Transform 签名,混用=done is not a function)。 */
    transform(chunk, controller) {
      /* 链路位置在 TextDecoderStream 与 TextEncoderStream 之间:入/出都是字符串,
         enqueue 字节会经 TextEncoderStream 二次编码成垃圾(2026-10-29 实证)。 */
      this._buf = (this._buf ?? '') + chunk
      let i
      while ((i = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, i).trim()
        this._buf = this._buf.slice(i + 1)
        if (!line) continue
        let ok = false
        try {
          const parsed = JSON.parse(line)
          ok = Boolean(parsed && typeof parsed === 'object' && (parsed.method !== undefined || parsed.id !== undefined || parsed.result !== undefined))
        } catch { /* 非 JSON:丢弃并记日志 */ }
        if (ok) controller.enqueue(line + '\n')
        else console.warn('[cover-acp] dropped non-protocol line:', line.slice(0, 200))
      }
    },
  })
  const agentOut = Readable.toWeb(state.child.stdout).pipeThrough(new TextDecoderStream()).pipeThrough(protocolOnly).pipeThrough(new TextEncoderStream())
  const stream = sdk_.ndJsonStream(
    Writable.toWeb(state.child.stdin),
    agentOut,
  )
  state.conn = sdk_.client({ name: CLIENT_INFO.name })
    .onRequest(sdk_.methods.client.session.requestPermission, (ctx) => new Promise((resolve) => {
      const requestId = randomUUID()
      state.permissions.set(requestId, resolve)
      emit({
        key: 'cover', kind: 'permission', requestId,
        params: {
          toolCall: { title: String(ctx.params.toolCall?.title ?? '') },
          options: (ctx.params.options ?? []),
        },
      })
    }))
    .onRequest(sdk_.methods.client.elicitation.create, (ctx) => new Promise((resolve) => {
      const questions = formQuestions(ctx.params)
      if (!questions) { resolve({ action: 'decline' }); return }
      const requestId = randomUUID()
      state.questions.set(requestId, { resolve, questions })
      emit({ key: 'cover', kind: 'question', requestId, message: String(ctx.params.message ?? ''), toolCallId: null, questions })
    }))
    .onRequest(sdk_.methods.client.fs.writeTextFile, () => ({}))
    .onRequest(sdk_.methods.client.fs.readTextFile, () => ({ content: '' }))
    .onNotification(sdk_.methods.client.session.update, (ctx) => {
      const update = ctx.params.update
      emit({ key: 'cover', kind: 'update', update: { sessionUpdate: String(update?.sessionUpdate ?? 'unknown'), ...update } })
    })
    .connect(stream)

  /* 握手与退出竞速(2026-10-30 崩溃窗口实证):子进程秒退时 initialize/session 阻塞
     永挂,发送侧只剩「正在处理」死路 —— 任一握手请求与 exitWaiter 竞速,死了立刻报错。 */
  const raceExit = (p) => Promise.race([
    p,
    state.exitWaiter.then(({ code }) => {
      throw new Error(`agent 进程在握手期间退出(code ${code ?? 'null'})。stderr 尾部: ${state.stderr.slice(-300)}`)
    }),
  ])
  const init = await raceExit(state.conn.agent.request(sdk_.methods.agent.initialize, {
    protocolVersion: sdk_.PROTOCOL_VERSION,
    clientCapabilities: CLIENT_CAPABILITIES,
    clientInfo: CLIENT_INFO,
  }))
  state.init = init
  state.steering = init?._meta?.steering?.supported === true
  /* MCP 挂载走补丁行(2026-10-30):rc.2 会话参数挂载死路, writePatch 已补 dsh-mcp-client
     行;此键仍是 schema 必需 —— 留空数组防双挂同名冲突。 */
  const params = { cwd, mcpServers: [] }
  let sessionId = state.sessionId
  if (sessionId) {
    const resumed = await raceExit(state.conn.agent.request(sdk_.methods.agent.session.resume, { ...params, sessionId })).then((r) => r, () => null)
    if (resumed) { sessionId = resumed.sessionId; state.session = resumed }
    else sessionId = null
  }
  if (!sessionId) {
    const created = await raceExit(state.conn.agent.request(sdk_.methods.agent.session.new, params))
    sessionId = created.sessionId
    state.session = created
  }
  state.sessionId = String(sessionId)
  state.ready = true
  return { ok: true, key: 'cover', info: sessionInfo() }
}

/** 会话信息(聊天侧 start 的返回;LocalAgentSessionInfo 形状) */
function sessionInfo() {
  const session = state.session ?? {}
  const available = Array.isArray(session.models?.availableModels) ? session.models.availableModels : []
  return {
    sessionId: state.sessionId ?? '',
    resumed: false,
    ...(state.steering ? { steering: true } : {}),
    agentInfo: state.init?.agentInfo ?? null,
    authMethods: [],
    mcp: false,
    models: available.length ? {
      availableModels: available.map((m) => ({
        modelId: String(m.modelId ?? m.id ?? ''),
        name: String(m.name ?? m.modelId ?? ''),
        ...(m.description ? { description: String(m.description) } : {}),
      })),
      currentModelId: String(session.models?.currentModelId ?? available[0]?.modelId ?? ''),
    } : null,
    modes: null,
    configOptions: Array.isArray(session.configOptions) ? session.configOptions : null,
  }
}

/**
 * 发送对话消息(整轮结束落定)。
 * @returns {Promise<{ok:true,stopReason:string}|{ok:false,error:string}>}
 */
export async function prompt(text, meta, images) {
  if (!state.ready || !state.conn) {
    /* 自愈(2026-10-30 用户报障:会话死亡后首轮「正在处理」死路)——agent 进程死亡后
       不再返回死路错误,而是用保留的启动参数自动重启一次并继续本条消息。 */
    console.warn('[cover-agent] prompt 时会话未就绪,自动重启…')
    const restarted = await startSession({ cwd: state.cwd, serverUrl: state.serverUrl, channelHome: state.channelHome })
    if (!restarted.ok) return { ok: false, error: `ACP 会话未启动(自动重启失败):${restarted.error}` }
  }
  const sdk_ = acpSdk()
  const turnId = typeof meta?.turnId === 'string' && meta.turnId ? meta.turnId : randomUUID()
  const turn = state.turns.get(turnId) ?? {
    key: 'cover', agent: 'deepseek', cwd: state.cwd, meta: meta ?? null, done: null, events: [],
  }
  state.turns.set(turnId, turn)
  state.currentTurnId = turnId
  try {
    const blocks = [{ type: 'text', text }, ...((images ?? []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType })))]
    const result = await Promise.race([
      state.conn.agent.request(sdk_.methods.agent.session.prompt, {
        sessionId: state.sessionId, prompt: blocks,
      }),
      state.exitWaiter.then(({ code }) => {
        throw new Error(`agent 进程退出(code ${code ?? 'null'})——轮次中止。stderr 尾部: ${state.stderr.slice(-300)}`)
      }),
    ])
    const stopReason = String(result?.stopReason ?? 'end_turn')
    turn.done = { ok: true, stopReason }
    emit({ key: 'cover', kind: 'done', turnId, ok: true, stopReason })
    return { ok: true, stopReason }
  } catch (e) {
    const message = errText(e)
    turn.done = { ok: false, error: message }
    emit({ key: 'cover', kind: 'done', turnId, ok: false, error: message })
    return { ok: false, error: message }
  } finally {
    state.currentTurnId = null
  }
}

/** 插话(ACP 报告支持 steering 才发;否则明确不支持) */
export async function steer(text, images) {
  if (!state.ready || !state.conn || !state.steering) return { ok: false, outcome: 'not-supported' }
  const sdk_ = acpSdk()
  const blocks = [{ type: 'text', text }, ...((images ?? []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType })))]
  await state.conn.agent.notify(sdk_.methods.agent.session.prompt, { sessionId: state.sessionId, prompt: blocks })
  return { ok: true, outcome: 'queued' }
}

/** 取消进行中的一轮(session/cancel 通知;进程与会话保留) */
export async function cancel() {
  if (!state.ready || !state.conn) return { ok: false }
  await state.conn.agent.notify(acpSdk().methods.agent.session.cancel, { sessionId: state.sessionId })
  return { ok: true }
}

/** 会话配置项切换(模型/思考档;官方 setOption 直通) */
export async function setOption(configId, value) {
  if (!state.ready || !state.conn) return { ok: false, error: '会话未启动' }
  try {
    const result = await state.conn.agent.request(acpSdk().methods.agent.session.setConfigOption, {
      sessionId: state.sessionId, configId, value,
    })
    return { ok: true, ...(result ? { result } : {}) }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

export async function answerPermission(requestId, optionId) {
  const pending = state.permissions.get(requestId)
  if (!pending) return { ok: false }
  state.permissions.delete(requestId)
  pending(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
  return { ok: true }
}

export async function answerQuestion(requestId, answers) {
  const pending = state.questions.get(requestId)
  if (!pending) return { ok: false }
  state.questions.delete(requestId)
  if (answers === null) pending.resolve({ action: 'decline' })
  else pending.resolve({ action: 'accept', content: formContent(pending.questions, answers) })
  return { ok: true }
}

/** 结束智能体进程(会话已持久,下次 start 以 resume 续上) */
export function stopSession() {
  try { state.child?.kill() } catch { /* 已退出 */ }
  state.child = null
  state.conn = null
  state.ready = false
}

/** 轮次回执(页面重载恢复;官方 localAgents.running 语义) */
export function runningTurns() {
  return [...state.turns.values()].map((turn) => ({ ...turn, events: [...turn.events] }))
}

/** 聊天已把该轮接回显示:丢弃缓存 */
export function ackTurn(turnId) {
  state.turns.delete(turnId)
}
