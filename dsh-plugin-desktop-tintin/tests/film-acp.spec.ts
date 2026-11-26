// tests/film-acp.spec.ts — 影片智能体 ACP 桥的纯函数面:补丁文本形状与幂等落盘。
// (子进程/协议面由 .tmp/agent-route-probe-film.spec.ts 真实 dsh + 真实服务端实测,2026-11-24。)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  advanceToolCallGuard,
  ensureFilmAgentPatch,
  extractAsyncTaskIds,
  FILM_TINTIN_AGENT_MODELS,
  FILM_TINTIN_AGENT_PERSONA,
  FILM_AGENT_WORK_RULES,
  filmAgentHomeDir,
  filmAgentPatchFile,
  filmAgentPatchText,
  isAsyncCreateTool,
  isPollingToolCall,
  isSettledTaskText,
  TOOL_CALL_GUARD,
} from '../src/tintin/film-acp.ts'

const dirs: string[] = []
const NL = String.fromCharCode(10)
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const tmpHome = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'film-acp-'))
  dirs.push(dir)
  return dir
}
type Row = { id?: string; insert?: Array<{ id?: string }>; config?: Record<string, unknown> }
const rowsOf = (text: string): Row[] => parse(text) as Row[]
const serverModels = [
  { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
  { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
  { id: 'qwen3.8-flash-next-iq2_xs', name: 'qwen3.8-flash-next-iq2_xs' },
]

describe('filmAgentPatchText', () => {
  it('TinTin 智能体(自定义):模型路由到服务端 /llm,清单=服务端实拉原生名,首个为默认,尾斜杠归一', () => {
    const home = tmpHome()
    const text = filmAgentPatchText('http://192.168.111.31:8000/', serverModels, FILM_TINTIN_AGENT_PERSONA, 'tintin-agent', home)
    expect(text).toContain('baseURL: http://192.168.111.31:8000/llm')
    expect(text).toContain('apiKeyEnv: TINTIN_SERVER_API_KEY')
    expect(text).toContain('- id: qwen3.8-flash-next-iq2_xs')
    expect(text).toContain('provider: tintin-server')
    expect(text).toContain('model: deepseek-v4-flash')
    expect(text).not.toMatch(/8000\/\/llm/)
    /* 2026-11-23 用户裁决:模型行显示服务端的模型清单,不再把首个模型显示名品牌化成「TinTin智能体」
       (2026-10-30 的品牌化退役 —— 选择器里模型行写着「TinTin智能体」、悬浮只有一项,看不到模型) */
    expect(text).not.toContain('name: TinTin智能体')
    /* MCP 挂载行(2026-10-30):rc.2 会话参数失效,补丁行进程级挂载服务端工具箱;
       新行必须 insert(顶层 - id: 行=更新语义,目标不存在=静默忽略) */
    expect(text).toContain('- insert:')
    expect(text).toContain('- id: mcp-tintin-server')
    expect(text).toContain("name: '@deepseek-ai/dsh-mcp-client'")
    expect(text).toContain('url: http://192.168.111.31:8000/mcp')
  })

  it('TinTin 智能体人设列出服务端子智能体(视频/图片/音乐/音频/口播/数字人),整份补丁是合法 YAML', () => {
    const text = filmAgentPatchText('http://a:1', serverModels, FILM_TINTIN_AGENT_PERSONA, 'tintin-agent', tmpHome())
    expect(text).toContain('- id: system-prompt')
    expect(text).toContain('personaPrefix: |-')
    expect(text).toContain('「TinTin智能体」')
    /* 五个主子智能体 + 数字人 + 轮询, 工具名以 2026-10-30 /mcp tools/list 实测为准 */
    for (const tool of ['create_video', 'create_image', 'create_music', 'create_audio', 'create_digital_human', 'task_status_unified']) {
      expect(text).toContain(tool)
    }
    expect(text).not.toContain('{{')
    expect(text).toContain(`${NL}- id: llm-pi-ai`)
    const personaRow = rowsOf(text).find((row) => row.id === 'system-prompt')
    expect(String(personaRow?.config?.personaPrefix ?? '')).toContain('create_video')
    expect(String(personaRow?.config?.personaPrefix ?? '').split(NL).length).toBe(FILM_TINTIN_AGENT_PERSONA.split(NL).length)
  })

  it('DeepSeek Harness(默认智能体,照上游 openfilm)=客户端自己的 dsh:不改写模型路由,默认模型=客户端默认', () => {
    const home = tmpHome()
    const text = filmAgentPatchText('http://a:1', [], FILM_AGENT_WORK_RULES, 'deepseek', home)
    /* 模型/凭据/账号全用客户端的:补丁里没有服务端路由 */
    expect(text).not.toContain('provider: tintin-server')
    expect(text).not.toContain('llm-pi-ai')
    expect(text).not.toContain('baseURL:')
    expect(text).not.toContain('TINTIN_SERVER_API_KEY')
    /* 默认模型跟随客户端;客户端没保存过 = dsh 自身默认(agent-default-model: deepseek-flash)。
       acp-app 包给 ACP 钉的旧 id deepseek-v4-flash 不在 dsh 官方模型目录里,不沿用 */
    const acp = rowsOf(text).find((row) => row.id === 'acp')
    expect(acp?.config).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
    /* 服务端 MCP 工具行保留:编导调 create_* 生成与模型路由无关;编排工作纪律照旧 */
    expect(text).toContain('- id: mcp-tintin-server')
    expect(text).toContain('唯一出口')
    expect(text).not.toContain('「TinTin智能体」')
    /* DSH_HOME 是客户端的:技能目录与会话目录经 dsh 插件配置项指回 TinTin 的智能体目录
       (不写进客户端的技能库与会话列表;旧会话路径不变照常续接) */
    const agentDir = join(home, filmAgentHomeDir('deepseek')).replaceAll('\\', '/')
    const skills = rowsOf(text).find((row) => row.id === 'skill-filesystem')
    const sessions = rowsOf(text).find((row) => row.id === 'session-persistence-jsonl')
    expect(skills?.config).toEqual({ customSkillDirs: [`${agentDir}/skills`] })
    expect(sessions?.config).toEqual({ root: `${agentDir}/sessions` })
    /* 整份补丁是合法 YAML,纪律多行块按行保留 */
    const personaRow = rowsOf(text).find((row) => row.id === 'system-prompt')
    expect(String(personaRow?.config?.personaPrefix ?? '')).toContain('唯一出口')
  })

  it('默认模型跟随客户端:客户端保存过 agent-default-model(deepseek-official)就用它的', () => {
    const home = tmpHome()
    mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'desktop', 'cordis.patch.yml'), [
      '- id: agent-default-model', '  config:', '    provider: deepseek-official', '    model: deepseek-v4-pro', '',
    ].join(NL))
    const acp = rowsOf(filmAgentPatchText('http://a:1', [], FILM_AGENT_WORK_RULES, 'deepseek', home)).find((row) => row.id === 'acp')
    expect(acp?.config).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  })

  it('兜底默认模型 = harness base 包 agent-default-model 的模型(钉住的 dsh 换默认值时这里先红)', (t) => {
    const bundle = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deepseek-harness', 'packages', 'bundle', 'base', 'cordis.patch.yml')
    if (!existsSync(bundle)) { t.skip(); return }
    const source = readFileSync(bundle, 'utf8')
    const block = source.slice(source.indexOf('- id: agent-default-model'))
    expect(block).toMatch(/provider:\s*deepseek-official\s+model:\s*(\S+)/)
    const dshDefault = /provider:\s*deepseek-official\s+model:\s*(\S+)/.exec(block)![1]!
    const acp = rowsOf(filmAgentPatchText('http://a:1', [], FILM_AGENT_WORK_RULES, 'deepseek', tmpHome())).find((row) => row.id === 'acp')
    expect(acp?.config?.model).toBe(dshDefault)
  })
})

