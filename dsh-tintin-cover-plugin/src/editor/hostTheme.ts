// hostTheme — 宿主（原生 DSH web）主题判定（2026-11-15 封面域主题跟随批）。
// 与媒体/运营/创作三包的 composables/hostTheme.ts 同口径（React 版；三包为 Vue 版，
// 包间不互引）：原生挂载点（harness ui-theme boot-theme.ts）应用内偏好 dark/light/
// system 写 html[data-ds-theme-source]，有效暗色 toggle body[data-ds-dark-theme]。
// 原生从不给 <html> 加 .dark 类——只认 classList.contains('dark') 会恒假。
// 判定链：body[data-ds-dark-theme] → html[data-ds-theme-source] → html.dark
// → 系统偏好（无原生信号时兜底）。并观察 body 属性变化，原生运行时翻主题即跟随。
import { useEffect, useState } from 'react'

export function resolveHostDark(): boolean {
  if (typeof document === 'undefined') return true // SSR/无 DOM：暗色兜底（封面域旧口径恒暗色）
  if (document.body?.hasAttribute('data-ds-dark-theme')) return true
  const source = document.documentElement?.dataset?.dsThemeSource
  if (source === 'dark' || source === 'light') return source === 'dark'
  if (document.documentElement?.classList?.contains('dark')) return true
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 宿主有效暗色（跟随运行时翻转；scope 根打 data-theme 用） */
export function useHostDark(): boolean {
  const [dark, setDark] = useState(resolveHostDark)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(resolveHostDark()))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}
