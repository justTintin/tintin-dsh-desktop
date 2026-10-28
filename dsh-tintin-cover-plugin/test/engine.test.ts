// 引擎路径与输出清洗(不触渲染;渲染冒烟走 scripts/render.mjs 手动/打包核验)
// 测试产物统一落 D 盘 .tmp(C: temp 受沙箱限制,photocraft CLI 子进程无法写入)
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCoverDir, renderCover } from '../src/engine.ts'

const testRoot = 'D:/Project/tintin-dsh-desktop/dsh-tintin-cover-plugin/.tmp/test'

const saved = { ws: process.env.TINTIN_WORKSPACE_DIR, cover: process.env.TINTIN_COVER_DIR }

afterEach(() => {
  process.env.TINTIN_WORKSPACE_DIR = saved.ws
  process.env.TINTIN_COVER_DIR = saved.cover
})

describe('产物目录解析(G5:<默认工作目录>/cover/)', () => {
  it('TINTIN_WORKSPACE_DIR 优先,固定 cover 子目录', () => {
    process.env.TINTIN_WORKSPACE_DIR = join(testRoot, 'ws-x')
    delete process.env.TINTIN_COVER_DIR
    expect(resolveCoverDir()).toBe(join(testRoot, 'ws-x', 'cover'))
  })
  it('TINTIN_COVER_DIR 覆盖(测试注入口)', () => {
    process.env.TINTIN_COVER_DIR = join(testRoot, 'cover-override')
    expect(resolveCoverDir()).toBe(join(testRoot, 'cover-override'))
  })
  it('两者皆缺省 → ~/Documents/tintin-workspace/cover', () => {
    delete process.env.TINTIN_WORKSPACE_DIR
    delete process.env.TINTIN_COVER_DIR
    expect(resolveCoverDir()).toContain(join('tintin-workspace', 'cover'))
  })
})

describe('renderCover 入参防线(不触渲染)', () => {
  it('未知模板 → ok:false 显式错误', async () => {
    process.env.TINTIN_COVER_DIR = join(testRoot, 'nope')
    const r = await renderCover({ templateId: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知封面模板')
  })
  it('空文本 props → ok:false 校验错误', async () => {
    process.env.TINTIN_COVER_DIR = join(testRoot, 'nope')
    const r = await renderCover({ templateId: 'cover', props: { title: '' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('主标题')
  })
})
