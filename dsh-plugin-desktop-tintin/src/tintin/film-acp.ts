// Film agent ACP bridge (第三行形态, 2026-10-23 用户裁决): 每部影片一个
// `dsh --profile acp` 子进程(DeepSeek Harness 的自动化 ACP stdio 面), 会话持久在
// 隔离 home. 对齐官方桌面 agents.mjs 的低层用法: initialize → session/new(或 resume)
// → session/prompt, 语义更新经 onEvent 流向聊天, 审批/提问路由给聊天卡回答
// (官方 `approve: true` 的口径由聊天 UI 承接; 无人应答时不自动放行).
// 2026-11-23 用户裁决(智能体分链): 模型路由按角色分链 —— DeepSeek Harness=客户端
// 配置(dsh acp 默认 deepseek-official, 补丁不改写路由); TinTin智能体=TinTin 服务端.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { readClientDeepseekConfig } from 'dsh-tintin-shared/lib/profile-patch-rows.js'
import { acpProfileMaterialized } from 'dsh-tintin-shared/lib/dsh-acp-home.js'
import { fileOf, scheduleFilmModelLog } from './film-model-calls.ts'
import { filmDreaminaPreferOn, filmDreaminaSkillsDir } from './film-dreamina-channels.ts'

const require_ = createRequire(import.meta.url)

/** 影片可用的服务端模型(id=请求用的模型名,name=选择器展示名). */
export interface FilmAgentModels { id: string; name: string }

/** 影片会话的智能体(聊天选择器里的 agent 行)。
    2026-11-24 用户裁决「检查原来 openfilm 的默认处理,再加自定义的 TinTin智能体」:
    · deepseek(DeepSeek Harness,默认智能体)= 用户自己的 dsh —— 照上游 openfilm
      (apps/desktop/src/agents.mjs:`dsh --profile acp`,用用户自己的 home):模型/凭据/账号
      全用客户端的,补丁不改写模型路由,只挂 TinTin 的 MCP 工具箱与编排纪律。
    · tintin-agent(TinTin智能体,自定义)= dsh + TinTin 服务端模型路由(/v1/models 实拉清单),
      调度服务端子智能体(视频/图片/音乐/音频/口播/数字人生成,即服务端 /mcp 的 create_* 工具族)。
    两个智能体是两条模型链路:补丁/home/会话都按智能体分键。 */
export type FilmAgentPersona = 'deepseek' | 'tintin-agent'

