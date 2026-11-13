/**
 * 把打包好的 TinTin Windows 安装包发布为 GitHub Release（tintin 通道专属）。
 *
 * 应用内「检查更新」走 GitHub Releases 清单（src/tintin/tintin-update-check.ts），
 * 本脚本是它的发布侧：版本号取自安装包文件名（TinTin-<版本>-x64-Setup.exe），
 * 与打包时的版本戳三处一致；同时生成并上传 SHA-256 旁挂资产供客户端硬校验。
 *
 * 用法：
 *   node dsh-plugin-desktop-tintin/scripts/publish-github-release.mjs [--file <Setup.exe>]
 *        [--notes <text>] [--prerelease] [--force] [--repo owner/name]
 *
 * 鉴权：环境变量 TINTIN_GITHUB_TOKEN（回退 GITHUB_TOKEN / GH_TOKEN），对目标仓库
 * 需要 releases 写权限。默认仓库 justTintin/tintin-dsh-desktop（与检查器同源，
 * 可用 TINTIN_UPDATE_REPO 覆盖）。
 *
 * 示例（打包后一条命令发布）：
 *   TINTIN_GITHUB_TOKEN=ghp_xxx corepack yarn package:tintin:publish
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(packageRoot, 'dist')

const args = process.argv.slice(2)
const argValue = name => {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} 需要一个参数值`)
  }
  return value
}
const hasFlag = name => args.includes(name)

const repo = argValue('--repo') ?? process.env.TINTIN_UPDATE_REPO ?? 'justTintin/tintin-dsh-desktop'

/**
 * 发布鉴权：优先显式 token（TINTIN_GITHUB_TOKEN / GITHUB_TOKEN / GH_TOKEN）；
 * 都没有时回退 git 凭据管理器（push 已在用的同一份 PAT，仅进程内使用、不落日志）。
 */
async function resolveGitHubToken() {
  const explicit = process.env.TINTIN_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (explicit !== undefined && explicit.length > 0) return explicit
  const { spawnSync } = await import('node:child_process')
  try {
    const filled = spawnSync('git', ['credential', 'fill'], {
      input: ['protocol=https', 'host=github.com', '', ''].join('\n'),
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    })
    const password = /^password=(.*)$/mu.exec(filled.stdout ?? '')?.[1]
    if (password !== undefined && password.length > 0) return password
  } catch {
    // 没有可用的凭据管理器条目，走统一的报错。
  }
  throw new Error('缺少 GitHub token：请设置 TINTIN_GITHUB_TOKEN（或 GITHUB_TOKEN / GH_TOKEN），或先对 github.com 完成一次 git push 以缓存凭据')
}
const token = await resolveGitHubToken()

// 选安装包：--file 显式指定，否则取 dist/ 里最新的 TinTin-*-x64-Setup.exe。
let installerPath = argValue('--file')
if (installerPath === undefined) {
  const candidates = (await readdir(distDir)).filter(name => /^TinTin-.+-x64-Setup\.exe$/u.test(name))
  if (candidates.length === 0) {
    throw new Error('dist/ 下没有 TinTin-*-x64-Setup.exe——先完成 NSIS 打包步骤，或用 --file 指定安装包路径')
  }
  const newest = (await Promise.all(candidates.map(async name => ({
    name,
    mtimeMs: (await stat(join(distDir, name))).mtimeMs,
  })))).sort((left, right) => right.mtimeMs - left.mtimeMs)[0]
  installerPath = join(distDir, newest.name)
}
installerPath = resolve(installerPath)
const installerName = basename(installerPath)

// 版本号与 tag 必须与文件名严格一致（应用内检查按 tag 全字比对）。
const version = /^TinTin-(.+)-x64-Setup\.exe$/u.exec(installerName)?.[1]
if (version === undefined) {
  throw new Error(`安装包命名不符合 TinTin-<版本>-x64-Setup.exe：${installerName}`)
}
const tag = `v${version}`

// SHA-256 旁挂资产（sha256sum 格式），客户端下载后的硬校验来源。
const fileHandle = await open(installerPath, 'r')
const digest = createHash('sha256')
try {
  const chunk = Buffer.alloc(1024 * 1024)
  while (true) {
    const result = await fileHandle.read(chunk, 0, chunk.byteLength, null)
    if (result.bytesRead === 0) break
    digest.update(result.bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, result.bytesRead))
  }
} finally {
  await fileHandle.close()
}
const installerSha256 = digest.digest('hex')
const sidecarPath = `${installerPath}.sha256`
await writeFile(sidecarPath, `${installerSha256}  ${installerName}\n`, 'utf8')

