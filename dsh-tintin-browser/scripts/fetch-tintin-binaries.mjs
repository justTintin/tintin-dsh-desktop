// Fetch TinTin media binaries (ffmpeg/ffprobe/yt-dlp) into the TinTin channel's
// packaging resources.
//
// These are ~300 MB and tracked via git LFS in the original client repo
// (D:\Project\TinTin_Client_Electron), so they are intentionally NOT committed
// here (tintin-resources/bin keeps only a placeholder). Run before packaging:
//
//   node scripts/fetch-tintin-binaries.mjs
//
// Source candidates: TINTIN_SRC override, then the original client checkout
// (git LFS), then the legacy dataelement fork whose resources/bin already
// materialized all three binaries on this machine (ffprobe never shipped in
// the client checkout).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const NAMES = ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe']
const srcCandidates = [
  process.env.TINTIN_SRC,
  'D:\\Project\\TinTin_Client_Electron',
  'D:\\Project\\tintin-dsh-desktop',
].filter(Boolean)
const srcBinOf = (root) => join(root, 'resources', 'bin')
const srcRoot = srcCandidates.find((root) => NAMES.every((name) => existsSync(join(srcBinOf(root), name)))) ?? srcCandidates[0]
const srcBin = srcBinOf(srcRoot)
const destBin = resolve('D:/Project/dsh-desktop/dsh-plugin-desktop-tintin/tintin-resources/bin')

mkdirSync(destBin, { recursive: true })

let copied = 0
for (const name of NAMES) {
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
console.log(copied === NAMES.length ? `OK: ${copied}/${NAMES.length} binaries in tintin-resources/bin` : `incomplete: ${copied}/${NAMES.length}`)