/** 服务端不可达时 TinTin 智能体补丁的兜底模型清单(正常以 GET /v1/models 实拉为准)。 */
export const FILM_TINTIN_AGENT_MODELS: FilmAgentModels[] = [
  { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
  { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
]

/** TinTin 服务端模型清单(与封面侧 fetchStandardModels 同一接口:标准 GET /v1/models)。
 *  失败返回 null,调用方用兜底清单。 */
export async function fetchFilmServerModels(serverUrl: string): Promise<FilmAgentModels[] | null> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/v1/models`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json() as { data?: Array<{ id?: unknown; name?: unknown }> }
    const models = (Array.isArray(body.data) ? body.data : [])
      .filter((m) => typeof m?.id === 'string' && m.id)
      .map((m) => ({ id: m.id as string, name: typeof m?.name === 'string' && m.name ? m.name : (m.id as string) }))
    return models.length ? models : null
  } catch { return null }
}

/** TinTin智能体角色的人设(补丁 system-prompt.personaPrefix, 叠在 acp bundle 层之后覆盖同 id 行):
    调度服务端子智能体(2026-10-30 /mcp tools/list 实测 7 工具: create_video/create_image/
    create_music/create_audio(sfx|tts)/create_digital_human/task_status_unified/server_health)。
    注意: personaPrefix 是严格模板, 文本里不能出现 {{ }}。 */
export const FILM_TINTIN_AGENT_PERSONA = [
  '你是 TinTin 视频剪辑工作台的「TinTin智能体」, 负责把用户的需求派给对应的服务端子智能体完成; 不做剪辑编排, 不改时间线。',
  '可调用的子智能体(全部是服务端 MCP 工具, 按需求选择):',
  '- 视频生成 → create_video: prompt 写清画面主体+场景+运镜(1..2000 字), duration 1~10 秒, aspect 可选 9:16(缺省)/16:9/1:1, resolution 可选 720p/1080p(缺省 1080p, 单卡独占、排队属正常); 异步, 返回 task_id 后用 task_status_unified 轮询。',
  '- 图片生成 → create_image: mode=t2i(缺省, 文生图, prompt 直接出图)或 mode=cover(封面图生图: script_id/images/material_ids 三选一 + title ≤20 字 + selling_points ≤5 条); aspect 可选 9:16(缺省)/16:9/1:1/4:3; 异步任务同上轮询。',
  '- 音乐生成 → create_music: style 九选一(流行/电子/古风/纯音乐/摇滚/嘻哈/爵士/氛围/auto), mood 六选一(欢快/大气/悲伤/温馨/紧张/平静), duration 3~30 秒(缺省 20); 同步直出音频地址。',
  '- 音频生成(音效) → create_audio 且 kind=sfx: prompt 用英文描述更佳, duration 0.5~10 秒; 同步直出。',
  '- 口播生成(配音) → create_audio 且 kind=tts: text 必填(整段一次提交), sample_id 选音色(用户没给就先问清), engine 可选 indextts(缺省)/qwen3/voxcpm, lang 默认 ZH; 同步直出。',
  '- 数字人 → create_digital_human: kind=image(人物图+驱动音频→口播视频, 缺省)或 kind=lipsync(视频+驱动音频→口型同步); 文件字段传 base64; 异步任务同上轮询。',
  '通用规则:',
  '1. 异步工具拿到 task_id 后用 task_status_unified 轮询到完成; 失败时把服务端错误原样转告用户, 并给一条修改建议。',
  '1b. 等待纪律(2026-11-24 用户裁决, 成本红线): 等待异步任务期间严禁反复 Start-Sleep 短轮询——每多一步都会重发全部会话上下文计费。**首选服务端 SSE 终态推送**: 单条 pwsh 命令 curl.exe -N -sS "<服务端>/tasks/unified/<task_id>/events" 一直挂到任务到终态(流结束或事件出现 completed|failed|error 即止;视频与数字人可挂满 30 分钟预算),最后一条 data 即结果。服务端较旧无此端点(404)时, 回落单条命令内嵌轮询循环(do { curl 查询; Start-Sleep 20 } while 未终态且未超 8 分钟);两条路都超时=返回当前状态并结束本轮让用户决定。',
  '2. 每个产物取结果地址后用 curl 下载保存进当前影片项目目录 assets/tintin/(命名: 视频 vid-短时间戳.mp4 / 图片 img-*.png / 音乐 bgm-*.wav / 音效 sfx-*.wav / 口播 vo-*.wav), 回复里必须给出保存路径, 方便插入时间线。',
  '2b. 落轨纪律(2026-11-24 用户裁决「会话生成的素材应放到剪辑轨道上」): 产物落盘后**必须立即插入时间线**(openfilm CLI/film.html 编辑), 禁止只落盘不上轨; 对效果不满意也要先插上让用户看到实际效果, 去留由用户决定——不得以「效果可能不好」为由替用户跳过。',
  '3. 用户要多个结果时逐个任务生成; 需求缺关键要素(画面主体/风格/时长/画幅/音色)时先问清再生成。',
  '4. 与生成无关的请求(剪辑/编排/改时间线)如实说明这不归你, 建议切到 DeepSeek Harness(编导)。',
  '回复用简短中文, 汇报每次调用的子智能体、参数与结果路径。',
].join('\n')

/** deepseek(编导,默认角色)的编排工作纪律(2026-11-01 用户裁决:防空转/费用护栏第一步)。
 *  与角色人设不同:这是编排纪律不是身份描述 —— 生成唯一出口=服务端 MCP 工具、异步必轮询
 *  且有上限、失败重试封顶、禁本地自制生成物。TinTin智能体(禁用中)的人设已含同款纪律;
 *  默认反转到 deepseek 后该约束曾随人设一起消失,本常量把它补回每轮可见的 system-prompt。 */
export const FILM_AGENT_WORK_RULES = [
  '你是 TinTin 视频剪辑工作台的编导智能体。编排工作纪律(每轮遵守):',
  '1. 生成视频/图片/音乐/音频(音效、口播)/数字人, 唯一出口是服务端 MCP 工具 create_video / create_image / create_music / create_audio / create_digital_human; 禁止用代码、HTML/canvas、写文件等本地方式自制这些生成物。',
  '2. 异步工具(返回 task_id)必须用 task_status_unified 轮询到终态: 两次轮询间隔 ≥5 秒; 视频与数字人任务预算 30 分钟, 到终态或超预算即停, 超时如实报告 task_id 供续查; 终态 failed 时把服务端错误原样转告并给一条修改建议, 同一任务重试最多 2 次, 禁止无限重试。',
  '2b. 等待纪律(2026-11-24 用户裁决, 成本红线): 等待异步任务期间严禁每 45 秒醒来查一次——每多一步都会重发全部会话上下文计费。**首选服务端 SSE 终态推送**: 单条 pwsh 命令 curl.exe -N -sS "<服务端>/tasks/unified/<task_id>/events" 一直挂到任务到终态(流结束或事件出现 completed|failed|error 即止;视频与数字人可挂满 30 分钟预算),最后一条 data 即结果。服务端较旧无此端点(404)时, 回落单条命令内嵌轮询循环(do { curl 查询; Start-Sleep 20 } while 未终态且未超 8 分钟);两条路都超时=返回当前状态并结束本轮让用户决定。',
  '3. 同步工具(音乐/音效/口播)直接使用返回的 URL; 需要进影片的产物下载保存进项目 assets/tintin/(vid-/img-/bgm-/sfx-/vo- 前缀), 回复里报告保存路径。',
  '3b. 落轨纪律(2026-11-24 用户裁决「会话生成的素材应放到剪辑轨道上」): 产物落盘后**必须立即插入时间线**(openfilm CLI/film.html 编辑), 禁止只落盘不上轨; 对效果不满意也要先插上让用户看到实际效果, 去留由用户决定——不得以「效果可能不好」为由替用户跳过。',
  '4. 剪辑与项目操作遵循已注入的 openfilm 技能文档(openfilm CLI); 需求缺关键要素(主体/风格/时长/画幅/音色)先问清再动手。',
  '5. 与当前能力无关的请求如实说明, 不虚构能力; 始终用简短中文回复。',
].join('\n')

/** 未显式传角色时的兜底。 */
export function filmAgentPersona(value: unknown): FilmAgentPersona {
  return value === 'tintin-agent' ? 'tintin-agent' : 'deepseek'
}

/** 回合工具调用护栏(2026-11-01 防空转第 2 步;校准依据 docs/tintin-agent-pipeline.md §6):
 *  实测正常多产物回合 32 次 → 上界约 40;硬限=上界×1.5=60(失控模式 360 次量级,间隔一个数量级)。
 *  触发行为:40 告警事件 / 60 中止本回合(session/cancel, 进程与会话保留, 可续)——不是静默死路。 */
export const TOOL_CALL_GUARD = { warn: 40, stop: 60 } as const

/** 轮询类工具(task_status_unified)按任务预算时长管理(工作纪律第 2 条), 不计入护栏计数。
 *  ACP 投影里工具名在 update.title(MCP 公开名 mcp__tintin-server__<raw>)。 */
export function isPollingToolCall(title: unknown): boolean {
  return typeof title === 'string' && title.endsWith('__task_status_unified')
}

export type ToolCallGuardState = { count: number; warned: boolean }

/** 纯函数: 计一步并裁决动作(warn 只发一次, stop 一次到位)。 */
export function advanceToolCallGuard(g: ToolCallGuardState): 'none' | 'warn' | 'stop' {
  g.count += 1
  if (g.count >= TOOL_CALL_GUARD.stop) return 'stop'
  if (g.count >= TOOL_CALL_GUARD.warn && !g.warned) { g.warned = true; return 'warn' }
  return 'none'
}

/** 第 3 步任务层兜底(2026-11-01 防空转):桥登记 create_* 异步任务的 task_id 并看门狗提醒——
 *  模型放弃轮询或会话中断后任务不再失踪;提醒事件进事件流与日志(聊天 UI 呈现后续接)。 */
export const ASYNC_TASK_BUDGET_MINUTES = 30
const ASYNC_CREATE_TOOL_SUFFIXES = ['create_video', 'create_image', 'create_digital_human']

/** 返回 task_id 需轮询的 create_*(同步类 create_music/create_audio 不登记)。 */
export function isAsyncCreateTool(title: unknown): boolean {
  return typeof title === 'string' && ASYNC_CREATE_TOOL_SUFFIXES.some((s) => title.endsWith(s))
}

/** 从工具结果文本提取服务端任务 id:优先 task_id 相邻形态,兜底裸任务 id 形态
 *  (服务端任务 id=<1-3 小写字母>_+8 位十六进制,可带 -序号,如 c_5ce35516-0;产物命名 bgm-/img- 等用连字符不会误中)。 */
export function extractAsyncTaskIds(text: string): string[] {
  const ids = new Set<string>()
  const explicit = /task_id["'\s:=]+([A-Za-z0-9_-]{6,})/g
  for (let m = explicit.exec(text); m; m = explicit.exec(text)) ids.add(m[1]!)
  const bare = /\b[a-z]{1,3}_[0-9a-f]{8}(?:-[0-9A-Za-z]+)?\b/g
  for (let m = bare.exec(text); m; m = bare.exec(text)) ids.add(m[0]!)
  return [...ids]
}

const TASK_SETTLED_RE = /(completed|succeeded|failed|cancelled|done\b)/i

/** 轮询结果文本出现任务 id + 终态词 = 该任务已结算(不再提醒)。 */
export function isSettledTaskText(text: string): boolean {
  return TASK_SETTLED_RE.test(text)
}

export type AsyncTaskEntry = { project: string; tool: string; createdAt: number; settled: boolean; reminded: boolean }

/** 一个角色的模型路由补丁文件名(按角色分文件, 角色切换=会话重建). */
export function filmAgentPatchFile(persona: FilmAgentPersona): string {
  return persona === 'tintin-agent' ? 'film-tintin-agent.patch.yml' : 'film-agent.patch.yml'
}

/** 一个角色的智能体 home(按角色分目录: 会话与技能互不串). */
export function filmAgentHomeDir(persona: FilmAgentPersona): string {
  return persona === 'tintin-agent' ? 'film-tintin-agent-home' : 'film-agent-home'
}

/** YAML 双引号字符串:JSON 转义即合法 YAML 双引号标量(Windows 路径的反斜杠/盘符冒号都安全)。 */
const yamlText = (value: string): string => JSON.stringify(value.replaceAll('\\', '/'))

/** DeepSeek Harness(默认智能体)的补丁行 —— 照上游 openfilm 的默认处理:它就是用户自己的 dsh,
 *  模型/凭据/账号全用客户端的,这里不改写模型路由,只做三件事(与封面侧 cover-acp-bridge
 *  的 deepseekRows 同构):
 *  ① 默认模型跟随客户端(agent-default-model;没保存过=dsh 自身默认 deepseek-flash。acp-app 包给
 *     ACP 钉的旧 id deepseek-v4-flash 不在 dsh 官方模型目录里,不沿用);
 *  ② 客户端「设置→模型」自定义过 DeepSeek 目录/地址(2026-11-23 用户裁决②)→ 该配置行原文并入;
 *  ③ 技能目录与会话目录经 dsh 插件配置项指回 TinTin 的智能体目录 —— DSH_HOME 是客户端的,不把影片
 *     技能写进客户端技能库、不把智能体会话写进客户端会话列表,且旧会话路径不变照常续接。 */
function filmDeepseekRows(channelHome: string): string[] {
  const client = readClientDeepseekConfig(channelHome)
  const agentDir = join(channelHome, filmAgentHomeDir('deepseek'))
  return [
    '# DeepSeek Harness = 客户端自己的 dsh(照上游 openfilm):模型/凭据/账号用客户端的,不改写模型路由.',
    '# 默认模型跟随客户端;客户端「设置→模型」自定义过目录则随后并入.',
    '- id: acp',
    '  config:',
    '    provider: deepseek-official',
    `    model: ${yamlText(client.defaultModel)}`,
    ...(client.catalogRow ? [client.catalogRow] : []),
    '# 技能/会话留在 TinTin 的智能体目录(不进客户端的技能库与会话列表;旧会话路径不变):',
    '- id: skill-filesystem',
    '  config:',
    '    customSkillDirs:',
    `      - ${yamlText(join(agentDir, 'skills'))}`,
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${yamlText(join(agentDir, 'sessions'))}`,
  ]
}

