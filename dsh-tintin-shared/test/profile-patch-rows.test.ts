// test/profile-patch-rows.test.ts — dsh profile patch 条目提取 + 客户端 DeepSeek 配置读取
// (2026-11-24,照上游 openfilm 的默认智能体处理方式)
//
// 上游把 DeepSeek Harness 当「用户自己的 dsh」拉起(dsh --profile acp,用户自己的 home),
// 模型清单=该会话自己报的。智能体补丁据此不改写模型路由,只跟随客户端的 DeepSeek 配置:
// 客户端「设置→模型」持久在主 home 的 profiles/desktop/cordis.patch.yml(顶层 YAML 数组,
// - id: 开条目)——按 id 取 agent-default-model(客户端默认模型)与 llm-deepseek(自定义目录)。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractPatchRows, readClientDeepseekConfig } from '../lib/profile-patch-rows.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-rows-'))
  dirs.push(dir)
  return dir
}
const patchFile = (dir: string): string => join(dir, 'profiles', 'desktop', 'cordis.patch.yml')
const writePatch = (dir: string, lines: string[]): void => {
  mkdirSync(join(dir, 'profiles', 'desktop'), { recursive: true })
  writeFileSync(patchFile(dir), lines.join('\n'))
}

const patchDoc = [
  '# Your patch layer for this dsh profile',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: deepseek-official',
  '    model: deepseek-v4-pro',
  '- id: llm-deepseek',
  '  name: "@deepseek-ai/dsh-llm-deepseek-api-key"',
  '  config:',
  '    models:',
  '      - id: deepseek-flash',
  '        name: DeepSeek-V4.1-Flash',
  '- insert:',
  '    - id: mcp-somewhere',
  '- id: ui-theme',
  '  config:',
  '    preference: dark',
  '',
]

describe('extractPatchRows(主 home profile patch → 指定 id 的条目原文)', () => {
  it('只取指定 id 的条目,原文块完整(体内嵌套 - id: 不被误拆),其余条目不带入', () => {
    const dir = home()
    writePatch(dir, patchDoc)
    const rows = extractPatchRows(patchFile(dir), ['llm-deepseek', 'agent-default-model'])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(['- id: agent-default-model', '  name: "@deepseek-ai/dsh-agent-default-model"', '  config:', '    provider: deepseek-official', '    model: deepseek-v4-pro'].join('\n'))
    expect(rows[1]).toContain('      - id: deepseek-flash') // 嵌套模型行保留在块内
    expect(rows[1]).toContain('name: DeepSeek-V4.1-Flash')
    expect(rows.join('\n')).not.toContain('- insert:')
    expect(rows.join('\n')).not.toContain('ui-theme')
  })

  it('文件缺失 / 无匹配 id = []', () => {
    const dir = home()
    expect(extractPatchRows(patchFile(dir), ['llm-deepseek'])).toEqual([])
    writePatch(dir, ['- id: ui-theme', '  config:', '    preference: dark', ''])
    expect(extractPatchRows(patchFile(dir), ['llm-deepseek'])).toEqual([])
  })
})

describe('readClientDeepseekConfig(DeepSeek Harness 智能体跟随客户端的 DeepSeek 配置)', () => {
  it('客户端未自定义:dsh 自身默认模型,无目录行', () => {
    const dir = home()
    expect(readClientDeepseekConfig(dir)).toEqual({ defaultModel: 'deepseek-flash', catalogRow: null })
  })

  it('客户端保存过默认模型(agent-default-model,provider=deepseek-official)→ 跟随', () => {
    const dir = home()
    writePatch(dir, patchDoc)
    const config = readClientDeepseekConfig(dir)
    expect(config.defaultModel).toBe('deepseek-v4-pro')
    expect(config.catalogRow).toContain('- id: llm-deepseek')
    expect(config.catalogRow).toContain('DeepSeek-V4.1-Flash')
  })

  it('客户端默认模型选的是别的 provider(非 deepseek-official)→ 不跟随,落 dsh 自身默认', () => {
    const dir = home()
    writePatch(dir, ['- id: agent-default-model', '  config:', '    provider: zai-coding-cn', '    model: glm-5.3-flash', ''])
    expect(readClientDeepseekConfig(dir).defaultModel).toBe('deepseek-flash')
  })
})
