// legacy-config — migrate the old TinTin client ("螺丝钉-电商智能体矩阵",
// appId com.tintin.electron.v3) config into the new harness settings seam.
// Scope per A2 裁决 (2026-09-23): config data only — server.url today; other
// domains (素材/草稿/任务/会话) are explicitly NOT migrated. Idempotent: once
// migrated, a marker in the new settings prevents re-reading the legacy file.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Keys we migrate, legacy config-store domain file → new settings path. */
const MIGRATIONS = [
  { file: 'server.json', read: (j) => j?.server?.url ?? j?.['server.url'], to: ['server', 'url'] },
]

/**
 * Locate the legacy config dir. The old client stored split-domain JSON under
 * <userData>/config (resolveConfigBasePath). userData derives from the old
 * productName ("螺丝钉-电商智能体矩阵") under %APPDATA% on Windows.
 * `appDataDir` is injected (testability); returns null when absent.
 */
export function findLegacyConfigDir(appDataDir) {
  if (!appDataDir) return null
  const dir = join(appDataDir, '螺丝钉-电商智能体矩阵', 'config')
  return existsSync(dir) ? dir : null
}

/**
 * Read migratable values from the legacy config dir. Pure read, no writes.
 * Returns a flat list of { path, value } ops for the settings seam.
 */
export function readLegacyConfig(configDir) {
  const ops = []
  for (const m of MIGRATIONS) {
    const file = join(configDir, m.file)
    if (!existsSync(file)) continue
    try {
      const value = m.read(JSON.parse(readFileSync(file, 'utf8')))
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