/** 生成影片智能体的补丁(叠在 acp bundle 层之后生效).
    插件 id 必须是 acp 组合实际存在的行(llm-pi-ai/acp, 见 dsh-base cordis.patch.yml 135 行)
    —— id 写错(如曾经的 llm-pi-ai)整行被静默忽略, 模型回落官方直连。
    personaPrefix 非空时叠加 system-prompt 行(覆盖 acp bundle 的部署人设)。
    2026-10-30:补 dsh-mcp-client 行挂服务端 MCP 工具箱 —— 实证 rc.2 的 acp 路径
    无视 session/new 的 mcpServers 参数(坏 URL 也不报错、子进程零连接, 当日探针),
    会话参数挂载失效;补丁行按官方 README 最小配置进程级挂载, 工具名 mcp__tintin-server__*。
    2026-11-24 按智能体分链:
    · deepseek(DeepSeek Harness):personaPrefix=编排纪律;模型路由不改写(见 filmDeepseekRows)。
    · tintin-agent(TinTin智能体):personaPrefix=角色人设;模型路由到 TinTin 服务端,models=GET
      /v1/models 实拉清单、原生名(2026-10-30 的「首个模型显示名品牌化为 TinTin智能体」随
      2026-11-23 用户裁决退役 —— 选择器里要看到服务端的模型清单)。 */
export function filmAgentPatchText(serverUrl: string, models: FilmAgentModels[], personaPrefix: string, persona: FilmAgentPersona, channelHome: string): string {
  /* 2026-11-04 感知闭环:模型行声明 input:[text,image](llm-pi-ai schema `input`)——
     缺省=纯文本,会话不广播 inline image prompts,用户附图在协议层被拒
     (「inline image prompts were not advertised」,1104 事故同根因,与封面侧同修)。
     服务端 /llm 已 caption-then-main,声明即真。 */
  const rows = models.map((m) => `          - id: ${m.id}\n            name: ${m.name}\n            input: [text, image]`).join('\n')
  /* 即梦 CLI:开关开且技能已安装时,把"优先 CLI"写进本会话的人设前缀;
     关或未装=不注入,生成仍走 create_image/create_video。 */
  const dreaminaOn = filmDreaminaPreferOn() && existsSync(join(filmDreaminaSkillsDir(channelHome), 'SKILL.md'))
  const effectivePrefix = `${personaPrefix}${dreaminaOn
    ? '\n\n即梦 CLI 技能已启用:图片/视频生成优先用 dreamina CLI(按已装技能文档执行);未登录或 CLI 失败时回退 create_image / create_video。'
    : ''}`
  const personaLines = effectivePrefix
    ? ['- id: system-prompt', '  config:', '    personaPrefix: |-',
      ...effectivePrefix.split('\n').map((line) => `      ${line}`)]
    : []
  const routeRows = persona === 'tintin-agent'
    ? [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      tintin-server:',
      '        displayName: TinTin',
      '        apiKeyEnv: TINTIN_SERVER_API_KEY',
      '        api: openai-completions',
      `        baseURL: ${serverUrl.replace(/\/+$/, '')}/llm`,
      '        models:',
      rows,
      '- id: acp',
      '  config:',
      '    provider: tintin-server',
      `    model: ${models[0]?.id ?? 'deepseek-v4-flash'}`,
    ]
    : filmDeepseekRows(channelHome)
  const lines = [
    persona === 'tintin-agent'
      ? '# TinTin 智能体(影片): 模型路由到 TinTin 服务端(openai-completions, <server>/llm).'
      : '# TinTin 影片智能体(DeepSeek Harness): 模型走客户端自己的 dsh, 服务端只挂 MCP 工具箱.',
    '# 由桌面端生成; 手改会被下次启动覆盖.',
    ...(persona === 'tintin-agent' ? ['# key 走 env TINTIN_SERVER_API_KEY(占位值).'] : []),
    ...personaLines,
    '# 服务端 MCP 工具箱(rc.2 会话参数挂载失效, 补丁行挂载; 工具名 mcp__tintin-server__*):',
    '# 新行必须 insert: 顶层 - id: 行是"更新已存在条目"语义, 目标不存在=整行静默忽略。',
    '- insert:',
    '    - id: mcp-tintin-server',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: tintin-server',
    '        transport: streamable-http',
    `        url: ${serverUrl.replace(/\/+$/, '')}/mcp`,
    '        failOnStartupError: true',
    ...routeRows,
  ]
  lines.push('')
  return lines.join('\n')
}

