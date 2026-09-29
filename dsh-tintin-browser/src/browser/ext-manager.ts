// ext-manager.ts — 扩展管理器（SRC desktop/main/ext-manager.js 一比一移植，基线 SRC 9ca9050）
//   上传 crx/zip → 解压到 userData/extensions → 对每个平台隔离 session 逐个 loadExtension
//   逐 session 加载：保持各平台 cookie/登录态隔离（电商多店铺安全），content script 按 manifest.matches 生效
// 移植差异：CJS→ESM；单例对象改工厂（sessions/root/广播注入，可脱离 Electron 单测——铁律 8）；
//   广播通道 browser:extensions-changed 由调用方（browser-service）接 mainWindow。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import AdmZip from 'adm-zip'
import { PLATFORM_DEFS, PLATFORM_IDS } from './platform-meta'
import { findBilibiliHelperDir } from './bilibili-ext'
import type { Session } from 'electron'

export interface ExtensionEntry {
  id: string
  name: string
  version: string
  path?: string
  icon?: string | null
  addedAt?: number
  builtin?: boolean
  description?: string
  installed?: boolean
}

export interface ExtensionListResult { installed: boolean; extensions: ExtensionEntry[] }

export interface ExtManagerDeps {
  /** 扩展根目录（userData/extensions） */
  getRoot: () => string
  /** 所有平台/网页的隔离 session（含已创建的） */
  listSessions: () => Session[]
  /** 清单变化广播（SRC browser:extensions-changed；注入以便单测） */
  broadcast: (extensions: ExtensionEntry[]) => void
  /** 抖音助手目录查找（随包 chrom-douyin；缺省=未装） */
  findDouyinHelperDir?: () => string | null
  log?: (msg: string) => void
}

/** 查找抖音助手目录（打包=resources/ext-assets；开发=build/ext-assets；SRC 布局候选兼容） */
export function findDouyinHelperDir(): string | null {
  const candidates: string[] = []
  const res = process.resourcesPath
  if (res) {
    candidates.push(join(res, 'ext-assets', 'chrom-douyin'))
    candidates.push(join(res, 'assets', 'chrom-douyin'))
    candidates.push(join(res, 'chrom-douyin'))
  }
  // dev：仓库根 build/ext-assets（SRC 用 __dirname 相对 assets，本仓 build/ 同职责）
  for (const base of [process.env.TINTIN_REPO_ROOT || '', process.cwd()]) {
    if (base) candidates.push(join(base, 'build', 'ext-assets', 'chrom-douyin'))
    if (base) candidates.push(join(base, 'assets', 'chrom-douyin'))
  }
  for (const p of candidates) {
    try { if (existsSync(join(p, 'manifest.json'))) return p } catch { /* 候选不可用 */ }
  }
  return null
}

