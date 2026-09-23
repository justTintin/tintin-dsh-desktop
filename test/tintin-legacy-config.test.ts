import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findLegacyConfigDir, planLegacyMigration, readLegacyConfig } from '../packages/tintin-bundle/lib/legacy-config.js'

describe('tintin legacy-config migration', () => {
  let dir: string
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  function seedLegacy(appData: string, serverUrl: string): string {
    const configDir = join(appData, '螺丝钉-电商智能体矩阵', 'config')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'server.json'), JSON.stringify({ server: { url: serverUrl } }), 'utf8')
    return configDir
  }

  it('finds the legacy config dir under %APPDATA%/<old productName>/config', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = seedLegacy(dir, 'http://192.168.111.31:8000')
    expect(findLegacyConfigDir(dir)).toBe(configDir)
    expect(findLegacyConfigDir(join(dir, 'nonexistent'))).toBeNull()
  })

  it('reads server.url from the legacy server.json domain file', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = seedLegacy(dir, 'http://192.168.111.31:8000')
    expect(readLegacyConfig(configDir)).toEqual([{ path: ['server', 'url'], value: 'http://192.168.111.31:8000' }])
  })

  it('plans only values that differ from current settings (idempotent)', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = seedLegacy(dir, 'http://192.168.111.31:8000')
    // Not yet configured → migrate.
    expect(planLegacyMigration(configDir, {})).toHaveLength(1)
    // Already at the same value → no-op.
    expect(planLegacyMigration(configDir, { server: { url: 'http://192.168.111.31:8000' } })).toHaveLength(0)
  })

  it('skips a malformed legacy file instead of failing', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = join(dir, '螺丝钉-电商智能体矩阵', 'config')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'server.json'), '{not json', 'utf8')
    expect(readLegacyConfig(configDir)).toEqual([])
  })
})