/** 把补丁写到 <channelHome>/tintin 的固定位置(内容变化才写), 返回补丁绝对路径.
 *  models 只有 TinTin 智能体需要(服务端 GET /v1/models 实拉清单;缺省=兜底清单)。 */
export function ensureFilmAgentPatch(channelHome: string, serverUrl: string, models: FilmAgentModels[] | undefined, persona: FilmAgentPersona): string {
  const dir = join(channelHome, 'tintin')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, filmAgentPatchFile(persona))
  const text = filmAgentPatchText(
    serverUrl,
    persona === 'tintin-agent' ? (models ?? FILM_TINTIN_AGENT_MODELS) : [],
    persona === 'tintin-agent' ? FILM_TINTIN_AGENT_PERSONA : FILM_AGENT_WORK_RULES,
    persona,
    channelHome,
  )
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text, 'utf8')
  return path
}

/** app 内的 `@deepseek-ai/dsh` CLI 可执行文件(与宿主同版本, 由包清单解析). */
export function resolveDshBin(): string {
  /* 诊断覆盖(2026-10-25): 指定 dsh 可执行文件用于对照实验(打包版 vs 工作区构建)。 */
  const override = process.env.TINTIN_DSH_BIN
  if (override !== undefined && override !== '') return override
  const manifest = require_.resolve('@deepseek-ai/dsh/package.json')
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: Record<string, string> | string }
  const bin = typeof parsed.bin === 'object' && parsed.bin !== null ? parsed.bin.dsh : parsed.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('@deepseek-ai/dsh declares no dsh executable')
  return join(dirname(manifest), bin)
}

/** The dsh CLI is spawnable (Settings → Agents 的 ready/missing 判定). */
export function dshBinExists(): boolean {
  try { return existsSync(resolveDshBin()) } catch { return false }
}

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  elicitation: { form: {} },
  session: { notices: {} },
}
const CLIENT_INFO = { name: 'tintin-desktop', title: 'TinTin' }

/** 官方口径的审批放行选项已改由聊天 UI 承接(权限事件路由), 此处不再自动放行. */

