// TinTin first-boot provisioning — make a fresh install usable without manual
// RPC. Two halves:
//
//  seedTintinDefaults(dshHome) runs BEFORE the harness starts, only when the
//  respective file is absent (never races a live harness):
//    · settings.yaml — tintin-bundle server.url (legacy-client config if the
//      old install exists, else the built-in default), the tintin-server
//      model provider pinned at <server>/llm, and the agent default model.
//    · .credentials.yaml — the provider's placeholder API key ref (the
//      inference server currently runs unauthenticated; A3 auth lands later).
//
//  ensureDefaultWorkspace(snapshot) runs ONCE after the harness reports ready
//  (2026-09-23 ruling: default workspace = Documents/tintin-workspace): it
//  creates the directory and registers it through the public workspace RPC
//  (idempotent — created:false when it already exists). This also unblocks
//  the conversation UI, which needs a workspace before sessions can exist.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeSnapshot } from '../shared/contracts'

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8766'
const WORKSPACE_DIR_NAME = 'tintin-workspace'

// The old client's userData used the package name; earlier packaged builds
// used the productName. Read both (newest mtime wins when both exist).
const LEGACY_APP_DIRS = ['tintin-client-electron', '螺丝钉-电商智能体矩阵']

/** Resolve the seed server URL: legacy client config when present, else default. */
function resolveSeedServerUrl(appDataDir: string | undefined): string {
  if (appDataDir) {
    for (const dir of LEGACY_APP_DIRS) {
      const legacy = join(appDataDir, dir, 'config', 'server.json')
      try {
        // Observed shapes: {"server.url": "..."} (flat dot-key), plus the
        // nested/server_url variants older builds wrote.
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
    'tintin-bundle:',
    '  server:',
    `    url: ${serverUrl}`,
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
    'ui-onboarding:',
    '  welcomeNoticeVersion: 2026-08-13.1',
    '',
  ].join('\n'), 'utf8')
}

function seedCredentials(dshHome: string): void {
  const credPath = join(dshHome, '.credentials.yaml')
  if (existsSync(credPath)) return
  writeFileSync(credPath, [
    'version: 1',
    'records: {}',
    'refs:',
    '  TINTIN_SERVER_API_KEY: sk-tintin-local',
    '',
  ].join('\n'), 'utf8')
}

/** Idempotent first-boot seed; call before starting the harness runtime. */
export function seedTintinDefaults(dshHome: string, appDataDir: string | undefined): void {
  try {
    mkdirSync(dshHome, { recursive: true })
    const serverUrl = resolveSeedServerUrl(appDataDir)
    seedSettings(dshHome, serverUrl)
    seedCredentials(dshHome)
  } catch (error) {
    // Provisioning must never block startup; a blank home still boots, the
    // user just configures through the settings card instead.
    console.warn('[tintin-first-boot] seed failed:', error instanceof Error ? error.message : String(error))
  }
}

let workspaceEnsured = false

/** Register the default workspace through the public RPC once harness is ready. */
export async function ensureDefaultWorkspace(snapshot: RuntimeSnapshot): Promise<void> {
  if (workspaceEnsured) return
  const base = snapshot.url
  const token = snapshot.authToken
  if (snapshot.phase !== 'ready' || typeof base !== 'string' || typeof token !== 'string') return
  workspaceEnsured = true
  try {
    const documentsDir = process.env.TINTIN_WORKSPACE_DIR
      ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Documents')
    const dir = join(documentsDir, WORKSPACE_DIR_NAME)
    mkdirSync(dir, { recursive: true })

    const origin = new URL(base).origin
    // Token → session cookie (the same chain verify-harness-auth.mjs proves).
    const exchange = new URL('/', origin)
    exchange.searchParams.set('token', token)
    const res = await fetch(exchange, { redirect: 'manual' })
    const setCookie = res.headers.getSetCookie?.() ?? []
    const cookie = setCookie.map((h: string) => h.split(';')[0]?.trim() ?? '').find((p: string) => p.includes('='))
    if (!cookie) throw new Error('no Set-Cookie on token exchange')

    const rpc = await fetch(new URL('/api/workspace/create', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'tintin-first-boot',
        method: 'workspace/create',
        payload: { args: { request: { path: dir } } },
      }),
    })
    const body = await rpc.json().catch(() => null)
    if (!rpc.ok) throw new Error(`workspace/create ${String(rpc.status)}`)
    const created = (body as { result?: { value?: { created?: boolean } } })?.result?.value?.created
    console.info(`[tintin-first-boot] default workspace ${created === false ? 'already registered' : 'created'}: ${dir}`)
  } catch (error) {
    // One-shot guard already set; a failure surfaces in the UI as "no
    // workspace", recoverable by picking one manually.
    console.warn('[tintin-first-boot] workspace ensure failed:', error instanceof Error ? error.message : String(error))
  }
}
