// test/tintin-browser-auto-listing.test.ts — 自动上架纯函数层回归（auto-listing/*.js 移植件）
// state.js（阶段判定/resume 语义/原子写）、validate.js（店铺匹配/图片收集/尺寸/定位）、
// package.js（runId/staging/zip 导入）、config.js（配置读写兜底）。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error 纯 JS ESM 移植件
import { STAGE_ORDER, stageFromUrl, resumePlan, writeState, readState, runsRootDir } from '../src/main/tintin/browser/auto-listing/state'
// @ts-expect-error 纯 JS ESM 移植件
import { normalizeName, shopMatches, collectImages, imageSize, locateWorkingDir } from '../src/main/tintin/browser/auto-listing/validate'
// @ts-expect-error 纯 JS ESM 移植件
import { newRunId, stagingDir, preparePackage } from '../src/main/tintin/browser/auto-listing/package'
// @ts-expect-error 纯 JS ESM 移植件
import { DOUYIN_STORES, loadConfig, saveConfig } from '../src/main/tintin/browser/auto-listing/config'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('auto-listing state (SRC state.js 1:1)', () => {
  it('judges stage from url features (create 无参=stage1，create?=stage2)', () => {
    expect(stageFromUrl('https://fxg.jinritemai.com/ffa/g/create')).toBe('stage1')
    expect(stageFromUrl('https://fxg.jinritemai.com/ffa/g/create?tab=price')).toBe('stage2')
    expect(stageFromUrl('https://fxg.jinritemai.com/ffa/mshop/homepage/index')).toBe('unknown')
    expect(STAGE_ORDER).toEqual(['validate', 'stage1', 'stage2', 'save_draft', 'publish', 'final'])
  })

  it('derives resume plan from state and current url', () => {
    expect(resumePlan(null, '').canResume).toBe(false)
    expect(resumePlan({ status: 'done' }, '').canResume).toBe(false)
    // 当前 URL 已在详情配置页 → 直接阶段2
    expect(resumePlan({ status: 'interrupted', stage: 'stage1' }, 'https://fxg.jinritemai.com/ffa/g/create?x=1')).toEqual({ canResume: true, stage: 'stage2' })
    // 否则按 state.stage（validate 提升为 stage1）
    expect(resumePlan({ status: 'running', stage: 'validate' }, '')).toEqual({ canResume: true, stage: 'stage1' })
    expect(resumePlan({ status: 'running', stage: 'stage2' }, '')).toEqual({ canResume: true, stage: 'stage2' })
  })

  it('writes state.json atomically with merge semantics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-al-'))
    tmpDirs.push(dir)
    const runsRoot = runsRootDir(dir)
    writeState(runsRoot, 'run1', { stage: 'stage1', status: 'running' })
    writeState(runsRoot, 'run1', { stage: 'stage2', url: 'u' })
    const s = readState(runsRoot, 'run1')
    expect(s?.stage).toBe('stage2')
    expect(s?.status).toBe('running')
    expect(s?.runId).toBe('run1')
    expect(existsSync(join(runsRoot, 'run1', 'state.json'))).toBe(true)
    expect(readState(runsRoot, 'nope')).toBeNull()
  })
})

describe('auto-listing validate (SRC validate.js 1:1)', () => {
  it('matches package names against shop keywords with normalization', () => {
    expect(normalizeName('桔柚-数码 严选！')).toBe('桔柚数码严选')
    expect(shopMatches('桔柚数码外设严选 20260925', 'juyou')).toBe(true)
    expect(shopMatches('555电池大礼包', 'juyou')).toBe(false)
    expect(shopMatches('某包_555井韵电池', '555_battery')).toBe(true)
    expect(DOUYIN_STORES.juyou?.name).toBe('桔柚数码外设严选')
  })

  it('collects images ordered by numeric index then name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-al-v-'))
    tmpDirs.push(dir)
    for (const n of ['图2.png', '图10.png', '图1.png', ' readme.txt']) {
      writeFileSync(join(dir, n.trim()), 'x')
    }
    const files = collectImages(dir)
    expect(files.map((f: string) => f.replace(/\\/g, '/').split('/').pop())).toEqual(['图1.png', '图2.png', '图10.png'])
  })

  it('reads png dimensions from header bytes', () => {
    // PNG 1x1 最小头：宽高在 IHDR（offset 16/20）
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
      (() => { const b = Buffer.alloc(8); b.writeUInt32BE(640, 0); b.writeUInt32BE(640, 4); return b })(),
      Buffer.alloc(8),
    ])
    const dir = mkdtempSync(join(tmpdir(), 'tintin-al-v2-'))
    tmpDirs.push(dir)
    const p = join(dir, 'a.png')
    writeFileSync(p, png)
    expect(imageSize(p)).toEqual([640, 640])
  })

  it('locates the working dir containing sku.xlsx', () => {
    const base = mkdtempSync(join(tmpdir(), 'tintin-al-v3-'))
    tmpDirs.push(base)
    const inner = join(base, 'pkg', 'inner')
    mkdirSync(inner, { recursive: true })
    writeFileSync(join(inner, 'sku.xlsx'), 'x')
    expect(locateWorkingDir(base)).toBe(inner)
  })
})

