// test/tintin-creation-generate-logic.test.ts — 真生成纯函数回归（2026-10-30）
// 覆盖：发送路由（技能后端优先/类型×后端/CLI 不支持显式阻断）、generate 请求体
//（智能不携带 aspect、2000 字硬校验）、生成提示词组包（剥六视图 URL 行）、
// unified 终态归一与进度文案、result 宽口径解析、错误截断、摘要组包。
import { describe, expect, it } from 'vitest'
import {
  absoluteMediaUrl,
  buildGenerateBody,
  buildGenerationPrompt,
  generatePollBudget,
  generateResultSummary,
  parseGenerateResult,
  resolveSendRoute,
  truncateServerError,
  unifiedPhase,
  unifiedProgressLabel,
} from '../src/composables/creationGenerateLogic'
import { BUILTIN_CREATION_SKILLS, type CreationSkill } from '../src/composables/creationStudioLogic'

describe('resolveSendRoute 发送路由（2026-10-30 双形态纠偏：非 Agent 不使用技能）', () => {
  const plain: CreationSkill = { id: 's', name: 'n', emoji: 'x', template: 't' }
  it('非 Agent 类型优先于技能后端：图片/视频=真生成，技能不劫持', () => {
    expect(resolveSendRoute({ backend: 'tintin', typeId: 'image', skill: { ...plain, backend: 'voiceover' } })).toBe('generate')
    expect(resolveSendRoute({ backend: 'tintin', typeId: 'video', skill: { ...plain, backend: 'copy' } })).toBe('generate')
    expect(resolveSendRoute({ backend: 'jimeng-cli', typeId: 'image', skill: { ...plain, backend: 'voiceover' } })).toBe('cli')
    expect(resolveSendRoute({ backend: 'jimeng-cli', typeId: 'video', skill: null })).toBe('cli')
  })
  it('Agent 模式走技能自带后端：voiceover/copy 优先，裸技能=llm', () => {
    expect(resolveSendRoute({ backend: 'tintin', typeId: 'agent', skill: { ...plain, backend: 'voiceover' } })).toBe('voiceover')
    expect(resolveSendRoute({ backend: 'jimeng-cli', typeId: 'agent', skill: { ...plain, backend: 'copy' } })).toBe('copy')
    expect(resolveSendRoute({ backend: 'tintin', typeId: 'agent', skill: plain })).toBe('llm')
    expect(resolveSendRoute({ backend: 'tintin', typeId: 'agent', skill: null })).toBe('llm')
  })
  it('非生成的其余类型：tintin→llm 提示词方案；jimeng-cli 显式阻断不静默回落', () => {
    expect(resolveSendRoute({ backend: 'tintin', typeId: 'digital-human', skill: plain })).toBe('llm')
    expect(resolveSendRoute({ backend: 'jimeng-cli', typeId: 'music', skill: plain })).toBe('cli-unsupported')
  })
})

describe('buildGenerateBody 请求体（live OpenAPI 契约）', () => {
  it('prompt 去空白；「智能」不携带 aspect，具体比例携带', () => {
    expect(buildGenerateBody({ kind: 'image', prompt: ' 一只猫 ' })).toEqual({ prompt: '一只猫' })
    expect(buildGenerateBody({ kind: 'video', prompt: 'x', ratio: '智能' })).toEqual({ prompt: 'x' })
    expect(buildGenerateBody({ kind: 'image', prompt: 'x', ratio: '9:16' })).toEqual({ prompt: 'x', aspect: '9:16' })
  })
  it('视频档 resolution/duration 仅非空携带；图片类型忽略这两参', () => {
    expect(buildGenerateBody({ kind: 'video', prompt: 'x', resolution: '720p', durationS: 10 })).toEqual({ prompt: 'x', resolution: '720p', duration: 10 })
    expect(buildGenerateBody({ kind: 'video', prompt: 'x', resolution: '', durationS: 0 })).toEqual({ prompt: 'x' })
    expect(buildGenerateBody({ kind: 'image', prompt: 'x', resolution: '720p', durationS: 10 })).toEqual({ prompt: 'x' })
  })
  it('空 prompt 与超 2000 字显式报错（不静默截断）', () => {
    expect(() => buildGenerateBody({ kind: 'image', prompt: '  ' })).toThrow(/为空/)
    expect(() => buildGenerateBody({ kind: 'image', prompt: '字'.repeat(2001) })).toThrow(/2000/)
  })
})

describe('buildGenerationPrompt 生成提示词组包', () => {
  it('模板组包后剥「六视图参考：」行，主体/卖点/参数保留', () => {
    const prompt = buildGenerationPrompt({
      skill: BUILTIN_CREATION_SKILLS[0],
      input: '运动相机广告',
      subjects: [{
        id: 'a',
        name: 'G304黑',
        product: { id: 'P1', model: '910', sellingPoints: ['低延迟'], sixViews: [{ view: 'front', url: 'http://x/1.png' }] },
      }],
    })
    expect(prompt).toContain('运动相机广告')
    expect(prompt).toContain('主体：')
    expect(prompt).toContain('卖点：低延迟')
    expect(prompt).not.toContain('六视图参考')
    expect(prompt).not.toContain('http://x/1.png')
  })
  it('超 2000 字报错带实际长度；空组包报错', () => {
    expect(() => buildGenerationPrompt({ input: '字'.repeat(2001) })).toThrow(/2001/)
    expect(() => buildGenerationPrompt({ input: '  ' })).toThrow(/为空/)
  })
})

