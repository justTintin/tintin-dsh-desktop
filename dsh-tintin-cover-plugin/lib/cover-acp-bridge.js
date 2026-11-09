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

/** 回合工具调用护栏(2026-11-01 防空转第 2 步;与影片侧 film-acp.ts 的 TOOL_CALL_GUARD
 *  同款同值——校准依据 docs/tintin-agent-pipeline.md §6: 实测正常回合 32 次 → 上界约 40,
 *  硬限=×1.5=60;轮询类(task_status_unified)按任务预算管理不计入。40 告警/60 中止本回合。 */
const TOOL_CALL_GUARD = { warn: 40, stop: 60 }
const isPollingToolCall = (title) => typeof title === 'string' && /__task_status_unified$/.test(title)

/** 计一步并裁决动作;状态挂在 state.guard(prompt 建立、done 清除)。 */
function bumpGuard() {
  const g = state.guard
  if (!g) return
  g.count += 1
  if (g.count >= TOOL_CALL_GUARD.stop) {
    emit({ key: 'cover', kind: 'limit', level: 'stop', toolCalls: g.count, limit: TOOL_CALL_GUARD.stop })
    cancel().catch(() => { /* 会话已死则无事可做 */ })
    return
  }
  if (g.count >= TOOL_CALL_GUARD.warn && !g.warned) {
    g.warned = true
    emit({ key: 'cover', kind: 'limit', level: 'warn', toolCalls: g.count, limit: TOOL_CALL_GUARD.warn })
  }
}

/** 任务层兜底(2026-11-01 防空转第 3 步, 与影片侧 film-acp.ts 同款):桥登记 create_* 异步
 *  任务的 task_id 并看门狗提醒——模型放弃轮询或会话中断后任务不再失踪。 */
const ASYNC_TASK_BUDGET_MINUTES = 30
const ASYNC_CREATE_TOOL_SUFFIXES = ['create_video', 'create_image', 'create_digital_human']
const isAsyncCreateTool = (title) => typeof title === 'string' && ASYNC_CREATE_TOOL_SUFFIXES.some((s) => title.endsWith(s))

/** 服务端任务 id=<1-3 小写字母>_+8 位十六进制(可带 -序号, 如 c_5ce35516-0;产物命名 bgm-/img- 等用连字符不会误中)。 */
function extractAsyncTaskIds(text) {
  const ids = new Set()
  const explicit = /task_id["'\s:=]+([A-Za-z0-9_-]{6,})/g
  for (let m = explicit.exec(text); m; m = explicit.exec(text)) ids.add(m[1])
  const bare = /\b[a-z]{1,3}_[0-9a-f]{8}(?:-[0-9A-Za-z]+)?\b/g
  for (let m = bare.exec(text); m; m = bare.exec(text)) ids.add(m[0])
  return [...ids]
}

const TASK_SETTLED_RE = /(completed|succeeded|failed|cancelled|done\b)/i

/** 从 tool_call_update 观察异步任务: create_* 结果提取 task_id 登记; 终态词+id 同现=结算。 */
function noteAsyncTask(update) {
  if (!update || update.sessionUpdate !== 'tool_call_update') return
  const text = typeof update.content === 'string' ? update.content : JSON.stringify(update.content ?? '')
  const title = state.toolNames.get(String(update.toolCallId ?? '')) ?? ''
  if (isAsyncCreateTool(title)) {
    for (const id of extractAsyncTaskIds(text)) {
      if (!state.asyncTasks.has(id)) state.asyncTasks.set(id, { tool: title, createdAt: Date.now(), settled: false, reminded: false })
    }
  }
  if (TASK_SETTLED_RE.test(text)) {
    for (const [id, entry] of state.asyncTasks) if (!entry.settled && text.includes(id)) entry.settled = true
  }
}

/* 看门狗: 超预算未观察到终态 → task-stale 事件+日志, 只提醒一次。 */
setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of state.asyncTasks) {
    if (entry.settled || entry.reminded) continue
    const ageMinutes = Math.round((now - entry.createdAt) / 60000)
    if (ageMinutes < ASYNC_TASK_BUDGET_MINUTES) continue
    entry.reminded = true
    console.warn(`[cover-agent][task-stale] ${entry.tool} 任务 ${id} 超过 ${ASYNC_TASK_BUDGET_MINUTES} 分钟未观察到终态(已 ${ageMinutes} 分钟)`)
    emit({ key: 'cover', kind: 'task-stale', taskId: id, tool: entry.tool, ageMinutes })
  }
}, 60_000)

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

