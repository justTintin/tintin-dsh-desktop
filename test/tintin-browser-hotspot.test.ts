// test/tintin-browser-hotspot.test.ts — 热点采集纯函数层回归（hotspot-logic.ts，SRC 1:1）
// 解析器（抖音/知乎/小红书/B站）按 SRC 注释里的 API payload 形状；清单追加含 date 字段。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HOTSPOT_PAGES,
  appendHotspotManifest,
  dedupeHotspots,
  domFallbackScript,
  hotspotManifestPath,
  hotspotParserForUrl,
  parseHotspotPayload,
  safeJsonParse,
} from '../src/main/tintin/browser/hotspot-logic'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('hotspot parsers (SRC preload-webview 拦截规则 1:1)', () => {
  it('routes urls to the right parser by API-path includes', () => {
    expect(hotspotParserForUrl('https://www.douyin.com/aweme/v1/web/hot/search/list/?x')).not.toBeNull()
    expect(hotspotParserForUrl('https://api.zhihu.com/feed/topstory/hot-lists/total')).not.toBeNull()
    expect(hotspotParserForUrl('https://www.xiaohongshu.com/api/sns/web/v1/search/hotlist')).not.toBeNull()
    expect(hotspotParserForUrl('https://api.bilibili.com/x/web-interface/ranking/v2')).not.toBeNull()
    expect(hotspotParserForUrl('https://api.bilibili.com/x/web-interface/popular')).not.toBeNull()
    expect(hotspotParserForUrl('https://example.com/other')).toBeNull()
  })

  it('parses the douyin hot-list payload (word_list with position/hot_value)', () => {
    const r = parseHotspotPayload('https://www.douyin.com/aweme/v1/web/hot/search/list', {
      data: { word_list: [
        { word: 'Fragrance', position: 0, hot_value: 1234567 },
        { sentence: '无词条目', hot_score: 99 },
        { word: '' },
      ] },
    })
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ platform: 'douyin', title: 'Fragrance', rank: 1, hot: 1234567, url: `https://www.douyin.com/search/${encodeURIComponent('Fragrance')}` })
    expect(r[1]?.rank).toBe(2)
  })

  it('parses the xiaohongshu hotlist payload (items/hot_query fallback)', () => {
    const r = parseHotspotPayload('https://xhs/api/sns/web/v1/search/hotlist', {
      data: { items: [{ title: '春日穿搭' }, { query: '露营好物' }, { name: '' }] },
    })
    expect(r).toHaveLength(2)
    expect(r[0]?.url).toContain('search_result?keyword=')
  })

  it('parses the bilibili ranking payload with 万播放 formatting', () => {
    const r = parseHotspotPayload('https://api.bilibili.com/x/web-interface/ranking/v2', {
      data: { list: [
        { title: '视频A', bvid: 'BV1a', stat: { view: 250000 } },
        { title: '视频B', bvid: 'BV1b', stat: { view: 9999 } },
        { title: '' },
      ] },
    })
    expect(r).toHaveLength(2)
    expect(r[0]?.hot).toBe('25.0万播放')
    expect(r[1]?.hot).toBe('9999播放')
    expect(r[0]?.url).toBe('https://www.bilibili.com/video/BV1a')
  })

  it('zhihu parser stays for reference though the page is hidden', () => {
    const r = parseHotspotPayload('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total', {
      data: [{ target: { title: '问题', id: 123 } }],
    })
    expect(r[0]).toMatchObject({ platform: 'zhihu', title: '问题', url: 'https://www.zhihu.com/question/123' })
  })
})

describe('hotspot manifest + dedupe (SRC append-hotspot-manifest 1:1)', () => {
  it('appends entries with a date field and merges across runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-hs-'))
    tmpDirs.push(dir)
    const items = dedupeHotspots([
      { platform: 'douyin', title: 'A', rank: 1, hot: 1, url: 'u1' },
      { platform: 'douyin', title: 'A', rank: 2, hot: 2, url: 'u1' }, // 重复
      { platform: 'bilibili', title: 'B', rank: 1, hot: '', url: 'u2' },
    ])
    expect(items).toHaveLength(2)
    const r = appendHotspotManifest(dir, items)
    expect(r.ok).toBe(true)
    expect(r.count).toBe(2)
    const manifest = JSON.parse(readFileSync(hotspotManifestPath(dir), 'utf8'))
    expect(manifest).toHaveLength(2)
    expect(manifest[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // 二次采集：追加不覆盖
    appendHotspotManifest(dir, [{ platform: 'douyin', title: 'C', rank: 1, hot: 0, url: 'u3' }])
    expect(JSON.parse(readFileSync(hotspotManifestPath(dir), 'utf8'))).toHaveLength(3)
    // 空数组：ok 且不写文件
    expect(appendHotspotManifest(dir, []).count).toBe(0)
  })

  it('safeJsonParse swallows BOM/empty bodies; xhs is the only DOM fallback', () => {
    // SRC 实现不剥 BOM：带 BOM 的 body 解析失败返回 null（注释比实现乐观——1:1 保真）
    expect(safeJsonParse('\ufeff{"a":1}')).toBeNull()
    expect(safeJsonParse('')).toBeNull()
    expect(domFallbackScript('xiaohongshu')).toContain('/explore/')
    expect(domFallbackScript('douyin')).toBe('null')
    // 采集页清单：zhihu 隐藏、三平台在列
    expect(HOTSPOT_PAGES.map((p) => p.platform)).toEqual(['douyin', 'xiaohongshu', 'bilibili'])
  })
})