describe('unifiedPhase/unifiedProgressLabel 终态归一（2026-10-30 实测枚举）', () => {
  it('completed/failed/cancelled 三终态（含拼写变体），未知按进行中', () => {
    expect(unifiedPhase('completed')).toBe('completed')
    expect(unifiedPhase('success')).toBe('completed')
    expect(unifiedPhase('failed')).toBe('failed')
    expect(unifiedPhase('cancelled')).toBe('cancelled')
    expect(unifiedPhase('canceled')).toBe('cancelled')
    expect(unifiedPhase('running')).toBe('active')
    expect(unifiedPhase('pending')).toBe('active')
    expect(unifiedPhase(undefined)).toBe('active')
    expect(unifiedPhase('WAT')).toBe('active')
  })
  it('进度文案：0%=排队中，>0=生成中 N%，终态空串', () => {
    expect(unifiedProgressLabel('running', 0)).toBe('排队中…')
    expect(unifiedProgressLabel('running', 40.4)).toBe('生成中 40%')
    expect(unifiedProgressLabel('running', undefined)).toBe('排队中…')
    expect(unifiedProgressLabel('completed', 100)).toBe('')
  })
})

describe('parseGenerateResult 宽口径解析（无历史样本可对照，不漏产物）', () => {
  it('主形态 output_url + 引擎/job/尺寸元数据', () => {
    const m = parseGenerateResult({ output_url: '/files/a.png', engine: 'comfygen', job_id: 'j1', width: 1024, height: 768, duration_sec: 5, seed_used: 42 })
    expect(m.urls).toEqual(['/files/a.png'])
    expect(m.engine).toBe('comfygen')
    expect(m.jobId).toBe('j1')
    expect(m.width).toBe(1024)
    expect(m.height).toBe(768)
    expect(m.durationSec).toBe(5)
    expect(m.seedUsed).toBe(42)
  })
  it('string/数组/files 列表/output_path/url/path 防御；去重；空结果 urls 空', () => {
    expect(parseGenerateResult('http://x/1.png').urls).toEqual(['http://x/1.png'])
    expect(parseGenerateResult(['http://x/1.png', 'http://x/1.png', '']).urls).toEqual(['http://x/1.png'])
    expect(parseGenerateResult({ output_path: '/data/a.mp4' }).urls).toEqual(['/data/a.mp4'])
    expect(parseGenerateResult({ files: [{ url: 'u1' }, { path: 'p1' }, 'raw'] }).urls).toEqual(['u1', 'p1', 'raw'])
    expect(parseGenerateResult(null).urls).toEqual([])
    expect(parseGenerateResult({}).urls).toEqual([])
  })
})

describe('generateResultSummary / truncateServerError / absoluteMediaUrl / 轮询预算', () => {
  it('摘要=URL 逐行+引擎/job/任务号注记；无产物给复查行', () => {
    const s = generateResultSummary({ media: { urls: ['http://x/a.png'], engine: 'comfygen', jobId: 'j9' }, taskId: 'c_1' })
    expect(s).toContain('http://x/a.png')
    expect(s).toContain('引擎 comfygen · job j9 · 任务 c_1')
    const empty = generateResultSummary({ media: { urls: [] }, taskId: 'c_2' })
    expect(empty).toContain('未返回产物地址')
    expect(empty).toContain('任务 c_2')
  })
  it('traceback 截断=首行+末行，超长加省略号；空串出空串', () => {
    const tb = 'media job x 取消\nTraceback (most recent call last):\n  File "q" ...\nComfygenJobCancelled: 取消'
    const out = truncateServerError(tb)
    expect(out).toContain('media job x 取消')
    expect(out).toContain('ComfygenJobCancelled: 取消')
    expect(out).not.toContain('Traceback (most')
    expect(truncateServerError('')).toBe('')
    expect(truncateServerError('单行'.repeat(400)).length).toBeLessThanOrEqual(301)
  })
  it('相对产物地址按基址绝对化；绝对/空基址原样', () => {
    expect(absoluteMediaUrl('http://s:8000', '/files/a.png')).toBe('http://s:8000/files/a.png')
    expect(absoluteMediaUrl('http://s:8000', 'files/a.png')).toBe('http://s:8000/files/a.png')
    expect(absoluteMediaUrl('http://s:8000', 'http://x/a.png')).toBe('http://x/a.png')
    expect(absoluteMediaUrl('', '/files/a.png')).toBe('/files/a.png')
  })
  it('轮询预算：图 15 分钟 / 视频 30 分钟（与宿主 openfilm-tools 同口径）', () => {
    expect(generatePollBudget('image')).toBe(15 * 60 * 1000)
    expect(generatePollBudget('video')).toBe(30 * 60 * 1000)
  })
})
