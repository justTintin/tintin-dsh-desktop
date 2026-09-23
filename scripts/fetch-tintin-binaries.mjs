// Fetch TinTin media binaries (ffmpeg/ffprobe/yt-dlp) into resources/bin.
//
// These are ~300 MB and tracked via git LFS in the source repo
// (D:\Project\TinTin_Client_Electron), so they are intentionally NOT committed
// here (resources/bin is gitignored). Run before packaging:
//
//   node scripts/fetch-tintin-binaries.mjs
//
// Source: TINTIN_SRC env override, else the sibling source checkout. Override
// for CI / other machines where the source path differs.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = process.env.TINTIN_SRC ?? 'D:\\Project\\TinTin_Client_Electron'
const srcBin = join(srcRoot, 'resources', 'bin')
const destBin = join(repo, 'resources', 'bin')

const NAMES = ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe']
mkdirSync(destBin, { recursive: true })

let copied = 0
for (const name of NAMES) {
  const from = join(srcBin, name)
  if (!existsSync(from)) {
    console.error(`missing ${from} — set TINTIN_SRC to the TinTin source checkout`)
    process.exitCode = 1
    continue
  }
  copyFileSync(from, join(destBin, name))
  copied++
  console.log(`fetched ${name}`)
}
console.log(copied === NAMES.length ? `OK: ${copied}/${NAMES.length} binaries in resources/bin` : `incomplete: ${copied}/${NAMES.length}`)