export function createExtensionManager(deps: ExtManagerDeps) {
  const { getRoot, listSessions, broadcast } = deps
  let manifest: ExtensionEntry[] = []   // 已安装扩展清单
  let manifestFile = ''
  let fingerprint = ''                  // 内容变更时才广播（SRC _fingerprint 口径）
  let douyinBuiltinDir: string | null = null

  function init(): void {
    try {
      manifestFile = join(getRoot(), 'manifest.json')
      mkdirSync(getRoot(), { recursive: true })
      loadManifest()
    } catch { /* 目录不可写时延后到安装时报错 */ }
  }
  function loadManifest(): void {
    try {
      if (manifestFile && existsSync(manifestFile)) {
        const parsed = JSON.parse(readFileSync(manifestFile, 'utf8'))
        manifest = Array.isArray(parsed) ? parsed : []
      }
    } catch { manifest = [] }
  }
  function saveManifest(): void {
    try { writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8') } catch { /* 忽略写盘失败（SRC 同） */ }
  }
  function bump(): void {
    try {
      const f = manifest.map(e => `${e.id}@${e.version}`).join(',')
      if (f === fingerprint) return
      fingerprint = f
      broadcast(list().extensions)
    } catch { /* ignore */ }
  }

  /** 把一个扩展目录加载到全部分离 session（幂等：loadExtension 同目录去重） */
  async function loadExtToAllSessions(extDir: string): Promise<PromiseSettledResult<unknown>[]> {
    const results = []
    for (const s of listSessions()) {
      try { results.push(s.loadExtension(extDir)) } catch { /* 单 session 失败不阻断 */ }
    }
    return Promise.allSettled(results)
  }

  /** 解压 crx/zip 到 root/<id>，返回目录；失败返回 null（SRC crx 头解析 1:1） */
  function extractPackage(src: string): string | null {
    const buf = readFileSync(src)
    let zipBuf = buf
    // crx：头部 "Cr24" + version(4) + pubkeyLen(4) + sigLen(4) + header
    if (buf.length >= 4 && buf[0] === 0x43 && buf[1] === 0x72 && buf[2] === 0x32 && buf[3] === 0x34) {
      if (buf.length < 16) return null
      const pubLen = buf.readUInt32LE(8)
      const sigLen = buf.readUInt32LE(12)
      const headLen = 16 + pubLen + sigLen
      if (headLen >= buf.length) return null
      zipBuf = buf.slice(headLen)
    }
    let zip
    try { zip = new AdmZip(zipBuf) } catch { return null }
    const entries = zip.getEntries()
    // 校验根目录有 manifest.json（可能在子目录，做一层查找）
    let manifestEntry = entries.find(e => !e.isDirectory && e.entryName === 'manifest.json')
    let baseDir = ''
    if (!manifestEntry) {
      const inDir = entries.find(e => !e.isDirectory && /(^|\/)manifest\.json$/i.test(e.entryName) && !e.entryName.split('/').slice(1).find(x => x))
      if (inDir) {
        baseDir = inDir.entryName.split('/')[0] + '/'
        manifestEntry = inDir
      }
    }
    if (!manifestEntry) return null
    const mf = JSON.parse(manifestEntry.getData().toString('utf8')) || {}
    const id = (mf.key ? String(mf.key).slice(0, 32) : null) || ('ext_' + Math.random().toString(36).slice(2, 10))
    const outDir = join(getRoot(), id)
    mkdirSync(outDir, { recursive: true })
    for (const en of entries) {
      if (en.isDirectory) continue
      let rel = en.entryName
      if (baseDir && rel.startsWith(baseDir)) rel = rel.slice(baseDir.length)
      if (!rel) continue
      const dest = join(outDir, rel)
      try {
        mkdirSync(join(dest, '..'), { recursive: true })
        writeFileSync(dest, en.getData())
      } catch { /* 单文件失败继续（SRC 同） */ }
    }
    return existsSync(join(outDir, 'manifest.json')) ? outDir : null
  }

  function removeExtensionEntry(id: string): void {
    const idx = manifest.findIndex(e => e.id === id)
    if (idx >= 0) manifest.splice(idx, 1)
  }

  /** 安装：接收 crx/zip 文件源路径 → 解压到 root/<id>/ → loadExtension 全 session → 持久化 */
  async function install(filePath: string): Promise<{ success: boolean; data?: ExtensionEntry; message: string }> {
    if (!filePath) return { success: false, message: '未选择文件' }
    try {
      const extDir = extractPackage(filePath)
      if (!extDir) return { success: false, message: '无法解析扩展包（需为 manifest.json 的 zip 或 crx）' }
      const mf = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'))
      const id = (mf.key ? String(mf.key).slice(0, 32) : null) || basename(extDir)
      const entry: ExtensionEntry = {
        id,
        name: mf.name || '未命名扩展',
        version: mf.version || '—',
        path: extDir,
        icon: (mf.icons && (mf.icons['128'] || mf.icons['48'] || mf.icons['32'] || mf.icons['16'])) || null,
        addedAt: Date.now(),
      }
      removeExtensionEntry(id)                 // 先移除同 id 旧版本，避免重复
      await loadExtToAllSessions(extDir)
      manifest.push(entry)
      saveManifest()
      bump()
      return { success: true, data: entry, message: `已安装：${entry.name} v${entry.version}` }
    } catch (e) {
      return { success: false, message: '安装失败：' + ((e as Error).message || e) }
    }
  }

  /** 卸载：清单移除 + 目录删除 + 各 session removeExtension */
  function uninstall(id: string): { success: boolean; message: string } {
    try {
      const entry = manifest.find(e => e.id === id)
      if (!entry) return { success: false, message: '扩展不存在' }
      for (const s of listSessions()) {
        try { s.removeExtension(id) } catch { /* 单 session 失败不阻断 */ }
      }
      removeExtensionEntry(id)
      saveManifest()
      try { rmSync(entry.path as string, { recursive: true, force: true }) } catch { /* 目录可能已消失 */ }
      bump()
      return { success: true, message: `已卸载：${entry.name}` }
    } catch (e) { return { success: false, message: '卸载失败：' + ((e as Error).message || e) } }
  }

  /** 内置 B站下载助手（随包分发；目录缺失时占位条目仍展示，SRC 同口径） */
  function builtinExtension(): ExtensionEntry {
    const dir = findBilibiliHelperDir()
    if (!dir) return { id: 'bilibili-helper-builtin', name: 'B站下载助手', version: '预装', installed: true }
    let mf: Record<string, unknown> | null = null
    try { mf = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) } catch { /* 占位 */ }
    const ic = ((mf?.icons ?? {}) as Record<string, string>)
    return {
      id: 'bilibili-helper',
      name: (mf?.name as string) || 'B站下载助手',
      version: (mf?.version as string) || '—',
      path: dir,
      icon: ic['128'] ?? ic['48'] ?? ic['32'] ?? ic['16'] ?? null,
      builtin: true,
      description: (mf?.description as string) || 'B站视频下载辅助扩展',
    }
  }

  /** 内置抖音下载助手（chrom-douyin 预装，2026-09-02 用户裁决）目录 */
  function douyinHelperDir(): string | null {
    return douyinBuiltinDir || deps.findDouyinHelperDir?.() || null
  }

  /** 启动预装：加载到抖音 session（幂等） */
  function preloadBuiltinDouyin(): void {
    const dir = douyinHelperDir()
    if (!dir) return
    try {
      douyinBuiltinDir = dir
      for (const s of listSessions()) {
        if ((s as unknown as { __tintinDouyinPreload?: boolean }).__tintinDouyinPreload) continue
        ;(s as unknown as { __tintinDouyinPreload?: boolean }).__tintinDouyinPreload = true
        Promise.resolve(s.loadExtension(dir)).catch(() => {})
      }
    } catch { /* ignore */ }
  }

  function builtinDouyinExtension(): ExtensionEntry | null {
    const dir = douyinHelperDir()
    if (!dir) return null
    let mf: Record<string, unknown> | null = null
    try { mf = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) } catch { /* 占位 */ }
    const ic = ((mf?.icons ?? {}) as Record<string, string>)
    return {
      id: 'chrom-douyin-builtin',
      name: (mf?.name as string) || '抖音视频下载助手',
      version: (mf?.version as string) || '—',
      path: dir,
      icon: ic['128'] ?? ic['48'] ?? ic['32'] ?? ic['16'] ?? null,
      builtin: true,
      description: (mf?.description as string) || '抖音分享链接解析下载（预装，右栏粘贴分享链接即可下载）',
    }
  }

  /** 列表：内置 B站/抖音下载助手 + 已装用户扩展 */
  function list(): ExtensionListResult {
    const preinstalled: ExtensionEntry[] = []
    const douyin = builtinDouyinExtension()
    if (douyin) preinstalled.push(douyin)
    return { installed: true, extensions: [builtinExtension(), ...preinstalled, ...manifest] }
  }

  /** 启动时把已装扩展重新加载到各 session（SRC thickShell 启动逻辑） */
  async function reloadInstalled(): Promise<void> {
    for (const e of manifest) {
      if (!e.path) continue
      try { await loadExtToAllSessions(e.path) } catch { /* 单个失败不阻断 */ }
    }
  }

  return {
    init, loadManifest, saveManifest, install, uninstall, list, bump,
    extractPackage, loadExtToAllSessions, reloadInstalled,
    preloadBuiltinDouyin, builtinDouyinExtension,
    get manifest(): ExtensionEntry[] { return manifest },
  }
}

export type ExtensionManager = ReturnType<typeof createExtensionManager>

/** 平台分区 session 列表（browser-service 注入用；与 SRC _allSessions 同口径） */
export function platformSessions(fromPartition: (partition: string) => Session): Session[] {
  const out: Session[] = []
  for (const id of PLATFORM_IDS) {
    const def = PLATFORM_DEFS[id]
    if (!def) continue
    try { out.push(fromPartition(def.partition)) } catch { /* ignore */ }
  }
  return out
}