/** ACP 表单 → 聊天问题清单(官方 formQuestions 移植): null = 该表单本聊天不展示(拒答, 智能体按跳过处理). */
function formQuestions(params: {
  mode?: unknown
  message?: unknown
  requestedSchema?: { properties?: Record<string, {
    type?: string
    title?: unknown
    description?: unknown
    enum?: unknown[]
    oneOf?: Array<{ const?: unknown; description?: unknown }> | null
    anyOf?: Array<{ const?: unknown; description?: unknown }> | null
    items?: { anyOf?: Array<{ const?: unknown; description?: unknown }> | null; oneOf?: Array<{ const?: unknown; description?: unknown }> | null }
    _meta?: { _askUserQuestionCustomAnswer?: { questionId?: unknown }; codex?: { role?: unknown; questionId?: unknown } }
  }> | null
  }}): Array<{ id: string; question: string; header: string | null; options: Array<{ label: string; description?: string }>; customId: string | null; multi: boolean }> | null {
  if (params?.mode !== undefined && params.mode !== 'form') return null
  const properties = params?.requestedSchema?.properties
  if (!properties || typeof properties !== 'object') return null
  const entries = Object.entries(properties)
  const customOf = new Map<string, string>()
  for (const [id, prop] of entries) {
    const target = prop?._meta?._askUserQuestionCustomAnswer?.questionId
      ?? (prop?._meta?.codex?.role === 'user_note' ? prop._meta.codex.questionId : undefined)
    if (typeof target === 'string' && properties[target]) customOf.set(target, id)
  }
  const custom = new Set(customOf.values())
  const fields = entries.filter(([id]) => !custom.has(id))
  if (fields.length === 0) return null
  const questions: Array<{ id: string; question: string; header: string | null; options: Array<{ label: string; description?: string }>; customId: string | null; multi: boolean }> = []
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

/** 聊天的回答 → 表单内容(官方 formContent 移植). */
function formContent(
  questions: Array<{ id: string; options: Array<{ label: string }>; customId: string | null; multi: boolean }>,
  answers: Record<string, { label?: unknown; text?: unknown }> | null,
): Record<string, unknown> {
  const content: Record<string, unknown> = {}
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

export interface FilmAgentUpdate { project: string; event: FilmAgentEvent }

/** ACP 语义事件, 与官方 DesktopBridge 的 LocalAgentEvent 同形(聊天按 sessionUpdate 分派渲染). */
export type FilmAgentEvent =
  | { key: string; kind: 'update'; update: { sessionUpdate: string } & Record<string, unknown> }
  | { key: string; kind: 'permission'; requestId: string; params: { toolCall?: { title?: string }; options: Array<{ optionId: string; name: string; kind: string }> } }
  | { key: string; kind: 'question'; requestId: string; message: string; toolCallId: string | null; questions: Array<{ id: string; question: string; header: string | null; options: Array<{ label: string; description?: string }>; customId: string | null; multi: boolean }> }
  | { key: string; kind: 'exit'; code: number | null; stderr: string }
  | { key: string; kind: 'done'; ok: boolean; stopReason?: string; error?: string; toolCalls?: number }
  | { key: string; kind: 'limit'; level: 'warn' | 'stop'; toolCalls: number; limit: number }
  | { key: string; kind: 'task-stale'; taskId: string; tool: string; ageMinutes: number }

export interface FilmAgentState {
  id: 'deepseek'
  label: string
  cli: { path: string; source: 'app' } | null
  signedIn: boolean
  install: string
}

interface Handle {
  project: string
  /** 本进程服务的角色(选择器里的 agent 行; 人设与补丁按角色分文件). */
  agentId: FilmAgentPersona
  sessionId: string | null
  child: ReturnType<typeof spawn>
  agent: Promise<{ prompt(text: string, images?: Array<{ data: string; mimeType: string }>): Promise<{ stopReason: string }> }>
  conn: {
    agent: {
      request(method: unknown, params: Record<string, unknown>): Promise<unknown>
      notify(method: unknown, params: Record<string, unknown>): Promise<void>
    }
  } | null
  init: { agentInfo?: { name?: string; title?: string; version?: string } | null; agentCapabilities?: Record<string, unknown> | null } | null
  session: Record<string, unknown> | null
  steering: boolean
}

/**
 * 每部影片一个 ACP 子进程的管理器: 首次 start 拉起并建会话(或 resume), 之后复用;
 * 进程退出即丢弃(会话已持久, 下次 start 以 resume 续上). 语义事件经 onEvent 流出.
 */
export class FilmAgentManager {
  private handles = new Map<string, Handle>()
  /** 会话 id 按 角色:项目 分键 —— 每个角色在同一影片下续各自的会话. */
  private sessionIds = new Map<string, string>()
  /** 项目 → 最近一次使用的角色(begin 显式给定; ensure/prompt 无参时沿用). */
  private personas = new Map<string, FilmAgentPersona>()
  private permissions = new Map<string, { project: string; resolve: (response: unknown) => void }>()
  private questions = new Map<string, { project: string; resolve: (response: unknown) => void; questions: Array<{ id: string; options: Array<{ label: string }>; customId: string | null; multi: boolean }> }>()
  private log: (message: string) => void

  constructor(private options: { channelHome: string; serverUrl: () => string; onEvent?: (update: FilmAgentUpdate) => void; log?: (message: string) => void }) {
    this.log = options.log ?? (() => {})
  }

  /** Settings → Agents 的名册行(官方 LocalAgentState 的 TinTin 子集). */
  listState(): FilmAgentState {
    const exists = dshBinExists()
    return {
      id: 'deepseek',
      label: 'DeepSeek Harness',
      cli: exists ? { path: 'dsh', source: 'app' } : null,
      signedIn: true, /* login: null —— 无登录命令, 服务端模型 */
      install: 'https://github.com/deepseek-ai/deepseek-harness',
    }
  }

  /** 提交一条消息; 语义更新经 onEvent 流出并缓存(重载恢复), 事件同步落盘
      .film/logs/<turnId>.jsonl(Developer 的每轮日志面数据源), Promise 在整轮结束时落定. */
  async prompt(project: string, text: string, meta?: { turnId?: string }, images?: Array<{ data: string; mimeType: string }>): Promise<{ stopReason: string }> {
    const turnId = meta?.turnId ?? randomUUID()
    const logsDir = join(project, '.film', 'logs')
    mkdirSync(logsDir, { recursive: true })
    /* 轮次 id 含冒号(local:xxx), Windows 文件名禁冒号 —— 官方 fileOf 同款净化
       (未净化时写成 NTFS ADS 流, unsaved 扫描永远空; 2026-11-07 实证)。 */
    const logFile = join(logsDir, `${fileOf(turnId)}.jsonl`)
    this.activeLogs.set(project, logFile)
    const handle = await this.ensure(project)
    this.trackTurn(project, null, handle.agentId)
    const entry = this.turns.get(project)!
    const agent = await handle.agent
    const startedAt = Date.now()
    appendFileSync(logFile, `${JSON.stringify({ t: startedAt, kind: 'prompt', meta: { turnId }, agent: handle.agentId, text })}\n`, 'utf8')
    /* 回合护栏计数清零(每回合一个作用域;轮询类工具不计,见 advanceToolCallGuard) */
    this.turnGuard.set(project, { count: 0, warned: false })
    try {
      const result = await agent.prompt(text, images)
      entry.done = { ok: true, stopReason: result.stopReason }
      const toolCalls = this.turnGuard.get(project)?.count ?? 0
      const doneAt = Date.now()
      appendFileSync(logFile, `${JSON.stringify({ t: doneAt, kind: 'done', ok: true, stopReason: result.stopReason, toolCalls })}\n`, 'utf8')
      /* 模型请求明细(0.3 的 calls 页签): 轮次落定后从 DSH 会话日志重建本窗口的请求 */
      scheduleFilmModelLog({ project, turnId, agentHome: join(this.options.channelHome, filmAgentHomeDir(handle.agentId)), sessionId: handle.sessionId ?? '', fromMs: startedAt, toMs: doneAt })
      this.emit(project, { key: project, kind: 'done', ok: true, stopReason: result.stopReason, toolCalls })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      entry.done = { ok: false, error: message }
      const toolCalls = this.turnGuard.get(project)?.count ?? 0
      appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), kind: 'done', ok: false, error: message, toolCalls })}\n`, 'utf8')
      this.emit(project, { key: project, kind: 'done', ok: false, error: message, toolCalls })
      throw error
    } finally {
      this.activeLogs.delete(project)
      this.turnGuard.delete(project)
    }
  }

  /** 显式启动(或续接)一部影片的会话, 返回会话信息(聊天侧 start 的后端).
      persona 缺省沿用该项目最近的角色(首次为 deepseek)。resume=聊天侧存档的会话 id:
      管理器无内存会话(如应用重启后)按它续持久会话; 0.3 起聊天侧比对 resumed/sessionId。 */
  async begin(project: string, persona?: FilmAgentPersona, resume?: string | null): Promise<{
    sessionId: string; resumed: boolean; agentInfo: { name?: string; title?: string; version?: string } | null; authMethods: never[]; mcp: false;
    models: { availableModels: Array<{ modelId: string; name: string; description?: string }>; currentModelId: string } | null;
    modes: null; configOptions: Array<Record<string, unknown>> | null;
  }> {
    const handle = await this.ensure(project, persona, resume)
    const session = (handle.session ?? {}) as {
      models?: { availableModels?: Array<Record<string, unknown>>; currentModelId?: unknown }
      configOptions?: Array<Record<string, unknown>>
    }
    const available = Array.isArray(session.models?.availableModels) ? session.models!.availableModels! : []
    return {
      sessionId: handle.sessionId ?? '',
      /* 0.3 聊天侧按 resumed+sessionId 判定是否真续上了: 管理器服务的会话与聊天侧存档 id
         一致才算续上, 不一致时聊天侧会前置会话上下文并如实提示(官方 local-agent-run 语义)。 */
      resumed: typeof resume === 'string' && resume !== '' && (handle.sessionId ?? '') === resume,
      agentInfo: handle.init?.agentInfo ?? null,
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

  /** 插话: ACP 报告支持 steering 才原样发(服务端自行并入当前轮), 否则明确不支持. */
  async steer(project: string, text: string, images?: Array<{ data: string; mimeType: string }>): Promise<{ ok: boolean; outcome: string }> {
    const handle = this.handles.get(project)
    if (!handle?.conn || !handle.steering) return { ok: false, outcome: 'not-supported' }
    const blocks: Array<Record<string, unknown>> = [{ type: 'text', text }, ...((images ?? []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType })))]
    await handle.conn.agent.notify(acp.methods.agent.session.prompt, { sessionId: handle.sessionId, prompt: blocks })
    return { ok: true, outcome: 'queued' }
  }

  /** 取消进行中的一轮(session/cancel 通知; 进程与会话保留). */
  async cancel(project: string): Promise<{ ok: boolean }> {
    const handle = this.handles.get(project)
    if (!handle?.conn || !handle.sessionId) return { ok: false }
    await handle.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: handle.sessionId })
    return { ok: true }
  }

  async answerPermission(project: string, requestId: string, optionId: string | null): Promise<{ ok: boolean }> {
    const pending = this.permissions.get(requestId)
    if (!pending || pending.project !== project) return { ok: false }
    this.permissions.delete(requestId)
    pending.resolve({ outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
    return { ok: true }
  }

  async answerQuestion(project: string, requestId: string, answers: Record<string, { label?: string; text?: string }> | null): Promise<{ ok: boolean }> {
    const pending = this.questions.get(requestId)
    if (!pending || pending.project !== project) return { ok: false }
    this.questions.delete(requestId)
    if (answers === null) pending.resolve({ action: 'decline' })
    else pending.resolve({ action: 'accept', content: formContent(pending.questions, answers) })
    return { ok: true }
  }

  /** 切会话配置项(模型/模式; 官方 setOption 的直通). */
  async setOption(project: string, configId: string, value: unknown): Promise<{ ok: boolean; error?: string; result?: { configOptions?: unknown } }> {
    const handle = this.handles.get(project)
    if (!handle?.conn || !handle.sessionId) return { ok: false, error: '会话未启动' }
    try {
      const result = await handle.conn.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: handle.sessionId, configId, value }) as { configOptions?: unknown } | undefined
      return { ok: true, ...(result ? { result } : {}) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 结束一部影片的智能体进程(会话已持久, 下次 start 以 resume 续上). */
  stop(project: string): void {
    const handle = this.handles.get(project)
    if (!handle) return
    this.handles.delete(project)
    try { handle.child.kill() } catch { /* 已退出 */ }
  }

  /** 轮次回执缓存: 页面重载后 running() 恢复显示用; 聊天 ack 后清除. */
  private turns = new Map<string, {
    key: string
    agent: FilmAgentPersona
    cwd: string
    meta: unknown
    done: { ok: true; stopReason: string } | { ok: false; error: string } | null
    events: Array<Record<string, unknown> & { kind: string }>
  }>()

  /** 聊天重载时取回仍在进行/刚结束未认领的轮次(官方 localAgents.running 语义). */
  runningTurns(): Array<{ key: string; agent: FilmAgentPersona; cwd: string; meta: unknown; done: { ok: true; stopReason: string } | { ok: false; error: string } | null; events: Array<Record<string, unknown> & { kind: string }> }> {
    return [...this.turns.values()].map((turn) => ({ ...turn, events: [...turn.events] }))
  }

  /** 聊天已把该轮接回显示: 丢弃缓存. */
  ackTurn(key: string): void {
    this.turns.delete(key)
  }

  /** 登记一轮( start 时建档, 供重载恢复; 已有则更新 meta 与角色 ). */
  trackTurn(project: string, meta: unknown, persona?: FilmAgentPersona): void {
    const wanted = persona ?? this.personas.get(project) ?? 'deepseek'
    const existing = this.turns.get(project)
    if (existing) { existing.meta = meta ?? existing.meta; existing.agent = wanted; return }
    this.turns.set(project, { key: project, agent: wanted, cwd: project, meta: meta ?? null, done: null, events: [] })
  }

  dispose(): void {
    clearInterval(this.taskWatchdog)
    for (const project of [...this.handles.keys()]) this.stop(project)
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  private activeLogs = new Map<string, string>()

  /** 回合工具调用护栏状态(prompt 建立作用域, done 后清除; 见 advanceToolCallGuard). */
  private turnGuard = new Map<string, ToolCallGuardState>()

  /** 任务层兜底(第 3 步):callId→工具名(把结果关联回 create_* 调用)与异步任务登记表。 */
  private toolNames = new Map<string, string>()
  private asyncTasks = new Map<string, AsyncTaskEntry>()

  /** 从 tool_call_update 观察异步任务: create_* 结果提取 task_id 登记; 终态词+id 同现=结算。 */
  private noteAsyncTask(project: string, update: unknown): void {
    const u = update as { sessionUpdate?: string; toolCallId?: unknown; content?: unknown } | null
    if (!u || u.sessionUpdate !== 'tool_call_update') return
    const text = typeof u.content === 'string' ? u.content : JSON.stringify(u.content ?? '')
    const title = this.toolNames.get(String(u.toolCallId ?? '')) ?? ''
    if (isAsyncCreateTool(title)) {
      for (const id of extractAsyncTaskIds(text)) {
        if (!this.asyncTasks.has(id)) this.asyncTasks.set(id, { project, tool: title, createdAt: Date.now(), settled: false, reminded: false })
      }
    }
    if (isSettledTaskText(text)) {
      for (const [id, entry] of this.asyncTasks) if (!entry.settled && text.includes(id)) entry.settled = true
    }
  }

  /** 看门狗: 登记任务超预算时长(30 分钟)未观察到终态 → task-stale 事件+日志, 只提醒一次。 */
  private taskWatchdog: ReturnType<typeof setInterval> = setInterval(() => {
    const now = Date.now()
    for (const [id, entry] of this.asyncTasks) {
      if (entry.settled || entry.reminded) continue
      const ageMinutes = Math.round((now - entry.createdAt) / 60_000)
      if (ageMinutes < ASYNC_TASK_BUDGET_MINUTES) continue
      entry.reminded = true
      this.log(`[task-stale] ${entry.tool} 任务 ${id} 超过 ${ASYNC_TASK_BUDGET_MINUTES} 分钟未观察到终态(已 ${ageMinutes} 分钟)`)
      this.emit(entry.project, { key: entry.project, kind: 'task-stale', taskId: id, tool: entry.tool, ageMinutes })
    }
  }, 60_000)

  /** 非轮询类 tool_call 计一步; 超阈值先告警后中止本回合(cancel 不杀进程, 会话可续). */
  private bumpGuard(project: string): void {
    const g = this.turnGuard.get(project)
    if (!g) return
    const action = advanceToolCallGuard(g)
    if (action === 'warn') {
      this.emit(project, { key: project, kind: 'limit', level: 'warn', toolCalls: g.count, limit: TOOL_CALL_GUARD.warn })
    } else if (action === 'stop') {
      this.emit(project, { key: project, kind: 'limit', level: 'stop', toolCalls: g.count, limit: TOOL_CALL_GUARD.stop })
      void this.cancel(project)
    }
  }

  private emit(project: string, event: FilmAgentEvent): void {
    const entry = this.turns.get(project)
    if (entry) entry.events.push({ ...event } as Record<string, unknown> & { kind: string })
    const logFile = this.activeLogs.get(project)
    if (logFile) {
      try { appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), ...event })}\n`, 'utf8') } catch { /* 日志失败不阻断会话 */ }
    }
    this.options.onEvent?.({ project, event })
  }

  private async ensure(project: string, persona?: FilmAgentPersona, resume?: string | null): Promise<Handle> {
    const wanted = persona ?? this.personas.get(project) ?? 'deepseek'
    if (persona !== undefined) this.personas.set(project, persona)
    const existing = this.handles.get(project)
    /* 切换智能体 = 换一条模型链路(DeepSeek Harness=客户端 / TinTin智能体=服务端),会话必须重建 */
    if (existing && existing.child.exitCode === null && existing.agentId === wanted) return existing
    if (existing) this.stop(project)
    const serverUrl = this.options.serverUrl().replace(/\/+$/, '')
    /* DeepSeek Harness 跑在客户端 home:dsh 首次在该 home 物化 acp profile 的那一次启动,模型发现
       早于凭据就绪,清单不全(见 dsh-tintin-shared/lib/dsh-acp-home.js)——未物化时先做一次丢弃式预热。
       (2026-11-24 实测:同一 home 第二次启动起即报完整目录;TinTin 智能体的清单来自补丁,不受影响。) */
    if (wanted === 'deepseek' && serverUrl && !acpProfileMaterialized(this.options.channelHome)) {
      this.log('[film-agent] 客户端 home 首次物化 acp profile:先做一次丢弃式预热启动')
      const warm = this.start(project, wanted, null)
      this.handles.set(project, warm)
      await warm.agent.then(() => undefined, () => undefined)
      this.stop(project)
    }
    /* 模型清单只有 TinTin 智能体(服务端路由)需要:GET /v1/models 实拉,失败回落兜底清单 */
    const models = wanted === 'tintin-agent' ? ((await fetchFilmServerModels(serverUrl)) ?? FILM_TINTIN_AGENT_MODELS) : undefined
    const handle = this.start(project, wanted, resume, models)
    this.handles.set(project, handle)
    return handle.agent.then(() => handle)
  }

  private start(project: string, agentId: FilmAgentPersona, resume?: string | null, models?: FilmAgentModels[]): Handle {
    const serverUrl = this.options.serverUrl().replace(/\/+$/, '')
    if (!serverUrl) throw new Error('server.url 未配置: 影片智能体无法启动')
    const patchPath = ensureFilmAgentPatch(this.options.channelHome, serverUrl, models, agentId)
    const home = join(this.options.channelHome, filmAgentHomeDir(agentId))
    mkdirSync(home, { recursive: true })
    /* 内置 openfilm 技能随包分发(2026-10-24): 同步进影片智能体的 home ——
       智能体才有该技能可执行; 同步失败不阻断启动。 */
    try {
      const bundled = join(process.resourcesPath ?? '', 'skills', 'openfilm', 'SKILL.md')
      const devSource = resolve(dirname(fileURLToPath(import.meta.url)), '../../../dsh-tintin-bundle/resources/skills/openfilm/SKILL.md')
      const source = existsSync(bundled) ? bundled : devSource
      if (existsSync(source)) {
        const target = join(home, 'skills', 'openfilm')
        mkdirSync(target, { recursive: true })
        writeFileSync(join(target, 'SKILL.md'), readFileSync(source, 'utf8'))
      }
    } catch { /* 技能同步失败不阻断启动 */ }
    /* 即梦 CLI 技能(视频剪辑技能管理页安装):随会话同步进本机 agent home;
       开关关=撤下,让"优先 CLI"在下次会话真正失效。 */
    try {
      const installed = join(filmDreaminaSkillsDir(this.options.channelHome), 'SKILL.md')
      const target = join(home, 'skills', 'dreamina')
      if (filmDreaminaPreferOn() && existsSync(installed)) {
        mkdirSync(target, { recursive: true })
        writeFileSync(join(target, 'SKILL.md'), readFileSync(installed, 'utf8'))
      } else {
        rmSync(target, { recursive: true, force: true })
      }
    } catch { /* 同步失败不阻断启动 */ }
    const bin = resolveDshBin()
    /* DSH_HOME(2026-11-24,照上游 openfilm 的默认智能体处理):
       · DeepSeek Harness = 客户端自己的 home —— 登录态/API 密钥/模型配置原样可用,不做任何拷贝;
         技能目录与会话目录由补丁里的 dsh 插件配置项指回 home 目录(见 filmDeepseekRows)。
       · TinTin 智能体(自定义)= 自己的隔离 home。 */
    const dshHome = agentId === 'deepseek' ? this.options.channelHome : home
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: dshHome,
      /* 2026-11-01 按入口分账:占位 key 按链路分值(服务端 /llm 无鉴权不校验值, 计量按 key 分账;
         同族标记: 封面=sk-tintin-local--cover, 页面 REST=sk-tintin-local--rest, 见 pipeline §6.7) */
      TINTIN_SERVER_API_KEY: 'sk-tintin-local--film',
      /* 2026-10-29 用户裁决:TinTin 智能体=完全权限——基础补丁按此 env 映射 沙箱 danger-full-access + 审批 never;
         缺它则落回 workspace-write+ask,审批卡链路一旦没接住就是「仍在处理」永挂(当晚实锤) */
      DSH_PERMISSION_MODE: 'danger-full-access' }
    const child = spawn(process.execPath, [bin, '--profile', 'acp', '--patch', patchPath], {
      cwd: project,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-16_000)
      /* 子进程 stderr 实时进管理器日志(2026-10-25 可观测性缺口: 失败轮次没有任何记录面) */
      const text = String(chunk).trim()
      if (text) this.log(`[agent-stderr] ${text.slice(0, 500)}`)
    })
    /* 占位 promise 不能用 Promise.reject: 创建即拒绝且无人接住 → unhandledRejection →
       failLoud 按致命错误退出主程序(2026-10-24 打开视频剪辑即崩的实测根因)。 */
    type AgentImpl = { prompt: (text: string, images?: Array<{ data: string; mimeType: string }>) => Promise<{ stopReason: string }> }
    let settleAgent!: (impl: AgentImpl) => void
    let failAgent!: (error: Error) => void
    const agent = new Promise<AgentImpl>((resolve, reject) => { settleAgent = resolve; failAgent = reject })
    const sessionKey = `${agentId}:${project}`
    const handle: Handle = {
      project, agentId, sessionId: this.sessionIds.get(sessionKey) ?? null, child, agent,
      conn: null, init: null, session: null, steering: false,
    }
    const forward = (update: unknown) => {
      const u = update as { sessionUpdate?: string; title?: unknown; toolCallId?: unknown } | null
      /* 回合护栏: 逐次计非轮询类工具调用(2026-11-01 防空转第 2 步) */
      if (u?.sessionUpdate === 'tool_call') {
        this.toolNames.set(String(u.toolCallId ?? ''), String(u.title ?? ''))
        if (!isPollingToolCall(u.title)) this.bumpGuard(project)
      }
      /* 任务层兜底: create_* 的 task_id 登记/结算观察(第 3 步) */
      this.noteAsyncTask(project, update)
      this.emit(project, { key: project, kind: 'update', update: { sessionUpdate: String(u?.sessionUpdate ?? 'unknown'), ...(update as Record<string, unknown>) } })
    }

    const started = (async () => {
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
        /* @types/node 的 toWeb 返回 any 泛型流;桥接到 SDK 期望的 DOM 字节流视图 */
        Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>,
      )
      const conn = acp.client({ name: CLIENT_INFO.name })
        .onRequest(acp.methods.client.session.requestPermission, (ctx) => new Promise((resolve) => {
          const requestId = randomUUID()
          this.permissions.set(requestId, { project, resolve: resolve as (response: unknown) => void })
          this.emit(project, {
            key: project, kind: 'permission', requestId,
            params: { toolCall: { title: String(ctx.params.toolCall?.title ?? '') }, options: (ctx.params.options ?? []) as Array<{ optionId: string; name: string; kind: string }> },
          })
        }))
        .onRequest(acp.methods.client.elicitation.create, (ctx) => new Promise((resolve) => {
          const questions = formQuestions(ctx.params as Parameters<typeof formQuestions>[0])
          if (!questions) { resolve({ action: 'decline' as const }); return }
          const requestId = randomUUID()
          this.questions.set(requestId, { project, resolve: resolve as (response: unknown) => void, questions })
          this.emit(project, { key: project, kind: 'question', requestId, message: String(ctx.params.message ?? ''), toolCallId: null, questions })
        }))
        .onRequest(acp.methods.client.fs.writeTextFile, () => ({}))
        .onRequest(acp.methods.client.fs.readTextFile, () => ({ content: '' }))
        .onNotification(acp.methods.client.session.update, (ctx) => forward(ctx.params.update))
        .connect(stream)
      handle.conn = conn
      child.once('exit', (code) => {
        if (this.handles.get(project)?.child === child) this.handles.delete(project)
        this.log(`film agent exited (${code})`)
        this.emit(project, { key: project, kind: 'exit', code: code ?? null, stderr: stderr.slice(-2000) })
      })
      const init = await conn.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: CLIENT_INFO,
      }) as { agentInfo?: { name?: string; title?: string; version?: string }; agentCapabilities?: Record<string, unknown>; _meta?: { steering?: { supported?: boolean } } }
      handle.init = init
      handle.steering = init._meta?.steering?.supported === true
      /* MCP 挂载走补丁行(2026-10-30):rc.2 会话参数挂载死路(实测合法 URL 零连接、坏条目被
         SDK schema 静默跳过), 补丁行进程级挂载。此键仍是 schema 必需 —— 留空数组防双挂。 */
      const params = { cwd: project, mcpServers: [] }
      /* 管理器内存的会话优先(本进程内已续上); 无内存会话而聊天侧带存档 id 时按它续 ——
         应用重启后会话文件仍在(DSH_HOME 持久), 否则每次重启都静默开新会话。 */
      let sessionId: string | null = this.sessionIds.get(sessionKey)
        ?? (typeof resume === 'string' && resume !== '' ? resume : null)
      if (sessionId !== null) {
        /* 持久会话: resume 失败(如目录变更)回落新建 */
        /* 续接成功后会话 id = 回包给了新 id 用新的,否则沿用请求的 id。2026-11-24 实测修复(两工作台同款老 bug):
           dsh 的 session/resume 回包只有 configOptions、不回 sessionId(harness acp index.ts resumeSession
           返回 { configOptions }),旧代码无条件取 resumed.sessionId → 续接「成功」却把 id 记成 undefined:
           setOption 判「会话未启动」切不了模型、内存会话表被写坏、聊天侧拿到空 id 判「未续接」。 */
        const resumed = await conn.agent.request(acp.methods.agent.session.resume, { ...params, sessionId }).then((r) => r as { sessionId?: string } & Record<string, unknown>, () => null)
        if (resumed) {
          sessionId = typeof resumed.sessionId === 'string' && resumed.sessionId !== '' ? resumed.sessionId : sessionId
          handle.session = resumed
        } else sessionId = null
      }
      if (sessionId === null) {
        const created = await conn.agent.request(acp.methods.agent.session.new, params) as { sessionId: string } & Record<string, unknown>
        sessionId = created.sessionId
        handle.session = created
      }
      handle.sessionId = sessionId
      this.sessionIds.set(sessionKey, sessionId)
      const promptFn = async (text: string, images?: Array<{ data: string; mimeType: string }>) => {
        const blocks: Array<Record<string, unknown>> = [{ type: 'text', text }, ...((images ?? []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType })))]
        const response = await conn.agent.request(acp.methods.agent.session.prompt, { sessionId: handle.sessionId, prompt: blocks }) as { stopReason: string }
        return { stopReason: response.stopReason }
      }
      return { prompt: promptFn }
    })()
    void started.then(
      (impl) => { settleAgent(impl) },
      (error) => {
        this.handles.delete(project)
        this.log(`film agent start failed: ${error?.message ?? error}; stderr: ${stderr.slice(-500)}`)
        failAgent(error instanceof Error ? error : new Error(String(error)))
      },
    )
    return handle
  }
}