/** 编排工作纪律(2026-11-01 用户裁决:防空转/费用护栏第一步, 与影片侧 FILM_AGENT_WORK_RULES 同款)。
 *  生成唯一出口=服务端 MCP 工具、异步必轮询且有上限、失败重试封顶、禁本地自制生成物 ——
 *  进补丁 system-prompt.personaPrefix, 每轮可见(技能文档是按需引用, 约束力不如 system-prompt)。 */
const COVER_AGENT_WORK_RULES = [
  '你是 TinTin 封面工作台的编排智能体。工作纪律(每轮遵守):',
  '1. 生成图片/封面唯一出口是服务端 MCP 工具 create_image(mode=t2i 文生图 / mode=cover 封面图生图); 禁止用 curl/pwsh 直调服务端 /generate/* 端点, 也禁止用代码、HTML/canvas、写文件等本地方式自制生成物(2026-11-01 端到端验收实录: 模型曾按技能文档旧端点指引绕行 REST, 生成仍在服务端但工具面失控——历史 REST 端点指引一律以本条为准)。',
  '2. 异步任务(返回 task_id)必须用 task_status_unified 轮询到终态: 两次轮询间隔 ≥5 秒; 任务预算 30 分钟, 到终态或超预算即停, 超时如实报告 task_id 供续查; 终态 failed 时把服务端错误原样转告并给一条修改建议, 同一任务重试最多 2 次, 禁止无限重试。',
  '3. 修改封面一律写 cover.props.json(origin=agent), 图层协议遵循 cover 技能文档; 调用编辑器 API 必须带 x-tintin-cover-agent 令牌头, 基址以技能文档动态附录为准(带 /tintin/cover/api 前缀, 裸 origin 全部 404)。',
  '4. 需求缺关键要素(主体/风格/画幅/文案)先问清再生成; 与封面无关的请求如实说明, 不虚构能力。',
  '5. 始终用简短中文回复。',
  '6. 完成判据(2026-11-04 感知闭环): 凡改动 cover.props.json 或产出/落位图片, 必须先 mcp__cover-tools__render_preview 渲染并查看预览图, 确认文字不溢出/图层位置符合要求/画面成立后才向用户报告完成; 禁止不看结果就宣称完成(2026-11-04 事故: 无看图通道时模型自创像素扫描死循环 43 连)。',
  '7. 多步任务(生成/抠图/改版式/导出)动手前先用一句话列出计划(用哪个模板、几步); 中途变更计划要说明。',
].join('\n')

/** 模型路由补丁(与 film 同源:服务端 openai-completions;权限全放行走聊天卡之外的兜底)。
 *  按智能体分文件(2026-10-31 用户裁决:名册双智能体):tintin-agent=首个模型显示名
 *  品牌化为「TinTin智能体」;deepseek=原生模型名(不品牌化)。 */