const api = `https://api.github.com/repos/${repo}`
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'tintin-release-publisher',
}

const requestJson = async (path, init) => {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GitHub API ${path} 失败：HTTP ${String(response.status)} ${text.slice(0, 400)}`)
  }
  return text.length === 0 ? null : JSON.parse(text)
}

// 已有同名 release 则复用（--force 覆盖资产），否则新建。
let release = null
{
  const existing = await fetch(`${api}/releases/tags/${encodeURIComponent(tag)}`, { headers })
  if (existing.ok) {
    release = await existing.json()
    console.log(`[publish] release ${tag} 已存在，复用`)
  } else if (existing.status === 404) {
    release = undefined
  } else {
    throw new Error(`查询已有 release 失败：HTTP ${String(existing.status)} ${(await existing.text()).slice(0, 400)}`)
  }
}
if (release === undefined) {
  const notes = argValue('--notes')
    ?? `TinTin Desktop ${version}\n\n安装包：${installerName}（SHA-256 见同名 .sha256 文件）。\n应用内「检查更新」会自动发现本版本并引导下载安装。`
  release = await requestJson('/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: `TinTin ${version}`,
      body: notes,
      draft: false,
      prerelease: hasFlag('--prerelease'),
    }),
  })
  console.log(`[publish] 已创建 release ${tag}`)
} else if (!hasFlag('--force')) {
  throw new Error(`release ${tag} 已存在——需要覆盖资产时加 --force（重跑脚本会重新生成 .sha256）`)
}

const uploadUrl = release.upload_url.replace(/\{\?[^}]*\}$/u, '')
const assets = Array.isArray(release.assets) ? release.assets : []
const wanted = [
  { path: installerPath, name: installerName },
  { path: sidecarPath, name: `${installerName}.sha256` },
]
for (const asset of wanted) {
  for (const existing of assets.filter(entry => entry.name === asset.name)) {
    if (!hasFlag('--force')) throw new Error(`资产 ${asset.name} 已存在——需要覆盖时加 --force`)
    const removed = await fetch(`${api}/releases/assets/${String(existing.id)}`, { method: 'DELETE', headers })
    if (!removed.ok && removed.status !== 204) {
      throw new Error(`删除旧资产 ${asset.name} 失败：HTTP ${String(removed.status)}`)
    }
    console.log(`[publish] 已删除旧资产 ${asset.name}`)
  }
  const size = (await stat(asset.path)).size
  const upload = await fetch(`${uploadUrl}?name=${encodeURIComponent(asset.name)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    duplex: 'half',
    body: createReadStream(asset.path),
  })
  if (!upload.ok) {
    throw new Error(`上传 ${asset.name} 失败：HTTP ${String(upload.status)} ${(await upload.text()).slice(0, 400)}`)
  }
  console.log(`[publish] 已上传 ${asset.name}（${(size / 1024 / 1024).toFixed(1)} MB）`)
}

// 发布后自检：回查清单确认 tag 与全部资产就绪，防「上传成功但 release 没建出/资产
// 还在 processing」的假完成。资产状态短暂 started 时小退避重试。
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
let verified = null
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const check = await fetch(`${api}/releases/tags/${encodeURIComponent(tag)}`, { headers })
  if (check.ok) {
    const release = await check.json()
    const assets = Array.isArray(release.assets) ? release.assets : []
    const missing = wanted.filter(asset => !assets.some(entry => entry.name === asset.name && entry.state === 'uploaded'))
    if (missing.length === 0) {
      verified = release
      break
    }
    console.log(`[publish] 自检第 ${String(attempt)} 次：${missing.map(asset => asset.name).join('、')} 尚未就绪，等待重试`)
  } else {
    console.log(`[publish] 自检第 ${String(attempt)} 次：release ${tag} 查询 HTTP ${String(check.status)}`)
  }
  await sleep(5000)
}
if (verified === null) {
  throw new Error(`发布后自检失败：release ${tag} 或其资产未在重试窗口内就绪——请到 GitHub 页面人工确认`)
}

console.log(`[publish] 自检通过：release ${tag} 可见，${String(verified.assets.length)} 份资产就绪`)
console.log(`[publish] 完成：https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`)
