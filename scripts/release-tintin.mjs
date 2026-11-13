/**
 * TinTin 一键发版链（2026-11-13 用户裁决）：打包 → NSIS Setup → 发布 GitHub Release，
 * 一条命令跑完并在发布后自检（回查清单确认 tag 与资产可见）。
 *
 * 版本戳本脚本统一下发：DSH_VERSION_STAMP 未设置时取启动时刻 `YYYYMMDD-HHmm`，
 * 打包与 NSIS 两步共用同一值——应用内版本、Setup 文件名、发布 tag 三处一致是构造保证，
 * 不再依赖外部 Release-Builder 记得传环境变量。
 *
 * 用法：
 *   corepack yarn package:tintin:release                     # 全流程（打包模式走 package:dir 交互菜单）
 *   corepack yarn package:tintin:release --hot               # 热调打包 → Setup → 发布
 *   corepack yarn package:tintin:release --local             # 本地全编 → Setup → 发布
 *   corepack yarn package:tintin:release --only-publish      # 跳过打包/NSIS，发布 dist/ 里最新 Setup
 *   通用旗标：--prerelease  --notes <text>  --repo owner/name  --dry-run
 *
 * 鉴权与仓库约定同 publish-github-release.mjs（TINTIN_GITHUB_TOKEN → git 凭据回退）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tintinRoot = join(root, 'dsh-plugin-desktop-tintin')
const distDir = join(tintinRoot, 'dist')
const nsisScript = join(tintinRoot, 'scripts', 'package-nsis-local.mjs')
const publishScript = join(tintinRoot, 'scripts', 'publish-github-release.mjs')
const packageVersion = JSON.parse(readFileSync(join(tintinRoot, 'package.json'), 'utf8')).version

const args = process.argv.slice(2)
const hasFlag = name => args.includes(name)
const argValue = name => {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} 需要一个参数值`)
  return value
}

const mode = hasFlag('--hot') ? '--hot' : hasFlag('--local') ? '--local' : hasFlag('--full') ? '--full' : undefined
const onlyPublish = hasFlag('--only-publish')
const dryRun = hasFlag('--dry-run')

/** 版本戳一次定值：DSH_VERSION_STAMP 未设时按启动时刻生成（与既有产物命名同款连字符格式）。 */
function resolveStamp(env) {
  if (env.DSH_VERSION_STAMP !== undefined) return env.DSH_VERSION_STAMP
  const now = new Date()
  const two = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
}

function newestSetup() {
  const candidates = readdirSync(distDir).filter(name => /^TinTin-.+-x64-Setup\.exe$/u.test(name))
  if (candidates.length === 0) return undefined
  return candidates
    .map(name => ({ name, mtimeMs: statSync(join(distDir, name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]
    .name
}

const stamp = resolveStamp(process.env)
const repo = argValue('--repo') ?? process.env.TINTIN_UPDATE_REPO ?? 'justTintin/tintin-dsh-desktop'
const setupForTag = newestSetup()
const releaseTag = setupForTag === undefined
  ? `v${packageVersion}-${stamp}`
  : `v${/^(?:TinTin-)?(.+)-x64-Setup\.exe$/u.exec(setupForTag)?.[1] ?? `${packageVersion}-${stamp}`}`

console.log(`[release] 版本戳：${stamp}${process.env.DSH_VERSION_STAMP === undefined ? '（自动生成）' : '（外部下发）'}`)

if (dryRun) {
  const setup = newestSetup()
  console.log('[release] --dry-run 计划：')
  console.log(`  1) 打包：${onlyPublish ? '跳过（--only-publish）' : `corepack yarn package:tintin:dir${mode === undefined ? '' : ` ${mode}`}`}`)
  console.log(`  2) NSIS：${onlyPublish ? '跳过（--only-publish）' : 'node dsh-plugin-desktop-tintin/scripts/package-nsis-local.mjs'}`)
  console.log(`  3) 发布：node dsh-plugin-desktop-tintin/scripts/publish-github-release.mjs`)
  console.log(`  4) 自检：回查 https://api.github.com/repos/${repo}/releases`)
  console.log(`  当前 dist/ 最新 Setup：${setup ?? '（暂无）'}`)
  console.log(`  预期发布 tag：${setup === undefined ? releaseTag : `v${/^(?:TinTin-)?(.+)-x64-Setup\.exe$/u.exec(setup)?.[1]}`}`)
  process.exit(0)
}

const yarn = process.env.COREPACK_ROOT
  ? join(process.env.COREPACK_ROOT, 'dist', 'yarn.js')
  : process.env.npm_execpath
if (!onlyPublish && (!yarn || !/\.[cm]?js$/u.test(yarn ?? '') || !existsSync(yarn))) {
  throw new Error('未找到仓库 Yarn 发行版：请用 corepack yarn package:tintin:release 运行')
}

const stepEnv = { ...process.env, DSH_VERSION_STAMP: stamp }

function run(name, command, argv, options = {}) {
  console.log(`\n>>> [release] ${name}\n`)
  const result = spawnSync(command, argv, {
    cwd: root,
    env: { ...stepEnv, ...options.env },
    stdio: 'inherit',
    timeout: options.timeout,
  })
  if (result.error !== undefined) throw result.error
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${name} 失败（exit ${String(result.status ?? '?')}）——后续步骤已中止`)
  }
}

// 1) 打包（win-unpacked）。失败即停，绝不带旧产物发版。
if (!onlyPublish) {
  run('打包 package:dir', process.execPath, [yarn, 'package:tintin:dir', ...(mode === undefined ? [] : [mode])], { timeout: 3 * 60 * 60_000 })
} else {
  console.log('[release] 跳过打包（--only-publish）')
}

// 2) NSIS Setup（同版本戳，保证文件名与应用内版本一致）。
if (!onlyPublish) {
  run('NSIS Setup', process.execPath, [nsisScript], { timeout: 60 * 60_000 })
}

// 3) 发布 + 自检（自检内置于 publish 脚本末尾）。
const publishArgs = [
  publishScript,
  ...(argValue('--file') === undefined ? [] : ['--file', argValue('--file')]),
  ...(argValue('--notes') === undefined ? [] : ['--notes', argValue('--notes')]),
  ...(hasFlag('--prerelease') ? ['--prerelease'] : []),
  ...(argValue('--repo') === undefined ? [] : ['--repo', argValue('--repo')]),
]
run('发布 GitHub Release', process.execPath, publishArgs, { timeout: 60 * 60_000 })

console.log(`\n[release] 完成：tag ${releaseTag ?? '(见 publish 输出)'}，仓库 ${repo}`)
