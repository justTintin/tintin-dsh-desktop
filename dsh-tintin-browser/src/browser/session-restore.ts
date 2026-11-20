// session-restore.ts — 浏览器标签池会话持久化/恢复（2026-11-20 用户裁决：壳层欠账
// 「启动恢复」批）。存储 = userData/tintin/browser/session.json；纯 fs 无 Electron
// 依赖（loadURL 经 getTabView().webContents 由调用方完成）。持久化由 tab-engine
// pushTabs 去抖调用（persistSessionTab）；恢复在 createTabEngine 尾部一次性执行
// （applyRestoredSession：逐 tab ensureTab + 记录 url 覆盖 seed）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SessionTabRecord { platform: string; url: string; title?: string }
export interface SessionSnapshot { tabs: SessionTabRecord[]; activeId?: string }

export const sessionFileAt = (baseDir: string): string => join(baseDir, 'session.json')

/** 去抖写盘（300ms 合并连续 pushTabs；退出前 flush 靠下次启动容错兜底） */
export function debouncedSessionSave(file: string): (pool: { tabs: Array<{ platform: string; url: string; title?: string }>; activeId?: string | null }) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSig = ''
  return (pool) => {
    const tabs = (pool.tabs || [])
      .filter((t) => t.platform)
      .map((t) => ({ platform: t.platform, url: String(t.url || ''), title: t.title ? String(t.title).slice(0, 200) : undefined }))
    const sig = JSON.stringify({ tabs, activeId: pool.activeId })
    if (sig === lastSig) return
    lastSig = sig
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, `${JSON.stringify({ tabs, activeId: pool.activeId ?? null }, null, 2)}\n`, 'utf8')
      } catch { /* 写盘失败下次再试 */ }
    }, 300)
  }
}

/** 读上次会话快照；文件缺失/坏 JSON/开关关闭 → null */
export function readSessionSnapshot(file: string, enabled: boolean): SessionSnapshot | null {
  if (!enabled) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as SessionSnapshot
    if (!Array.isArray(raw?.tabs) || !raw.tabs.length) return null
    return { tabs: raw.tabs.filter((t) => t && t.platform), activeId: raw.activeId }
  } catch { return null }
}

/**
 * 应用恢复快照：逐 tab ensureTab(platform)（web 平台每次新建=恢复多开），
 * 有记录 url 的（非 seed 首跳）在其 view 上覆盖 loadURL。恢复后的激活按 activeId。
 * `ensureTab` 复用 tab-engine 的（web 新建/平台复用语义已内置）。
 */
export function applyRestoredSession(
  snapshot: SessionSnapshot,
  io: {
    ensureTab: (platform: string) => { id: string } | null
    getTabView: (id: string) => { webContents: { loadURL: (url: string, opts?: unknown) => Promise<void>; isDestroyed: () => boolean } } | undefined
  },
  log: (msg: string) => void,
): void {
  const idByUrl: Array<{ id: string; url: string }> = []
  for (const t of snapshot.tabs) {
    const r = io.ensureTab(t.platform)
    if (!r) continue
    idByUrl.push({ id: r.id, url: t.url })
  }
  // 记录 url 非空且 != 平台 seed 的才补跳（ensureTab 首跳 seed；避免双载同址）
  for (const { id, url } of idByUrl) {
    if (!url) continue
    const view = io.getTabView(id)
    if (!view || view.webContents.isDestroyed()) continue
    void view.webContents.loadURL(url).catch(() => { /* 恢复页不可达不阻塞 */ })
  }
  log(`session-restore: ${idByUrl.length} tab(s) restored`)
}
