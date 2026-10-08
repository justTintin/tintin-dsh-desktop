// test/tintin-copywriting-voiceover-variants.test.ts — 文案混剪十稿全量回归（2026-10-03）
// 契约锚点：服务端 POST /copywriting/voiceover（server/api/copywriting_api.py 实读
// 2026-10-03）：formula 缺省=十稿全量（每次返回 10 种文案写法，客户端挑选确认；
// 单稿失败该稿带 error 不拖垮整体，全部失败 502），formula 锁定=单稿。
// 2026-10-03 用户裁决：文案混剪 Step1 删场景选择与时长限制（保留平台），生成改
// 十稿全量 + 客户端挑选确认一种；活服务端未部署新版时为旧版单稿形态（顶层 text）。
import { describe, expect, it } from 'vitest'
import {
  voiceoverCandidatesFromResponse,
  productDescFromInfo,
  parseVoiceoverResponse,
} from '../src/composables/copywritingMontageStep2ConcatLogic'
import { API_PATHS } from '../src/types/server-api'

describe('API_PATHS 端点注册（路径漏注册=请求 undefined 静默兜底，1003 平台下拉事故）', () => {
  it('copywriting.platforms / voiceover 已注册', () => {
    expect(API_PATHS.copywriting.platforms).toBe('/copywriting/platforms')
    expect(API_PATHS.copywriting.voiceover).toBe('/copywriting/voiceover')
  })
})

describe('voiceoverCandidatesFromResponse 十稿全量归一', () => {
  it('variants 全成功 → 10 条候选，failedFormulas 空、single=false', () => {
    const variants = Array.from({ length: 10 }, (_, i) => ({
      formula: `写法${i + 1}`, text: `文案${i + 1}`, chars: 100 + i, duration_s: 12.5, budget: 135, retried: false,
    }))
    const r = voiceoverCandidatesFromResponse({ variants, platform: '抖音', skill_id: '' })
    expect(r.single).toBe(false)
    expect(r.failedFormulas).toEqual([])
    expect(r.candidates).toHaveLength(10)
    expect(r.candidates[0]).toEqual({ formula: '写法1', text: '文案1', chars: 100, durationS: 12.5 })
  })

  it('duration_s 缺失/非法 → durationS=undefined（弹窗不显示时间），其余字段照常', () => {
    const r = voiceoverCandidatesFromResponse({
      variants: [
        { formula: '痛点式', text: '正文A' },
        { formula: '开箱实测式', text: '正文B', duration_s: -1 },
      ],
    })
    expect(r.candidates[0]?.durationS).toBeUndefined()
    expect(r.candidates[1]?.durationS).toBeUndefined()
    expect(r.candidates[1]?.chars).toBe(3)
  })

  it('variants 混合成败 → 成功稿入候选、失败稿写法名进 failedFormulas', () => {
    const r = voiceoverCandidatesFromResponse({
      variants: [
        { formula: '痛点式', text: '正文A', chars: 3 },
        { formula: '开箱实测式', error: 'LLM 超时' },
        { formula: '测评对比式', text: '正文C' }, // chars 缺失 → 按正文长度兜底
      ],
    })
    expect(r.candidates).toEqual([
      { formula: '痛点式', text: '正文A', chars: 3 },
      { formula: '测评对比式', text: '正文C', chars: 3 },
    ])
    expect(r.failedFormulas).toEqual(['开箱实测式'])
  })

  it('variants 全失败 → 空候选（调用方按 502 前置已拦，此处兜底报错路径）', () => {
    const r = voiceoverCandidatesFromResponse({
      variants: [{ formula: '痛点式', error: 'x' }, { formula: '剧情植入式', error: 'y' }],
    })
    expect(r.candidates).toEqual([])
    expect(r.failedFormulas).toEqual(['痛点式', '剧情植入式'])
    expect(r.single).toBe(false)
  })

  it('旧版/锁定单稿形态（顶层 text）→ single=true 单候选', () => {
    const r = voiceoverCandidatesFromResponse({ text: '唯一稿', chars: 3, budget: 135, retried: false })
    expect(r.single).toBe(true)
    expect(r.candidates).toEqual([{ formula: '', text: '唯一稿', chars: 3 }])
  })

  it('契约外响应（null/缺键/variants 非数组）→ 空结果不抛错，由调用方按键名报错', () => {
    for (const bad of [null, undefined, {}, { variants: 'x' }, { foo: 1 }]) {
      const r = voiceoverCandidatesFromResponse(bad)
      expect(r.candidates).toEqual([])
      expect(r.failedFormulas).toEqual([])
      expect(r.single).toBe(false)
    }
  })
})

describe('parseVoiceoverResponse 双形态容错（Step2 逐条方案自动填充）', () => {
  it('顶层 text 直接返回（旧版/锁定单稿）', () => {
    expect(parseVoiceoverResponse({ text: '正文', chars: 2 })).toBe('正文')
  })

  it('variants 形态取第一种成功稿（与新服务端十稿全量兼容）', () => {
    expect(parseVoiceoverResponse({
      variants: [
        { formula: '痛点式', error: 'x' },
        { formula: '开箱实测式', text: '第一成功稿' },
        { formula: '测评对比式', text: '第二成功稿' },
      ],
    })).toBe('第一成功稿')
  })

  it('无正文可取 → 抛错（失败必须暴露）', () => {
    expect(() => parseVoiceoverResponse(null)).toThrow('服务端未返回口播文案')
    expect(() => parseVoiceoverResponse({ variants: [{ formula: '痛点式', error: 'x' }] })).toThrow('服务端未返回口播文案')
  })
})

describe('productDescFromInfo 产品描述组包（Step1 生成入参）', () => {
  it('品牌/产品/型号「，」连接；全空回退补充卖点；再空返回空串由调用方校验', () => {
    expect(productDescFromInfo({ brand: 'A牌', product: 'B品', modelName: 'C型', extra: '卖点' })).toBe('A牌，B品，C型')
    expect(productDescFromInfo({ extra: '只有卖点' })).toBe('只有卖点')
    expect(productDescFromInfo({ brand: ' ', product: '', modelName: undefined, extra: '  ' })).toBe('')
  })
})
