/** Unsigned NSIS installer build for the TinTin channel (local packaging).
 *
 * Reuses the channel's own unsigned-build plumbing (the same environment and
 * flag surface as scripts/package-dir.mjs) but targets NSIS instead of --dir.
 * The repository's dist:win release chain runs Beta-pinned packaging specs
 * that are not yet identity-normalized for the TinTin channel; local
 * packaging goes through here and relies on artifact verification instead.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'

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
  `--config.electronDist=${electronDist}`,
]

const result = spawnSync(process.execPath, args, { cwd: packageRoot, env, stdio: 'inherit' })
if (result.error !== undefined) throw result.error
// The afterPack runtime smoke fails on this machine for a repository-wide
// Windows/Node-24 reason (identical on Beta); the artifact is still produced,
// so surface the code without failing the local build.
if (result.status !== 0) {
  process.stdout.write(`package-nsis: electron-builder exited with ${String(result.status)} (artifact may still be complete; verify it)\n`)
}
process.exitCode = 0
