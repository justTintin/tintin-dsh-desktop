/** Refresh the bundled market from npm latest without floating the committed lockfile. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MARKET_WORKSPACES = ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta', 'dsh-desktop-next', 'dsh-plugin-desktop-tintin']
export const marketResolution = version => `patch:dshmarket@npm%3A${version}#./.yarn/patches/dshmarket-desktop.patch`
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registry = 'https://registry.npmjs.org/dshmarket/latest'

export async function latestMarket(fetcher = fetch) {
  const response = await fetcher(registry, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (!response.ok) throw new Error(`dshmarket latest lookup failed: HTTP ${response.status}`)
  const manifest = await response.json()
  if (manifest.name !== 'dshmarket' || typeof manifest.version !== 'string'
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error('npm latest returned an invalid dshmarket identity/version')
  }
  return manifest.version
}

function installedVersion(directory, workspace) {
  try {
    const require = createRequire(join(directory, workspace, 'package.json'))
    return JSON.parse(readFileSync(require.resolve('dshmarket/package.json'), 'utf8')).version
  } catch { return undefined }
}

function install(directory) {
  const yarn = process.env.COREPACK_ROOT
    ? join(process.env.COREPACK_ROOT, 'dist', 'yarn.js') : process.env.npm_execpath
  if (!yarn || !/\.[cm]?js$/.test(yarn) || !existsSync(yarn)) {
    throw new Error('Run corepack yarn market:prepare to use the repository Yarn release')
  }
  const result = spawnSync(process.execPath, [yarn, 'install'], {
    cwd: directory, timeout: 600_000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' },
  })
  // 输出透传保持既有可见性，同时留一份文本供补丁失配自愈判定
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Market dependency install failed (${result.status})`, {
      cause: new Error(`${(result.stdout || '')}${(result.stderr || '')}`),
    })
  }
}

/**
 * 2026-11-07 用户需求：浮版补丁失配自动重接线——打包模式 1（联网+最新）因
 * dshmarket 漂版导致「Cannot apply hunk #N」时，不再要求人工修改：
 * 取新版原件（Yarn Berry 缓存优先，缺失走 registry tgz）重生成桌面补丁；
 * 由调用方重试一次安装。版本钉版无需在此处理——prepareMarket 在 install 前
 * 已把 resolutions/各 workspace manifests 全部写成新版本，失配的只有补丁文件本体。
 * 前提：scripts/regen-dshmarket-patch.mjs 的语义锚点仍适用（锚点漂移时本自愈
 * 会带 regen 输出失败——那是需要人工看上游 diff 的信号，不静默吞掉）。
 */
function healMarketPatch(directory, version) {
  const regen = resolve(directory, 'scripts', 'regen-dshmarket-patch.mjs')
  const patchPath = join(directory, '.yarn', 'patches', 'dshmarket-desktop.patch')
  const patchBackup = existsSync(patchPath) ? readFileSync(patchPath) : null
  console.log(`[market] dshmarket ${version} 补丁失配，自动重接线（重生成补丁）后重试…`)
  const result = spawnSync(process.execPath, [regen, version, patchPath], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0 || !existsSync(patchPath)) {
    // 自愈失败：恢复原补丁，把上游 diff 的取证责任如实抛回
    if (patchBackup === null) rmSync(patchPath, { force: true })
    else writeFileSync(patchPath, patchBackup)
    throw new Error(`patch auto-repair failed for dshmarket ${version}（语义锚点可能漂移，需人工看上游 diff）:\n${output.trim().slice(-1200)}`)
  }
  console.log(`[market] patch re-wired for dshmarket ${version} (auto-repair)`)
}

