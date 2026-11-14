// sniff-capture 单测（2026-11-11 方案 1）：后台捕获请求校验（纯逻辑）+ 文件名解析（2026-11-13 扩展名保全）
import { describe, expect, it } from 'vitest'
import { parseCaptureRequest, resolveSniffFilename } from '../src/browser/sniff-capture'

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

describe('resolveSniffFilename（2026-11-13 用户报障：长标题截断砍掉尾部 .mp4 → 产物无扩展名）', () => {
  it('超 120 字的「标题 + .mp4」截断后扩展名保留在尾部', () => {
    const longTitle = '45分钟读懂《秦书》张良帮忙刘邦得天下。'.repeat(6) // 132 字
    const name = resolveSniffFilename(longTitle + '.mp4', 'media.mp4')
    expect(name.endsWith('.mp4')).toBe(true)
    expect(name.length).toBe(124) // 120 主干 + 4 扩展名
    expect(name.startsWith('45分钟读懂')).toBe(true)
  })

  it('普通短标题原样保留（含扩展名）', () => {
    expect(resolveSniffFilename('历史上来历不明的人.mp4', 'media.mp4')).toBe('历史上来历不明的人.mp4')
  })

  it('非法路径字符消毒；无扩展名不凭空补；空值回落 fallback', () => {
    expect(resolveSniffFilename('a/b:c*d?.mp4', 'media.mp4')).toBe('a_b_c_d_.mp4')
    expect(resolveSniffFilename('没有扩展名的标题', 'media.mp4')).toBe('没有扩展名的标题')
    expect(resolveSniffFilename('', 'media.mp4')).toBe('media.mp4')
    expect(resolveSniffFilename('   ', 'media.mp4')).toBe('media.mp4')
  })

  it('恰在临界：116 字标题 + .mp4 全名 120 字不截断', () => {
    const title = '长'.repeat(116)
    expect(resolveSniffFilename(title + '.mp4', 'media.mp4')).toBe(title + '.mp4')
  })
})
