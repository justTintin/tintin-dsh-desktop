// 为 dshmarket 1.71.1 重生成桌面补丁(.yarn/patches/dshmarket-desktop.patch)。
// 语义与 1.70.x 版补丁一致(8 处):市场自更新识别(selfName×2)、通道归属(channelFor)、
// provideNpmVersions 注入(checkUpdates 调用×3 + updates.js 支撑×2)。
// 用法:node scripts/regen-dshmarket-patch.mjs <解包的 dshmarket package 目录> [输出patch路径]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, join } from 'node:path'

const src = process.argv[2]
const outPatch = process.argv[3] ?? '.yarn/patches/dshmarket-desktop.patch'
if (!src) throw new Error('用法: node regen-dshmarket-patch.mjs <dshmarket 解包目录> [输出路径]')

const work = join(process.env.TEMP ?? '/tmp', 'dshmarket-patchregen')
rmSync(work, { recursive: true, force: true })
const orig = join(work, 'orig', 'package')
const mod = join(work, 'mod', 'package')
mkdirSync(join(work, 'orig'), { recursive: true })
mkdirSync(join(work, 'mod'), { recursive: true })
cpSync(src, orig, { recursive: true })
cpSync(src, mod, { recursive: true })

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
  ['catalogNpmByRepo, { holdYoungReleases: config.desktopHost === true }',
    'catalogNpmByRepo, { provideNpmVersions: new Map([["dshmarket", marketVersion()]]), holdYoungReleases: config.desktopHost === true }',
    3],
])

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
