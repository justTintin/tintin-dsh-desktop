// tests/film-acp.spec.ts — 影片智能体 ACP 桥的纯函数面:补丁文本形状与幂等落盘。
// (子进程/协议面由探针 C:\Users\Administrator\.tintin-film-acp-probe 实机验证,2026-10-23。)
import { existsSync, readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  ensureFilmAgentPatch,
  FILM_AGENT_MODELS,
  FILM_TINTIN_AGENT_MODELS,
  FILM_TINTIN_AGENT_PERSONA,
  filmAgentPatchFile,
  filmAgentPatchText,
} from '../src/tintin/film-acp.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('filmAgentPatchText', () => {
  it('路由到服务端 /llm,含全部模型与 acp 默认模型,尾斜杠归一', () => {
    const text = filmAgentPatchText('http://192.168.111.31:8000/')
    expect(text).toContain('baseURL: http://192.168.111.31:8000/llm')
    expect(text).toContain('apiKeyEnv: TINTIN_SERVER_API_KEY')
    expect(text).toContain('- id: deepseek-v4-flash')
    expect(text).toContain('provider: tintin-server')
    expect(text).toContain('model: deepseek-v4-flash')
    expect(text).not.toMatch(/8000\/\/llm/)
    /* MCP 挂载行(2026-10-30):rc.2 会话参数失效,补丁行进程级挂载服务端工具箱;
       新行必须 insert(顶层 - id: 行=更新语义,目标不存在=静默忽略) */
    expect(text).toContain('- insert:')
    expect(text).toContain('- id: mcp-tintin-server')
    expect(text).toContain("name: '@deepseek-ai/dsh-mcp-client'")
    expect(text).toContain('serverName: tintin-server')
    expect(text).toContain('transport: streamable-http')
    expect(text).toContain('url: http://192.168.111.31:8000/mcp')
  })

  it('模型清单可覆盖,首个为默认', () => {
    const text = filmAgentPatchText('http://a:1', [{ id: 'm-2', name: 'M2' }])
    expect(text).toContain('model: m-2')
    expect(text).not.toContain('deepseek-v4-flash')
    expect(FILM_AGENT_MODELS.length).toBeGreaterThan(0)
  })

  it('TinTin智能体角色:模型显示名=TinTin智能体,人设列出服务端子智能体(视频/图片/音乐/音频/口播/数字人)', () => {
    const text = filmAgentPatchText('http://a:1', FILM_TINTIN_AGENT_MODELS, FILM_TINTIN_AGENT_PERSONA)
    expect(text).toContain('- id: system-prompt')
    expect(text).toContain('personaPrefix: |-')
    expect(text).toContain('「TinTin智能体」')
    /* 五个主子智能体 + 数字人 + 轮询, 工具名以 2026-10-30 /mcp tools/list 实测为准 */
    for (const tool of ['create_video', 'create_image', 'create_music', 'create_audio', 'create_digital_human', 'task_status_unified']) {
      expect(text).toContain(tool)
    }
    expect(text).toContain('视频生成')
    expect(text).toContain('图片生成')
    expect(text).toContain('音乐生成')
    expect(text).toContain('口播生成')
    expect(text).not.toContain('{{')
    /* 模型行显示名即角色名,底层模型 id 不变(选择器按钮因此显示「TinTin智能体」) */
    expect(text).toContain('name: TinTin智能体')
    expect(text).toContain('- id: deepseek-v4-flash')
    expect(text).toContain('model: deepseek-v4-flash')
    /* 人设块不破坏后续 YAML 行的缩进结构 */
    expect(text).toContain('\n- id: llm-pi-ai')
    /* 整份补丁是合法 YAML,人设多行块按行保留 */
    const doc = parse(text) as Array<{ id: string; config?: Record<string, unknown> }>
    const personaRow = doc.find((row) => row.id === 'system-prompt')
    expect(String(personaRow?.config?.personaPrefix ?? '')).toContain('create_video')
    expect((personaRow?.config?.personaPrefix as string).split('\n').length).toBe(FILM_TINTIN_AGENT_PERSONA.split('\n').length)
  })

  it('人设缺省(编导角色)不产出 system-prompt 行', () => {
    const text = filmAgentPatchText('http://a:1')
    expect(text).not.toContain('system-prompt')
  })
})

describe('ensureFilmAgentPatch', () => {
  it('写入一次成文,内容不变再写为幂等,URL 变化重写', () => {
    const home = mkdtempSync(join(tmpdir(), 'film-acp-'))
    dirs.push(home)
    const first = ensureFilmAgentPatch(home, 'http://a:1')
    expect(existsSync(first)).toBe(true)
    expect(readFileSync(first, 'utf8')).toContain('baseURL: http://a:1/llm')
    expect(ensureFilmAgentPatch(home, 'http://a:1')).toBe(first)
    expect(readFileSync(first, 'utf8')).toBe(filmAgentPatchText('http://a:1'))
    ensureFilmAgentPatch(home, 'http://b:2')
    expect(readFileSync(first, 'utf8')).toContain('baseURL: http://b:2/llm')
    expect(first.startsWith(join(home, 'tintin'))).toBe(true)
  })

  it('按角色分文件:TinTin智能体补丁带人设,编导补丁无人设,互不覆盖', () => {
    const home = mkdtempSync(join(tmpdir(), 'film-acp-'))
    dirs.push(home)
    expect(filmAgentPatchFile('tintin-agent')).toBe('film-tintin-agent.patch.yml')
    expect(filmAgentPatchFile('deepseek')).toBe('film-agent.patch.yml')
    const tintin = ensureFilmAgentPatch(home, 'http://a:1', undefined, 'tintin-agent')
    const plain = ensureFilmAgentPatch(home, 'http://a:1', undefined, 'deepseek')
    expect(tintin).not.toBe(plain)
    expect(readFileSync(tintin, 'utf8')).toBe(filmAgentPatchText('http://a:1', FILM_TINTIN_AGENT_MODELS, FILM_TINTIN_AGENT_PERSONA))
    expect(readFileSync(tintin, 'utf8')).toContain('personaPrefix: |-')
    expect(readFileSync(plain, 'utf8')).not.toContain('system-prompt')
    /* 幂等 */
    expect(ensureFilmAgentPatch(home, 'http://a:1', undefined, 'tintin-agent')).toBe(tintin)
  })
})
