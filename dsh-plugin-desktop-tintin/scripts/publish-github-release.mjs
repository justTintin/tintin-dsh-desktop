/**
 * 把打包好的 TinTin Windows 安装包发布为 GitHub Release（tintin 通道专属）。
 *
 * 应用内「检查更新」走 GitHub Releases 清单（src/tintin/tintin-update-check.ts），
 * 本脚本是它的发布侧：版本号取自安装包文件名（TinTin-<版本>-x64-Setup.exe），
 * 与打包时的版本戳三处一致；同时生成并上传 SHA-256 旁挂资产供客户端硬校验。
 * 资产上传走 curl 子进程（瞬时错误自动重试×3）；被打断的上传会留下占住资产名的
 * 空壳资产，撞 422 already_exists 时加 --force 自动清理重传，自检还会比对资产
 * 字节数与本地文件防 0 字节假上传。
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

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { open, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

// 传输层走 curl 子进程而不是 Node fetch 流式 body：大资产长传输一旦被中断（网络
// 复位、进程被杀），GitHub 会留下占住资产名的半截资产，后续重试全部撞 422
// already_exists（2026-11-14 实测坑，且该资产常被定型成 0 字节的 uploaded 空壳）。
// curl 实发 Content-Length、瞬时错误自动重试、进度条直落 stderr；token 经 stdin
// 配置喂入，不落命令行与日志。
const wanted = []
for (const entry of [
  { path: installerPath, name: installerName },
  { path: sidecarPath, name: `${installerName}.sha256` },
]) {
  wanted.push({ ...entry, size: (await stat(entry.path)).size })
}

const deleteAssetById = async assetId => {
  const removed = await fetch(`${api}/releases/assets/${String(assetId)}`, { method: 'DELETE', headers })
  if (!removed.ok && removed.status !== 204) {
    throw new Error(`删除资产失败（id ${String(assetId)}）：HTTP ${String(removed.status)}`)
  }
}

const refreshAssets = async () => {
  const fresh = await requestJson(`/releases/tags/${encodeURIComponent(tag)}`)
  return Array.isArray(fresh.assets) ? fresh.assets : []
}

/** curl 一次性上传，返回 { status, body, exit }；进度条与错误直通终端（stderr）。 */
function uploadAssetWithCurl(asset) {
  const responsePath = join(tmpdir(), `tintin-upload-${String(process.pid)}-${String(Date.now())}.json`)
  const config = [
    `header = "Authorization: Bearer ${token}"`,
    'header = "Content-Type: application/octet-stream"',
    'header = "Expect:"',
    `url = "${uploadUrl}?name=${encodeURIComponent(asset.name)}"`,
    'request = "POST"',
    // upload-file 从磁盘流式读出，不吃满进程内存（data-binary 会把整个文件读进内存）。
    `upload-file = "${asset.path.replaceAll('\\', '/')}"`,
    `output = "${responsePath.replaceAll('\\', '/')}"`,
    'retry = 3',
    'retry-delay = 5',
    'max-time = 2700',
  ].join('\n')
  const result = spawnSync('curl', ['-K', '-', '-#', '-w', '%{http_code} %{size_upload}B %{time_total}s'], {
    input: config,
    encoding: 'utf8',
    timeout: 3000_000,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const status = Number.parseInt((result.stdout ?? '').trim(), 10)
  let body = ''
  if (existsSync(responsePath)) {
    body = readFileSync(responsePath, 'utf8')
    rmSync(responsePath, { force: true })
  }
  return { status: Number.isNaN(status) ? 0 : status, body, exit: result.status }
}

const uploadOne = async asset => {
  // 清单里已存在的同名旧资产：--force 删除，否则明确报错。
  for (const stale of (await refreshAssets()).filter(entry => entry.name === asset.name)) {
    if (!hasFlag('--force')) throw new Error(`资产 ${asset.name} 已存在——需要覆盖时加 --force`)
    await deleteAssetById(stale.id)
    console.log(`[publish] 已删除旧资产 ${asset.name}（id ${String(stale.id)}）`)
  }
  console.log(`[publish] 正在上传 ${asset.name}（${(asset.size / 1024 / 1024).toFixed(1)} MB，自动重试×3）…`)
  let upload = uploadAssetWithCurl(asset)
  // 半截占名资产常常不在清单里，只有上传时才撞 422 already_exists；--force 下按清单
  // 清理后重传一次。没有 --force 时给出明确的处置指引。
  if (upload.status === 422 && /already_exists/u.test(upload.body)) {
    if (!hasFlag('--force')) {
      throw new Error(`上传 ${asset.name} 被拒：422 already_exists——通常有先前中断上传留下的占名资产，加 --force 自动清理重传`)
    }
    const stale = (await refreshAssets()).find(entry => entry.name === asset.name)
    if (stale === undefined) {
      throw new Error(`上传 ${asset.name} 被拒：422 already_exists，且清单查不到占名资产——请到 release 页面人工处理后重跑`)
    }
    await deleteAssetById(stale.id)
    console.log(`[publish] 已删除占名旧资产 ${asset.name}（id ${String(stale.id)}），重传`)
    upload = uploadAssetWithCurl(asset)
  }
  if (upload.exit !== 0 || upload.status < 200 || upload.status >= 300) {
    throw new Error(`上传 ${asset.name} 失败：curl exit ${String(upload.exit)} HTTP ${String(upload.status)}${upload.body.length > 0 ? ` ${upload.body.slice(0, 300)}` : ''}`)
  }
  console.log(`[publish] 已上传 ${asset.name}（${(asset.size / 1024 / 1024).toFixed(1)} MB）`)
}
for (const asset of wanted) await uploadOne(asset)

// 发布后自检：回查清单确认 tag 与全部资产就绪，防「上传成功但 release 没建出/资产
// 还在 processing」的假完成；同时比对资产字节数与本地文件，拦住中断留下的 0 字节
// 空壳资产（--force 下就地删除重传，否则只能人工处置）。状态短暂 started 时小退避重试。
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
let verified = null
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const check = await fetch(`${api}/releases/tags/${encodeURIComponent(tag)}`, { headers })
  if (check.ok) {
    const payload = await check.json()
    const assets = Array.isArray(payload.assets) ? payload.assets : []
    const broken = assets.filter(entry => {
      const local = wanted.find(asset => asset.name === entry.name)
      return local !== undefined && (entry.state !== 'uploaded' || entry.size !== local.size)
    })
    const missing = wanted.filter(asset => !assets.some(entry => entry.name === asset.name))
    if (missing.length === 0 && broken.length === 0) {
      verified = payload
      break
    }
    console.log(`[publish] 自检第 ${String(attempt)} 次：${
      [...missing.map(asset => asset.name), ...broken.map(asset => `${asset.name}（state=${asset.state}/size=${String(asset.size)}B 与本地不符）`)].join('、')} 未就绪`)
    if (hasFlag('--force')) {
      for (const asset of broken) {
        await deleteAssetById(asset.id)
        console.log(`[publish] 自检发现空壳资产 ${asset.name}（id ${String(asset.id)}），已删除重传`)
        await uploadOne(asset)
      }
    }
  } else {
    console.log(`[publish] 自检第 ${String(attempt)} 次：release ${tag} 查询 HTTP ${String(check.status)}`)
  }
  await sleep(5000)
}
if (verified === null) {
  throw new Error(`发布后自检失败：release ${tag} 或其资产未在重试窗口内就绪（或资产尺寸与本地不符）——请到 GitHub 页面人工确认`)
}

console.log(`[publish] 自检通过：release ${tag} 可见，${String(verified.assets.length)} 份资产就绪`)
console.log(`[publish] 完成：https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`)
