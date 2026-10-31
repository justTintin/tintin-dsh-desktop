#!/usr/bin/env node
/**
 * 封面插件载荷新鲜度门禁(2026-10-29 事故固化)。
 *
 * 事故:打包链消费的是 tintin-resources/cover-plugin 这份 staged 拷贝,它只在
 * dsh-tintin-cover-plugin/scripts/stage.mjs 运行时刷新。只改源码/重建 dist 而不跑
 * stage,下一次打包就把旧载荷整体烤进新包(编辑器/引擎/会话页全部回退)。
 *
 * 本门禁把 staged 载荷与插件工作区构建产物逐字节比对,不一致即 fail——
 * 哲学与 market:check 一致:宁可失败,不静默使用旧资源。
 * 打包链(package:dir / package:dir:hot)先跑 stage 再跑本门禁;check:tintin 兜底仓内状态。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = join(root, 'dsh-tintin-cover-plugin')
const staging = join(root, 'dsh-plugin-desktop-tintin', 'tintin-resources', 'cover-plugin')
// [staged 相对路径, 工作区相对路径]——chat-shell 两侧都在 dist/ 一层(stage 原样落盘)
const AREAS = [
  ['dist', 'dist'],
  ['public', 'public'],
  [join('chat-shell', 'dist'), join('chat-shell', 'dist')],
  ['skills', 'skills'],
]

const hash = (buf) => createHash('sha256').update(buf).digest('hex')
const walk = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (entry.name === 'node_modules' || entry.name === '.remotion' || entry.name === 'debug.log') return []
  const rel = prefix ? `${prefix}/${entry.name}` : entry.name
  return entry.isDirectory() ? walk(join(dir, entry.name), rel) : [[rel, join(dir, entry.name)]]
})

if (!existsSync(staging)) {
  console.error(`[verify-cover-payload] staging 缺失:${relative(root, staging)}`)
  console.error('  打包链 package:dir 会自动重建;手动补跑:node dsh-tintin-cover-plugin/scripts/stage.mjs')
  process.exit(1)
}

const problems = []
for (const [stagedArea, pluginArea] of AREAS) {
  const stagedDir = join(staging, stagedArea)
  const pluginDir = join(plugin, pluginArea)
  if (!existsSync(stagedDir) && !existsSync(pluginDir)) continue // 双方都无=一致(stage 对 skills 是条件同步)
  if (!existsSync(stagedDir)) { problems.push(`${stagedArea}: staging 缺失而工作区存在(stage 未跑)`) ; continue }
  if (!existsSync(pluginDir)) { problems.push(`${stagedArea}: staging 存在而工作区缺失(源已删,stale)`) ; continue }
  const stagedFiles = new Map(walk(stagedDir))
  const pluginFiles = new Map(walk(pluginDir))
  for (const [rel] of pluginFiles) {
    if (!stagedFiles.has(rel)) problems.push(`${stagedArea}/${rel}: 工作区新文件未入 staging`)
  }
  for (const [rel, stagedPath] of stagedFiles) {
    const pluginPath = pluginFiles.get(rel)
    if (!pluginPath) { problems.push(`${stagedArea}/${rel}: staging 多余(工作区已删)`) ; continue }
    if (hash(readFileSync(stagedPath)) !== hash(readFileSync(pluginPath))) {
      problems.push(`${stagedArea}/${rel}: 内容与工作区构建产物不一致(构建后未 stage)`)
    }
  }
}
// workspace 专属依赖(dsh-tintin-*)不进 staged 载荷(引擎/编辑器/chat-shell 均不消费,
// 插件宿主 lib 运行时按 app node_modules 同级解析),stage.mjs 写 staging package.json
// 时剥离它们好让 npm install 成立——比对前两侧同口径剥离,保持其余字段逐字节新鲜。
const normalizePkg = (text) => {
  const pkg = JSON.parse(text)
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[field]
    if (!deps || typeof deps !== 'object') continue
    for (const name of Object.keys(deps)) {
      if (name.startsWith('dsh-tintin-')) delete deps[name]
    }
  }
  return JSON.stringify(pkg)
}
{
  const stagedPkg = join(staging, 'package.json')
  const pluginPkg = join(plugin, 'package.json')
  if (existsSync(stagedPkg) && hash(normalizePkg(readFileSync(stagedPkg))) !== hash(normalizePkg(readFileSync(pluginPkg)))) {
    problems.push('package.json: 与工作区不一致')
  }
}

if (problems.length > 0) {
  console.error(`[verify-cover-payload] 封面载荷 stale:staging ≠ 工作区构建产物(${problems.length} 处)`)
  for (const problem of problems.slice(0, 12)) console.error(`  - ${problem}`)
  if (problems.length > 12) console.error(`  …另有 ${problems.length - 12} 处`)
  console.error('  修复:node dsh-tintin-cover-plugin/scripts/stage.mjs')
  process.exit(1)
}
console.log('[verify-cover-payload] 封面载荷新鲜:staging 与工作区构建产物逐字节一致 ✓')
