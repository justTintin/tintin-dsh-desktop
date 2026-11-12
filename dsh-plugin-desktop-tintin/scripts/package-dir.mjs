/** Build an unsigned unpacked application for the current host platform. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')
const electronDist = resolve(dirname(require.resolve('electron/package.json')), 'dist')

/** Electron Builder overrides that make the directory build unconditionally unsigned. */
export const UNSIGNED_DIRECTORY_BUILD_ARGS = Object.freeze([
  '--dir',
  '--publish',
  'never',
  '--config.forceCodeSigning=false',
  '--config.mac.identity=null',
  '--config.mac.notarize=false',
  '--config.win.signExecutable=false',
])

/**
 * Remove every release credential recognized by the native release entry points.
 * @param {NodeJS.ProcessEnv} environment
 * @returns {NodeJS.ProcessEnv}
 */
export function unsignedDirectoryBuildEnvironment(environment) {
  return electronBuilderEnvironment({
    ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(environment)),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  })
}

/**
 * 版本日期戳（2026-10-12 用户裁决）：目录名/Setup 名/应用内版本三处一致。TinTin 独有
 * （beta 镜像无此概念）——`package-nsis-local.mjs` 与本目录构建同源使用；env.DSH_VERSION_STAMP
 * 由 Release-Builder 统一下发，缺省=构建时刻 `YYYYMMDD.HHmm`，'off'=关闭。
 * @param {NodeJS.ProcessEnv} env
 * @param {Date} now
 * @returns {string[]} electron-builder 追加参数
 */
export function versionStampArgs(env = process.env, now = new Date()) {
  const stamp = env.DSH_VERSION_STAMP
  if (stamp === 'off') return []
  const resolved = stamp
    ?? `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  return [`--config.extraMetadata.version=${pkg.version}-${resolved}`]
}

/**
 * Build an unsigned, unpacked application for the current host platform.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   electronBuilderCli?: string,
 *   electronDistPath?: string,
 *   nodeExecutable?: string,
 *   run?: typeof spawnSync,
 * }} [options]
 */
export function packageDirectory(options = {}) {
  const run = options.run ?? spawnSync
  const nodeExecutable = options.nodeExecutable ?? process.execPath
  const electronBuilderCli = options.electronBuilderCli ?? builderCli
  const configuredElectronDist = options.electronDistPath ?? electronDist
  const result = run(
    nodeExecutable,
    [
      electronBuilderCli,
      ...UNSIGNED_DIRECTORY_BUILD_ARGS,
      ...versionStampArgs(options.env ?? process.env),
      `--config.electronDist=${configuredElectronDist}`,
    ],
    {
      cwd: options.cwd ?? packageRoot,
      env: unsignedDirectoryBuildEnvironment(options.env ?? process.env),
      stdio: 'inherit',
    },
  )

  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`electron-builder --dir exited with ${String(result.status)}`)
  }

  // 插件生产 node_modules 随载荷(2026-11-13 用户裁决「node_modules 每次打包都要打进去」):
  // electron-builder 收集依赖时把每个包提升到 app 根级,给插件留**空的**嵌套 node_modules 壳,
  // 无主目录(.remotion 浏览器缓存=非包下载缓存)永远不被收集——7.8 后渲染仍 180s 超时的根因
  // (先窄修只拷 .remotion,1113 升级为整树)。staging 的 node_modules 正是为此而建:stage.mjs
  // 按 lockfile npm install --omit=dev 的生产树(.remotion 283MB 占大头,整树仅 +41MB)。
  // 整树入载荷=插件自包含(imports 优先嵌套版,不再依赖 yarn 提升结果),未来任何非包数据
  // (模型/缓存)自动随包。拷完双校验——缺浏览器或缺渲染库宁可打包失败,不产出渲染必挂的包。
  const distDir = join(packageRoot, 'dist')
  const unpacked = existsSync(join(distDir, 'win-unpacked'))
    ? join(distDir, 'win-unpacked')
    : readdirSync(distDir).map((name) => join(distDir, name)).find((dir) => dir.endsWith('-unpacked') && existsSync(join(dir, 'resources', 'app')))
  if (unpacked) {
    const stagingModules = join(packageRoot, 'tintin-resources', 'cover-plugin', 'node_modules')
    const exeRel = join('chrome-headless-shell', 'win64', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (!existsSync(join(stagingModules, '.remotion', exeRel))) {
      throw new Error('staging 缺 .remotion 浏览器缓存(渲染必需)——先跑 stage.mjs 并保留缓存,再打包')
    }
    if (!existsSync(join(stagingModules, '@remotion', 'renderer'))) {
      throw new Error('staging 缺 @remotion/renderer(引擎渲染必需)——先跑 stage.mjs 重建生产 node_modules')
    }
    const dest = join(unpacked, 'resources', 'app', 'node_modules', 'dsh-tintin-cover-plugin')
    cpSync(stagingModules, join(dest, 'node_modules'), { recursive: true })
    if (!existsSync(join(dest, 'node_modules', '.remotion', exeRel))) {
      throw new Error('载荷浏览器缓存拷贝后仍缺失——检查 dist 载荷目录权限')
    }
    if (!existsSync(join(dest, 'node_modules', '@remotion', 'renderer'))) {
      throw new Error('载荷 @remotion/renderer 拷贝后仍缺失——检查 dist 载荷目录权限')
    }
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  packageDirectory()
}
