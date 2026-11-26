/** Unsigned NSIS installer build for the TinTin channel (local packaging).
 *
 * Reuses the channel's own unsigned-build plumbing (the same environment and
 * flag surface as scripts/package-dir.mjs) but targets NSIS instead of --dir.
 * The repository's dist:win release chain runs Beta-pinned packaging specs
 * that are not yet identity-normalized for the TinTin channel; local
 * packaging goes through here and relies on artifact verification instead.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'
import { removeStaleUnpackedOutput, versionStampArgs } from './package-dir.mjs'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')
const electronDist = resolve(dirname(require.resolve('electron/package.json')), 'dist')

// lite 包预处理(2026-11-16 用户裁决: 双包交付——full 全量/lite 最小+装后联网补齐)。
// --lite 旗标或 DSH_PACKAGE_LITE=1 时: 剔除 staging 的 bin 三件套与 .remotion,
// 放 .tintin-lite 标记; installer.nsh 据此在装后调用 download-binaries.ps1 联网补齐,
// .remotion 由 Remotion ensureBrowser 首渲染自动下载。NSIS 阶段(extraResources 收集)
// 在剔除后执行,lite 包自然缺这些大件。full 包不含此步,staging 原样进包。
if (process.argv.includes('--lite') || process.env.DSH_PACKAGE_LITE === '1') {
  const { existsSync: ex, rmSync: rm, writeFileSync: wf } = await import('node:fs')
  const removed = []
  for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe']) {
    const f = join(packageRoot, 'tintin-resources', 'bin', name)
    if (ex(f)) { rm(f, { force: true }); removed.push(name) }
  }
  // openfilm 三件(node.exe 83MB + openfilm 包 51MB + playwright-core 12MB):
  // 全组件可下载(nodejs.org 镜像/npm), 装后由 ensureOpenfilmRuntime 补齐
  const ofDir = join(packageRoot, 'tintin-resources', 'openfilm')
  if (ex(ofDir)) { rm(ofDir, { recursive: true, force: true }); removed.push('openfilm') }
  process.stdout.write(`[lite] staging 剔除: ${removed.join(', ') || '(已缺)'}（标记由 afterPack 写入产物 resources/）\n`)
}

/** NSIS 打包一步(spawn + 瞬态锁重试)。options.run 可注入(spec 确定性)。
 *  options.env 覆盖基础环境(缺省 process.env)。 */
export function packageNsisLocal(options = {}) {
  const run = options.run ?? spawnSync
  const nodeExecutable = options.nodeExecutable ?? process.execPath
  const env = electronBuilderEnvironment({
    ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(options.env ?? process.env)),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  })
  const argv = [
    builderCli,
    '--win', 'nsis',
    '--publish', 'never',
    '--config.forceCodeSigning=false',
    '--config.win.signExecutable=false',
    '--config.mac.identity=null',
    '--config.mac.notarize=false',
    ...versionStampArgs(options.env ?? process.env),
    `--config.electronDist=${electronDist}`,
    // 封面载荷完成性(afterPack,2026-11-13 用户裁决「打包应含全部功能并正确装到不同设备」):
    // NSIS 压缩前补拷插件生产 node_modules 整树+双校验——与 --dir 同钩子。此前 NSIS 流
    // 没有这一步,发布的 Setup 装到任何机器都缺渲染浏览器(180s 超时)。
    `--config.afterPack=${join(packageRoot, 'scripts', 'after-pack.cjs')}`,
  ]
  const attempt = () => run(nodeExecutable, argv, { cwd: packageRoot, env, stdio: 'inherit' })

  const result = attempt()
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    // Windows 杀软对刚落地的 extraResources 文件(如 download-binaries.ps1)即时扫描
    // 会短暂持锁,electron-builder 的 copyfile 无重试——2026-11-23 22:02/22:16 两轮实证:
    // --dir 有 3s 重试(package-dir.mjs [dir-retry])后通过,lite NSIS 无重试一碰即死
    // (lite Setup 缺席)。NSIS 幂等可整体重跑:3s 后重试一次,第二次仍败=真错误原样上抛;
    // spawn 层失败(error,ENOENT 类)非瞬态锁,不重试直接上抛。
    process.stderr.write('[nsis-retry] electron-builder --win nsis 失败(疑瞬态文件锁/杀软扫描),3s 后重试一次\n')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
    const retry = attempt()
    if (retry.error !== undefined) throw retry.error
    if (retry.status !== 0) {
      throw new Error(`electron-builder --win nsis exited with ${String(retry.status)} (重试后仍失败)`)
    }
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  // 自愈持锁清扫+陈旧树预清(与 package-dir.mjs 主路径同款):占锁方=跑 download-binaries.ps1
  // 的自愈 powershell/杀软实时扫描,旧 win-unpacked 不清掉,eb copyfile 一碰即 EBUSY。
  removeStaleUnpackedOutput()
  packageNsisLocal()

  // SHA-256 旁挂（2026-11-14 用户裁决：不管走哪个入口，只要产出安装包就有检验文件）。
  // 本脚本是全部 NSIS 打包路径的收口（一键链 release-tintin / Release-Builder 各模式 /
  // 手工直跑都经此），在此生成一次即可；sha256sum 格式（<摘要>  <文件名>）与
  // publish-github-release.mjs 再生成的逐字节一致，发布环节失败时可直接手动上传兜底。
  const distDir = join(packageRoot, 'dist')
  const setupName = readdirSync(distDir)
    .filter((name) => /^TinTin-.+-x64-Setup\.exe$/u.test(name))
    .map((name) => ({ name, mtimeMs: statSync(join(distDir, name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.name
  if (setupName === undefined) {
    throw new Error('NSIS 成功但 dist/ 下没有 TinTin-*-x64-Setup.exe——产物异常，中止')
  }
  const digest = createHash('sha256')
  const sidecarHandle = openSync(join(distDir, setupName), 'r')
  try {
    const chunk = Buffer.alloc(1024 * 1024)
    while (true) {
      const bytesRead = readSync(sidecarHandle, chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      digest.update(bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, bytesRead))
    }
  } finally {
    closeSync(sidecarHandle)
  }
  writeFileSync(join(distDir, `${setupName}.sha256`), `${digest.digest('hex')}  ${setupName}\n`, 'utf8')
  console.log(`[package-nsis] 已生成 SHA-256 旁挂：dist/${setupName}.sha256`)
}
