export interface MigrationOp {
  path: string[]
  value: unknown
}
export function findLegacyConfigDir(appDataDir: string | undefined): string | null
export function readLegacyConfig(configDir: string): MigrationOp[]
export function planLegacyMigration(configDir: string, current: unknown): MigrationOp[]
