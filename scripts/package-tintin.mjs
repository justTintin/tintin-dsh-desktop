/**
 * TinTin 打包模式运行时选择器（2026-10-02 用户裁决）：
 * 运行 package:tintin:dir 时弹出选项——
 *   1) 全新重建（默认）：联网刷新市场/AA 新鲜度门禁 + 全量门禁 + 干净构建
 *   2) 快速热调：跳过联网门禁与构建，复用现有产物直接打包（改动源码需先 build）
 *   3) 本地全编：全量编译与门禁，不连 GitHub（AA 锚定本地已验证产物，见
 *      scripts/package-tintin-local.mjs；官方 AA main 若已前进本档不会发现）
 * 非交互调用（管道/CI 无输入流）默认 1；亦可用 --hot/--full/--local 参数或
 * DSH_PACKAGE_MODE=hot|full|local 环境变量免交互指定。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const MODE_SCRIPT = { full: 'package:tintin:dir:full', hot: 'package:tintin:dir:hot', local: 'package:tintin:dir:local' }
const MODE_LABEL = { full: '1) 全新重建', hot: '2) 快速热调', local: '3) 本地全编' }

/** 纯函数：参数/环境/应答 → 模式（full|hot|local）；无法确定返回 null（需交互询问） */
export function resolveMode(argv, env, answer) {
  if (argv.includes('--hot') || env.DSH_PACKAGE_MODE === 'hot') return 'hot'
  if (argv.includes('--full') || env.DSH_PACKAGE_MODE === 'full') return 'full'
  if (argv.includes('--local') || env.DSH_PACKAGE_MODE === 'local') return 'local'
  if (answer !== undefined && answer !== null) {
    const a = String(answer).trim().toLowerCase()
    if (a === '2' || a === 'hot' || a === '快' || a === '快速热调') return 'hot'
    if (a === '3' || a === 'local' || a === '本地' || a === '本地全编') return 'local'
    return 'full'
  }
  return null
}

async function main() {
  let mode = resolveMode(process.argv, process.env)
  if (mode === null) {
    process.stdout.write('\n=== TinTin 打包模式 ===\n  1) 全新重建（默认）：联网刷新市场/AA + 全量门禁 + 干净构建\n  2) 快速热调：跳过联网门禁与构建，复用现有产物直接打包\n  3) 本地全编：全量编译与门禁，不连 GitHub（AA 锚定本地已验证产物）\n请选择 [1/2/3]（回车默认 1）：')
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

  const script = MODE_SCRIPT[mode]
  console.log(`\n>>> 已选择：${MODE_LABEL[mode]} → corepack yarn ${script}\n`)

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
