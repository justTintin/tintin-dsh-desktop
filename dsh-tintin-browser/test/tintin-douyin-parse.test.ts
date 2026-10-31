// 抖音分享链接解析纯函数层（SRC douyin-parse-logic.js 对拍；2026-10-26 下载扩展链复活工作包）
import { describe, expect, it } from 'vitest'
import {
  buildDouyinVideoPageUrl,
  extractDouyinShareUrl,
  extractDouyinVideoIdFromUrl,
  validateDouyinParseResponse,
} from '../src/browser/douyin-parse-logic.ts'

describe('extractDouyinShareUrl（SRC 正则 1:1）', () => {
  it('从分享文本提取 v.douyin.com 短链', () => {
    const text = '8.99 HtC:/ 复制打开抖音 https://v.douyin.com/iRNBho6u/ 看看作品'
    expect(extractDouyinShareUrl(text)).toBe('https://v.douyin.com/iRNBho6u/')
  })
  it('无短链 → null；空值 → null', () => {
    expect(extractDouyinShareUrl('随便一段文本')).toBeNull()
    expect(extractDouyinShareUrl('')).toBeNull()
    expect(extractDouyinShareUrl(null)).toBeNull()
  })
})

describe('extractDouyinVideoIdFromUrl（仅 /video/ /note/ 15 位）', () => {
  it('视频页与 note 页提取 id', () => {
    expect(extractDouyinVideoIdFromUrl('https://www.douyin.com/video/7412345678901234567')).toBe('7412345678901234567')
    expect(extractDouyinVideoIdFromUrl('https://www.douyin.com/note/7412345678901234567')).toBe('7412345678901234567')
  })
  it('短链 / 用户主页 / 不足 15 位 → null', () => {
    expect(extractDouyinVideoIdFromUrl('https://v.douyin.com/iRNBho6u/')).toBeNull()
    expect(extractDouyinVideoIdFromUrl('https://www.douyin.com/user/MS4wLjABAAAA?modal_id=741')).toBeNull()
    expect(extractDouyinVideoIdFromUrl('https://www.douyin.com/video/12345678901234')).toBeNull()
  })
})

describe('buildDouyinVideoPageUrl', () => {
  it('15 位 id 拼视频页 URL；非法输入 → null', () => {
    expect(buildDouyinVideoPageUrl('7412345678901234567')).toBe('https://www.douyin.com/video/7412345678901234567')
    expect(buildDouyinVideoPageUrl('74123456789012')).toBeNull()
    expect(buildDouyinVideoPageUrl('abc')).toBeNull()
    expect(buildDouyinVideoPageUrl('')).toBeNull()
  })
})

describe('validateDouyinParseResponse（dy.xs25.cn 响应契约）', () => {
  it('正常响应抽取直链 + 作者 + 描述', () => {
    const v = validateDouyinParseResponse({
      code: 200,
      data: {
        video_url: 'https://v26-web.douyinvod.com/video/tos/cn/xxx/?mime_type=video_mp4',
        additional_data: [{ nickname: '作者甲', desc: '作品描述' }],
      },
    })
    expect(v).toEqual({
      ok: true,
      videoUrl: 'https://v26-web.douyinvod.com/video/tos/cn/xxx/?mime_type=video_mp4',
      author: '作者甲',
      desc: '作品描述',
    })
  })
  it('code !== 200 → 透出 msg；异常体 → 固定文案', () => {
    expect(validateDouyinParseResponse({ code: 500, msg: '链接错误' })).toEqual({ ok: false, reason: '链接错误' })
    expect(validateDouyinParseResponse(null)).toEqual({ ok: false, reason: '解析接口响应异常' })
    expect(validateDouyinParseResponse({ code: 200 })).toEqual({ ok: false, reason: '解析接口响应异常' })
  })
  it('缺直链 → 显式报错（铁律 2：禁止静默兜底）', () => {
    expect(validateDouyinParseResponse({ code: 200, data: { video_url: '  ' } })).toEqual({
      ok: false,
      reason: '解析结果缺少视频直链，无法下载',
    })
  })
})