describe('auto-listing package + config (SRC 1:1)', () => {
  it('prepares a zip data package into staging and validates shop keyword', async () => {
    const syncDir = mkdtempSync(join(tmpdir(), 'tintin-al-p-'))
    tmpDirs.push(syncDir)
    const inputDir = mkdtempSync(join(tmpdir(), 'tintin-al-p2-'))
    tmpDirs.push(inputDir)
    // 数据包：sku.xlsx + 主图（1:1 方形）+ 详情页 + sku图
    writeFileSync(join(inputDir, 'sku.xlsx'), 'placeholder-not-real-xlsx')
    const mainDir = join(inputDir, '主图')
    mkdirSync(mainDir, { recursive: true })
    // 合法 1:1 PNG（64x64）
    const ihdr = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
      (() => { const b = Buffer.alloc(8); b.writeUInt32BE(64, 0); b.writeUInt32BE(64, 4); return b })(),
      Buffer.alloc(8),
    ])
    writeFileSync(join(mainDir, '主图1.png'), ihdr)
    const detailDir = join(inputDir, '详情页')
    mkdirSync(detailDir, { recursive: true })
    writeFileSync(join(detailDir, 'd1.png'), ihdr)
    const skuDir = join(inputDir, 'sku图')
    mkdirSync(skuDir, { recursive: true })
    writeFileSync(join(skuDir, 's1.png'), ihdr)

    // 店铺关键词校验先于结构：不匹配 → 指明期望关键词
    await expect(preparePackage(inputDir, '555_battery', { syncDir })).rejects.toThrow(/未包含目标店铺关键词/)

    // 打包成 zip 走解压路径
    const zip = new AdmZip()
    zip.addLocalFolder(inputDir)
    const zipPath = join(tmpdir(), `tintin-al-zip-${Date.now()}.zip`)
    tmpDirs.push(zipPath)
    zip.writeZip(zipPath)
    // zip 内目录名含"桔柚"→ 店铺校验通过（staging 解压后 sku.xlsx 存在但内容非真 xlsx → 解析报错，预期 ValidationError 文案）
    const renamed = zipPath.replace('tintin-al-zip-', 'tintin-al-zip-桔柚-')
    renameSync(zipPath, renamed)
    await expect(preparePackage(renamed, 'juyou', { syncDir })).rejects.toThrow(/sku\.xlsx|读取 sku\.xlsx/)
    // staging 已产生（runId 目录）
    const runs = existsSync(join(syncDir, 'runs'))
    expect(runs).toBe(true)
  })

  it('loadConfig falls back to defaults and saveConfig merges', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-al-c-'))
    tmpDirs.push(dir)
    const store = (() => {
      let data: Record<string, unknown> = {}
      return {
        get: (k: string) => data[k],
        set: (k: string, v: unknown) => { data[k] = v },
      }
    })()
    const d = loadConfig(store, dir)
    expect(d.shopKey).toBe('juyou')
    expect(d.publishAfterSave).toBe(false)
    const merged = saveConfig(store, dir, { shopKey: '555_battery', publishAfterSave: true })
    expect(merged.shopKey).toBe('555_battery')
    expect(loadConfig(store, dir).publishAfterSave).toBe(true)
    expect(newRunId()).toMatch(/^\d{8}_\d{6}$/)
  })
})
