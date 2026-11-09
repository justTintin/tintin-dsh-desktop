// ═══════════════════════════════════════════════════════════════
// theme-sync.ts — 视图底色主题同步（2026-11-08 白底修复 §16.23；第二批
// 自 browser-service.ts 提取付账）。nativeTheme 只知「系统深浅+themeSource
// 覆盖」，而应用深色=web 层刷的 body[data-ds-dark-theme]——偏好=跟随系统且
// Windows 浅色时两者相反。宿主渲染层探测 web 层真值，nativeTheme 兜底。
// ═══════════════════════════════════════════════════════════════
import { nativeTheme, type WebContentsView } from 'electron'

const THEME_PROBE_SCRIPT = "({dark:Boolean(document.body&&document.body.hasAttribute('data-ds-dark-theme'))||document.documentElement.getAttribute('data-ds-theme-source')==='dark',light:document.documentElement.getAttribute('data-ds-theme-source')==='light'})"

export interface ThemeSyncHost {
  /** 宿主渲染层 webContents（null=未就绪，等下次探针） */
  hostWebContents: () => import('electron').WebContents | null
  /** 全部存活视图（平台单视图+标签+内嵌 UI） */
  views: () => WebContentsView[]
}

/** 创建主题同步器：probe() 探测 web 层真值，变化即重刷全部视图底色 */
export function createThemeSync(host: ThemeSyncHost) {
  let webLayerDark: boolean | null = null
  const themedBackground = (): string => {
    const dark = webLayerDark ?? nativeTheme.shouldUseDarkColors
    return dark ? '#141416' : '#ffffff'
  }
  function applyAll(): void {
    const bg = themedBackground()
    for (const v of host.views()) {
      try { if (!v.webContents.isDestroyed()) v.setBackgroundColor(bg) } catch { /* ignore */ }
    }
  }
  function probe(): void {
    const wc = host.hostWebContents()
    if (!wc) return
    void wc.executeJavaScript(THEME_PROBE_SCRIPT, true).then((r) => {
      const d = (r ?? {}) as { dark?: boolean; light?: boolean }
      const next = d.light ? false : d.dark ? true : null
      if (next === webLayerDark) return
      webLayerDark = next
      applyAll()
    }).catch(() => { /* 导航重探 */ })
  }
  return { themedBackground, probe }
}
