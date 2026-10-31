#!/usr/bin/env node
/**
 * 热调模式载荷新鲜度守卫(打包不变量:包里必须最新代码,2026-10-29 用户裁决)。
 *
 * 模式 2(快速热调)跳过编译复用现有产物——四个 bundle 与封面载荷在链上仍会现编译,
 * 但通道自身代码(lib/)与 OpenFilm 壳(覆盖进 openfilm 运行时 editor dist)不会。
 * 本守卫不编译、只校验:发现任何源码文件比对应构建产物新,立即失败并指路,
 * 绝不静默把旧产物打进包。正常路径零耗时(纯 mtime 扫描)。
 * 修复方式二选一:改用打包模式 1/3/4(现编译),或手动补跑对应构建后再热调。
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'dist.stock', '.remotion', 'debug.log', '.tmp'])

const newest = (dir) => {
  let m = 0
  let file = ''
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else {
        const t = statSync(p).mtimeMs
        if (t > m) { m = t; file = p }
      }
    }
  }
  walk(dir)
  return { m, file }
}

// [源码目录, 构建产物目录, 构建命令提示];源码目录不存在=可选,跳过
const PAIRS = [
  ['dsh-plugin-desktop-tintin/src', 'dsh-plugin-desktop-tintin/lib', 'corepack yarn workspace dsh-plugin-desktop-tintin build'],
  ['dsh-tintin-bundle/openfilm-shell', 'dsh-plugin-desktop-tintin/tintin-resources/openfilm/node_modules/openfilm/studio/ui/dist', 'corepack yarn workspace dsh-plugin-desktop-tintin prepare:openfilm-shell'],
  ['dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src', 'dsh-plugin-desktop-tintin/tintin-resources/openfilm/node_modules/openfilm/studio/ui/dist', 'corepack yarn workspace dsh-plugin-desktop-tintin prepare:openfilm-shell'],
]

const problems = []
const fixes = new Set()
for (const [srcRel, artRel, fix] of PAIRS) {
  const srcDir = join(root, srcRel)
  const artDir = join(root, artRel)
  if (!statSync(srcDir, { throwIfNoEntry: false })) continue
  if (!statSync(artDir, { throwIfNoEntry: false })) {
    problems.push(`${srcRel}: 构建产物缺失(${artRel})——从未构建过`)
    fixes.add(fix)
    continue
  }
  const src = newest(srcDir)
  const art = newest(artDir)
  if (src.m > art.m) {
    problems.push(`${relative(root, src.file)} 比产物新 ${Math.round((src.m - art.m) / 60000)} 分钟(${srcRel})`)
    fixes.add(fix)
  }
}

if (problems.length > 0) {
  console.error('[verify-hot-fresh] 热调模式检测到源码比构建产物新(热调不编译,拒绝打包旧代码):')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('  修复(二选一):打包改用模式 1/3/4(现编译),或先补跑对应构建再热调:')
  for (const fix of fixes) console.error(`    ${fix}`)
  process.exit(1)
}
console.log('[verify-hot-fresh] 热调载荷新鲜:通道 lib 与 OpenFilm 壳产物均不旧于源码 ✓')
