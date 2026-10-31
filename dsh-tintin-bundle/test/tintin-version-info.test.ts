// test/tintin-version-info.test.ts — 三轴版本信息收集回归（2026-10-26 用户裁决）
// collectVersions 为纯逻辑（fs 注入）：app 根向上判定（dsh-plugin-desktop 前缀）、
// 上游 DSH 版本、dsh-tintin-* 业务插件动态枚举与排序、段缺失降级不阻塞。
import { describe, expect, it } from 'vitest'
import { collectVersions } from '../lib/version-info.js'
import { createVersionInfoApi } from '../lib/version-info.js'

/** 内存 fs：path 表 + 目录表（测试不触真实盘；startDir 可指定模拟不同布局） */
function memIo(files, dirs, startDir = '/app/node_modules/dsh-tintin-bundle/lib') {
  return {
    startDir,
    join: (...parts) => parts.join('/'),
    dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p) || (dirs ?? []).includes(p),
    readJson: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
    readdir: (p) => (dirs ?? []).includes(p) ? Object.keys(files).filter((f) => f.startsWith(`${p}/`)).map((f) => f.slice(p.length + 1).split('/')[0]) : [],
  }
}

describe('collectVersions（打包树形态）', () => {
  it('app 根向上判定 + 三轴齐全 + 插件排序', () => {
    const io = memIo({
      '/app/package.json': { name: 'dsh-plugin-desktop-tintin', version: '0.2.1-rc.1' },
      '/app/node_modules/@deepseek-ai/dsh/package.json': { name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' },
      '/app/node_modules/dsh-tintin-media-bundle/package.json': { name: 'dsh-tintin-media-bundle', version: '0.1.0-dev.0' },
      '/app/node_modules/dsh-tintin-bundle/package.json': { name: 'dsh-tintin-bundle', version: '0.1.0-dev.0' },
      '/app/node_modules/dsh-tintin-client-ui/package.json': { name: 'dsh-tintin-client-ui', version: '0.1.0-dev.0' },
    }, ['/app/node_modules'])
    const v = collectVersions(io)
    expect(v.desktop).toEqual({ name: 'dsh-plugin-desktop-tintin', version: '0.2.1-rc.1' })
    expect(v.dsh).toBe('0.2.1-rc.2')
    expect(v.plugins.map((p) => p.name)).toEqual(['dsh-tintin-bundle', 'dsh-tintin-client-ui', 'dsh-tintin-media-bundle'])
  })

  it('非桌面根（开发态）→ desktop/dsh 空，回退优先选真含 dsh-tintin-* 的 node_modules', () => {
    // 包自身的 node_modules 先于仓库根出现且不含业务插件——候选择优须跳过它
    const io = memIo({
      '/repo/package.json': { name: 'deepseek-harness-desktop' },
      '/repo/node_modules/dsh-tintin-bundle/package.json': { name: 'dsh-tintin-bundle', version: '0.1.0-dev.0' },
      '/repo/node_modules/dsh-tintin-media-bundle/package.json': { name: 'dsh-tintin-media-bundle', version: '0.1.0-dev.0' },
    }, ['/repo/node_modules', '/repo/node_modules/dsh-tintin-bundle/node_modules'], '/repo/node_modules/dsh-tintin-bundle/lib')
    const v = collectVersions(io)
    expect(v.desktop).toBeNull()
    expect(v.dsh).toBe('')
    expect(v.plugins.map((p) => p.name)).toEqual(['dsh-tintin-bundle', 'dsh-tintin-media-bundle'])
  })

  it('坏 JSON/缺版本字段的插件条目跳过；@deepseek-ai/dsh 缺失只降级该段', () => {
    const io = memIo({
      '/app/package.json': { name: 'dsh-plugin-desktop-beta', version: '2.0.18-beta.1' },
      '/app/node_modules/@deepseek-ai/dsh/package.json': 'not-json',
      '/app/node_modules/dsh-tintin-bundle/package.json': { name: 'dsh-tintin-bundle' },
      '/app/node_modules/dsh-tintin-browser/package.json': { name: 'dsh-tintin-browser', version: '0.1.0-dev.0' },
    }, ['/app/node_modules'])
    const v = collectVersions(io)
    expect(v.desktop).toEqual({ name: 'dsh-plugin-desktop-beta', version: '2.0.18-beta.1' })
    expect(v.dsh).toBe('')
    expect(v.plugins).toEqual([{ name: 'dsh-tintin-browser', version: '0.1.0-dev.0' }])
  })
})

describe('tintin:versions 通道', () => {
  it('通道存在且返回对象形态（真实开发树上 desktop 为空属预期）', async () => {
    const api = createVersionInfoApi()
    const entry = api['tintin:versions']
    expect(typeof entry).toBe('function')
    const v = await entry([])
    expect(v).toHaveProperty('desktop')
    expect(v).toHaveProperty('dsh')
    expect(Array.isArray(v.plugins)).toBe(true)
  })
})
