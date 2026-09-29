// fetch-tintin-ext-assets.mjs — 浏览器扩展资产搬运（SRC 一比一随包资产）
//
// bilibili-helper（B站下载助手，~31MB 含 ffmpeg wasm）与 chrom-douyin（抖音
// 分享链接解析助手）是第三方扩展的解包目录，SRC 仓库随 git 分发；本仓按
// 「源码与构建产物规范」不入库（build/ext-assets gitignored），打包/开发前
// 从 SRC checkout 拷贝。由 Release Builder 前置步骤与本脚本手动执行：
//
//   node scripts/fetch-tintin-ext-assets.mjs
//
// Source: TINTIN_SRC env override, else the sibling source checkout.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = process.env.TINTIN_SRC ?? 'D:\\Project\\TinTin_Client_Electron'
const destRoot = join(repo, 'build', 'ext-assets')

const NAMES = ['bilibili-helper', 'chrom-douyin']
mkdirSync(destRoot, { recursive: true })

let copied = 0
for (const name of NAMES) {
  const from = join(srcRoot, 'assets', name)
  if (!existsSync(from)) {
    console.error(`missing ${from} — set TINTIN_SRC to the TinTin source checkout`)
    process.exitCode = 1
    continue
  }
  cpSync(from, join(destRoot, name), { recursive: true })
  copied++
  console.log(`fetched ${name}`)
}
console.log(copied === NAMES.length ? `OK: ${copied}/${NAMES.length} ext assets in build/ext-assets` : `incomplete: ${copied}/${NAMES.length}`)
