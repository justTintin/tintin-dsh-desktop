/** Build an unsigned unpacked application for the current host platform. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')
const electronDist = resolve(dirname(require.resolve('electron/package.json')), 'dist')

/** lite 包预处理(2026-11-16 用户裁决: 双包交付——full 全量/lite 最小+装后联网补齐)。
 *  DSH_PACKAGE_LITE=1 时: 从 staging 剔除 bin 三件套与 .remotion 浏览器缓存
 *  (安装后由 resources/download-binaries.ps1 与 Remotion ensureBrowser 联网补齐),
 *  并放 .tintin-lite 标记(installer.nsh 据此决定装后下载段)。
 *  注意: staging 是打包输入,不是产物——剔除只影响本次包,重打 full 前先补齐 staging。 */
function applyLitePackage() {
  if (process.env.DSH_PACKAGE_LITE !== '1') return
  const stagingBin = join(packageRoot, 'tintin-resources', 'bin')
  const removed = []
  for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe']) {
    const f = join(stagingBin, name)
    if (existsSync(f)) { rmSync(f, { force: true }); removed.push(name) }
  }
  const remotion = join(packageRoot, 'tintin-resources', 'cover-plugin', 'node_modules', '.remotion')
  if (existsSync(remotion)) { rmSync(remotion, { recursive: true, force: true }); removed.push('.remotion') }
  writeFileSync(join(packageRoot, 'tintin-resources', 'cover-plugin', '.tintin-lite'), 'lite package: media binaries download after install; .remotion auto-downloads on first render\n')
  process.stdout.write(`[lite] staging 剔除: ${removed.join(', ') || '(已缺)'} + 放置 .tintin-lite 标记\n`)
}

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
  applyLitePackage()
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
      // 封面载荷完成性(afterPack,2026-11-13 用户裁决):装配完成、产物落地前补拷
      // 插件生产 node_modules 整树并双校验——与 NSIS 安装包同钩子,一处门禁全产物生效。
      `--config.afterPack=${join(packageRoot, 'scripts', 'after-pack.cjs')}`,
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
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  packageDirectory()
}
