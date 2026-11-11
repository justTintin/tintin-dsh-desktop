// sniff-capture 单测（2026-11-11 方案 1）：后台捕获请求校验（纯逻辑）
import { describe, expect, it } from 'vitest'
import { parseCaptureRequest } from '../src/browser/sniff-capture'

describe('sniff capture request (2026-11-11 方案 1)', () => {
  it('接受已知平台 + http(s) 地址，autoplay 原样透传', () => {
    const r = parseCaptureRequest({ platform: 'douyin', url: 'https://www.douyin.com/video/1', autoplay: true })
    expect(r).toEqual({
      ok: true,
      request: { platform: 'douyin', url: 'https://www.douyin.com/video/1', autoplay: true },
    })
    const plain = parseCaptureRequest({ platform: 'douyin', url: 'http://example.com/x' })
    expect(plain).toMatchObject({ ok: true, request: { autoplay: false } })
  })

  it('拒绝未知平台、非 http(s) 地址与空载荷', () => {
    expect(parseCaptureRequest({ platform: 'nope', url: 'https://x' })).toEqual({ ok: false, error: '未知平台: nope' })
    expect(parseCaptureRequest({ platform: 'douyin', url: 'file:///c:/x' })).toEqual({ ok: false, error: '非法捕获地址' })
    expect(parseCaptureRequest(null)).toEqual({ ok: false, error: '未知平台: ' })
  })

  it('autoplay 只认布尔 true', () => {
    const r = parseCaptureRequest({ platform: 'douyin', url: 'https://x', autoplay: 'yes' })
    expect(r.ok && r.request.autoplay).toBe(false)
  })
})
