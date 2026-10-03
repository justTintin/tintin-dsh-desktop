// test/tintin-script-platform-prompt.test.ts — 文案混剪投放平台织入回归（2026-10-03）
// 契约锚点：服务端 GET /copywriting/platforms（{default, platforms:[{name,guide}]}，
// 实测 2026-10-03：抖音/小红书/公众号，各带口播风格指引）；用户裁决=文案混剪场景
// 后平台下拉（默认抖音），平台口播风格指引织入系统提示词（同场景指令惯例）。
import { describe, expect, it } from 'vitest'
import { buildScriptSystemPrompt } from '../src/composables/copywritingMontageStep2ConcatLogic'

describe('buildScriptSystemPrompt 投放平台织入', () => {
  it('平台+guide → 织入「## 投放平台」块（名称+指引同段）', () => {
    const out = buildScriptSystemPrompt('BASE', {
      platform: '抖音',
      platformGuide: '抖音口播：前3秒钩子决定生死，开头必须抓人；短句为主、节奏快。',
    })
    expect(out).toContain('## 投放平台')
    expect(out).toContain('抖音。抖音口播：前3秒钩子决定生死')
  })

  it('平台无 guide → 只织入平台名；无平台 → 不出投放平台块', () => {
    const nameOnly = buildScriptSystemPrompt('BASE', { platform: '小红书' })
    expect(nameOnly).toContain('## 投放平台\n小红书')
    expect(nameOnly).not.toContain('## 投放平台\n小红书。')

    const none = buildScriptSystemPrompt('BASE', { scene: 'general' })
    expect(none).not.toContain('## 投放平台')
  })

  it('平台块与场景/建议时长/产品信息块并存且顺序稳定', () => {
    const out = buildScriptSystemPrompt('BASE', {
      scene: 'general',
      suggestSec: 30,
      platform: '抖音',
      platformGuide: 'g',
      brand: 'B', product: 'P',
    })
    const iScene = out.indexOf('## 场景')
    const iPlat = out.indexOf('## 投放平台')
    const iDur = out.indexOf('## 建议时长')
    const iProd = out.indexOf('## 产品信息')
    expect([iScene, iPlat, iDur, iProd].every((i) => i >= 0)).toBe(true)
    expect([iScene, iPlat, iDur, iProd]).toEqual([... [iScene, iPlat, iDur, iProd]].sort((a, b) => a - b))
  })
})
