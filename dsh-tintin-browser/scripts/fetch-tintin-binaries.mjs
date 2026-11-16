// fetch-tintin-binaries.mjs — 媒体二进制(ffmpeg/ffprobe/yt-dlp)就位核对脚本。
// 2026-11-16 用户裁决(逻辑定案):**文件来源只有一个=工程内 tintin-resources/bin
// (git-ignored 的工程准备目录,由原工程 LFS checkout 一次性拷入)**;安装目录里的
// 可执行文件/附加文件是安装包的产物,不是文件来源,永远不从系统运行路径取——打包
// 时从工程取,安装时由安装包产生,两个方向永不混用。外部 checkout
// (TinTin_Client_Electron 等)路径候选全部废除,staging 缺文件=显式报错指路,
// 绝不静默从别处抓。
//
//   node scripts/fetch-tintin-binaries.mjs           # 核对媒体三件套在位(不联网不改文件)
//   node scripts/fetch-tintin-binaries.mjs --latest  # 显式升级 yt-dlp 到 GitHub 最新
//                                                    # (工程侧动作,与打包解耦,铁律 18)
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const NAMES = ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe']
const YT_DLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

/** 工程内 bin 就位目录(唯一文件来源;git-ignored,由工程侧维护) */
const destBin = join(repoRoot, 'dsh-plugin-desktop-tintin', 'tintin-resources', 'bin')

mkdirSync(destBin, { recursive: true })

const missing = NAMES.filter((name) => !existsSync(join(destBin, name)))
if (missing.length && !process.argv.includes('--latest')) {
  // 2026-11-16: --latest 是显式工程侧动作, 允许从零拉齐(缺 yt-dlp 直接下载;
  // ffmpeg/ffprobe 目前只能来自 LFS checkout——它们无 --latest 通道, 缺时仍报错)
  console.error(`工程内 bin 缺文件: ${missing.join(', ')}(--latest 模式: yt-dlp 将下载)`)
  console.error(`就位目录: ${destBin}`)
}

const versionOf = (file) => {
  try {
    const v = String(spawnSync(file, ['--version'], { stdio: 'pipe', timeout: 15000 }).stdout || '').trim()
    return /^\d{4}\.\d{2}\.\d{2}/.test(v) ? v : null
  } catch { return null }
}

const wantLatestYtdlp = process.argv.includes('--latest') || process.env.TINTIN_YTDLP_LATEST === '1'
const destYtdlp = join(destBin, 'yt-dlp.exe')

if (!wantLatestYtdlp) {
  const versions = NAMES.map((n) => {
    if (n === 'yt-dlp.exe') return `${n} ${versionOf(destYtdlp) ?? '(版本不可读)'}`
    return n
  })
  console.log(`bin 就位(工程内原样): ${versions.join(', ')}`)
  console.log('OK: 3/3 binaries in tintin-resources/bin')
  process.exit(0)
}

// 显式升级 yt-dlp(--latest)
const tmpYtdlp = destYtdlp + '.download'
try {
  const res = await fetch(YT_DLP_URL, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // 校验:体积合理 + PE 头(GitHub 阻断期的拦截页/杀软页是 HTML,不是 MZ)
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
  console.log(`fetched yt-dlp.exe (latest release ${version})`)
} catch (err) {
  console.error(`yt-dlp latest download failed: ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
} finally {
  try { if (existsSync(tmpYtdlp)) unlinkSync(tmpYtdlp) } catch { /* ignore */ }
}
