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

const newest = (dir, extraSkip) => {
  let m = 0
  let file = ''
  const skip = extraSkip?.length ? new Set([...SKIP, ...extraSkip]) : SKIP
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
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

// [源码目录, 构建产物(目录或文件), 构建命令提示, 源码扫描额外排除目录?];源码目录不存在=可选,跳过。
// 2026-11-15 扩账(用户裁决「每次打包都应有所有功能代码」):三个 Vue 子应用 dist、封面
// client.js/engine、chat-shell dist 全部入账——此前只盯 3 对,1237 安装包(构建于功能
// 落地前)暴露的「部分产物不在守卫名单」漏洞就此关闭。
const PAIRS = [
  ['dsh-plugin-desktop-tintin/src', 'dsh-plugin-desktop-tintin/lib', 'corepack yarn workspace dsh-plugin-desktop-tintin build'],
  ['dsh-tintin-bundle/openfilm-shell', 'dsh-plugin-desktop-tintin/tintin-resources/openfilm/node_modules/openfilm/studio/ui/dist', 'corepack yarn workspace dsh-plugin-desktop-tintin prepare:openfilm-shell'],
  ['dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src', 'dsh-plugin-desktop-tintin/tintin-resources/openfilm/node_modules/openfilm/studio/ui/dist', 'corepack yarn workspace dsh-plugin-desktop-tintin prepare:openfilm-shell'],
  ['dsh-tintin-media-bundle/src', 'dsh-tintin-media-bundle/dist', 'corepack yarn workspace dsh-tintin-media-bundle build'],
  ['dsh-tintin-ops-bundle/src', 'dsh-tintin-ops-bundle/dist', 'corepack yarn workspace dsh-tintin-ops-bundle build'],
  ['dsh-tintin-creation-bundle/src', 'dsh-tintin-creation-bundle/dist', 'corepack yarn workspace dsh-tintin-creation-bundle build'],
  ['dsh-tintin-cover-plugin/src', 'dsh-tintin-cover-plugin/client.js', 'node ../dsh-tintin-cover-plugin/scripts/stage.mjs'],
  ['dsh-tintin-cover-plugin/src', 'dsh-tintin-cover-plugin/dist/engine.mjs', 'node ../dsh-tintin-cover-plugin/scripts/stage.mjs'],
  ['dsh-tintin-cover-plugin/chat-shell', 'dsh-tintin-cover-plugin/chat-shell/dist', 'node ../dsh-tintin-cover-plugin/chat-shell/build.mjs', ['dist']],
]

const problems = []
const fixes = new Set()
for (const [srcRel, artRel, fix, extraSkip] of PAIRS) {
  const srcDir = join(root, srcRel)
  const artPath = join(root, artRel)
  if (!statSync(srcDir, { throwIfNoEntry: false })) continue
  const artStat = statSync(artPath, { throwIfNoEntry: false })
  if (!artStat) {
    problems.push(`${srcRel}: 构建产物缺失(${artRel})——从未构建过`)
    fixes.add(fix)
    continue
  }
  const src = newest(srcDir, extraSkip)
  /* 产物=文件时直接取其 mtime;目录沿用递归扫描 */
  const art = artStat.isFile() ? { m: artStat.mtimeMs, file: artPath } : newest(artPath)
  if (src.m > art.m) {
    problems.push(`${relative(root, src.file)} 比产物新 ${Math.round((src.m - art.m) / 60000)} 分钟(${srcRel})`)
    fixes.add(fix)
  }
}

if (problems.length > 0) {
  console.error('[verify-hot-fresh] 检测到源码比构建产物新(拒绝把旧产物打进安装包):')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('  修复(二选一):打包改用模式 1/3/4(现编译),或先补跑对应构建再热调:')
  for (const fix of fixes) console.error(`    ${fix}`)
  process.exit(1)
}
console.log('[verify-hot-fresh] 载荷新鲜:通道 lib、OpenFilm 壳、三个 Vue 子应用 dist 与封面载荷(client.js/engine/chat-shell)均不旧于源码 ✓')
