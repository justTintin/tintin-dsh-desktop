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
  const ofDir = join(packageRoot, 'tintin-resources', 'openfilm')
  if (existsSync(ofDir)) { rmSync(ofDir, { recursive: true, force: true }); removed.push('openfilm') }
  const loArm = join(packageRoot, 'tintin-resources', 'cover-plugin', 'node_modules', '@deepseek-ai', 'libreoffice-kit-win32-arm64')
  if (existsSync(loArm)) { rmSync(loArm, { recursive: true, force: true }); removed.push('libreoffice-kit-win32-arm64') }
  const tmpDir = join(packageRoot, 'tintin-resources', 'cover-plugin', '.tmp')
  if (existsSync(tmpDir)) { rmSync(tmpDir, { recursive: true, force: true }); removed.push('.tmp') }
  writeFileSync(join(packageRoot, 'tintin-resources', 'cover-plugin', '.tintin-lite'), 'lite package: media binaries download after install; .remotion auto-downloads on first render\n')
  process.stdout.write(`[lite] staging 剔除: ${removed.join(', ') || '(已缺)'} + 放置 .tintin-lite 标记\n`)
}

/** 收掉占用旧产物的自愈 PowerShell（2026-11-18 EBUSY 事故）。
 *  lite 装后补齐/缺件自愈会用 detached PowerShell 跑本包 dist\win-unpacked\resources\
 *  下的 download-binaries.ps1 长下载(数百 MB,可达数分钟),期间该文件被锁;
 *  electron-builder 就地覆写同名文件会以 EBUSY 失败——且发生在数分钟构建之后。
 *  只收命令行同时命中「本包路径 + win-unpacked + download-binaries.ps1」的
 *  powershell/pwsh,杀软扫描与其它进程不由本函数处理。非 win32 直接空手返回。 */
export function sweepUnpackedSelfHealHolders(options = {}) {
  if (process.platform !== 'win32') return []
  const run = options.run ?? spawnSync
  const root = options.packagePath ?? packageRoot
  const script = [
    "$root = '" + root.replace(/'/g, "''") + "'",
    "$hits = Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' OR Name='pwsh.exe'\" |",
    "  Where-Object { $_.CommandLine -and $_.CommandLine -like '*download-binaries.ps1*' -and $_.CommandLine -like '*win-unpacked*' -and $_.CommandLine -like ('*' + $root + '*') }",
    "foreach ($p in $hits) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }",
    "($hits | ForEach-Object { $_.ProcessId }) -join ','",
  ].join('\n')
  try {
    const result = run('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
    const out = String(result.stdout ?? '').trim()
    // Number('')===0,空段必须先按文本剔除,只认纯数字段
    return out === '' ? [] : out.split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number)
  } catch {
    // CIM 查询失败不拦构建——真正的占用由随后的整树删除兜底暴露
    return []
  }
}

/** 打包前整树删除旧 dist\win-unpacked(2026-11-18 用户裁决:覆写失败类一律先清场)。
 *  删除重试间穿插一次自愈进程收割;重试耗尽仍被占用则立即失败并把可疑占用方写明,
 *  把失败提前到构建之前而不是 4 分钟之后。双包第二遍(lite)时 full 产物已挪 dist/full/,
 *  此处删除的是已让位的旧壳,无数据损失。
 *  只在 CLI 入口调用:packageDirectory 本体保持纯转参语义——单测(tests/package-dir.spec.ts)
 *  以注入 run 直调该函数,体内挂预清理会顺手删掉真实 dist 产物。 */
export function removeStaleUnpackedOutput(options = {}) {
  const target = options.unpackedPath ?? join(packageRoot, 'dist', 'win-unpacked')
  if (!existsSync(target)) return false
  const attempts = options.attempts ?? 5
  const waitMs = options.waitMs ?? 1500
  const sweep = options.sweep ?? sweepUnpackedSelfHealHolders
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const killed = sweep()
    if (killed.length) process.stdout.write(`[dir-preclean] 已收掉占用旧产物的自愈进程: PID ${killed.join(', ')}\n`)
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      process.stdout.write(`[dir-preclean] 已清理旧产物: ${target}\n`)
      return true
    } catch (error) {
      lastError = error
      if (attempt < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
    }
  }
  const code = lastError?.code ?? String(lastError?.message ?? '')
  throw new Error(
    `旧产物 ${target} 被占用,打包前无法清理(${code})。` +
    '可疑占用方:正在跑 download-binaries.ps1 的 PowerShell(lite 装后补齐自愈)、杀软实时扫描、' +
    '或正从该目录运行的程序——关闭后重跑。',
  )
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
  removeStaleUnpackedOutput()
  packageDirectory()
}
