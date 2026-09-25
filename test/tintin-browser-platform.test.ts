// test/tintin-browser-platform.test.ts — 浏览器域首片纯函数回归
// platform-meta.ts（SRC platform-meta.js 一比一）：URL→平台识别 / 详情页白名单 /
// cookie 域映射；netscape-cookies.ts（SRC ytdlp-gate.js 序列化段）：Netscape 行格式。
// 需要 Electron session/真实窗口的引擎行为（browser:setSurface 等）走真实启动验收。
import { describe, expect, it } from 'vitest'
import {
  PLATFORM_COOKIE_DOMAINS,
  PLATFORM_DEFS,
  detectPlatformFromUrl,
  isDetailPage,
} from '../src/main/tintin/browser/platform-meta'
import { formatNetscapeCookie, formatNetscapeCookies } from '../src/main/tintin/browser/netscape-cookies'

describe('browser platform meta (SRC platform-meta 1:1)', () => {
  it('maps platform URLs to platform ids', () => {
    expect(detectPlatformFromUrl('https://www.douyin.com/video/741')).toBe('douyin')
    // 子域同样命中（SRC /douyin\.com/i 正则口径，v.douyin 短链归 douyin）
    expect(detectPlatformFromUrl('https://v.douyin.com/abc/')).toBe('douyin')
    expect(detectPlatformFromUrl('https://www.bilibili.com/video/BV1x')).toBe('bilibili')
    expect(detectPlatformFromUrl('https://www.kuaishou.com/short-video/1')).toBe('kuaishou')
    expect(detectPlatformFromUrl('https://www.xiaohongshu.com/explore/x')).toBe('xiaohongshu')
    expect(detectPlatformFromUrl('https://channels.weixin.qq.com/feed/x')).toBe('weixin')
    expect(detectPlatformFromUrl('https://youtu.be/x')).toBe('youtube')
    expect(detectPlatformFromUrl('https://www.pinterest.com/')).toBeNull()
    expect(detectPlatformFromUrl('')).toBeNull()
  })

  it('whitelists detail pages only (douyin feed paths are NOT detail pages)', () => {
    expect(isDetailPage('https://www.douyin.com/video/741', 'douyin')).toBe(true)
    expect(isDetailPage('https://www.douyin.com/video/741?modal_id=123', 'douyin')).toBe(true)
    expect(isDetailPage('https://www.douyin.com/discover', 'douyin')).toBe(false)
    expect(isDetailPage('https://www.bilibili.com/video/BV1abc', 'bilibili')).toBe(true)
    expect(isDetailPage('https://www.bilibili.com/', 'bilibili')).toBe(false)
    // web 分区不过平台过滤：URL 命中任何平台详情页即可嗅探
    expect(isDetailPage('https://www.bilibili.com/video/BV1abc', 'web')).toBe(true)
    // 跨平台不嗅探：douyin 分区里的 B 站详情页不算
    expect(isDetailPage('https://www.bilibili.com/video/BV1abc', 'douyin')).toBe(false)
  })

  it('keeps one cookie-jar partition per platform and yt-dlp cookie domains for the download platforms', () => {
    for (const platform of ['douyin', 'bilibili', 'kuaishou', 'xiaohongshu', 'weixin', 'youtube']) {
      expect(PLATFORM_DEFS[platform]?.partition).toBe(`persist:tintin-${platform === 'bilibili' ? 'bili' : platform === 'xiaohongshu' ? 'xhs' : platform}`)
      expect((PLATFORM_COOKIE_DOMAINS[platform] ?? []).length).toBeGreaterThan(0)
    }
    // fxg 抖店分区存在但不进浏览器面板（browser:platforms 过滤，引擎侧约定）
    expect(PLATFORM_DEFS.fxg?.partition).toBe('persist:tintin-fxg')
  })
})

describe('netscape cookies serialization (SRC ytdlp-gate 1:1)', () => {
  it('formats the seven tab-separated columns with a dot-prefixed domain', () => {
    const line = formatNetscapeCookie({
      domain: 'douyin.com', path: '/', secure: true, expirationDate: 1727300000, name: 'sid', value: 'v1',
    })
    expect(line).toBe('.douyin.com\tTRUE\t/\tTRUE\t1727300000\tsid\tv1')
  })

  it('defaults expiry to +30 days and dot-prefixes the domain (no #HttpOnly_ prefix — SRC 口径)', () => {
    const before = Math.floor(Date.now() / 1000)
    const line = formatNetscapeCookie({ domain: '.bilibili.com', secure: false, name: 'SESSDATA', value: 'x' })
    const cols = line.split('\t')
    expect(cols[0]).toBe('.bilibili.com')
    expect(cols[3]).toBe('FALSE')
    const exp = Number(cols[4])
    expect(exp).toBeGreaterThanOrEqual(before + 86400 * 30 - 5)
    expect(exp).toBeLessThanOrEqual(before + 86400 * 30 + 5)
  })

  it('joins a header line plus one line per cookie', () => {
    const text = formatNetscapeCookies([
      { domain: '.douyin.com', path: '/', secure: true, expirationDate: 1, name: 'a', value: '1' },
      { domain: '.douyin.com', path: '/x', secure: false, expirationDate: 2, name: 'b', value: '2' },
    ])
    const lines = text.split('\n')
    expect(lines[0]).toBe('# Netscape HTTP Cookie File')
    expect(lines[2]).toContain('\ta\t1')
    expect(lines[3]).toContain('\tb\t2')
    expect(lines[4]).toBe('')
  })
})
