// test/tintin-browser-extractors.test.ts — 平台 DOM 抽取移植回归
// 1) 脚本纯度契约：SRC extractors/*.ts 是"纯 ES2020 文本"（运行时 readFileSync +
//    executeJavaScript 注入页面，不经 TS 编译）——禁止 import/export/type 等
//    非纯 JS 语法；_common 挂 window.__TIN_EX_COMMON__，平台脚本产出
//    __TIN_EXTRACT_RESULT__（SRC thickShell-ipc browser:extractDOM 契约）。
// 2) buildExtractorScript 行为：拼接/异常折叠/未返回结果兜底。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildExtractorScript, extractionError } from '../src/main/tintin/browser/browser-service'
import { PLATFORM_DEFS } from '../src/main/tintin/browser/platform-meta'

const EXTRACTOR_DIR = join(import.meta.dirname, '..', 'build', 'extractors')

function listExtractors(): string[] {
  return readdirSync(EXTRACTOR_DIR).filter((f) => f.endsWith('.ts')).sort()
}

describe('extractor script purity (SRC 纯 ES2020 文本注入契约)', () => {
  it('ships the 6 source scripts (common + 5 platforms)', () => {
    expect(listExtractors()).toEqual([
      '_common.ts', 'bilibili.ts', 'douyin.ts', 'kuaishou.ts', 'weixin.ts', 'xiaohongshu.ts',
    ])
  })

  it('contains no import/export or TS-only syntax (executeJavaScript runs it as plain JS)', () => {
    for (const file of listExtractors()) {
      const text = readFileSync(join(EXTRACTOR_DIR, file), 'utf8')
      // 语句级 import/export（字符串内出现不算；宽松按行首判断）
      expect(/^import\s/m.test(text), `${file} has import`).toBe(false)
      expect(/^export\s/m.test(text), `${file} has export`).toBe(false)
      // TS 类型语法常见形态：interface/type 声明、enum、: string 标注
      expect(/^\s*(interface|enum)\s/m.test(text), `${file} has TS type decls`).toBe(false)
      expect(/^\s*type\s+\w+\s*=/m.test(text), `${file} has type alias`).toBe(false)
    }
  })

  it('_common mounts the shared namespace; platform scripts assign __TIN_EXTRACT_RESULT__', () => {
    const common = readFileSync(join(EXTRACTOR_DIR, '_common.ts'), 'utf8')
    expect(common).toContain('__TIN_EX_COMMON__')
    for (const file of ['bilibili.ts', 'douyin.ts', 'kuaishou.ts', 'weixin.ts', 'xiaohongshu.ts']) {
      const text = readFileSync(join(EXTRACTOR_DIR, file), 'utf8')
      expect(text.includes('__TIN_EXTRACT_RESULT__') || text.includes('__TIN_EX_COMMON__'), `${file} uses the contract`).toBe(true)
    }
  })

  it('platform-meta wires extractor paths for the 5 sniffing platforms (SRC 一比一)', () => {
    expect(PLATFORM_DEFS.douyin?.extractor).toBe('extractors/douyin.ts')
    expect(PLATFORM_DEFS.bilibili?.extractor).toBe('extractors/bilibili.ts')
    expect(PLATFORM_DEFS.kuaishou?.extractor).toBe('extractors/kuaishou.ts')
    expect(PLATFORM_DEFS.weixin?.extractor).toBe('extractors/weixin.ts')
    expect(PLATFORM_DEFS.xiaohongshu?.extractor).toBe('extractors/xiaohongshu.ts')
    // youtube/jimeng 指向 SRC 亦未实现的脚本（extractDOM 优雅降级）；web/fxg 恒 null
    expect(PLATFORM_DEFS.youtube?.extractor).toBe('extractors/youtube.ts')
    expect(PLATFORM_DEFS.web?.extractor).toBeNull()
    expect(PLATFORM_DEFS.fxg?.extractor).toBeNull()
  })
})

describe('buildExtractorScript (SRC browser:extractDOM wrapper 1:1)', () => {
  it('prepends common, returns __TIN_EXTRACT_RESULT__ explicitly', () => {
    const script = buildExtractorScript('var C = 1;', '__TIN_EXTRACT_RESULT__ = { ok: true, data: C }')
    expect(script).toContain('var C = 1;')
    expect(script).toContain('__TIN_EXTRACT_RESULT__')
    // wrapper 是自执行表达式：在真实 JS 引擎里求值验证（铁律 2：验到运行结果）
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${script})`)() as { ok: boolean; data?: unknown }
    expect(result).toEqual({ ok: true, data: 1 })
  })

  it('folds script exceptions into a structured DOM_MISMATCH error', () => {
    const script = buildExtractorScript('', 'throw new Error("boom")')
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${script})`)() as { ok: boolean; error: { type: string; message: string } }
    expect(result.ok).toBe(false)
    expect(result.error.type).toBe('DOM_MISMATCH')
    expect(result.error.message).toContain('boom')
  })

  it('reports a missing result assignment as DOM_MISMATCH', () => {
    const script = buildExtractorScript('', 'var unused = 1')
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${script})`)() as { ok: boolean; error: { type: string } }
    expect(result.ok).toBe(false)
    expect(result.error.type).toBe('DOM_MISMATCH')
  })

  it('extractionError mirrors the SRC E3 shape', () => {
    expect(extractionError('NEED_LOGIN', '请先登录', 'hint')).toEqual({
      ok: false, error: { type: 'NEED_LOGIN', message: '请先登录', hint: 'hint' },
    })
  })
})
