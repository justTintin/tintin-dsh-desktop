// test/tintin-bundle-esm.test.ts — tintin-bundle 出货文件 ESM 纯度回归
// 2026-09-25 用户实机事故：lib/ytdlp-logic.js 被 SRC 同步带回 CJS 的
// `module.exports = {...}`（vitest 模块垫片下测试全绿），打包后真实 Node 的
// harness 以 ESM 导入 tintin-bundle 即抛 "module is not defined in ES module
// scope" —— 整包装载失败、"Harness 暂时无法启动"。本测试在源码层拦截：
// 出货 .js 一律禁止顶层 module.exports 赋值（createRequire/惰性 require 是
// 合法迁移手法，不拦；.d.ts/纯数据不管）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BUNDLE_ROOT = join(import.meta.dirname, '..', 'packages', 'tintin-bundle')

function listJsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listJsFiles(full))
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

describe('tintin-bundle ships pure ESM (real-node import safety)', () => {
  it('no shipped .js assigns module.exports (CJS leftover breaks the harness loader)', () => {
    const offenders: string[] = []
    for (const file of listJsFiles(BUNDLE_ROOT)) {
      const text = readFileSync(file, 'utf8')
      if (/^[ \t]*module\.exports[ \t]*=/m.test(text)) offenders.push(file)
    }
    expect(
      offenders.map((p) => p.slice(BUNDLE_ROOT.length + 1)),
      'top-level module.exports in a "type":"module" package throws at real-node import (vitest shims it — do not trust green tests here)',
    ).toEqual([])
  })
})
