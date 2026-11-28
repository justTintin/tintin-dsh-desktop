// test/tintin-aroll-audio-align.test.ts — A-Roll 声波对齐器纯函数回归
// （2026-11-27 用户裁决「声音的对齐就是声波」：切窗/脚本窗只是生成驱动信号，帧级
//  偏移跨镜累积——唯一实测锚点=产物自带音轨与整段旁白的波形互相关定位。）
import { describe, expect, it } from 'vitest'
import {
  MATCH_SCORE_MIN,
  bestAlignOffset,
  normalizeEnvelope,
  pcmBytesToEnvelope,
} from '../lib/montage/aroll-audio-align.js'

/** 合成「语音突发」旁白包络：[from,to) 置幅值 amp 并叠确定性调制（真实语音包络
 *  具备逐采样方差——恒定幅值会使 NCC 零方差退化成无意义 ±1），其余留底噪 */
function burstNarration(secs = 30, envRate = 100, bursts: Array<[number, number, number]> = [[5, 8, 1], [12, 17, 0.9], [25, 29, 1]]): Float64Array {
  const env = new Float64Array(secs * envRate).fill(0.05)
  const noise = (i: number) => 0.7 + 0.3 * Math.abs(Math.sin(i * 12.9898) % 1)
  for (const [a, b, amp] of bursts) {
    for (let i = a * envRate; i < b * envRate && i < env.length; i++) env[i] = amp * noise(i)
  }
  return env
}

describe('pcmBytesToEnvelope：s16le → 峰值包络降采样', () => {
  it('按 srcRate/envRate 步进取窗口峰值并归一到 [0,1]', () => {
    // 200 采样 @200Hz → envRate 100 → 步长 2、输出 100 帧；前半采样幅值 16384、后半 8192
    const bytes = new Uint8Array(200 * 2)
    const view = new DataView(bytes.buffer)
    for (let j = 0; j < 200; j++) view.setInt16(j * 2, j < 100 ? 16384 : 8192, true)
    const env = pcmBytesToEnvelope(bytes, 200, 100)
    expect(env.length).toBe(100)
    expect(env[0]).toBeCloseTo(0.5, 5)
    expect(env[49]).toBeCloseTo(0.5, 5) // 窗 49 覆盖采样 98-99（前半段 16384）
    expect(env[50]).toBeCloseTo(0.25, 5) // 窗 50 覆盖采样 100-101（后半段 8192）
    expect(env[99]).toBeCloseTo(0.25, 5)
  })

  it('空输入返回空包络', () => {
    expect(pcmBytesToEnvelope(new Uint8Array(0), 200, 100).length).toBe(0)
  })
})

describe('normalizeEnvelope：去均值/单位方差', () => {
  it('[1,2,3] → 均值 0、标准差 1', () => {
    const out = normalizeEnvelope(new Float64Array([1, 2, 3]))
    const mean = (out[0] + out[1] + out[2]) / 3
    expect(mean).toBeCloseTo(0, 5)
    const std = Math.sqrt((out[0] ** 2 + out[1] ** 2 + out[2] ** 2) / 3)
    expect(std).toBeCloseTo(1, 5)
  })
})

describe('bestAlignOffset：NCC 波形互相关定位', () => {
  it('同源切段精确回定位：offset=切窗起点，score 高（≥0.9）', () => {
    const narr = burstNarration()
    const seg = narr.slice(12 * 100, 17 * 100) // 12-17s 切段
    const { offsetSec, score } = bestAlignOffset(narr, seg, 100)
    expect(Math.abs(offsetSec - 12)).toBeLessThanOrEqual(0.02)
    expect(score).toBeGreaterThan(0.9)
    expect(score).toBeGreaterThanOrEqual(MATCH_SCORE_MIN)
  })

  it('幅值缩放不破坏定位：×0.8 后仍命中（响度差异容忍）', () => {
    const narr = burstNarration()
    const raw = narr.slice(25 * 100, 29 * 100)
    const seg = new Float64Array(raw.length).map((_, i) => raw[i] * 0.8)
    const { offsetSec, score } = bestAlignOffset(narr, seg, 100)
    expect(Math.abs(offsetSec - 25)).toBeLessThanOrEqual(0.02)
    expect(score).toBeGreaterThan(0.9)
  })

  it('无关波形（恒定幅值，零方差）score 不达匹配阈值', () => {
    const narr = burstNarration()
    const seg = new Float64Array(3 * 100).fill(0.5)
    const { score } = bestAlignOffset(narr, seg, 100, 0, 27)
    expect(score).toBeLessThan(MATCH_SCORE_MIN)
  })

  it('搜索窗限定 [fromSec,toSec)：窗外真实位置不会被命中（score 低于阈值）', () => {
    const narr = burstNarration()
    const seg = narr.slice(12 * 100, 17 * 100)
    const { offsetSec, score } = bestAlignOffset(narr, seg, 100, 20, 30)
    expect(offsetSec).toBeGreaterThanOrEqual(20)
    expect(score).toBeLessThan(MATCH_SCORE_MIN)
  })

  it('段长 > 旁白：非法输入返回 offsetSec=-1', () => {
    const narr = new Float64Array(100)
    const seg = new Float64Array(200)
    expect(bestAlignOffset(narr, seg, 100).offsetSec).toBe(-1)
  })
})