function writePatch(state, models, agent = 'deepseek') {
  const dir = join(state.channelHome, 'tintin')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, agent === 'deepseek' ? 'cover-deepseek-agent.patch.yml' : 'cover-agent.patch.yml')
  /* 2026-10-30 用户裁决:默认(首个)模型显示名=TinTin智能体 —— 选择器按钮与模型行
     显示角色名而不是裸模型 id(同影片侧做法);deepseek 角色保持原生名。
     2026-11-04 感知闭环:模型行声明 input:[text,image](llm-pi-ai schema=config.ts
     `input`)——缺省=纯文本,会话不广播 inline image prompts,用户附图在 ACP 协议层
     被「inline image prompts were not advertised」拒绝(1104 事故总根因:智能体从未
     见过用户图)。服务端 /llm 已 caption-then-main,声明即真。 */
  const rows = models
    .map((m, i) => `          - id: ${m.id}\n            name: ${agent === 'tintin-agent' && i === 0 ? 'TinTin智能体' : m.name}\n            input: [text, image]`)
    .join('\n')
  /* 工作纪律进 system-prompt(与 film-acp.ts personaLines 同格式) */
  const personaLines = [
    '- id: system-prompt',
    '  config:',
    '    personaPrefix: |-',
    ...COVER_AGENT_WORK_RULES.split('\n').map((line) => `      ${line}`),
  ]
  const text = [
    '# TinTin 封面智能体: 模型路由到 TinTin 服务端(openai-completions)',
    '# 由桌面端生成; 手改会被下次启动覆盖.',
    '# 服务端 MCP 工具箱(rc.2 会话参数挂载失效, 补丁行挂载; 工具名 mcp__tintin-server__*):',
    ...personaLines,
    /* 2026-11-01 端到端验收实锤:新行必须 insert: 包裹(顶层 - id: =更新已存在条目语义,
       mcp-tintin-server 在 base 不存在=整行被静默忽略——10-31 重构丢 insert 后封面 MCP
       一直没挂上, 模型无 create_image 可用只能 curl 绕行;照 film-acp.ts 补回) */
    '- insert:',
    '    - id: mcp-tintin-server',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: tintin-server',
    '        transport: streamable-http',
    `        url: ${state.serverUrl.replace(/\/+$/, '')}/mcp`,
    '        failOnStartupError: true',
    /* 本地工具 MCP(2026-11-04 感知闭环+工具收敛立项;2026-11-05 改道独立监听):
       渲染回看/看图/抠图链,端点=插件自起的随机 token 回环监听
       (lib/cover-tools-mcp.js startCoverToolsServer,index.js 启动并 setCoverToolsEndpoint)。
       不走 dsh webServer——其 POST 闸对非浏览器客户端 403(会话 cookie/CSRF 层,
       MCP 子进程无 cookie,Origin 也不够,1105 实测)。headers=dsh-mcp-client
       原生配置(z.dict(String)),随请求带令牌。监听未起时跳过该行,服务端工具仍可用。 */
    ...(state.coverTools ? [
      '    - id: mcp-cover-tools',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: cover-tools',
      '        transport: streamable-http',
      `        url: ${state.coverTools.url}`,
      '        headers:',
      `          x-tintin-cover-tools-token: ${state.coverTools.token}`,
      '        failOnStartupError: false',
    ] : []),
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
function syncUserSkills(state, homeName = 'cover-agent-home') {
  try { migrateCoverSkillsHome(state.channelHome) } catch { /* 迁移失败不阻断注入 */ }
  const dir = join(state.channelHome, 'cover-skills')
  if (!existsSync(dir)) return 0
  const target = join(state.channelHome, homeName, 'skills')
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(join(dir, entry.name, 'SKILL.md'))) continue
    try { cpSync(join(dir, entry.name), join(target, entry.name), { recursive: true }); count += 1 } catch { /* 单技能故障不断链 */ }
  }
  return count
}

/** 技能注入:skills/cover/SKILL.md → agent home;动态附录(服务端/编辑器 API/令牌)拼在文末。
 *  2026-11-01 用户裁决:封面协议技能随场景走 —— 默认角色 deepseek 同样注入(没有它任何
 *  角色都不知道 cover.props.json 图层协议与编辑器 API,封面会话退化为裸编码智能体)。 */
