// legacy-config — migrate the old TinTin client ("螺丝钉-电商智能体矩阵",
// appId com.tintin.electron.v3) config into the new harness settings seam.
// Scope per A2 裁决 (2026-09-23): config data only — server.url today; other
// domains (素材/草稿/任务/会话) are explicitly NOT migrated. Idempotent: once
// migrated, a marker in the new settings prevents re-reading the legacy file.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Keys we migrate, legacy config-store domain file → new settings path. */
const MIGRATIONS = [
  // All three observed server.json shapes flatten to one reader.
  { file: 'server.json', read: (j) => j?.url ?? j?.['server.url'] ?? j?.server_url, to: ['server', 'url'] },
]

/**
 * Locate the legacy config dir. The old client split-domain JSON lives under
 * <userData>/config; its userData used the package name (tintin-client-electron)
 * on this fleet — earlier packaged builds used the productName. First hit wins.
 * `appDataDir` is injected (testability); returns null when absent.
 */
export function findLegacyConfigDir(appDataDir) {
  if (!appDataDir) return null
  for (const dir of ['tintin-client-electron', '螺丝钉-电商智能体矩阵']) {
    const candidate = join(appDataDir, dir, 'config')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Read migratable values from the legacy config dir. Pure read, no writes.
 * Returns a flat list of { path, value } ops for the settings seam.
 * server.json shapes seen in the wild: {"server.url": "..."} flat dot-key,
 * plus nested {server:{url}} and server_url variants.
 */
export function readLegacyConfig(configDir) {
  const ops = []
  for (const m of MIGRATIONS) {
    const file = join(configDir, m.file)
    if (!existsSync(file)) continue
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      const nested = raw && typeof raw === 'object' ? raw.server : undefined
      const value = m.read({ ...raw, ...(nested && typeof nested === 'object' ? nested : {}) })
      if (value) ops.push({ path: m.to, value })
    } catch { /* a malformed legacy file is skipped, not fatal */ }
  }
  return ops
}

/**
 * Plan the migration ops for the settings seam: legacy values that differ from
 * what is already configured. Pure; the caller applies via settings.mutate.
 */
export function planLegacyMigration(configDir, current) {
  return readLegacyConfig(configDir).filter(({ path, value }) => {
    const existing = path.reduce((acc, k) => (acc == null ? undefined : acc[k]), current)
    return existing !== value
  })
}
