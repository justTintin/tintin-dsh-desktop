// hot-sync-archives — 把工作区热刷到全部现存打包归档(铁律 20:禁止手拼 cp——
// 2026-11-24 lib 热刷只同步 *.js 漏掉 preload 的 *.cjs,手拼命令没有完整文件集知识)。
// 同步面=实际热刷过的全部面,在此登记一次;新面在此登记,以后机械覆盖所有现存归档。
// 用法: node scripts/hot-sync-archives.mjs [--verify]
//   --verify: 只校验各归档与工作区文件集一致,不写(交付自检用)。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const releases = resolve(root, '..', 'TinTin_DSH_Release_Builder', 'releases')
const verifyOnly = process.argv.includes('--verify')

/** 同步面登记表(每面=工作区源 + 归档内一个或多个落点) */
const SOURCES = [
  { name: '宿主 lib(js+cjs,含 preload)', srcDir: join(root, 'dsh-plugin-desktop-tintin', 'lib'), test: /\.(js|cjs)$/, targets: (res) => [join(res, 'app', 'lib')], cleanJs: true },
  { name: 'dsh-tintin-shared/lib(js)', srcDir: join(root, 'dsh-tintin-shared', 'lib'), test: /\.js$/, targets: (res) => [join(res, 'app', 'node_modules', 'dsh-tintin-shared', 'lib')], cleanJs: true },
  { name: 'film shell dist(两副本)', srcDir: join(root, 'dsh-tintin-bundle', 'openfilm-shell', 'dist'), test: null, targets: (res) => [join(res, 'app', 'node_modules', 'dsh-tintin-bundle', 'openfilm-shell', 'dist'), join(res, 'openfilm', 'node_modules', 'openfilm', 'studio', 'ui', 'dist')], mirror: true },
  { name: '媒体包 dist(client.js+css)', srcDir: join(root, 'dsh-tintin-media-bundle', 'dist'), test: null, targets: (res) => [join(res, 'app', 'node_modules', 'dsh-tintin-media-bundle', 'dist')], mirror: true },
  // 宿主桥 bundle（2026-11-26 四源四轨批：人物图上传新通道 server:uploadImage 落在此包）
  { name: '桥 bundle 根脚本(client/index)', srcDir: join(root, 'dsh-tintin-bundle'), test: /^(client|index)\.js$/, targets: (res) => [join(res, 'app', 'node_modules', 'dsh-tintin-bundle')], cleanJs: true },
  { name: '桥 bundle lib(js)', srcDir: join(root, 'dsh-tintin-bundle', 'lib'), test: /\.js$/, targets: (res) => [join(res, 'app', 'node_modules', 'dsh-tintin-bundle', 'lib')], cleanJs: true },
]

/** 递归收集目录下全部文件(相对路径) */
const dirTree = (dir) => {
  const out = []
  const walk = (cur, rel) => {
    for (const name of readdirSync(cur, { withFileTypes: true })) {
      const from = join(cur, name.name)
      const relPath = rel ? `${rel}/${name.name}` : name.name
      if (name.isDirectory()) walk(from, relPath)
      else out.push({ from, rel: relPath })
    }
  }
  if (existsSync(dir)) walk(dir, '')
  return out
}
const filesOf = (surface) => dirTree(surface.srcDir).filter((f) => !surface.test || surface.test.test(f.rel))
const mirrorSync = (destDir, srcFiles) => {
  rmSync(destDir, { recursive: true, force: true })
  for (const f of srcFiles) {
    mkdirSync(dirname(join(destDir, f.rel)), { recursive: true })
    cpSync(f.from, join(destDir, f.rel))
  }
}
const cleanJsSync = (destDir, srcFiles) => {
  if (!existsSync(destDir)) return
  for (const name of readdirSync(destDir)) {
    if (/\.(js|cjs)$/.test(name)) rmSync(join(destDir, name))
  }
  for (const f of srcFiles) cpSync(f.from, join(destDir, f.rel))
}
const sameSet = (srcFiles, destDir) => {
  if (!existsSync(destDir)) return false
  /* Windows 递归 readdir 返回反斜杠相对路径,统一成 posix 再比 */
  const dest = new Set(readdirSync(destDir, { recursive: true }).map((p) => p.split('\\').join('/')))
  return srcFiles.every((f) => dest.has(f.rel))
}

const archives = existsSync(releases)
  ? readdirSync(releases)
      .filter((n) => n.endsWith('-dir'))
      .map((n) => resolve(releases, n, 'win-unpacked', 'resources'))
      .filter((res) => existsSync(join(res, 'app', 'lib')))
  : []
if (!archives.length) {
  console.error('hot-sync-archives: 没有找到任何现存归档(releases/*-dir/win-unpacked/resources/app/lib)')
  process.exit(1)
}
console.log(`hot-sync-archives: ${archives.length} 个归档, ${verifyOnly ? '校验模式' : '写入模式'}`)

let failures = 0
for (const res of archives) {
  for (const surface of SOURCES) {
    const srcFiles = filesOf(surface)
    if (!srcFiles.length) { console.warn(`[handoff] ${surface.name}: 工作区源为空,跳过(先构建再热刷)`); continue }
    const targets = surface.targets(res).filter((dir) => existsSync(dirname(dir)) || !verifyOnly)
    if (verifyOnly) {
      const ok = targets.filter((dir) => sameSet(srcFiles, dir)).length
      if (ok !== targets.length) { failures += 1; console.error(`[handoff] ${surface.name} → 不一致 (${ok}/${targets.length} 落点)`) }
      continue
    }
    for (const dir of targets) {
      if (surface.mirror) mirrorSync(dir, srcFiles)
      else cleanJsSync(dir, srcFiles)
    }
    const ok = targets.filter((dir) => sameSet(srcFiles, dir)).length
    if (ok !== targets.length) { failures += 1; console.error(`[handoff] ${surface.name} → 同步后仍不一致 (${ok}/${targets.length})`) }
    else console.log(`[handoff] ${surface.name} → ${targets.length} 落点 ✓ (${srcFiles.length} 文件)`)
  }
}
if (failures) { console.error(`hot-sync-archives: FAILED (${failures} 项)`); process.exit(1) }
console.log('hot-sync-archives: 完成')
