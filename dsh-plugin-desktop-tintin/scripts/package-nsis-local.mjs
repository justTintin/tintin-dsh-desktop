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
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'
// 版本日期戳（2026-10-12 用户裁决）：与 package-dir.mjs 同源——DSH_VERSION_STAMP
// 由 Release-Builder 统一下发（目录名/setup 名/应用内版本三处一致），缺省=构建时刻
import { versionStampArgs } from './package-dir.mjs'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')
const electronDist = resolve(dirname(require.resolve('electron/package.json')), 'dist')

const env = electronBuilderEnvironment({
  ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(process.env)),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
})

const args = [
  builderCli,
  '--win', 'nsis',
  '--publish', 'never',
  '--config.forceCodeSigning=false',
  '--config.win.signExecutable=false',
  '--config.mac.identity=null',
  '--config.mac.notarize=false',
  ...versionStampArgs(process.env),
  `--config.electronDist=${electronDist}`,
  // 封面载荷完成性(afterPack,2026-11-13 用户裁决「打包应含全部功能并正确装到不同设备」):
  // NSIS 压缩前补拷插件生产 node_modules 整树+双校验——与 --dir 同钩子。此前 NSIS 流
  // 没有这一步,发布的 Setup 装到任何机器都缺渲染浏览器(180s 超时)。
  `--config.afterPack=${join(packageRoot, 'scripts', 'after-pack.cjs')}`,
]

const result = spawnSync(process.execPath, args, { cwd: packageRoot, env, stdio: 'inherit' })
if (result.error !== undefined) throw result.error
if (result.status !== 0) {
  throw new Error(`electron-builder --win nsis exited with ${String(result.status)}`)
}

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
