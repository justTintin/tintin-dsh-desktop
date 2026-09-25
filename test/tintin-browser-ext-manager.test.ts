// test/tintin-browser-ext-manager.test.ts — 扩展管理移植回归（ext-manager.ts）
// SRC ext-manager.js 一比一：crx 头解析/zip 解压/manifest 清单生命周期/session 加载。
// Session 以桩注入（loadExtension/removeExtension 记录调用），不触真实 Electron。
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { createExtensionManager } from '../src/main/tintin/browser/ext-manager'
import { BILI_DL_EXTRACT_SCRIPT } from '../src/main/tintin/browser/bilibili-ext'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface FakeSession {
  loaded: string[]
  removed: string[]
  loadExtension(dir: string): { id: string }
  removeExtension(id: string): void
}

function makeFakeSession(): FakeSession {
  return {
    loaded: [], removed: [],
    loadExtension(dir: string) { this.loaded.push(dir); return { id: dir } },
    removeExtension(id: string) { this.removed.push(id) },
  }
}

/** 构造一个带 manifest.json 的 zip（in-memory），可选包一层 crx 头（Cr24） */
function makePackage(opts: { crx?: boolean; subdir?: boolean; name?: string; key?: string }): Buffer {
  const zip = new AdmZip()
  const prefix = opts.subdir ? 'inner-dir/' : ''
  zip.addFile(`${prefix}manifest.json`, Buffer.from(JSON.stringify({
    name: opts.name ?? '测试扩展', version: '1.2.3', icons: { '48': 'icon48.png' }, ...(opts.key ? { key: opts.key } : {}),
  })))
  zip.addFile(`${prefix}icon48.png`, Buffer.from([1, 2, 3]))
  const zipBuf = zip.toBuffer()
  if (!opts.crx) return zipBuf
  // crx3 简化头：Cr24 + version(4) + pubkeyLen(4) + sigLen(4) + header + zip
  const header = Buffer.alloc(4)
  const head = Buffer.from('Cr24', 'ascii')
  const version = Buffer.alloc(4); version.writeUInt32LE(3)
  const pubLen = Buffer.alloc(4); pubLen.writeUInt32LE(0)
  const sigLen = Buffer.alloc(4); sigLen.writeUInt32LE(0)
  return Buffer.concat([head, version, pubLen, sigLen, zipBuf])
}

