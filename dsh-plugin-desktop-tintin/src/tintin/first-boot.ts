// TinTin first-boot provisioning (channel-only addition), ported from the
// source repository's src/main/tintin-first-boot.ts seed half. Runs before
// the mirrored bootstrap starts the Host, so it never races a live runtime:
// every write only happens when the target file is absent.
//
// 0.2.0 adaptations (measured against this framework):
// - the bridge plugin namespace is dsh-tintin-bundle (not tintin-bundle);
// - the ui-onboarding section is not seeded: 0.2.0 owns its own onboarding
//   surface and an unknown namespace could make the settings import strict.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDesktopChannelHome } from '../desktop-channel-home.ts'
import { DESKTOP_PRODUCT_IDENTITY } from '../product-identity.ts'

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8766'
const WORKSPACE_DIR_NAME = 'tintin-workspace'
export const TINTIN_SERVER_API_KEY_REF = 'TINTIN_SERVER_API_KEY'
export const TINTIN_PLACEHOLDER_API_KEY = 'sk-tintin-local'

// The old client's userData used the package name; earlier packaged builds
// used the productName. Read both (newest mtime wins when both exist).
const LEGACY_APP_DIRS = ['tintin-client-electron', '螺丝钉-电商智能体矩阵']

/** Resolve the seed server URL: legacy client config when present, else default. */
function resolveSeedServerUrl(appDataDir: string | undefined): string {
  if (appDataDir !== undefined) {
    for (const dir of LEGACY_APP_DIRS) {
      const legacy = join(appDataDir, dir, 'config', 'server.json')
      try {
        const raw = JSON.parse(readFileSync(legacy, 'utf8')) as Record<string, unknown>
        const nested = raw.server as { url?: unknown } | undefined
        const url = raw['server.url'] ?? nested?.url ?? raw.server_url
        if (typeof url === 'string' && url.length > 0) return url.replace(/\/$/u, '')
      } catch { /* absent or malformed — try the next dir */ }
    }
  }
  return DEFAULT_SERVER_URL
}

function seedSettings(dshHome: string, serverUrl: string): void {
  const settingsPath = join(dshHome, 'settings.yaml')
  if (existsSync(settingsPath)) return
  writeFileSync(settingsPath, [
    '# Seeded by TinTin first-boot provisioning; user settings live above this.',
    'dsh-tintin-bundle:',
    '  server:',
    `    url: ${serverUrl}`,
    '    provisioned: false',
    'llm-pi-ai:',
    '  providers:',
    '    tintin-server:',
    '      displayName: TinTin',
    '      apiKeyEnv: TINTIN_SERVER_API_KEY',
    '      api: openai-completions',
    `      baseURL: ${serverUrl}/llm`,
    '      models:',
    '        - id: deepseek-v4-flash',
    '          name: DeepSeek V4 Flash',
    'agent-default-model:',
    '  provider: tintin-server',
    '  model: deepseek-v4-flash',
    '',
  ].join(''), 'utf8')
}

function seedCredentials(dshHome: string): void {
  const credPath = join(dshHome, '.credentials.yaml')
  if (existsSync(credPath)) return
  writeFileSync(credPath, [
    'version: 1',
    'records: {}',
    'refs:',
    `  ${TINTIN_SERVER_API_KEY_REF}: ${TINTIN_PLACEHOLDER_API_KEY}`,
    '',
  ].join(''), 'utf8')
}

/**
 * Resolve the channel's DSH home the same way the mirrored bootstrap will
 * (identity + environment), then seed the first-boot defaults. Provisioning
 * must never block startup: a failed seed leaves a blank home that still
 * boots, and the user configures through the first-boot wizard instead.
 */
export function seedTinTinDefaults(appDataDir: string | undefined): void {
  try {
    const resolution = resolveDesktopChannelHome({
      identity: DESKTOP_PRODUCT_IDENTITY,
      environment: process.env,
      homeDirectory: homedir(),
    })
    const dshHome = resolution.homeDir
    mkdirSync(dshHome, { recursive: true })
    const serverUrl = resolveSeedServerUrl(appDataDir)
    seedSettings(dshHome, serverUrl)
    seedCredentials(dshHome)
    // The settings document may be imported/rewritten by the Loader; the
    // bridge's own store is the authoritative second copy the resolver chain
    // reads from the very first boot.
    const storePath = join(dshHome, 'tintin', 'config.json')
    if (!existsSync(storePath)) {
      mkdirSync(join(dshHome, 'tintin'), { recursive: true })
      writeFileSync(storePath, `${JSON.stringify({ server: { url: serverUrl } }, null, 2)}\n`, 'utf8')
    }
    console.info(`[tintin-first-boot] seeded defaults for ${dshHome} (server ${serverUrl})`)
  } catch (error) {
    console.warn('[tintin-first-boot] seed failed:', error instanceof Error ? error.message : String(error))
  }
}

/** Documents/tintin-workspace — the default workspace the ready-hook registers. */
export function tintinWorkspaceDir(): string {
  const documentsDir = process.env.TINTIN_WORKSPACE_DIR
    ?? join(homedir(), 'Documents')
  return join(documentsDir, WORKSPACE_DIR_NAME)
}
