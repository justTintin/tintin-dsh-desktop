// Fetch TinTin media binaries (ffmpeg/ffprobe/yt-dlp) into the TinTin channel's
// packaging resources.
//
// These are ~300 MB and tracked via git LFS in the original client repo
// (D:\Project\TinTin_Client_Electron), so they are intentionally NOT committed
// here (tintin-resources/bin keeps only a placeholder). Run before packaging:
//
//   node scripts/fetch-tintin-binaries.mjs
//
// yt-dlp (2026-11-05 修复): 旧脚本从老工程 checkout 复制，版本冻结在拷贝当时的
// 发布版 —— 抖音是 yt-dlp 抽取器攻防最频繁的站点，抽取器修复跟着版本走（当期
// 报障：2026.08.19 旧版对当期抖音报 `Fresh cookies are needed`）。改为**每次打包
// 下载最新 release**；GitHub 不可达/校验失败时回落旧拷贝并大声告警（不阻塞打包，
// 沿用 1012 GitHub 阻断处置口径），绝不静默变旧。
// ffmpeg/ffprobe (~300 MB, 版本稳定) 维持旧工程拷贝。
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const NAMES = ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe']
const YT_DLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

const srcCandidates = [
  process.env.TINTIN_SRC,
  'D:\\Project\\TinTin_Client_Electron',
  'D:\\Project\\dsh-desktop',
].filter(Boolean)
const srcBinOf = (root) => join(root, 'resources', 'bin')
const srcRoot = srcCandidates.find((root) => NAMES.every((name) => existsSync(join(srcBinOf(root), name)))) ?? srcCandidates[0]
const srcBin = srcBinOf(srcRoot)
const destBin = join(repoRoot, 'dsh-plugin-desktop-tintin', 'tintin-resources', 'bin')

mkdirSync(destBin, { recursive: true })

let copied = 0
// ffmpeg/ffprobe：版本稳定，维持旧工程拷贝
for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
  const from = join(srcBin, name)
  if (!existsSync(from)) {
    console.error(`missing ${from} — set TINTIN_SRC to a checkout holding all of ${NAMES.join(', ')}`)
    process.exitCode = 1
    continue
  }
  copyFileSync(from, join(destBin, name))
  console.log(`fetched ${name}`)
  copied++
}

// yt-dlp：下载最新 release，校验 PE 头 + 可执行版本后落盘；失败回落旧拷贝并告警
const destYtdlp = join(destBin, 'yt-dlp.exe')
const tmpYtdlp = destYtdlp + '.download'
let downloaded = false
try {
  const res = await fetch(YT_DLP_URL, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // 校验：体积合理 + PE 头（GitHub 阻断期的拦截页/杀软页是 HTML，不是 MZ）
  if (buf.length < 1024 * 1024 || buf[0] !== 0x4d || buf[1] !== 0x5a) {
    throw new Error(`downloaded payload is not a PE exe (${buf.length} bytes)`)
  }
  writeFileSync(tmpYtdlp, buf)
  const v = spawnSync(tmpYtdlp, ['--version'], { stdio: 'pipe', timeout: 15000 })
  if (v.status !== 0) throw new Error(`--version probe failed (exit ${v.status})`)
  const version = String(v.stdout || '').trim()
  if (!/^\d{4}\.\d{2}\.\d{2}/.test(version)) throw new Error(`unexpected version string: ${version}`)
  if (existsSync(destYtdlp)) unlinkSync(destYtdlp)
  copyFileSync(tmpYtdlp, destYtdlp)
  downloaded = true
  console.log(`fetched yt-dlp.exe (latest release ${version})`)
} catch (err) {
  console.error(`yt-dlp latest download failed: ${err instanceof Error ? err.message : err}`)
} finally {
  try { if (existsSync(tmpYtdlp)) unlinkSync(tmpYtdlp) } catch { /* ignore */ }
}
if (!downloaded) {
  const from = join(srcBin, 'yt-dlp.exe')
  if (existsSync(from)) {
    copyFileSync(from, destYtdlp)
    copied++
    let staleVersion = 'unknown'
    try { staleVersion = String(spawnSync(from, ['--version'], { stdio: 'pipe', timeout: 15000 }).stdout || '').trim() } catch { /* ignore */ }
    console.error(`WARNING: yt-dlp fell back to the legacy copy (${staleVersion}) — 抖音抽取器可能落后，请排查 GitHub 连通性后重跑本脚本`)
  } else {
    console.error(`missing ${from} — set TINTIN_SRC to a checkout holding all of ${NAMES.join(', ')}`)
    process.exitCode = 1
  }
} else {
  copied++
}

console.log(copied === NAMES.length ? `OK: ${copied}/${NAMES.length} binaries in tintin-resources/bin` : `incomplete: ${copied}/${NAMES.length}`)
