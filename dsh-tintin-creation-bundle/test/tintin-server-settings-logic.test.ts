// test/tintin-server-settings-logic.test.ts — 服务设置弹层纯逻辑回归（2026-11-14
// 用户裁决：素材创作/运营/媒体三面各配本面服务端地址；弹窗三包字节副本，本测试
// 随副本各持一份，语义保持一致）。
import { describe, expect, it } from 'vitest'
import { globalServerUrl, normalizeServerUrl, surfaceServerUrl } from '../src/components/serverSettingsLogic'

describe('normalizeServerUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeServerUrl('  http://a:1///  ')).toBe('http://a:1')
    expect(normalizeServerUrl('http://a:1')).toBe('http://a:1')
  })

  it('accepts empty input as "clear" (follow global)', () => {
    expect(normalizeServerUrl('')).toBe('')
    expect(normalizeServerUrl('   ')).toBe('')
  })

  it('rejects non-http(s) and hostless values', () => {
    expect(normalizeServerUrl('ftp://a:1')).toBeNull()
    expect(normalizeServerUrl('a:1')).toBeNull()
    expect(normalizeServerUrl('http://')).toBeNull()
    expect(normalizeServerUrl('http://a b')).toBeNull()
  })

  it('accepts localhost and path-less forms with port or not', () => {
    expect(normalizeServerUrl('http://localhost:8000')).toBe('http://localhost:8000')
    expect(normalizeServerUrl('https://server.lan')).toBe('https://server.lan')
    expect(normalizeServerUrl('http://a:1/base/path')).toBe('http://a:1/base/path')
  })
})

describe('surface/global extraction from a config:get merged view', () => {
  it('reads the surface section and tolerates missing/non-string values', () => {
    const value = { media: { serverUrl: 'http://m:1' }, server: { url: 'http://g:1' } }
    expect(surfaceServerUrl(value, 'media')).toBe('http://m:1')
    expect(surfaceServerUrl(value, 'ops')).toBe('')
    expect(surfaceServerUrl(null, 'media')).toBe('')
    expect(surfaceServerUrl({ media: { serverUrl: 42 } }, 'media')).toBe('')
  })

  it('reads the global server.url for the hint line', () => {
    expect(globalServerUrl({ server: { url: 'http://g:1' } })).toBe('http://g:1')
    expect(globalServerUrl({})).toBe('')
    expect(globalServerUrl(null)).toBe('')
  })
})
