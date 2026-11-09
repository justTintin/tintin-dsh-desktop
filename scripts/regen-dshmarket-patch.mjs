// 为 dshmarket 重生成桌面补丁(.yarn/patches/dshmarket-desktop.patch)。
// 语义稳定(8 处):市场自更新识别(selfName×2)、通道归属(channelFor)、
// provideNpmVersions 注入(checkUpdates 调用×3 + updates.js 支撑×2)。
// 用法:node scripts/regen-dshmarket-patch.mjs <dshmarket 解包目录 | 版本号> [输出patch路径]
//   · 传版本号(如 1.73.14)=自动从 Yarn Berry 缓存取原件(失败 fetch 也会落 zip)，
//     缓存缺失时从 registry.npmjs.org 下载 tgz 解包——market:prepare 的补丁失配
//     自愈(prepare-dsh-market.mjs healMarketPatch)就走这条路径。
// 1.73.14 适配:三处 checkUpdates 调用上游新增 releaseSources 实参——routes.js 的
// 注入改用正则(只在 holdYoungReleases 前插 provideNpmVersions)，对上游继续加参免疫；
// 精确串锚点(channelFor/selfName/lockCommits)保留严格计数，上游大改时显式失败。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { basename, join } from 'node:path'

const src = process.argv[2]
const outPatch = process.argv[3] ?? '.yarn/patches/dshmarket-desktop.patch'
if (!src) throw new Error('用法: node regen-dshmarket-patch.mjs <dshmarket 解包目录 | 版本号> [输出patch路径]')

// ── 传版本号时:定位/下载原件并解包到临时目录 ──────────────────────────
function extractArchive(archive, dest) {
  mkdirSync(dest, { recursive: true })
  // Windows 自带 bsdtar 可读 zip/tgz;非 Windows 依次退 GNU tar/unzip
  const attempts = process.platform === 'win32'
    ? [['tar', ['-xf', archive, '-C', dest]], ['unzip', ['-o', '-q', archive, '-d', dest]]]
    : [['tar', ['-xzf', archive, '-C', dest]], ['tar', ['-xf', archive, '-C', dest]], ['unzip', ['-o', '-q', archive, '-d', dest]]]
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 120_000 })
    if (r.status === 0 && existsSync(dest)) return true
  }
  return false
}

