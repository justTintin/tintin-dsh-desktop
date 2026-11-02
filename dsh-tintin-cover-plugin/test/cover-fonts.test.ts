// 字体枚举(2026-11-02 对齐 PhotoCraft)回归面:sfnt/ttc 解析、族聚合、目录扫描缓存。
// 夹具=合成 sfnt(name/OS/2 表),不依赖系统字体;目录经 TINTIN_FONT_DIRS 覆盖。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { listFontFamiliesCached, parseFontFile, parseSfntFace } from '../lib/cover-fonts.js'

const roots: string[] = []
afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })
const tempRoot = (): string => { const dir = mkdtempSync(join(tmpdir(), 'tintin-fonts-')); roots.push(dir); return dir }

const utf16be = (text: string): Buffer => Buffer.from(text, 'utf16le').swap16()

interface NameRecord { id: number; lang: number; text: string }
function buildNameTable(records: NameRecord[]): Buffer {
  const count = records.length
  const stringOffset = 6 + 12 * count
  const pool: Buffer[] = []
  const offsets: number[] = []
  let at = 0
  for (const rec of records) {
    const bytes = utf16be(rec.text)
    pool.push(bytes)
    offsets.push(at)
    at += bytes.length
  }
  const buf = Buffer.alloc(stringOffset + at)
  buf.writeUInt16BE(0, 0)
  buf.writeUInt16BE(count, 2)
  buf.writeUInt16BE(stringOffset, 4)
  records.forEach((rec, i) => {
    const r = 6 + i * 12
    buf.writeUInt16BE(3, r)
    buf.writeUInt16BE(1, r + 2)
    buf.writeUInt16BE(rec.lang, r + 4)
    buf.writeUInt16BE(rec.id, r + 6)
    buf.writeUInt16BE(pool[i]!.length, r + 8)
    buf.writeUInt16BE(offsets[i]!, r + 10)
    pool[i]!.copy(buf, stringOffset + offsets[i]!)
  })
  return buf
}

function buildOs2(weight: number, italic = false): Buffer {
  const b = Buffer.alloc(86)
  b.writeUInt16BE(weight, 4)
  b.writeUInt16BE(italic ? 1 : 0, 62)
  return b
}

function buildSfnt(name: Buffer, os2: Buffer, offsetBase = 0): Buffer {
  const tables = [{ tag: 'OS/2', data: os2 }, { tag: 'name', data: name }]
  const headerSize = 12 + 16 * tables.length
  let at = headerSize
  const placed = tables.map((t) => { const o = at; at += Math.ceil(t.data.length / 4) * 4; return { ...t, o } })
  const buf = Buffer.alloc(at)
  buf.writeUInt32BE(0x00010000, 0)
  buf.writeUInt16BE(tables.length, 4)
  placed.forEach((t, i) => {
    const rec = 12 + i * 16
    buf.write(t.tag, rec, 'latin1')
    buf.writeUInt32BE(offsetBase + t.o, rec + 8) // TTC 字面的表偏移按文件绝对值(同 msyh.ttc 实测)
    buf.writeUInt32BE(t.data.length, rec + 12)
    t.data.copy(buf, t.o)
  })
  return buf
}

const NAMES = {
  enFamily: (text: string): NameRecord => ({ id: 1, lang: 0x0409, text }),
  zhFamily: (text: string): NameRecord => ({ id: 1, lang: 0x0804, text }),
  enStyle: (text: string): NameRecord => ({ id: 2, lang: 0x0409, text }),
  enTypoFamily: (text: string): NameRecord => ({ id: 16, lang: 0x0409, text }),
  zhTypoFamily: (text: string): NameRecord => ({ id: 16, lang: 0x0804, text }),
  enTypoStyle: (text: string): NameRecord => ({ id: 17, lang: 0x0409, text }),
}

