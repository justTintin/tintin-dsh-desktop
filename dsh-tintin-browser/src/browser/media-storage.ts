// media-storage.ts — 媒体采集/下载记录与设置持久化（SRC desktop/main/media-storage.js 一比一移植，基线 9ca9050）
// 移植差异：electron-store → userData 下 JSON 文件（壳无该依赖，get/has/set 语义等价）；
// 工厂注入 ipcMain 与存储文件路径，可脱离 Electron 单测（铁律 8）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const STORAGE_KEYS = {
  SNIFFED: 'media.sniffedHistory',
  DOWNLOADS: 'media.downloadRecords',
  SETTINGS: 'media.settings',
  FAVORITES: 'media.favorites',
} as const

const MAX_SNIFFED = 200
const MAX_DOWNLOADS = 500
const MAX_FAVORITES = 500

interface SniffedItem {
  name?: string
  type?: string
  url: string
  size?: number
  platformId?: string
  ts?: number
  // 收藏夹时间戳（addFavorite 写入；2026-09-25 门禁解锁补声明——并行会话 WIP）
  addedAt?: number
  updatedAt?: number
}
interface DownloadRecord {
  id: string
  name?: string
  url?: string
  path?: string
  size?: number
  ts?: number
}
interface StorageSettings {
  autoSave: boolean
  maxHistory: number
  downloadDir: string
}

/** 极简 JSON 持久化（electron-store 语义子集：get/has/set，整文件读写） */
class JsonStore {
  private data: Record<string, unknown> = {}
  constructor(private file: string) {
    try {
      if (existsSync(file)) this.data = JSON.parse(readFileSync(file, 'utf8'))
    } catch { /* 损坏文件按空库处理 */ }
  }
  has(key: string): boolean { return key in this.data }
  get<T>(key: string, fallback: T): T {
    return (this.data[key] as T) ?? fallback
  }
  set(key: string, value: unknown): void {
    this.data[key] = value
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch { /* 写盘失败下次再试 */ }
  }
}

export interface MediaStorageDeps {
  /** 持久化文件（userData/tintin/browser/media-storage.json） */
  storeFile: string
  /** 下载目录兜底（app.getPath('downloads') 由调用方注入，避免模块级依赖 electron） */
  downloadsDir: () => string
}