describe('回合工具调用护栏(2026-11-01 防空转第 2 步)', () => {
  it('阈值=告警 40/硬中止 60(实测正常回合 32 次的校准, 见 pipeline 文档 §6)', () => {
    expect(TOOL_CALL_GUARD.warn).toBe(40)
    expect(TOOL_CALL_GUARD.stop).toBe(60)
  })

  it('轮询类工具(task_status_unified)不计入:按 ACP 投影的 title 识别', () => {
    expect(isPollingToolCall('mcp__tintin-server__task_status_unified')).toBe(true)
    expect(isPollingToolCall('mcp__tintin-server__create_image')).toBe(false)
    expect(isPollingToolCall('pwsh')).toBe(false)
    expect(isPollingToolCall(undefined)).toBe(false)
    expect(isPollingToolCall(123)).toBe(false)
  })

  it('advanceToolCallGuard:39 步无声,40 步告警一次,后续无声,60 步中止', () => {
    const g = { count: 0, warned: false }
    for (let i = 0; i < 39; i++) expect(advanceToolCallGuard(g)).toBe('none')
    expect(g.count).toBe(39)
    expect(advanceToolCallGuard(g)).toBe('warn')
    expect(advanceToolCallGuard(g)).toBe('none') /* 告警只发一次 */
    g.count = TOOL_CALL_GUARD.stop - 1
    expect(advanceToolCallGuard(g)).toBe('stop')
    expect(g.count).toBe(TOOL_CALL_GUARD.stop)
  })

  it('任务层兜底(第 3 步):登记面=异步 create_*;task_id 提取(显式/裸 id);终态词结算', () => {
    expect(isAsyncCreateTool('mcp__tintin-server__create_image')).toBe(true)
    expect(isAsyncCreateTool('mcp__tintin-server__create_video')).toBe(true)
    expect(isAsyncCreateTool('mcp__tintin-server__create_music')).toBe(false) /* 同步类不登记 */
    expect(isAsyncCreateTool(undefined)).toBe(false)
    expect(extractAsyncTaskIds('{"task_id":"c_06070add-2","status":"queued"}')).toContain('c_06070add-2')
    expect(extractAsyncTaskIds('任务 c_5ce35516 已排队')).toContain('c_5ce35516')
    expect(extractAsyncTaskIds('产物 essence-bg-c_5ce35516-0.png')).toContain('c_5ce35516-0')
    /* 产物命名用连字符前缀(bgm-1730456789), 不落裸 id 误报面 */
    expect(extractAsyncTaskIds('bgm-1730456789.wav sfx-a1b2c3d4.wav')).toEqual([])
    expect(isSettledTaskText('{"status":"completed","task_id":"c_06070add-2"}')).toBe(true)
    expect(isSettledTaskText('{"status":"running"}')).toBe(false)
  })
})

