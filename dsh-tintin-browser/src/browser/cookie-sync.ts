// ═══════════════════════════════════════════════════════════════
// cookie-sync.ts — 登录态 cookie 链（2026-11-08 自 browser-service.ts 提取：
// 千行红线付账，代理/静音/导航批净增行超阈）。SRC ytdlp-gate
// exportCookiesForPlatform 同口径：分区读取（domain 与去 . 变体双查 + 去重）
// → Netscape 交接文件；默认 session 存量登录一次性迁移（2026-09-28 分区事故救援）。
// ═══════════════════════════════════════════════════════════════
import { app, session } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLATFORM_COOKIE_DOMAINS, PLATFORM_DEFS, type PlatformDef } from './platform-meta.ts'
import { formatNetscapeCookies } from './netscape-cookies.ts'

/** cookies 交接目录：与 harness 子进程的 DSH_HOME 同源（<userData>/harness） */
export function browserCookiesDir(): string {
  return join(app.getPath('userData'), 'harness', 'tintin', 'browser', 'cookies')
}

interface ElectronCookie {
  domain: string
  path: string
  secure: boolean
  expirationDate?: number
  name: string
  value: string
}

/** 平台分区内的去重 cookie 集合（SRC ytdlp-gate exportCookiesForPlatform 同口径：
 *  domain 与去 . 变体双查 + domain|path|name 去重） */
export async function collectPlatformCookies(platform: string): Promise<ElectronCookie[]> {
  const def: PlatformDef | undefined = PLATFORM_DEFS[platform]
  const domains = PLATFORM_COOKIE_DOMAINS[platform]
  if (!def || !domains || !domains.length) return []
  const sess = session.fromPartition(def.partition)
  const seen = new Set<string>()
  const unique: ElectronCookie[] = []
  for (const domain of domains) {
    for (const d of [domain, domain.replace(/^\./, '')]) {
      let cookies: ElectronCookie[] = []
      try { cookies = await sess.cookies.get({ domain: d }) as unknown as ElectronCookie[] } catch { continue }
      for (const c of cookies) {
        const key = `${c.domain}|${c.path}|${c.name}`
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(c)
      }
    }
  }
  return unique
}

/** 导出平台分区 cookies 为 Netscape 文件；无 cookie 返回 null（未登录不算错） */
export async function exportPlatformCookies(
  platform: string,
  destPath: string,
): Promise<{ count: number; path: string } | null> {
  try {
    const cookies = await collectPlatformCookies(platform)
    if (!cookies.length) return null
    mkdirSync(join(destPath, '..'), { recursive: true })
    writeFileSync(destPath, formatNetscapeCookies(cookies), 'utf-8')
    return { count: cookies.length, path: destPath }
  } catch {
    return null
  }
}

/** 默认 session → 平台分区的一次性登录态迁移（2026-09-28 分区事故救援）。
 *  事故期间用户在内置浏览器的登录全落在默认 session，而消费链只认分区；分区事故修复
 *  （view 挂 partition）后，把默认 session 里该平台域的存量 cookie 迁回分区，用户免重登。
 *  幂等：仅当分区对该平台域完全无 cookie 时迁移（有任意一条即认为分区已有自己的登录态，
 *  不覆盖不合并）；单条 set 失败不阻断。返回迁移条数。 */
export async function migrateDefaultSessionCookies(platform: string, log: (msg: string) => void): Promise<number> {
  const def: PlatformDef | undefined = PLATFORM_DEFS[platform]
  const domains = PLATFORM_COOKIE_DOMAINS[platform]
  if (!def || !domains?.length) return 0
  try {
    const existing = await collectPlatformCookies(platform)
    if (existing.length > 0) return 0
    const partSess = session.fromPartition(def.partition)
    const seen = new Set<string>()
    let migrated = 0
    for (const domain of domains) {
      let cookies: ElectronCookie[] = []
      try { cookies = await session.defaultSession.cookies.get({ domain }) as unknown as ElectronCookie[] } catch { continue }
      for (const c of cookies) {
        const key = `${c.domain}|${c.path}|${c.name}`
        if (seen.has(key)) continue
        seen.add(key)
        try {
          await partSess.cookies.set({
            url: `https://${String(c.domain || '').replace(/^\./, '')}${c.path || '/'}`,
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            ...(c.expirationDate === undefined ? {} : { expirationDate: c.expirationDate }),
          })
          migrated++
        } catch { /* 单条失败不阻断（如域/路径非法） */ }
      }
    }
    if (migrated > 0) log(`login migrate: default session -> ${def.partition} (${migrated} cookies)`)
    return migrated
  } catch (err) {
    log(`login migrate failed for ${platform}: ${err instanceof Error ? err.message : err}`)
    return 0
  }
}