export function createMediaStorage(ipcMain: Electron.IpcMain, deps: MediaStorageDeps) {
  const store = new JsonStore(deps.storeFile)

  let sniffedCache: SniffedItem[] = []
  let downloadCache: DownloadRecord[] = []
  let settingsCache: StorageSettings = { autoSave: true, maxHistory: MAX_SNIFFED, downloadDir: '' }
  let favoritesCache: SniffedItem[] = []

  function load<T>(key: string, fallback: T): T {
    try {
      if (store.has(key)) return store.get(key, fallback)
    } catch { /* ignore */ }
    return fallback
  }
  function save(key: string, value: unknown): boolean {
    try { store.set(key, value); return true } catch { return false }
  }

  try {
    sniffedCache = load<SniffedItem[]>(STORAGE_KEYS.SNIFFED, [])
    downloadCache = load<DownloadRecord[]>(STORAGE_KEYS.DOWNLOADS, [])
    settingsCache = { ...settingsCache, ...load<Partial<StorageSettings>>(STORAGE_KEYS.SETTINGS, {}) }
    favoritesCache = load<SniffedItem[]>(STORAGE_KEYS.FAVORITES, [])
  } catch { /* ignore */ }

  function ensureDir(dirPath: string): boolean {
    try {
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
      return true
    } catch { return false }
  }
  if (settingsCache.downloadDir) ensureDir(settingsCache.downloadDir)

  const saveSniffed = (list: SniffedItem[]): void => {
    sniffedCache = Array.isArray(list) ? list.slice(0, settingsCache.maxHistory || MAX_SNIFFED) : []
    save(STORAGE_KEYS.SNIFFED, sniffedCache)
  }
  const saveDownloads = (list: DownloadRecord[]): void => {
    downloadCache = Array.isArray(list) ? list.slice(0, MAX_DOWNLOADS) : []
    save(STORAGE_KEYS.DOWNLOADS, downloadCache)
  }
  const saveSettings = (s: Partial<StorageSettings>): void => {
    settingsCache = { ...settingsCache, ...(s || {}) }
    save(STORAGE_KEYS.SETTINGS, settingsCache)
  }
  const saveFavorites = (list: SniffedItem[]): void => {
    favoritesCache = Array.isArray(list) ? list.slice(0, MAX_FAVORITES) : []
    save(STORAGE_KEYS.FAVORITES, favoritesCache)
  }
  const addFavorite = (item: SniffedItem): SniffedItem[] => {
    if (!item || !item.url) return favoritesCache
    const exists = favoritesCache.findIndex(f => f.url === item.url)
    if (exists >= 0) {
      favoritesCache[exists] = { ...favoritesCache[exists], ...item, updatedAt: Date.now() }
    } else {
      favoritesCache.unshift({ ...item, addedAt: Date.now() })
      if (favoritesCache.length > MAX_FAVORITES) favoritesCache.pop()
    }
    save(STORAGE_KEYS.FAVORITES, favoritesCache)
    return favoritesCache
  }
  const removeFavorite = (url: string): SniffedItem[] => {
    favoritesCache = favoritesCache.filter(f => f.url !== url)
    save(STORAGE_KEYS.FAVORITES, favoritesCache)
    return favoritesCache
  }

  ipcMain.handle('media:storageGetSniffed', () => {
    try { return { success: true, data: sniffedCache } } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageSaveSniffed', (_e, list: SniffedItem[]) => {
    try { saveSniffed(list); return { success: true, count: sniffedCache.length } } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageGetDownloads', () => {
    try { return { success: true, data: downloadCache } } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageSaveDownloads', (_e, list: DownloadRecord[]) => {
    try { saveDownloads(list); return { success: true, count: downloadCache.length } } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageExport', async (_e, { format = 'json', path: destPath } = {}) => {
    try {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sniffed: sniffedCache,
        downloads: downloadCache,
        settings: settingsCache,
      }
      if (format === 'json') {
        let outPath = destPath
        if (!outPath) {
          const dlDir = settingsCache.downloadDir || deps.downloadsDir()
          outPath = join(dlDir, `tintin-media-export-${Date.now()}.json`)
        }
        writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8')
        return { success: true, path: outPath }
      }
      if (format === 'csv') {
        let outPath = destPath
        if (!outPath) {
          const dlDir = settingsCache.downloadDir || deps.downloadsDir()
          outPath = join(dlDir, `tintin-media-sniffed-${Date.now()}.csv`)
        }
        const headers = ['name', 'type', 'url', 'size', 'platformId', 'timestamp']
        const rows = sniffedCache.map(m => [
          `"${String(m.name || '').replace(/"/g, '""')}"`,
          m.type || '',
          `"${String(m.url || '').replace(/"/g, '""')}"`,
          m.size || 0,
          m.platformId || '',
          m.ts || 0,
        ].join(','))
        writeFileSync(outPath, [headers.join(','), ...rows].join('\n'), 'utf-8')
        return { success: true, path: outPath, count: sniffedCache.length }
      }
      return { success: false, error: 'UNKNOWN_FORMAT' }
    } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageImport', async (_e, { path: srcPath } = {}) => {
    try {
      if (!srcPath) return { success: false, error: 'NO_PATH' }
      const raw = readFileSync(srcPath, 'utf-8')
      const data = JSON.parse(raw) as { sniffed?: SniffedItem[]; downloads?: DownloadRecord[]; settings?: Partial<StorageSettings> }
      if (data.sniffed && Array.isArray(data.sniffed)) {
        const existing = new Set(sniffedCache.map(m => m.url))
        saveSniffed([...data.sniffed.filter(m => !existing.has(m.url)), ...sniffedCache])
      }
      if (data.downloads && Array.isArray(data.downloads)) {
        const existing = new Set(downloadCache.map(d => d.id))
        saveDownloads([...data.downloads.filter(d => !existing.has(d.id)), ...downloadCache])
      }
      if (data.settings && typeof data.settings === 'object') saveSettings(data.settings)
      return {
        success: true,
        sniffedImported: data.sniffed ? data.sniffed.length : 0,
        downloadsImported: data.downloads ? data.downloads.length : 0,
      }
    } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageClearHistory', (_e, { type = 'sniffed' } = {}) => {
    try {
      if (type === 'sniffed') { saveSniffed([]); return { success: true, cleared: 'sniffed' } }
      if (type === 'downloads') { saveDownloads([]); return { success: true, cleared: 'downloads' } }
      if (type === 'all') { saveSniffed([]); saveDownloads([]); return { success: true, cleared: 'all' } }
      return { success: false, error: 'UNKNOWN_TYPE' }
    } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageGetFavorites', () => {
    try { return { success: true, data: favoritesCache } } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageAddFavorite', (_e, item: SniffedItem) => {
    try {
      const result = addFavorite(item)
      return { success: true, data: result, count: result.length }
    } catch (e) { return { success: false, error: (e as Error).message } }
  })
  ipcMain.handle('media:storageRemoveFavorite', (_e, url: string) => {
    try {
      const result = removeFavorite(url)
      return { success: true, data: result, count: result.length }
    } catch (e) { return { success: false, error: (e as Error).message } }
  })

  return {
    getSniffed: () => sniffedCache,
    getDownloads: () => downloadCache,
    getSettings: () => settingsCache,
    getFavorites: () => favoritesCache,
    setSniffed: saveSniffed,
    setDownloads: saveDownloads,
    setSettings: saveSettings,
    setFavorites: saveFavorites,
    addFavorite,
    removeFavorite,
  }
}

export type MediaStorage = ReturnType<typeof createMediaStorage>
