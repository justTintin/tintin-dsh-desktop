// test/tintin-creation-dreamina-logic.test.ts — 创作模式·即梦 CLI 后端纯函数回归
// （2026-10-25 用户裁决：双后端切换）。覆盖：后端字典、类型→命令映射、
// payload 组包（比例过滤注记/参考图裁剪/必填分辨率）、终态归一、轮询预算、
// 结果摘要、prefs.backend 持久化回路。
import { describe, expect, it } from 'vitest'
import {
  DREAMINA_IMAGE_RATIOS,
  DREAMINA_VIDEO_RATIOS,
  backendLabel,
  buildDreaminaPayload,
  cliResultSummary,
  cliSupportedType,
  dreaminaCommandForType,
  dreaminaPollBudget,
  dreaminaTerminal,
} from '../src/composables/creationDreaminaLogic'
import { CREATION_PREFS_DEFAULT, loadCreationPrefs, sanitizeCreationPrefs, saveCreationPrefs } from '../src/composables/creationStudioLogic'

describe('后端字典（2026-10-25 用户裁决）', () => {
  it('两个后端：tintin 缺省 / jimeng-cli，标签可反查', () => {
    expect(backendLabel('tintin')).toBe('TinTin 服务')
    expect(backendLabel('jimeng-cli')).toBe('即梦 CLI')
    expect(backendLabel('unknown')).toBe('TinTin 服务')
  })
})

describe('类型→CLI 命令映射', () => {
  it('CLI 只支持图片/视频；其余类型显式拒绝', () => {
    expect(cliSupportedType('image')).toBe(true)
    expect(cliSupportedType('video')).toBe(true)
    for (const t of ['agent', 'music', 'audio', 'digital-human', 'motion']) expect(cliSupportedType(t)).toBe(false)
    expect(() => dreaminaCommandForType('agent', 0)).toThrow(/不支持创作类型/)
  })

  it('有参考图走图生图/图生视频，无则文生', () => {
    expect(dreaminaCommandForType('image', 0)).toBe('text2image')
    expect(dreaminaCommandForType('image', 3)).toBe('image2image')
    expect(dreaminaCommandForType('video', 0)).toBe('text2video')
    expect(dreaminaCommandForType('video', 2)).toBe('image2video')
  })
})

describe('payload 组包（铁律 6：不支持显式注记，不静默）', () => {
  it('图片：分辨率档 2k、比例合法直传、参考图最多 10 张', () => {
    const p = buildDreaminaPayload({ typeId: 'image', prompt: 'x', imagePaths: ['C:/a.png'], ratio: '2:3' })
    expect(p).toMatchObject({ command: 'image2image', prompt: 'x', images: ['C:/a.png'], ratio: '2:3', resolutionType: '2k' })
    expect(p.note).toBeUndefined()
    expect(buildDreaminaPayload({ typeId: 'image', prompt: 'x', imagePaths: Array.from({ length: 12 }, (_, i) => `${i}.png`) }).images).toHaveLength(10)
  })

  it('视频：720p 档、视频端不支持的比例注记回落（3:2/2:3 仅图片端）', () => {
    const p = buildDreaminaPayload({ typeId: 'video', prompt: 'x', ratio: '3:2' })
    expect(p.command).toBe('text2video')
    expect(p.videoResolution).toBe('720p')
    expect(p.ratio).toBeUndefined()
    expect(p.note).toContain('3:2')
    expect(buildDreaminaPayload({ typeId: 'video', prompt: 'x', ratio: '9:16' }).ratio).toBe('9:16')
  })

  it('「智能」比例不传；无参考图不带 images 键', () => {
    const p = buildDreaminaPayload({ typeId: 'image', prompt: 'x', ratio: '智能' })
    expect(p.command).toBe('text2image')
    expect(p.ratio).toBeUndefined()
    expect(p.images).toBeUndefined()
  })

  it('比例支持集与 CLI -h 实测一致（包间镜像，宿主侧同表）', () => {
    expect(DREAMINA_IMAGE_RATIOS).toEqual(['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'])
    expect(DREAMINA_VIDEO_RATIOS).toEqual(['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'])
  })
})

describe('任务终态与结果摘要（SKILL.md：gen_status=success 才算成功）', () => {
  it('终态归一三态', () => {
    expect(dreaminaTerminal('success')).toBe('success')
    expect(dreaminaTerminal('fail')).toBe('fail')
    expect(dreaminaTerminal('failed')).toBe('fail')
    expect(dreaminaTerminal('querying')).toBe('querying')
    expect(dreaminaTerminal('')).toBe('querying')
  })

  it('轮询预算：图片 4 分钟 / 视频 10 分钟', () => {
    expect(dreaminaPollBudget('image')).toBe(240000)
    expect(dreaminaPollBudget('video')).toBe(600000)
  })

  it('摘要：链接逐行 + 落盘目录；失败带原因', () => {
    const ok = cliResultSummary({ submitId: 's1', mediaUrls: ['https://cdn/a.mp4'], localDir: 'C:/d/s1' })
    expect(ok).toContain('submit_id: s1')
    expect(ok).toContain('https://cdn/a.mp4')
    expect(ok).toContain('已保存到：C:/d/s1')
    expect(cliResultSummary({ submitId: 's2', failReason: '审核未过' })).toBe('生成失败：审核未过')
    expect(cliResultSummary({ submitId: 's3' })).toContain('未取到媒体链接')
  })
})

describe('prefs.backend 持久化回路', () => {
  it('缺省 tintin；jimeng-cli 可保存回读；非法值回 tintin', () => {
    expect(CREATION_PREFS_DEFAULT.backend).toBe('tintin')
    expect(sanitizeCreationPrefs({ backend: 'jimeng-cli' }).backend).toBe('jimeng-cli')
    expect(sanitizeCreationPrefs({ backend: 'other' }).backend).toBe('tintin')
    expect(sanitizeCreationPrefs({}).backend).toBe('tintin')
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    saveCreationPrefs({ ...CREATION_PREFS_DEFAULT, backend: 'jimeng-cli' }, storage)
    expect(loadCreationPrefs(storage).backend).toBe('jimeng-cli')
  })
})
