/**
 * TinTin 打包模式运行时选择器（2026-10-02 用户裁决）：
 * 运行 package:tintin:dir 时弹出选项——
 *   1) 全新重建（默认）：联网刷新市场/AA 新鲜度门禁 + 全量门禁 + 干净构建
 *   2) 快速热调：跳过联网门禁与构建，复用现有产物直接打包（改动源码需先 build）
 * 非交互调用（管道/CI 无输入流）默认 1；亦可用 --hot/--full 参数或
 * DSH_PACKAGE_MODE=hot|full 环境变量免交互指定。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

/** 纯函数：参数/环境/应答 → 模式（hot|full）；无法确定返回 null（需交互询问） */
export function resolveMode(argv, env, answer) {
  if (argv.includes('--hot') || env.DSH_PACKAGE_MODE === 'hot') return 'hot'
  if (argv.includes('--full') || env.DSH_PACKAGE_MODE === 'full') return 'full'
  if (answer !== undefined && answer !== null) {
    const a = String(answer).trim().toLowerCase()
    if (a === '2' || a === 'hot' || a === '快' || a === '快速热调') return 'hot'
    return 'full'
  }
  return null
}

async function main() {
  let mode = resolveMode(process.argv, process.env)
  if (mode === null) {
    process.stdout.write('\n=== TinTin 打包模式 ===\n  1) 全新重建（默认）：联网刷新市场/AA + 全量门禁 + 干净构建\n  2) 快速热调：跳过联网门禁与构建，复用现有产物直接打包\n请选择 [1/2]（回车默认 1）：')
    let answer = ''
    try {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      answer = await rl.question('')
      rl.close()
    } catch {
      // 无交互输入流（CI/管道）：保持默认全新重建
    }
    mode = resolveMode([], {}, answer) ?? 'full'
  }

  const script = mode === 'hot' ? 'package:tintin:dir:hot' : 'package:tintin:dir:full'
  console.log(`\n>>> 已选择：${mode === 'hot' ? '2) 快速热调' : '1) 全新重建'} → corepack yarn ${script}\n`)

  const yarn = process.env.COREPACK_ROOT
    ? join(process.env.COREPACK_ROOT, 'dist', 'yarn.js')
    : process.env.npm_execpath
  if (!yarn || !/\.[cm]?js$/.test(yarn) || !existsSync(yarn)) {
    throw new Error('未找到仓库 Yarn 发行版：请用 corepack yarn package:tintin:dir 运行')
  }
  const result = spawnSync(process.execPath, [yarn, script], { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  process.exitCode = result.status ?? 1
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