function packageDirForVersion(version) {
  const cacheDirs = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Yarn', 'Berry', 'cache'),
    process.env.HOME && join(process.env.HOME, '.cache', 'yarn', 'v6'),
    process.env.HOME && join(process.env.HOME, '.yarn', 'berry', 'cache'),
  ].filter(Boolean)
  const work = join(process.env.TEMP ?? '/tmp', `dshmarket-pristine-${version}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  let archive = null
  let kind = null
  for (const dir of cacheDirs) {
    if (!existsSync(dir)) continue
    const hit = readdirSync(dir).find((f) => f.startsWith(`dshmarket-npm-${version}-`) && f.endsWith('.zip'))
    if (hit) { archive = join(dir, hit); kind = 'berry-cache'; break }
  }
  if (archive === null) {
    // 缓存缺失：registry tgz 直下（与 latest 同源），存缓存目录旁便于复用
    const tgz = join(work, `dshmarket-${version}.tgz`)
    console.log(`[regen] 缓存无 ${version} 原件，从 registry 下载 tgz…`)
    const download = spawnSync(process.execPath, ['-e', `fetch('https://registry.npmjs.org/dshmarket/-/dshmarket-${version}.tgz').then(async r => { if (!r.ok) throw new Error('HTTP ' + r.status); const fs = await import('node:fs'); fs.writeFileSync(process.argv[1], Buffer.from(await r.arrayBuffer())) }).catch(e => { console.error(e.message); process.exit(1) })`, tgz], {
      encoding: 'utf8', timeout: 120_000,
    })
    if (download.status !== 0 || !existsSync(tgz)) throw new Error(`registry 下载失败：${(download.stderr || download.stdout || '').trim().slice(-300)}`)
    archive = tgz
    kind = 'registry-tgz'
  }
  const dest = join(work, 'pkg')
  // Berry 缓存 zip 的根是 node_modules/dshmarket；tgz 解出 package/
  const nested = kind === 'berry-cache' ? join(dest, 'node_modules', 'dshmarket') : join(dest, 'package')
  if (!extractArchive(archive, dest) || !existsSync(nested)) throw new Error(`原件解包失败：${archive}`)
  console.log(`[regen] 原件来源=${kind} 版本=${version}`)
  return nested
}

const packageDir = /^\d+\.\d+\.\d+$/.test(src) ? packageDirForVersion(src) : src
if (!existsSync(join(packageDir, 'lib', 'routes.js'))) throw new Error(`不是 dshmarket 包目录（缺 lib/routes.js）：${packageDir}`)

const work = join(process.env.TEMP ?? '/tmp', 'dshmarket-patchregen')
rmSync(work, { recursive: true, force: true })
const orig = join(work, 'orig', 'package')
const mod = join(work, 'mod', 'package')
mkdirSync(join(work, 'orig'), { recursive: true })
mkdirSync(join(work, 'mod'), { recursive: true })
cpSync(packageDir, orig, { recursive: true })
cpSync(packageDir, mod, { recursive: true })

function edit(file, pairs) {
  const path = join(mod, file)
  let text = readFileSync(path, 'utf8')
  for (const [from, to, expect = 1] of pairs) {
    const count = text.split(from).length - 1
    if (count !== expect) throw new Error(`${file}: 期望 ${expect} 处、实得 ${count} 处 —— ${from.slice(0, 60)}...`)
    text = text.split(from).join(to)
  }
  writeFileSync(path, text, 'utf8')
}

// client/client.js —— 自更新识别(两处)
edit('client/client.js', [
  ['const selfName = installed["dshmarket"] !== void 0 ? "dshmarket" : "dsh-market";',
    'const selfName = installed["dshmarket"] !== void 0 || updates["dshmarket"] !== void 0 ? "dshmarket" : "dsh-market";'],
  ['const self = installed["dshmarket"] !== void 0 ? "dshmarket" : "dsh-market";',
    'const self = installed["dshmarket"] !== void 0 || updates["dshmarket"] !== void 0 ? "dshmarket" : "dsh-market";'],
])

// lib/routes.js —— dshmarket 归入 SELF 通道 + 注入 npm 版本(三处调用)
edit('lib/routes.js', [
  ['const channelFor = new Map(Object.keys(installed)',
    "const channelFor = new Map([...new Set([...Object.keys(installed), 'dshmarket'])]"],
])
// checkUpdates 注入用正则:1.73.14 起上游会给 options 追加新实参(如 releaseSources)，
// 只在 holdYoungReleases 前插 provideNpmVersions，对后续继续加参免疫(精确串锚点已翻车一次)
{
  const path = join(mod, 'lib/routes.js')
  const text = readFileSync(path, 'utf8')
  const pattern = /catalogNpmByRepo, \{ holdYoungReleases: /g
  const count = (text.match(pattern) ?? []).length
  if (count !== 3) throw new Error(`lib/routes.js: 期望 3 处、实得 ${count} 处 —— checkUpdates 注入锚点`)
  writeFileSync(path, text.replace(pattern, 'catalogNpmByRepo, { provideNpmVersions: new Map([["dshmarket", marketVersion()]]), holdYoungReleases: '), 'utf8')
}

// lib/updates.js —— checkUpdates 支撑 provideNpmVersions(注入 + 优先取 provided)
edit('lib/updates.js', [
  ['    const lockCommits = readLockCommits(profile, activeProfileDir);',
    `    const provided = new Map();
    for (const [name, version] of options.provideNpmVersions ?? []) {
        if (installed[name] !== undefined) continue;
        installed[name] = version;
        provided.set(name, version);
    }
    const lockCommits = readLockCommits(profile, activeProfileDir);`],
  ['const version = readInstalledVersion(profile, name, activeProfileDir);',
    'const version = provided.get(name) ?? readInstalledVersion(profile, name, activeProfileDir);'],
])

// 生成 unified diff(a/ b/ 路径与旧补丁同构;git diff --no-index 有差异时 exit 1,经 catch 取 stdout)
let diff = ''
try {
  diff = execFileSync('git', ['diff', '--no-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', 'orig/package', 'mod/package'], {
    cwd: work,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (e) {
  diff = String(e.stdout ?? '')
}
// 路径归一:a/orig/package/... → a/... (对齐旧补丁的 a/client/client.js 形态)
diff = diff.replaceAll('a/orig/package/', 'a/').replaceAll('b/mod/package/', 'b/')
if (!diff.includes('client/client.js')) throw new Error('diff 生成异常:无 client/client.js 变更')
writeFileSync(outPatch, diff, 'utf8')
console.log(`[regen] ${diff.split('\n').length} 行补丁 → ${outPatch}`)
console.log('[regen] hunks:', (diff.match(/^@@/gm) ?? []).length)