describe('ensureFilmAgentPatch', () => {
  it('写入一次成文,内容不变再写为幂等,URL 变化重写(TinTin 智能体=服务端路由)', () => {
    const home = tmpHome()
    const first = ensureFilmAgentPatch(home, 'http://a:1', serverModels, 'tintin-agent')
    expect(existsSync(first)).toBe(true)
    expect(readFileSync(first, 'utf8')).toContain('baseURL: http://a:1/llm')
    expect(readFileSync(first, 'utf8')).toContain('「TinTin智能体」')
    expect(ensureFilmAgentPatch(home, 'http://a:1', serverModels, 'tintin-agent')).toBe(first)
    expect(readFileSync(first, 'utf8')).toBe(filmAgentPatchText('http://a:1', serverModels, FILM_TINTIN_AGENT_PERSONA, 'tintin-agent', home))
    ensureFilmAgentPatch(home, 'http://b:2', serverModels, 'tintin-agent')
    expect(readFileSync(first, 'utf8')).toContain('baseURL: http://b:2/llm')
    expect(first.startsWith(join(home, 'tintin'))).toBe(true)
  })

  it('缺省清单=兜底清单(服务端 /v1/models 不可达时)', () => {
    const home = tmpHome()
    const text = readFileSync(ensureFilmAgentPatch(home, 'http://a:1', undefined, 'tintin-agent'), 'utf8')
    for (const model of FILM_TINTIN_AGENT_MODELS) expect(text).toContain(`- id: ${model.id}`)
    /* 兜底清单也是原生名 */
    expect(FILM_TINTIN_AGENT_MODELS.every((model) => model.name === model.id)).toBe(true)
  })

  it('按智能体分文件:TinTin 智能体补丁带角色人设+服务端路由,DeepSeek Harness 补丁带编排纪律+客户端路由,互不覆盖', () => {
    const home = tmpHome()
    expect(filmAgentPatchFile('tintin-agent')).toBe('film-tintin-agent.patch.yml')
    expect(filmAgentPatchFile('deepseek')).toBe('film-agent.patch.yml')
    const tintin = ensureFilmAgentPatch(home, 'http://a:1', serverModels, 'tintin-agent')
    const plain = ensureFilmAgentPatch(home, 'http://a:1', undefined, 'deepseek')
    expect(tintin).not.toBe(plain)
    expect(readFileSync(tintin, 'utf8')).toBe(filmAgentPatchText('http://a:1', serverModels, FILM_TINTIN_AGENT_PERSONA, 'tintin-agent', home))
    expect(readFileSync(tintin, 'utf8')).toContain('personaPrefix: |-')
    expect(readFileSync(plain, 'utf8')).toBe(filmAgentPatchText('http://a:1', [], FILM_AGENT_WORK_RULES, 'deepseek', home))
    expect(readFileSync(plain, 'utf8')).not.toContain('「TinTin智能体」')
    expect(readFileSync(plain, 'utf8')).not.toContain('provider: tintin-server')
    /* 幂等 */
    expect(ensureFilmAgentPatch(home, 'http://a:1', serverModels, 'tintin-agent')).toBe(tintin)
  })
})