export async function prepareMarket(directory, { check = false, pinned = false, fetcher = fetch, runInstall = install } = {}) {
  if (pinned) {
    // 本地全编锚定（2026-10-21 用户裁决）：沿用已安装/已锁定的 dshmarket，
    // 不访问 npm、不重写版本——与 AA 的本地锚定同一条"钉死"口径。
    const installed = MARKET_WORKSPACES.map(workspace => installedVersion(directory, workspace))
    const version = installed[0]
    if (version === undefined) throw new Error('dshmarket is not installed; run corepack yarn market:prepare once online to seed it')
    if (installed.some(entry => entry !== version)) throw new Error(`dshmarket versions diverge across workspaces: ${installed.join(', ')}`)
    if (!existsSync(resolve(directory, '.yarn', 'patches', 'dshmarket-desktop.patch'))) throw new Error('dshmarket desktop patch is missing')
    return version
  }
  // Resolve the tag before any writes. An offline check must not silently bless an old release.
  const version = await latestMarket(fetcher)
  const paths = ['package.json', ...MARKET_WORKSPACES.map(name => `${name}/package.json`), 'yarn.lock']
  const originals = new Map(paths.map(path => [path, readFileSync(join(directory, path))]))
  const manifests = new Map(paths.filter(path => path.endsWith('.json')).map(path =>
    [path, JSON.parse(originals.get(path).toString())]))
  const rootManifest = manifests.get('package.json')
  const overrides = Object.keys(rootManifest.resolutions ?? {}).filter(key => key === 'dshmarket' || key.startsWith('dshmarket@'))
  const resolutionKey = `dshmarket@npm:${version}`
  const patchCurrent = overrides.length === 1 && rootManifest.resolutions[resolutionKey] === marketResolution(version)
  const stale = MARKET_WORKSPACES.filter(workspace =>
    manifests.get(`${workspace}/package.json`).dependencies?.dshmarket !== version
    || installedVersion(directory, workspace) !== version)
  if (check) {
    if (stale.length || !patchCurrent) throw new Error(`dshmarket latest is ${version}; run corepack yarn market:prepare (${stale.join(', ') || 'stale resolution'})`)
    return version
  }
  if (!stale.length && patchCurrent) return version
  try {
    // Follow latest while retaining Desktop self-update and rollback fixes. Yarn rejects
    // incompatible patch contexts; never silently ship a new release without these safeguards.
    for (const key of overrides) delete rootManifest.resolutions[key]
    rootManifest.resolutions ??= {}
    rootManifest.resolutions[resolutionKey] = marketResolution(version)
    for (const workspace of MARKET_WORKSPACES) {
      const manifest = manifests.get(`${workspace}/package.json`)
      if (!manifest.dependencies?.dshmarket) throw new Error(`${workspace} must declare its bundled dshmarket`)
      manifest.dependencies.dshmarket = version
    }
    for (const [path, manifest] of manifests) writeFileSync(join(directory, path), `${JSON.stringify(manifest, null, 2)}\n`)
    // 自愈原子性：heal 前留补丁底片，重试仍失败时一并恢复（防「旧钉版+新补丁」错配残留）
    const patchPath = join(directory, '.yarn', 'patches', 'dshmarket-desktop.patch')
    const patchBackup = existsSync(patchPath) ? readFileSync(patchPath) : null
    try {
      runInstall(directory)
    } catch (installError) {
      // 2026-11-07 用户需求：浮版补丁失配自愈——只在「hunk 对不上」特征下重接线重试一次
      const causeText = String(installError?.cause?.message ?? installError?.message ?? installError)
      if (!/Cannot apply hunk/i.test(causeText)) throw installError
      healMarketPatch(directory, version)
      try {
        runInstall(directory)
      } catch (retryError) {
        if (patchBackup === null) rmSync(patchPath, { force: true })
        else writeFileSync(patchPath, patchBackup)
        throw retryError
      }
    }
    for (const workspace of MARKET_WORKSPACES) {
      if (installedVersion(directory, workspace) !== version) throw new Error(`${workspace} did not install dshmarket ${version}`)
    }
  } catch (error) {
    for (const [path, bytes] of originals) writeFileSync(join(directory, path), bytes)
    throw new Error('Market preparation failed; manifests and lockfile restored. Rerun yarn install before continuing.', { cause: error })
  }
  return version
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--check' && arg !== '--pinned')) throw new Error('Usage: corepack yarn market:prepare [--check] [--pinned]')
  const pinned = args.includes('--pinned') || process.env.DSH_MARKET_PINNED === '1'
  const version = await prepareMarket(root, { check: args.includes('--check'), pinned })
  console.log(pinned
    ? `dshmarket pinned to the installed ${version} in Stable, Beta, Next and the TinTin channel (no npm access)`
    : `dshmarket latest verified: ${version} in Stable, Beta, Next and the TinTin channel`)
}
