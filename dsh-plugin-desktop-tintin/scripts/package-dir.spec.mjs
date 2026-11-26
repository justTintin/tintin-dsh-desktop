import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  packageDirectory,
  removeStaleUnpackedOutput,
  sweepUnpackedSelfHealHolders,
} from './package-dir.mjs'
import { packageNsisLocal } from './package-nsis-local.mjs'

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const fakeRun = (stdout = '') => () => ({ stdout })

test('sweep parses self-heal holder pids from CIM output', () => {
  assert.deepEqual(sweepUnpackedSelfHealHolders({ run: fakeRun('123,456') }), [123, 456])
  assert.deepEqual(sweepUnpackedSelfHealHolders({ run: fakeRun('  ') }), [])
  assert.deepEqual(sweepUnpackedSelfHealHolders({ run: fakeRun('1,,x,7') }), [1, 7])
})

test('sweep swallows CIM failures and returns no holders', () => {
  assert.deepEqual(sweepUnpackedSelfHealHolders({ run: () => { throw new Error('boom') } }), [])
})

test('sweep live query returns an array (empty on a clean session)', () => {
  // win32 真跑一次 PowerShell 查询链;非 win32 恒空
  assert.ok(Array.isArray(sweepUnpackedSelfHealHolders()))
})

test('removeStaleUnpackedOutput no-ops when nothing stale exists', () => {
  assert.equal(removeStaleUnpackedOutput({ unpackedPath: join(tmpdir(), 'definitely-not-here-xyz') }), false)
})

test('removeStaleUnpackedOutput deletes a stale tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pkgdir-preclean-'))
  writeFileSync(join(dir, 'download-binaries.ps1'), '# stale\n')
  assert.equal(removeStaleUnpackedOutput({ unpackedPath: dir, attempts: 2, waitMs: 100 }), true)
  assert.equal(removeStaleUnpackedOutput({ unpackedPath: dir }), false)
})

test('preclean is wired at the CLI entry only, never inside packageDirectory', () => {
  const source = readFileSync(new URL('./package-dir.mjs', import.meta.url), 'utf8')
  // CLI 入口:清场在前、构建在后
  const entry = source.slice(source.indexOf('const invokedPath'))
  assert.ok(entry.includes('removeStaleUnpackedOutput()\n  packageDirectory()'), 'CLI 入口必须先清场再打包')
  // 函数体内禁止出现预清理——单测以注入 run 直调,体内清场会删真实 dist 产物
  const body = source.slice(source.indexOf('export function packageDirectory'), source.indexOf('const invokedPath'))
  assert.ok(!body.includes('removeStaleUnpackedOutput'), 'packageDirectory 本体不得调用预清理')
})

test('transient nonzero exit retries once and succeeds (antivirus scan lock)', () => {
  let calls = 0
  const flaky = () => {
    calls++
    return calls === 1 ? { status: 1 } : { status: 0 }
  }
  packageDirectory({ run: flaky })
  assert.equal(calls, 2, '首败应恰好重试一次')
})

test('persistent nonzero exit surfaces after the single retry', () => {
  const alwaysFail = () => ({ status: 7 })
  assert.throws(() => packageDirectory({ run: alwaysFail }), /exited with 7 \(重试后仍失败\)/)
})

test('spawn-level errors are not retried (ENOENT-class, not a transient lock)', () => {
  let calls = 0
  const spawnError = () => {
    calls++
    return { error: new Error('cannot spawn') }
  }
  assert.throws(() => packageDirectory({ run: spawnError }), /cannot spawn/)
  assert.equal(calls, 1, 'spawn 层失败不得重试')
})

test('removeStaleUnpackedOutput fails fast with guidance when a holder locks the tree', { timeout: 30000, skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pkgdir-locked-'))
  const locked = join(dir, 'download-binaries.ps1')
  writeFileSync(locked, '# held open with no sharing\n')
  const holder = spawn('powershell.exe', [
    '-NoProfile',
    '-Command',
    `$fs=[IO.File]::Open('${locked.replace(/'/g, "''")}','Open','ReadWrite','None'); Start-Sleep 25`,
  ], { stdio: 'ignore' })
  try {
    // 等 PowerShell 真握住独占句柄:期间任何其它打开都会失败
    const deadline = Date.now() + 10000
    let held = false
    while (Date.now() < deadline) {
      try {
        const fd = openSync(locked, 'r')
        closeSync(fd)
        sleep(200)
      } catch {
        held = true
        break
      }
    }
    assert.ok(held, '测试夹具未能在 10s 内锁住文件')
    assert.throws(
      () => removeStaleUnpackedOutput({ unpackedPath: dir, attempts: 2, waitMs: 200 }),
      /被占用/,
    )
  } finally {
    holder.kill()
    // kill 后句柄释放有竞态,清理自身带界重试
    for (let i = 0; i < 25; i++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        sleep(200)
      }
    }
  }
})

// ═══ lite NSIS 的瞬态锁重试(2026-11-23 22:02/22:16 两轮 EBUSY 实证:--dir 有 3s 重试
// 后通过,lite NSIS 无重试一碰即死 → lite Setup 缺席)。packageNsisLocal 与
// packageDirectory 同缝(run 可注入),以下三例与上方 --dir 重试语义逐条对齐。
test('nsis transient nonzero exit retries once and succeeds (antivirus scan lock)', () => {
  let calls = 0
  const flaky = () => {
    calls++
    return calls === 1 ? { status: 1 } : { status: 0 }
  }
  packageNsisLocal({ run: flaky })
  assert.equal(calls, 2, '首败应恰好重试一次')
})

test('nsis persistent nonzero exit surfaces after the single retry', () => {
  const alwaysFail = () => ({ status: 7 })
  assert.throws(() => packageNsisLocal({ run: alwaysFail }), /exited with 7 \(重试后仍失败\)/)
})

test('nsis spawn-level errors are not retried (ENOENT-class, not a transient lock)', () => {
  let calls = 0
  const spawnError = () => {
    calls++
    return { error: new Error('cannot spawn') }
  }
  assert.throws(() => packageNsisLocal({ run: spawnError }), /cannot spawn/)
  assert.equal(calls, 1, 'spawn 层失败不得重试')
})

test('nsis preclean is wired at the CLI entry only, never inside packageNsisLocal', () => {
  const source = readFileSync(new URL('./package-nsis-local.mjs', import.meta.url), 'utf8')
  const entry = source.slice(source.indexOf('const invokedPath'))
  const wired = ['removeStaleUnpackedOutput()', 'packageNsisLocal()']
  assert.ok(wired.every((line) => entry.includes(line)), 'CLI 入口必须先清场再打包')
  const body = source.slice(source.indexOf('export function packageNsisLocal'), source.indexOf('const invokedPath'))
  assert.ok(!body.includes('removeStaleUnpackedOutput'), 'packageNsisLocal 本体不得调用预清理')
})
