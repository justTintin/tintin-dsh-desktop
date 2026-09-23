import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findLegacyConfigDir, planLegacyMigration, readLegacyConfig } from '../packages/tintin-bundle/lib/legacy-config.js'

describe('tintin legacy-config migration', () => {
  let dir: string
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  function seedLegacy(appData: string, serverUrl: string, dirName = 'tintin-client-electron'): string {
    const configDir = join(appData, dirName, 'config')
    mkdirSync(configDir, { recursive: true })
    // Flat dot-key shape observed on the real fleet machine.
    writeFileSync(join(configDir, 'server.json'), JSON.stringify({ 'server.url': serverUrl }), 'utf8')
    return configDir
  }

  it('finds the legacy config dir under the old client userData (both names)', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = seedLegacy(dir, 'http://192.168.111.31:8000')
    expect(findLegacyConfigDir(dir)).toBe(configDir)
    expect(findLegacyConfigDir(join(dir, 'nonexistent'))).toBeNull()
  })

  it('reads the flat server.url dot-key from the legacy server.json', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = seedLegacy(dir, 'http://192.168.111.31:8000')
    expect(readLegacyConfig(configDir)).toEqual([{ path: ['server', 'url'], value: 'http://192.168.111.31:8000' }])
  })

  it('also reads the productName-named dir and nested shape', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = join(dir, '螺丝钉-电商智能体矩阵', 'config')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'server.json'), JSON.stringify({ server: { url: 'http://10.0.0.9:9000' } }), 'utf8')
    expect(readLegacyConfig(configDir)).toEqual([{ path: ['server', 'url'], value: 'http://10.0.0.9:9000' }])
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
