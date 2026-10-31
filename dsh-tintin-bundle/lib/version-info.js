// version-info.js — 三轴版本信息通道（2026-10-26 用户裁决：客户端展示
// 上游 DSH 版本 / 桌面渠道版本 / TinTin 各业务插件版本）。
// 数据源（铁律 9）：打包树实测——app 根 package.json（渠道名+版本）、
// app 根 node_modules/@deepseek-ai/dsh/package.json（上游运行时）、
// app 根 node_modules/dsh-tintin-*/package.json（业务插件，动态枚举不硬编码）。
// 任何一段读不到=该段 unavailable，不阻塞其余（缺供应商包/开发态属常态）。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 读 JSON 安全封装：缺失/坏 JSON → null（调用方按 unavailable 呈现） */
function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/**
 * 纯收集逻辑（fs 经参数注入，可测；不触真实盘）。
 * @param {{
 *   startDir: string,
 *   join: (a: string, b: string) => string,
 *   dirname: (p: string) => string,
 *   exists: (p: string) => boolean,
 *   readJson: (p: string) => unknown,
 *   readdir: (p: string) => string[],
 * }} io
 * @returns {{ desktop: {name: string, version: string} | null, dsh: string,
 *   plugins: Array<{name: string, version: string}> }}
 */
export function collectVersions(io) {
  const out = { desktop: null, dsh: '', plugins: [] }
  // 从本模块目录向上找 app 根：package.json 的 name 以 dsh-plugin-desktop 开头
  //（打包树 = resources/app；开发树根名 deepseek-harness-desktop → 开发态不匹配）。
  let dir = io.startDir
  let appRoot = ''
  const moduleCandidates = []
  for (let i = 0; i < 12 && dir; i++) {
    const pkg = io.readJson(io.join(dir, 'package.json'))
    if (pkg && typeof pkg.name === 'string' && pkg.name.startsWith('dsh-plugin-desktop')) {
      out.desktop = { name: pkg.name, version: String(pkg.version ?? '') }
      appRoot = dir
      break
    }
    // 开发态候选：链上真实存在的 node_modules（workspace 布局下包自身的
    // node_modules 会先出现且不含业务插件——收集全部，事后择优，见下）。
    const candidate = io.join(dir, 'node_modules')
    if (io.exists(candidate)) moduleCandidates.push(candidate)
    const parent = io.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const hasTintinEntries = (p) => {
    try { return io.readdir(p).some((e) => String(e).startsWith('dsh-tintin-')) } catch { return false }
  }
  const pickDevModules = () => {
    // 自最顶层（最靠近仓库根）向下找第一个真含 dsh-tintin-* 的；都不含则用最深一个
    for (let i = moduleCandidates.length - 1; i >= 0; i--) {
      if (hasTintinEntries(moduleCandidates[i])) return moduleCandidates[i]
    }
    return moduleCandidates[moduleCandidates.length - 1] ?? ''
  }
  const nodeModules = appRoot ? io.join(appRoot, 'node_modules') : pickDevModules()
  // 上游 DSH 运行时（vendor tarball 安装后的实际版本）
  const dshPkgPath = io.join(nodeModules, '@deepseek-ai', 'dsh', 'package.json')
  if (nodeModules && io.exists(dshPkgPath)) {
    const dsh = io.readJson(dshPkgPath)
    if (dsh && typeof dsh.version === 'string') out.dsh = dsh.version
  }
  // TinTin 业务插件（node_modules 目录名前缀动态枚举；client-ui/ops 等一并呈现）
  if (nodeModules && io.exists(nodeModules)) {
    for (const entry of io.readdir(nodeModules)) {
      if (!entry.startsWith('dsh-tintin-')) continue
      const pkg = io.readJson(io.join(nodeModules, entry, 'package.json'))
      if (pkg && typeof pkg.name === 'string' && typeof pkg.version === 'string') {
        out.plugins.push({ name: pkg.name, version: pkg.version })
      }
    }
    out.plugins.sort((a, b) => a.name.localeCompare(b.name))
  }
  return out
}

export function createVersionInfoApi() {
  const startDir = dirname(fileURLToPath(import.meta.url))
  return {
    // tintin:versions — 渲染层「版本信息」展示的唯一数据源
    'tintin:versions': async () => {
      try {
        return collectVersions({
          startDir,
          join,
          dirname,
          exists: existsSync,
          readJson: readJsonSafe,
          readdir: (p) => readdirSync(p),
        })
      } catch (e) {
        return { desktop: null, dsh: '', plugins: [], error: e?.message ?? String(e) }
      }
    },
  }
}