function ensureCoverSkill(state, homeName = 'cover-agent-home') {  const sources = [
    join(here, '..', '..', 'dsh-tintin-cover-plugin', 'skills', 'cover', 'SKILL.md'),
    join(process.resourcesPath ?? '', 'skills', 'cover', 'SKILL.md'),
  ]
  const src = sources.find((p) => existsSync(p))
  const target = join(state.channelHome, homeName, 'skills', 'cover')
  mkdirSync(target, { recursive: true })
  const base = src ? readFileSync(src, 'utf8') : '# TinTin 封面智能体技能(源文件缺失,仅环境附录)\n'
  const appendix = [
    '',
    '<!-- tintin-cover-bridge: 动态环境(每次会话启动重写) -->',
    `- TinTin 服务端: ${state.serverUrl}(API key 环境变量 TINTIN_SERVER_API_KEY)`,
    /* 2026-10-30 用户报障「一次请求烧几块钱 token」:基址必须带 /tintin/cover/api
       前缀(裸 origin 全部 404→模型重试 360 次×全上下文计费);并明示 TINTIN_COVER_API。
       2026-11-01 会话生成统一走 MCP create_image 后, 此基址的会话用途只剩导出 render。 */
    `- 渲染/导出/看图一律走本地工具 MCP mcp__cover-tools__*(render_preview/read_image/matting);编辑器 HTTP API 对智能体已关闭(非浏览器 POST 一律 403,2026-11-05),不要用 curl 调它`,
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
  /** 本地工具 MCP 独立监听端点(setCoverToolsEndpoint;null=监听未起,补丁不含该行) */
  coverTools: null,
  /** 当前会话的智能体(选择器 id;2026-10-31 名册双智能体;2026-11-01 默认改 deepseek) */
  agentId: 'deepseek',
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
  /* 回合工具调用护栏状态(prompt 建立, done 清除;见 bumpGuard) */
  guard: null,
  /* 任务层兜底(第 3 步):callId→工具名 与 异步任务登记表(见 noteAsyncTask) */
  toolNames: new Map(),
  asyncTasks: new Map(),
  stderr: '',
}

export function isRunning() {
  return state.ready && state.child !== null && state.child.exitCode === null
}

/** 编辑器 API 基址(acp-start 路由从请求头捕获,进 agent 环境供 curl) */
export function setApiOrigin(origin) {
  if (typeof origin === 'string' && origin) state.apiOrigin = origin.replace(/\/+$/, '')
}

/** 本地工具 MCP 独立监听端点(2026-11-04 感知闭环改道):dsh webServer 的 POST 闸
 *  对非浏览器客户端 403(会话 cookie/CSRF 层,MCP 子进程无 cookie、Origin 不够——
 *  1105 实测), 所以 cover-tools 用插件自起的随机 token 回环监听(index.js 启动,
 *  lib/cover-tools-mcp.js startCoverToolsServer);writePatch 据此生成 mcp-cover-tools
 *  行并经 dsh-mcp-client 的 headers 配置带令牌。 */
export function setCoverToolsEndpoint(endpoint) {
  state.coverTools = endpoint && endpoint.url && endpoint.token ? { url: endpoint.url, token: endpoint.token } : null
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
 * 启动(或续接)封面会话。agent=选择器里的智能体。
 * 2026-10-31 双智能体;2026-11-01 用户裁决:TinTin智能体=服务端编排智能体,服务端该功能
 * 观察期 —— 归一化只保留 deepseek(tintin-agent 请求统一落到 deepseek,人设/补丁分支保留,
 * 服务端就绪后放开)。补丁/home/会话仍按 id 分键。
 * @returns {Promise<{ok:true,key:string,info:object}|{ok:false,error:string}>}
 */
export async function startSession({ cwd, serverUrl, channelHome, agent = 'deepseek' }) {
  const agentId = 'deepseek'
  const homeName = agentId === 'deepseek' ? 'cover-deepseek-agent-home' : 'cover-agent-home'
  if (isRunning() && state.cwd === cwd && state.agentId === agentId) return { ok: true, key: 'cover', info: sessionInfo() }
  /* 跨智能体切换=人设不同,不续接对方会话;同智能体按内存会话续接 */
  const resumeId = state.agentId === agentId ? state.sessionId : null
  stopSession()
  if (!serverUrl) return { ok: false, error: 'server.url 未配置: 封面智能体无法启动' }
  state.serverUrl = String(serverUrl).replace(/\/+$/, '')
  state.channelHome = channelHome
  state.cwd = cwd
  state.agentId = agentId
  /* 跨智能体切换不续接对方会话(null=新建);同智能体续接原会话 */
  state.sessionId = resumeId
  const sdk_ = acpSdk()
  const bin = dshBin()
  const models = (await fetchStandardModels(state.serverUrl)) ?? COVER_AGENT_FALLBACK_MODELS
  const patch = writePatch(state, models, agentId)
  mkdirSync(join(state.channelHome, homeName), { recursive: true })
  syncUserSkills(state, homeName)
  ensureCoverSkill(state, homeName)
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    /* 2026-10-29 用户裁决:完全权限——基础补丁按此 env 映射 沙箱 danger-full-access + 审批 never(缺它=每次会话重新要权限,审批卡没接住即永挂) */
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_HOME: join(state.channelHome, homeName),
    /* 2026-11-01 按入口分账:占位 key 按链路分值(服务端 /llm 无鉴权不校验值, 计量按 key 分账;
       同族标记: 影片=sk-tintin-local--film, 页面 REST=sk-tintin-local--rest, 见 pipeline §6.7) */
    TINTIN_SERVER_API_KEY: 'sk-tintin-local--cover',
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
      state.lastExitCode = code ?? null
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
      /* 回合护栏(2026-11-01 防空转第 2 步, 与影片侧 film-acp.ts 同款): 逐次计非轮询类
         工具调用, 40 告警 / 60 中止本回合(cancel 不杀进程, 会话可续)。 */
      if (update?.sessionUpdate === 'tool_call') {
        state.toolNames.set(String(update.toolCallId ?? ''), String(update.title ?? ''))
        if (!isPollingToolCall(update.title)) bumpGuard()
      }
      /* 任务层兜底(第 3 步): create_* 的 task_id 登记/结算观察 */
      noteAsyncTask(update)
      emit({ key: 'cover', kind: 'update', update: { sessionUpdate: String(update?.sessionUpdate ?? 'unknown'), ...update } })
    })
    .connect(stream)

  /* 握手与退出竞速(2026-10-30 崩溃窗口实证):子进程秒退时 initialize/session 阻塞
     永挂,发送侧只剩「正在处理」死路 —— 任一握手请求与 exitWaiter 竞速,死了立刻报错。
     2026-11-09 报障「Cannot read properties of null (reading 'agent')」:exit 看门狗在
     spawn 与握手之间置 conn=null,而 p 的参数表达式(state.conn.agent.request)先于
     race 开始同步求值 → 裸 TypeError 上屏。race 内先验 conn,死了报有意义错误。 */
  const raceExit = (make) => {
    if (!state.conn) {
      return Promise.reject(new Error(`agent 进程在握手前退出(code ${state.lastExitCode ?? 'null'})。stderr 尾部: ${state.stderr.slice(-300)}`))
    }
    return Promise.race([
      make(state.conn),
      state.exitWaiter.then(({ code }) => {
        throw new Error(`agent 进程在握手期间退出(code ${code ?? 'null'})。stderr 尾部: ${state.stderr.slice(-300)}`)
    }),
  ])
  }
  /* 三个握手请求都传 make(conn):参数在 race 内求值,conn 已死时不再裸读。 */
  const init = await raceExit((conn) => conn.agent.request(sdk_.methods.agent.initialize, {
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
    const resumed = await raceExit((conn) => conn.agent.request(sdk_.methods.agent.session.resume, { ...params, sessionId })).then((r) => r, () => null)
    if (resumed) { sessionId = resumed.sessionId; state.session = resumed }
    else sessionId = null
  }
  if (!sessionId) {
    const created = await raceExit((conn) => conn.agent.request(sdk_.methods.agent.session.new, params))
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
    /* 带 state.agentId 重启(2026-11-01):不传会回落默认角色,deepseek 会话死亡自愈
       会被重启成别的角色人设(角色与默认不一致时 = 换人设续会话)。 */
    const restarted = await startSession({ cwd: state.cwd, serverUrl: state.serverUrl, channelHome: state.channelHome, agent: state.agentId })
    if (!restarted.ok) return { ok: false, error: `ACP 会话未启动(自动重启失败):${restarted.error}` }
    /* 重启后二次校验(2026-11-01 用户报障 Cannot read properties of null):startSession 返回 ok
       与实际发 prompt 之间存在竞态窗口——agent 进程可能在握手完成后立即退出(exit 看门狗置
       conn=null),此时不裸抛而是报告有意义错误。 */
    if (!state.conn || !state.ready) {
      return { ok: false, error: `封面智能体启动后立即退出(stderr: ${state.stderr.slice(-200) || '空'})——请检查服务端可达性与封面项目目录` }
    }
  }
  /* prompt 发出前再校验一次(拖动/轮询等并发操作可能在 startSession 与 prompt 之间触发 exit) */
  if (!state.conn || !state.ready) {
    return { ok: false, error: '封面智能体会话已断开——请重试(系统会自动重启)' }
  }
  const sdk_ = acpSdk()
  const turnId = typeof meta?.turnId === 'string' && meta.turnId ? meta.turnId : randomUUID()
  const turn = state.turns.get(turnId) ?? {
    key: 'cover', agent: state.agentId, cwd: state.cwd, meta: meta ?? null, done: null, events: [],
  }
  state.turns.set(turnId, turn)
  state.currentTurnId = turnId
  /* 回合护栏计数清零(每回合一个作用域;轮询类工具不计) */
  state.guard = { count: 0, warned: false }
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
    emit({ key: 'cover', kind: 'done', turnId, ok: true, stopReason, toolCalls: state.guard.count })
    return { ok: true, stopReason }
  } catch (e) {
    const message = errText(e)
    turn.done = { ok: false, error: message }
    emit({ key: 'cover', kind: 'done', turnId, ok: false, error: message, toolCalls: state.guard?.count ?? 0 })
    return { ok: false, error: message }
  } finally {
    state.currentTurnId = null
    state.guard = null
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
