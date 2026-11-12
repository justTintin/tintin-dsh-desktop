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

  // Remotion 浏览器缓存随载荷(2026-11-12 三轮渲染超时根修): electron-builder 收集
  // node_modules 时丢弃插件的 .remotion/chrome-headless-shell——渲染必需,缺失=
  // resolveBundledBrowser() 返回 null → 静默回退 ensureBrowser 联网下载 150MB,
  // 受限网络挂到渲染超时(180s 杀树,错误还不带死因)。staging 缓存由 stage.mjs
  // 保留,从那里补拷进载荷插件嵌套 node_modules 并自校验 exe——缺失宁可打包
  // 失败,不静默产出一个渲染必挂的包。
  const distDir = join(packageRoot, 'dist')
  const unpacked = existsSync(join(distDir, 'win-unpacked'))
    ? join(distDir, 'win-unpacked')
    : readdirSync(distDir).map((name) => join(distDir, name)).find((dir) => dir.endsWith('-unpacked') && existsSync(join(dir, 'resources', 'app')))
  if (unpacked) {
    const stagingCache = join(packageRoot, 'tintin-resources', 'cover-plugin', 'node_modules', '.remotion')
    const cacheExe = (...parts) => join(...parts, 'chrome-headless-shell', 'win64', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (!existsSync(cacheExe(stagingCache))) {
      throw new Error('staging 缺 .remotion 浏览器缓存(渲染必需)——先跑 stage.mjs 并保留缓存,再打包')
    }
    const dest = join(unpacked, 'resources', 'app', 'node_modules', 'dsh-tintin-cover-plugin')
    cpSync(stagingCache, join(dest, 'node_modules', '.remotion'), { recursive: true })
    if (!existsSync(cacheExe(dest, 'node_modules', '.remotion'))) {
      throw new Error('载荷浏览器缓存拷贝后仍缺失——检查 dist 载荷目录权限')
    }
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  packageDirectory()
}
