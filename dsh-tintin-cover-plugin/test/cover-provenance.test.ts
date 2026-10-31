// cover-provenance 对拍(临时目录)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendAssetProvenance, pickAssetRecord, readAssetProvenance } from '../lib/cover-provenance.js'

const dirs: string[] = []
const newDir = (): string => { const d = mkdtempSync(join(tmpdir(), 'prov-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0 })

describe('cover-provenance(§七 素材来源留痕)', () => {
  it('追加/读取/按名摘取;同名覆盖取最新', () => {
    const dir = newDir()
    appendAssetProvenance(dir, { name: 'a.png', source: 'upload', ts: 1 })
    appendAssetProvenance(dir, { name: 'bg-1.png', source: 'ai', ts: 2, prompt: '夜色城市', engine: 'e1', url: 'https://s/x.png' })
    expect(readAssetProvenance(dir).records.length).toBe(2)
    expect(pickAssetRecord(dir, 'bg-1.png')).toMatchObject({ source: 'ai', prompt: '夜色城市' })
    appendAssetProvenance(dir, { name: 'a.png', source: 'upload', ts: 9 })
    expect(readAssetProvenance(dir).records.find((r) => r.name === 'a.png')?.ts).toBe(9)
    expect(readAssetProvenance(dir).records.length).toBe(2)
  })
  it('无文件/损坏文件按空处理;缺 name 显式报错', () => {
    const dir = newDir()
    expect(readAssetProvenance(dir).records).toEqual([])
    expect(pickAssetRecord(dir, 'x.png')).toBeUndefined()
    writeFileSync(join(dir, 'cover-assets.json'), '{broken', 'utf8')
    expect(readAssetProvenance(dir).records).toEqual([])
    expect(() => appendAssetProvenance(dir, { name: '', source: 'upload', ts: 1 })).toThrow(/name/)
  })
  it('上限 500 条(最新保留)', () => {
    const dir = newDir()
    for (let i = 0; i < 505; i += 1) appendAssetProvenance(dir, { name: `f${i}.png`, source: 'upload', ts: i })
    const records = readAssetProvenance(dir).records
    expect(records.length).toBe(500)
    expect(records[0]?.name).toBe('f504.png')
  })
})
