// test/tintin-srt-vtt.test.ts — SRT→VTT 转换回归（2026-11-07 用户需求：文案混剪
// 导出 OpenFilm 项目携带字幕轨；口播整段挂 at，SRT cue（wav 自身秒）1:1 抄写）
import { describe, expect, it } from 'vitest'
import { srtToVtt } from '../lib/openfilm/srt-vtt.js'

describe('srtToVtt', () => {
  it('标准 cue：序号行/时间行/正文 → VTT 头行+点号毫秒', () => {
    const srt = [
      '1',
      '00:00:00,500 --> 00:00:02,000',
      '你好世界',
      '',
      '2',
      '00:00:02,500 --> 00:00:04,000',
      '第二行字幕',
    ].join('\n')
    expect(srtToVtt(srt)).toBe(
      'WEBVTT\n\n00:00:00.500 --> 00:00:02.000\n你好世界\n\n00:00:02.500 --> 00:00:04.000\n第二行字幕\n',
    )
  })

  it('多行正文保留换行；时间毫秒用点号也能解析', () => {
    const srt = '00:00:01.000 --> 00:00:03.000\n第一行\n第二行'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n第一行\n第二行\n')
  })

  it('容错：非 cue 块（纯序号/无时间行）与无正文块跳过', () => {
    const srt = [
      '广告行',
      '',
      '1',
      '00:00:01,000 --> 00:00:02,000',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      '有效字幕',
    ].join('\n')
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n00:00:03.000 --> 00:00:04.000\n有效字幕\n')
  })

  it('空/损坏输入 → 仅头行的合法空 VTT', () => {
    expect(srtToVtt('')).toBe('WEBVTT\n\n')
    expect(srtToVtt('不是 srt 的文本')).toBe('WEBVTT\n\n')
  })
})