function makeManager(cases: { sessions?: FakeSession[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tintin-ext-'))
  tmpDirs.push(root)
  const sessions = cases.sessions ?? [makeFakeSession(), makeFakeSession()]
  const broadcasts: unknown[] = []
  const mgr = createExtensionManager({
    getRoot: () => root,
    listSessions: () => sessions as unknown as never[],
    broadcast: (extensions) => broadcasts.push(extensions),
    findDouyinHelperDir: () => null,
  })
  mgr.init()
  return { mgr, root, sessions, broadcasts }
}

describe('ext-manager (SRC ext-manager.js 1:1)', () => {
  it('installs a zip: extracts to root/<id>, loads into all sessions, persists manifest', async () => {
    const { mgr, root, sessions } = makeManager()
    const pkg = join(mkdtempSync(join(tmpdir(), 'tintin-pkg-')), 'ext.zip')
    tmpDirs.push(pkg)
    writeFileSync(pkg, makePackage({ zip: false } as never))
    const r = await mgr.install(pkg)
    expect(r.success).toBe(true)
    expect(r.message).toContain('测试扩展 v1.2.3')
    // 解压产物含 manifest（铁律 2：验到磁盘）
    const extDir = r.data?.path as string
    expect(readFileSync(join(extDir, 'manifest.json'), 'utf8')).toContain('测试扩展')
    expect(sessions.every((s) => s.loaded.length === 1 && s.loaded[0] === extDir)).toBe(true)
    // 清单持久化 + 返回列表
    expect(mgr.list().extensions.some((e) => e.id === r.data?.id)).toBe(true)
    expect(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))).toHaveLength(1)
  })

  it('parses a CR24 crx header and strips it before unzip', async () => {
    const { mgr } = makeManager()
    const pkg = join(mkdtempSync(join(tmpdir(), 'tintin-pkg-')), 'ext.crx')
    tmpDirs.push(pkg)
    writeFileSync(pkg, makePackage({ crx: true }))
    const r = await mgr.install(pkg)
    expect(r.success).toBe(true)
    expect(r.data?.version).toBe('1.2.3')
  })

  it('rejects subdir-wrapped packages (SRC 一层查找分支实际只匹配根 manifest — 1:1 行为)', async () => {
    const { mgr } = makeManager()
    const pkg = join(mkdtempSync(join(tmpdir(), 'tintin-pkg-')), 'ext-sub.zip')
    tmpDirs.push(pkg)
    writeFileSync(pkg, makePackage({ subdir: true }))
    const r = await mgr.install(pkg)
    expect(r.success).toBe(false)
    expect(r.message).toBe('无法解析扩展包（需为 manifest.json 的 zip 或 crx）')
  })

  it('reinstalling a keyed extension replaces the old entry (no duplicates)', async () => {
    const { mgr } = makeManager()
    const pkg = join(mkdtempSync(join(tmpdir(), 'tintin-pkg-')), 'ext.zip')
    tmpDirs.push(pkg)
    writeFileSync(pkg, makePackage({ key: 'test-stable-key' }))
    await mgr.install(pkg)
    const r2 = await mgr.install(pkg)
    expect(r2.success).toBe(true)
    // manifest.key 前 32 位即 id → 重装按 id 去重（SRC 同口径）
    expect(mgr.list().extensions.filter((e) => e.id === 'test-stable-key')).toHaveLength(1)
  })

  it('uninstall removes the entry, directory and session registrations', async () => {
    const { mgr, root, sessions } = makeManager()
    const pkg = join(mkdtempSync(join(tmpdir(), 'tintin-pkg-')), 'ext.zip')
    tmpDirs.push(pkg)
    writeFileSync(pkg, makePackage({}))
    const r = await mgr.install(pkg)
    const extDir = r.data?.path as string
    const id = r.data?.id as string
    const u = mgr.uninstall(id)
    expect(u.success).toBe(true)
    expect(mgr.list().extensions.some((e) => e.id === id)).toBe(false)
    expect(sessions.every((s) => s.removed.includes(id))).toBe(true)
    expect(() => readFileSync(join(extDir, 'manifest.json'))).toThrow()
    // 卸载后清单文件同步为空
    expect(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))).toHaveLength(0)
  })

  it('rejects non-extension packages with the source message', async () => {
    const { mgr } = makeManager()
    const pkg = join(mkdtempSync(join(tmpdir(), 'tintin-pkg-')), 'bad.zip')
    tmpDirs.push(pkg)
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('no manifest here'))
    writeFileSync(pkg, zip.toBuffer())
    const r = await mgr.install(pkg)
    expect(r.success).toBe(false)
    expect(r.message).toBe('无法解析扩展包（需为 manifest.json 的 zip 或 crx）')
    expect(mgr.uninstall('no-such-id').message).toBe('扩展不存在')
    expect((await mgr.install('')).message).toBe('未选择文件')
  })

  it('broadcasts only when the manifest fingerprint changes', async () => {
    const { mgr, broadcasts } = makeManager()
    const pkg = join(mkdtempSync(join(tmpdir(), 'tintin-pkg-')), 'ext.zip')
    tmpDirs.push(pkg)
    writeFileSync(pkg, makePackage({}))
    await mgr.install(pkg)
    expect(broadcasts).toHaveLength(1)
    // 卸载 → 又一次广播
    const installed = (broadcasts[0] as Array<{ id: string; name: string }>).find((e) => e.name === '测试扩展')
    const id = installed?.id as string
    mgr.uninstall(id)
    expect(broadcasts).toHaveLength(2)
    // 卸载不存在的扩展 → 清单未变 → 不广播
    mgr.uninstall('no-such')
    expect(broadcasts).toHaveLength(2)
  })
})

describe('bilibili-ext helpers (SRC bilibili-ext.js 1:1)', () => {
  it('extract script targets the helper shadow host and all three link forms', () => {
    expect(BILI_DL_EXTRACT_SCRIPT).toContain("getElementById('bilibili-helper-host')")
    expect(BILI_DL_EXTRACT_SCRIPT).toContain("getAttribute('durl')")
    expect(BILI_DL_EXTRACT_SCRIPT).toContain("getAttribute('durls')")
    // 纯 ES2020 文本（executeJavaScript 注入）：无 import/export
    expect(/^import\s/m.test(BILI_DL_EXTRACT_SCRIPT)).toBe(false)
    expect(/^export\s/m.test(BILI_DL_EXTRACT_SCRIPT)).toBe(false)
  })
})
