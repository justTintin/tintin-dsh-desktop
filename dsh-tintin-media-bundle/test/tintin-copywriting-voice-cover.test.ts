// test/tintin-copywriting-voice-cover.test.ts — 语音覆盖拟合回归
// （2026-11-27 对齐方向裁决：Σ视频槽位 = 旁白时长，精确相等——aroll 内在时长锁死
//  （生成偏移下 best-effort 防二次错位），非 aroll 段双向缩放到 (旁白-aroll 总长)）
import { describe, expect, it } from 'vitest'
import { applyVoiceCoverFit } from '../src/composables/copywritingMontageStep4FxBgmLogic'

describe('语音覆盖拟合（2026-11-27 裁决：Σ视频槽位 = 旁白时长）', () => {
  it('旁白>视频总长：非 aroll 段升到精确覆盖（Σ=旁白）', () => {
    // 素材 1+1s + aroll 5s，旁白 10s：目标=10-5=5s → 素材段 ×2.5
    const { durs, arollOverVoice } = applyVoiceCoverFit([
      { durSec: 1, trackKind: 'material' },
      { durSec: 1, trackKind: 'material' },
      { durSec: 5, trackKind: 'aroll' },
    ], 10)
    expect(durs).toEqual([2.5, 2.5, 5])
    expect(durs.reduce((a, b) => a + b, 0)).toBe(10)
    expect(arollOverVoice).toBe(false)
  })

  it('旁白<视频总长：非 aroll 段降（裁素材）到精确覆盖，aroll 锁死', () => {
    // 素材 4s + aroll 3s，旁白 5s：目标=5-3=2s → 素材段 ×0.5
    const { durs, arollOverVoice } = applyVoiceCoverFit([
      { durSec: 4, trackKind: 'material' },
      { durSec: 3, trackKind: 'aroll' },
    ], 5)
    expect(durs).toEqual([2, 3])
    expect(durs.reduce((a, b) => a + b, 0)).toBe(5)
    expect(arollOverVoice).toBe(false)
  })

  it('aroll 总长已超旁白：b-roll 压 0.1s 下限 + arollOverVoice=true（服务端切窗漂移信号）', () => {
    const { durs, arollOverVoice } = applyVoiceCoverFit([
      { durSec: 1, trackKind: 'material' },
      { durSec: 6, trackKind: 'aroll' },
    ], 5)
    expect(durs[0]).toBe(0.1)
    expect(durs[1]).toBe(6)
    expect(arollOverVoice).toBe(true)
  })

  it('舍入残差归末个 b-roll 段：Σ 精确等于旁白时长', () => {
    // 素材 1×3 + aroll 3s，旁白 7s：目标=4s，×4/3 → 1.33/1.33/1.34（残差 0.01 入末段）
    const { durs } = applyVoiceCoverFit([
      { durSec: 1, trackKind: 'material' },
      { durSec: 1, trackKind: 'material' },
      { durSec: 1, trackKind: 'material' },
      { durSec: 3, trackKind: 'aroll' },
    ], 7)
    expect(durs).toEqual([1.33, 1.33, 1.34, 3])
    expect(durs.reduce((a, b) => a + b, 0)).toBe(7)
  })

  it('旁白时长缺失（探测失败=0）：原样回退（回退方案口径）', () => {
    const segs = [{ durSec: 2, trackKind: 'stock' }]
    const { durs, arollOverVoice } = applyVoiceCoverFit(segs, 0)
    expect(durs).toEqual([2])
    expect(arollOverVoice).toBe(false)
  })
})
