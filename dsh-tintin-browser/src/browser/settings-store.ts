// ═══════════════════════════════════════════════════════════════
// settings-store.ts — 浏览器设置存储与应用（2026-11-08 第一批 P0「设置入口」）
// 存储 = userData/tintin/browser/settings.json（与 media-storage 同目录口径）；
// 代理 = 平台分区 session.setProxy（system/direct/manual），保存即时生效；
// 清除数据 = 分区 clearStorageData（白名单存储类型，Cookie 清除=退出该平台登录）。
// ═══════════════════════════════════════════════════════════════
import { app, session, type ClearStorageDataOptions, type ProxyConfig } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PLATFORM_DEFS, PLATFORM_IDS } from './platform-meta.ts'

export interface BrowserSettings {
  /** 主页按钮目标（空=当前平台首页） */
  homepage?: string
  /** 地址栏搜索兜底引擎：baidu | bing | google */
  searchEngine?: string
  proxyMode?: 'system' | 'direct' | 'manual'
  proxyRules?: string
}

const ALLOWED_STORAGES = new Set(['cookies', 'cachestorage', 'localstorage', 'indexdb', 'serviceworkers'])
/** clearStorageData 的 storages 入参类型（可选属性 | undefined，需非空收窄后断言） */
type StorageKind = NonNullable<ClearStorageDataOptions['storages']>[number]
const SEARCH_ENGINES = new Set(['baidu', 'bing', 'google'])

/** 设置 → Electron 代理配置（system/direct 原样；manual 规则缺省回落 system） */
export function resolveProxyConfig(s: BrowserSettings): ProxyConfig {
  if (s.proxyMode === 'manual' && s.proxyRules) return { mode: 'fixed_servers', proxyRules: s.proxyRules }
  if (s.proxyMode === 'direct') return { mode: 'direct' }
  return { mode: 'system' }
}

export function registerSettingsIpc(
  ipcMain: Pick<Electron.IpcMain, 'handle'>,
  deps: { workspaceDir: () => string; log: (msg: string) => void },
): { getSettings: () => BrowserSettings } {
  const { log, workspaceDir } = deps
  const file = join(app.getPath('userData'), 'tintin', 'browser', 'settings.json')
  let cache: BrowserSettings = {}
  const load = (): void => {
    try { cache = JSON.parse(readFileSync(file, 'utf8')) as BrowserSettings } catch { cache = {} }
  }
  const save = (): void => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8')
    } catch (err) { log(`settings save failed: ${err instanceof Error ? err.message : err}`) }
  }
  const applyProxy = (): void => {
    const cfg = resolveProxyConfig(cache)
    for (const platform of PLATFORM_IDS) {
      try { void session.fromPartition(PLATFORM_DEFS[platform]!.partition).setProxy(cfg) } catch (err) {
        log(`proxy setup failed for ${platform}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  const withDownloads = (): BrowserSettings => ({ ...cache, downloadsDir: join(workspaceDir(), 'materials') } as BrowserSettings)

  load()
  applyProxy()

  ipcMain.handle('browser:getSettings', () => withDownloads())
  ipcMain.handle('browser:setSettings', (_e, patch: unknown) => {
    const p = (patch ?? {}) as Record<string, unknown>
    if (typeof p.homepage === 'string') cache.homepage = p.homepage.trim().slice(0, 500)
    if (typeof p.searchEngine === 'string' && SEARCH_ENGINES.has(p.searchEngine)) cache.searchEngine = p.searchEngine
    if (p.proxyMode === 'system' || p.proxyMode === 'direct' || p.proxyMode === 'manual') cache.proxyMode = p.proxyMode
    if (typeof p.proxyRules === 'string') cache.proxyRules = p.proxyRules.trim().slice(0, 300)
    save()
    const proxyTouched = typeof p.proxyMode === 'string' || typeof p.proxyRules === 'string'
    if (proxyTouched) applyProxy()
    return withDownloads()
  })
  ipcMain.handle('browser:clearData', async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { platform?: unknown; storages?: unknown }
    const storages = (Array.isArray(p.storages) ? p.storages : []).map(String).filter((s) => ALLOWED_STORAGES.has(s))
    if (!storages.length) return { success: false, error: '未选择要清除的数据类型' }
    const targets = p.platform === 'all' || !p.platform
      ? PLATFORM_IDS
      : [String(p.platform)].filter((id) => PLATFORM_IDS.includes(id))
    if (!targets.length) return { success: false, error: '未知平台' }
    let cleared = 0
    const kinds = storages as StorageKind[]
    for (const id of targets) {
      try {
        await session.fromPartition(PLATFORM_DEFS[id]!.partition).clearStorageData({ storages: kinds })
        cleared++
      } catch (err) {
        log(`clearData failed for ${id}: ${err instanceof Error ? err.message : err}`)
      }
    }
    return { success: cleared > 0, cleared }
  })
  ipcMain.handle('browser:openDownloadsDir', async () => {
    const { shell } = await import('electron')
    const dir = join(workspaceDir(), 'materials')
    const err = await shell.openPath(dir)
    return err ? { success: false, error: err } : { success: true }
  })

  return { getSettings: () => ({ ...cache }) }
}