describe('DeepSeek Harness 跟随客户端「设置→模型」的 DeepSeek 配置(2026-11-23 用户裁决②)', () => {
  it('客户端自定义过目录(desktop profile patch 的 llm-deepseek 行)→ 原文并进 DeepSeek Harness 补丁;TinTin 智能体补丁不并', () => {
    const home = tmpHome()
    mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'desktop', 'cordis.patch.yml'), [
      '- id: llm-deepseek',
      '  name: "@deepseek-ai/dsh-llm-deepseek-api-key"',
      '  config:',
      '    models:',
      '      - id: deepseek-flash',
      '        name: DeepSeek-V4.1-Flash',
      '',
    ].join(NL))
    const deepseekText = readFileSync(ensureFilmAgentPatch(home, 'http://a:1', undefined, 'deepseek'), 'utf8')
    expect(deepseekText).toContain('- id: llm-deepseek')
    expect(deepseekText).toContain('name: DeepSeek-V4.1-Flash')
    expect(deepseekText).not.toContain('provider: tintin-server')
    expect(rowsOf(deepseekText).find((row) => row.id === 'llm-deepseek')).toBeTruthy()
    expect(readFileSync(ensureFilmAgentPatch(home, 'http://a:1', serverModels, 'tintin-agent'), 'utf8')).not.toContain('- id: llm-deepseek')
  })

  it('客户端没自定义过:DeepSeek Harness 补丁不含 llm-deepseek 行(智能体用 dsh 内置目录)', () => {
    const home = tmpHome()
    expect(rowsOf(readFileSync(ensureFilmAgentPatch(home, 'http://a:1', undefined, 'deepseek'), 'utf8')).some((row) => row.id === 'llm-deepseek')).toBe(false)
  })
})
