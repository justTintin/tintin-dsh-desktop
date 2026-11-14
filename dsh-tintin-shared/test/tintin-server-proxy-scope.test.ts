// test/tintin-server-proxy-scope.test.ts — 分面服务端地址解析（2026-11-14 用户裁决：
// 素材创作/运营工具/媒体工具三面各自独立配置，空/缺省回落全局解析链）纯逻辑回归。
import { describe, expect, it } from 'vitest'
import { TINTIN_SURFACES, resolveScopedServerUrl } from '../lib/server-proxy.js'

describe('resolveScopedServerUrl', () => {
  const base = () => 'http://global:8000'

  it('keeps the three-surface whitelist in sync with the bridge client', () => {
    // dsh-tintin-bundle/client.js forSurface 白名单字面量须与此同步
    expect(TINTIN_SURFACES).toEqual(['creation', 'ops', 'media'])
  })

  it('prefers the surface section when it carries a non-empty string', () => {
    const store = { ops: { serverUrl: 'http://ops-server:9000/' } }
    expect(resolveScopedServerUrl(store, 'ops', base)).toBe('http://ops-server:9000')
  })

  it('trims whitespace and trailing slashes of the surface value', () => {
    const store = { media: { serverUrl: '  http://media:1///  ' } }
    expect(resolveScopedServerUrl(store, 'media', base)).toBe('http://media:1')
  })

  it('falls back to the global chain on empty string, missing segment or unknown scope', () => {
    expect(resolveScopedServerUrl({ media: { serverUrl: '' } }, 'media', base)).toBe('http://global:8000')
    expect(resolveScopedServerUrl({}, 'media', base)).toBe('http://global:8000')
    expect(resolveScopedServerUrl({ media: { serverUrl: '   ' } }, 'media', base)).toBe('http://global:8000')
    expect(resolveScopedServerUrl({ server: { url: 'http://other:1' } }, 'cover', base)).toBe('http://global:8000')
  })

  it('never throws on malformed store shapes and still falls back', () => {
    expect(resolveScopedServerUrl(null, 'media', base)).toBe('http://global:8000')
    expect(resolveScopedServerUrl({ media: 'oops' }, 'media', base)).toBe('http://global:8000')
    expect(resolveScopedServerUrl({ media: { serverUrl: 42 } }, 'media', base)).toBe('http://global:8000')
    expect(resolveScopedServerUrl(undefined, undefined, base)).toBe('http://global:8000')
  })
})
