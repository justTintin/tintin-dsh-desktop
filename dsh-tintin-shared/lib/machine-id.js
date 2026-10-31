// machine-id — stable machine_id derivation, ported near-1:1 from SRC
// desktop/main/machine-id.js (2026-09-23, WP-1). CJS → ESM, logic unchanged.
// Derivation follows the original studio/utils/license.py get_machine_id:
// seed = "mac:{12-hex}|host:{hostname}|cpu:{processor}", sha256 → first 16
// lowercase hex. hostname/cpu keep original case; mac normalizes to 12-hex.
import crypto from 'node:crypto'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

/** config-store cache key (shared with client-task-thread / server-proxy). */
export const MACHINE_ID_KEY = 'machineIdV2'

/**
 * Derive machine_id (pure: same input → same output; empty string when no
 * stable seed, never fabricate).
 */
export function deriveMachineId(info) {
  const mac = String((info && info.mac) || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  const hostname = String((info && info.hostname) || '').trim()
  const cpu = String((info && info.cpu) || '').trim()
  if (!mac && !hostname && !cpu) return ''
  const seed = `mac:${mac}|host:${hostname}|cpu:${cpu}`
  return crypto.createHash('sha256').update(seed, 'utf-8').digest('hex').slice(0, 16)
}

/**
 * Synchronously collect raw machine info (server-proxy sync path). Same
 * fields as client-task-thread.collectMachineInfo; MachineGuid via sync reg.
 */
export function collectMachineInfoSync() {
  const info = { hostname: os.hostname(), platform: os.platform(), machineGuid: '', mac: '', cpu: '', source: 'sync' }
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni && !ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') { info.mac = ni.mac; break }
      }
      if (info.mac) break
    }
  } catch { /* best effort */ }
  info.cpu = String(process.env.PROCESSOR_IDENTIFIER || '').trim()
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { timeout: 3000, encoding: 'utf8' })
      const m = String(out).match(/MachineGuid\s+REG_SZ\s+(\S+)/i)
      info.machineGuid = m ? m[1] : ''
    } catch { /* best effort */ }
  }
  return info
}

/**
 * Idempotently resolve a stable machine_id: cache-first from the store,
 * otherwise derive from sync collection and write back. Without a store the
 * derived value is returned (process-level caching happens in the caller).
 */
export function resolveMachineIdSync({ store, collect = collectMachineInfoSync } = {}) {
  try {
    const cached = store && typeof store.get === 'function' ? store.get(MACHINE_ID_KEY) : null
    if (cached) return String(cached)
  } catch { /* fall through to derive */ }
  const mid = deriveMachineId(collect())
  if (mid && store && typeof store.set === 'function') {
    try { store.set(MACHINE_ID_KEY, mid) } catch { /* non-fatal */ }
  }
  return mid
}
