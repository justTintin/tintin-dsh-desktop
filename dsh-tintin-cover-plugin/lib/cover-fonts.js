// 封面字体枚举(2026-11-02 用户裁决:对齐 PhotoCraft——运行时枚举全部已装字体,非白名单)。
// Windows 扫描 %WINDIR%\Fonts 与 %LOCALAPPDATA%\Microsoft\Windows\Fonts(用户级安装),
// 递归 ttf/otf/ttc/otc(深度≤8,同 PhotoCraft 口径);解析 sfnt name/OS/2 表:
// 族名=名称 ID 16(首选族,缺省 1);样式=17(缺省 2);中文名=language 0x0804 记录;字重=OS/2 usWeightClass。
// 纯解析,无依赖;解析失败的文件跳过。结果按(目录清单+mtime)缓存,首次访问后常驻宿主进程。
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FONT_EXTS = /\.(?:ttf|otf|ttc|otc)$/i
const MAX_DEPTH = 8

/** 字体目录(测试可经 TINTIN_FONT_DIRS=分号分隔 覆盖);同 PhotoCraft:系统目录+用户目录 */
export function fontDirs() {
  const env = process.env.TINTIN_FONT_DIRS
  if (env && env.trim()) return env.split(';').map((s) => s.trim()).filter(Boolean)
  const dirs = []
  if (process.env.WINDIR) dirs.push(join(process.env.WINDIR, 'Fonts'))
  if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'))
  return dirs
}

function walk(dir, depth, out) {
  if (depth > MAX_DEPTH) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1, out)
    else if (e.isFile() && FONT_EXTS.test(e.name)) out.push(p)
  }
}

function listFontFiles() {
  const out = []
  for (const dir of fontDirs()) walk(dir, 1, out)
  return out
}

const u16 = (b, off) => b.readUInt16BE(off)
const u32 = (b, off) => b.readUInt32BE(off)

/** 解码 name 记录:platform 3/0 = UTF-16BE;platform 1 = latin1(罕见,兜底)。先拷贝再换字节序(subarray 共享内存) */
function decodeNameRecord(b, strOff, rec) {
  const start = strOff + rec.offset
  const raw = b.subarray(start, start + rec.length)
  try {
    if (rec.platform === 0 || rec.platform === 3) return Buffer.from(raw).swap16().toString('utf16le').replace(/\0+$/u, '')
    return raw.toString('latin1').replace(/\0+$/u, '')
  } catch { return '' }
}


/** 解析一个 sfnt 字面(头字段相对 base;表偏移按 sfnt 规范相对缓冲开头——TTC 子字面的表偏移是文件绝对值):
 *  族名/样式;失败返回 null */
export function parseSfntFace(b, base = 0) {
  try {
    const numTables = u16(b, base + 4)
    let name = -1
    let os2 = -1
    for (let i = 0; i < numTables; i++) {
      const rec = base + 12 + i * 16
      const tag = b.toString('latin1', rec, rec + 4)
      if (tag === 'name') name = u32(b, rec + 8)
      else if (tag === 'OS/2') os2 = u32(b, rec + 8)
    }
    if (name < 0) return null
    const count = u16(b, name + 2)
    const strOff = name + u16(b, name + 4)
    // 名称收集:英文(lang 0x0409,退化为任意)与中文(lang 0x0804)各取 ID 16/17/1/2
    const pick = (wantId, zh) => {
      let fallback = ''
      for (let i = 0; i < count; i++) {
        const rec = name + 6 + i * 12
        const platform = u16(b, rec), enc = u16(b, rec + 2), lang = u16(b, rec + 4), id = u16(b, rec + 6)
        if (id !== wantId) continue
        const text = decodeNameRecord(b, strOff, { platform, length: u16(b, rec + 8), offset: u16(b, rec + 10) })
        if (!text) continue
        if (zh) { if (lang === 0x0804) return text } else { if (lang === 0x0409) return text; if (!fallback) fallback = text }
      }
      return fallback
    }
    const family = pick(16, false) || pick(1, false)
    if (!family) return null
    const styleName = pick(17, false) || pick(2, false) || 'Regular'
    const weight = os2 >= 0 ? u16(b, os2 + 4) || 400 : 400
    const italic = os2 >= 0 ? (u16(b, os2 + 62) & 1) === 1 : false
    return { family, local: pick(16, true) || pick(1, true) || '', style: { name: styleName, label: pick(17, true) || pick(2, true) || '', weight, italic } }
  } catch { return null }
}

/** 解析一个字体文件(ttf/otf 单字面;ttc/otc 多字面),返回全部字面 */
export function parseFontFile(path) {
  let b
  try { b = readFileSync(path) } catch { return [] }
  try {
    if (b.length > 12 && b.toString('latin1', 0, 4) === 'ttcf') {
      const faces = []
      const n = u32(b, 8)
      for (let i = 0; i < n && i < 64; i++) {
        const face = parseSfntFace(b, u32(b, 12 + i * 4))
        if (face) faces.push(face)
      }
      return faces
    }
    const face = parseSfntFace(b, 0)
    return face ? [face] : []
  } catch { return [] }
}

/** 全量枚举:按族聚合(样式去重),族名不区分大小写排序 */
export function listFontFamilies() {
  const byFamily = new Map()
  for (const file of listFontFiles()) {
    for (const face of parseFontFile(file)) {
      let fam = byFamily.get(face.family)
      if (!fam) { fam = { family: face.family, local: face.local, styles: new Map() }; byFamily.set(face.family, fam) }
      if (!fam.local && face.local) fam.local = face.local
      const key = `${face.style.italic ? 'i' : ''}${face.style.weight}:${face.style.name}`
      if (!fam.styles.has(key)) fam.styles.set(key, face.style)
    }
  }
  const families = [...byFamily.values()].map((fam) => ({
    family: fam.family,
    local: fam.local,
    styles: [...fam.styles.values()].sort((a, b) => (a.weight - b.weight) || (a.italic ? 1 : 0) - (b.italic ? 1 : 0) || a.name.localeCompare(b.name)),
  }))
  families.sort((a, b) => a.family.toLowerCase().localeCompare(b.family.toLowerCase()))
  return families
}

let cached = null

/** 缓存版枚举(按目录文件清单+mtime 变化失效);扫描/解析失败=空列表,不抛错 */
export function listFontFamiliesCached() {
  try {
    const files = listFontFiles()
    const sig = files.map((f) => { try { return `${f}:${statSync(f).mtimeMs}` } catch { return `${f}:gone` } }).join('|')
    if (!cached || cached.sig !== sig) cached = { sig, families: listFontFamilies() }
    return cached.families
  } catch { return cached?.families ?? [] }
}
