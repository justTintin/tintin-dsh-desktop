// 编辑器共享 UI 常量与画布帧引用(2026-10-28 千行付账:从 App.tsx 下沉)。
import type React from 'react'

export const panelStyle: React.CSSProperties = {
  width: 252, flexShrink: 0, background: '#1a1a1c', borderRight: '1px solid #333',
  padding: 12, display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden',
}
export const headStyle: React.CSSProperties = { fontSize: 11, color: '#8b8b88', margin: '4px 0 8px', fontWeight: 700, letterSpacing: 1 }
export const iconBtn: React.CSSProperties = { border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, padding: 0, width: 22 }
export const ghostBtn: React.CSSProperties = {
  width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #444',
  background: 'transparent', color: '#e8e8e6', fontSize: 12, cursor: 'pointer',
}
export const inputStyle = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  width: '100%', background: '#101012', border: '1px solid #444', borderRadius: 6,
  color: '#e8e8e6', fontSize: 12, padding: '6px 8px', outline: 'none', ...extra,
})

export const chatFrameRef: { current: HTMLIFrameElement | null } = { current: null }

export interface ReferableLayer { id: string; label: string; type: string; propsKey?: string; value?: unknown }

export function referLayerToChat(layer: ReferableLayer): void {
  chatFrameRef.current?.contentWindow?.postMessage({ type: 'tintin-cover:refer', layer }, '*')
}


export const referableValue = (value: unknown): unknown => (Array.isArray(value) ? value.map(String).join(" / ") : value)