describe('parseSfntFace(name/OS-2 表)', () => {
  it('单字面:英文族名+中文名+Regular/400', () => {
    const face = parseSfntFace(buildSfnt(buildNameTable([NAMES.enFamily('Test Sans'), NAMES.zhFamily('测试黑'), NAMES.enStyle('Regular')]), buildOs2(400)))
    expect(face).toMatchObject({ family: 'Test Sans', local: '测试黑', style: { name: 'Regular', weight: 400, italic: false } })
  })
  it('首选族(ID 16/17)优先于遗留族(ID 1/2);字重取 OS/2;斜体取 fsSelection', () => {
    const face = parseSfntFace(buildSfnt(
      buildNameTable([NAMES.enFamily('Test Sans Light'), NAMES.enTypoFamily('Test Sans'), NAMES.enStyle('Regular'), NAMES.enTypoStyle('Light')]),
      buildOs2(300),
    ))
    expect(face).toMatchObject({ family: 'Test Sans', style: { name: 'Light', weight: 300 } })
    const italic = parseSfntFace(buildSfnt(buildNameTable([NAMES.enFamily('It')]), buildOs2(400, true)))
    expect(italic?.style.italic).toBe(true)
  })
  it('无 ID16/17 中文记录时中文族名回落 ID1;无中文=空串', () => {
    const face = parseSfntFace(buildSfnt(buildNameTable([NAMES.enFamily('Test Sans'), NAMES.zhFamily('测试黑'), NAMES.enStyle('Regular')]), buildOs2(400)))
    expect(face?.local).toBe('测试黑')
    const plain = parseSfntFace(buildSfnt(buildNameTable([NAMES.enFamily('Latin Only'), NAMES.enStyle('Regular')]), buildOs2(400)))
    expect(plain?.local).toBe('')
  })
  it('无 name 表=返回 null(不抛错)', () => {
    expect(parseSfntFace(Buffer.alloc(64))).toBeNull()
  })
})

describe('parseFontFile(ttc 多字面)', () => {
  it('按 ttcf 偏移逐字面解析,表偏移按文件绝对值', () => {
    const regular = buildSfnt(buildNameTable([NAMES.enFamily('Test Sans'), NAMES.enStyle('Regular')]), buildOs2(400), 20)
    const bold = buildSfnt(buildNameTable([NAMES.enTypoFamily('Test Sans'), NAMES.enStyle('Regular'), NAMES.enTypoStyle('Bold')]), buildOs2(700), 20 + regular.length)
    const ttc = Buffer.concat([
      Buffer.from('ttcf', 'latin1'), (() => { const v = Buffer.alloc(4); v.writeUInt32BE(0x00010000, 0); return v })(),
      (() => { const v = Buffer.alloc(4); v.writeUInt32BE(2, 0); return v })(),
      (() => { const v = Buffer.alloc(4); v.writeUInt32BE(20, 0); return v })(),
      (() => { const v = Buffer.alloc(4); v.writeUInt32BE(20 + regular.length, 0); return v })(),
      regular, bold,
    ])
    const dir = tempRoot()
    const file = join(dir, 'test.ttc')
    writeFileSync(file, ttc)
    const faces = parseFontFile(file)
    expect(faces.map((f) => `${f.family}/${f.style.name}@${f.style.weight}`)).toEqual(['Test Sans/Regular@400', 'Test Sans/Bold@700'])
  })
  it('坏文件返回空数组(不抛错)', () => {
    const dir = tempRoot()
    const file = join(dir, 'broken.ttf')
    writeFileSync(file, Buffer.from('not a font'))
    expect(parseFontFile(file)).toEqual([])
    expect(parseFontFile(join(dir, 'missing.ttf'))).toEqual([])
  })
})

describe('listFontFamiliesCached(目录扫描+聚合+缓存)', () => {
  it('按目录枚举,按族聚合样式并排序;TINTIN_FONT_DIRS 覆盖生效', () => {
    const dir = tempRoot()
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'a.ttf'), buildSfnt(buildNameTable([NAMES.enFamily('Zulu Sans'), NAMES.zhFamily('祖鲁黑'), NAMES.enStyle('Regular')]), buildOs2(400)))
    writeFileSync(join(dir, 'sub', 'b.ttf'), buildSfnt(buildNameTable([NAMES.enFamily('Zulu Sans'), NAMES.enStyle('Bold')]), buildOs2(700)))
    writeFileSync(join(dir, 'c.ttf'), buildSfnt(buildNameTable([NAMES.enFamily('Alpha Serif')]), buildOs2(400)))
    writeFileSync(join(dir, 'ignore.txt'), Buffer.from('x'))
    process.env.TINTIN_FONT_DIRS = dir
    try {
      const families = listFontFamiliesCached()
      expect(families.map((f) => f.family)).toEqual(['Alpha Serif', 'Zulu Sans'])
      const zulu = families[1]!
      expect(zulu.local).toBe('祖鲁黑')
      expect(zulu.styles.map((s) => `${s.name}@${s.weight}`)).toEqual(['Regular@400', 'Bold@700'])
    } finally {
      delete process.env.TINTIN_FONT_DIRS
    }
  })
})
