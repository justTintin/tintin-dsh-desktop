// test/tintin-shot-track-resolve.test.ts — 四源四轨解析回归（2026-11-26 用户裁决：
// 不同视频源=不同轨道各一占位；合成时每镜至少一条轨道有内容；右列单选标记轨优先；
// 无标记素材轨兜底，再按 ai > stock > aroll；全空报缺。）
import { describe, expect, it } from 'vitest'
import { markedShotIdxs, resolveShotTrack } from '../src/composables/copywritingMontageTrackLogic'
import type { StoryboardShot } from '../src/composables/opsStoryboardLogic'

const shot = (over: Partial<Pick<StoryboardShot, 'markARoll' | 'markAI' | 'slots'>> = {}): StoryboardShot =>
  ({ index: 1, markARoll: undefined, markAI: undefined, slots: undefined, ...over }) as unknown as StoryboardShot

describe('resolveShotTrack 四源四轨解析', () => {
  it('标记轨优先：aroll/ai 标记且有产物 → 各自轨道', () => {
    expect(resolveShotTrack(shot({ markARoll: true, slots: { aroll: { local: 'a.mp4' } } }), true))
      .toEqual({ track: 'aroll', local: 'a.mp4' })
    expect(resolveShotTrack(shot({ markAI: true, slots: { gen: { local: 'g.mp4' } } }), true))
      .toEqual({ track: 'gen', local: 'g.mp4' })
  })

  it('两复选互不排斥：同时标记时 A-Roll 优先（有产物），A-Roll 缺产物落 AI 轨', () => {
    expect(resolveShotTrack(shot({ markARoll: true, markAI: true, slots: { aroll: { local: 'a.mp4' } } }), false))
      .toEqual({ track: 'aroll', local: 'a.mp4' })
    expect(resolveShotTrack(shot({ markARoll: true, markAI: true, slots: { gen: { local: 'g.mp4' } } }), false))
      .toEqual({ track: 'gen', local: 'g.mp4' })
  })

  it('标记轨缺产物回落：标记 ai 但无产物、素材轨有 → material', () => {
    expect(resolveShotTrack(shot({ markAI: true }), true)).toEqual({ track: 'material' })
    // 标记 aroll 无产物，AI 轨有 → 兜底 gen（素材轨为空时）
    expect(resolveShotTrack(shot({ markARoll: true, slots: { gen: { local: 'g.mp4' } } }), false))
      .toEqual({ track: 'gen', local: 'g.mp4' })
  })

  it('无标记：素材轨兜底优先；无绑定按 ai > stock > aroll', () => {
    expect(resolveShotTrack(shot(), true)).toEqual({ track: 'material' })
    expect(resolveShotTrack(shot({ slots: { gen: { local: 'g' }, stock: { local: 's', url: 'u' }, aroll: { local: 'a' } } }), false))
      .toEqual({ track: 'gen', local: 'g' })
    expect(resolveShotTrack(shot({ slots: { stock: { local: 's', url: 'u' }, aroll: { local: 'a' } } }), false))
      .toEqual({ track: 'stock', local: 's' })
    expect(resolveShotTrack(shot({ slots: { aroll: { local: 'a' } } }), false))
      .toEqual({ track: 'aroll', local: 'a' })
  })

  it('全空 → null（合成校验报「必须有一个」）；空 local 视为无产物', () => {
    expect(resolveShotTrack(shot(), false)).toBeNull()
    expect(resolveShotTrack(shot({ slots: { gen: { local: '' } } }), false)).toBeNull()
  })
})

describe('markedShotIdxs 批量标记过滤', () => {
  it('只取复选命中且该轨尚无产物的镜下标', () => {
    const shots = [
      shot({ markAI: true }),
      shot({ markAI: true, slots: { gen: { local: 'done.mp4' } } }), // 已有产物不重做
      shot({ markARoll: true }),
      shot(),
    ]
    expect(markedShotIdxs(shots, 'ai')).toEqual([0])
    expect(markedShotIdxs(shots, 'aroll')).toEqual([2])
  })
})
