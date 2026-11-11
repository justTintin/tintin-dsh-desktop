// 编辑器共享 UI 常量与画布帧引用(2026-10-28 千行付账:从 App.tsx 下沉)。
import type React from 'react'

export const panelStyle: React.CSSProperties = {
  width: 252, flexShrink: 0, background: 'var(--bg-panel)', borderRight: '1px solid #333',
  padding: 12, display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden',
}
/* 卡片标题单行省略(2026-11-11 用户裁决:长文件名不换行) */
export const headStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-faint)', margin: '4px 0 8px', fontWeight: 700, letterSpacing: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
export const iconBtn: React.CSSProperties = { border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, padding: 0, width: 22 }
export const ghostBtn: React.CSSProperties = {
  width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #444',
  background: 'transparent', color: 'var(--text)', fontSize: 12, cursor: 'pointer',
}
export const inputStyle = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  width: '100%', background: '#101012', border: '1px solid #444', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, padding: '6px 8px', outline: 'none', ...extra,
})

export const chatFrameRef: { current: HTMLIFrameElement | null } = { current: null }

/** 右键菜单样式(2026-11-11 WP-B 自 panels.tsx 上收:素材面板与图层面板共用同一菜单皮肤;
 *  :hover 语义 inline 无法表达,一次性注入,幂等)。 */
let menuStyleInjected = false
export function ensureMenuStyle(): void {
  if (menuStyleInjected || typeof document === 'undefined') return
  menuStyleInjected = true
  const s = document.createElement('style')
  s.dataset.plugin = 'dsh-tintin-cover-plugin'
  s.textContent = [
    '.tintin-as-menu{position:fixed;z-index:2300;min-width:200px;background:var(--bg-raised);border:1px solid var(--border-strong);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.5);padding:5px}',
    '.tintin-as-menu button{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:#d9d9de;font:400 12px/1.6 system-ui;padding:7px 10px;border-radius:8px;cursor:pointer;text-align:left;white-space:nowrap}',
    '.tintin-as-menu button:hover{background:var(--bg-hover)}',
    '.tintin-as-menu button.danger{color:var(--err)}',
    '.tintin-as-menu button .ico{width:16px;text-align:center;flex-shrink:0;color:#a9a9af}',
    '.tintin-as-menu button.danger .ico{color:var(--err)}',
  ].join('\n')
  document.head.append(s)
}

/* 画布操作 live 值通道(2026-11-10 对齐 PhotoCraft #128):拖动/缩放中 DOM 预览-提交分离,
   编辑卡数值经此读实时值(不经 store——每帧写 store 会撑爆撤销栈与重渲染)。
   id=null=无 live 操作(编辑卡回落 store 值)。v=版本号,变更自增,useSyncExternalStore 订阅。 */
export interface LiveLayerState {
  posId: string | null
  posDx: number
  posDy: number
  scaleId: string | null
  scalePx: number
  v: number
}
export const liveLayer: LiveLayerState = { posId: null, posDx: 0, posDy: 0, scaleId: null, scalePx: 0, v: 0 }
const liveListeners = new Set<() => void>()
export function notifyLiveLayer(): void {
  liveLayer.v += 1
  for (const l of liveListeners) { try { l() } catch { /* 单订阅者故障不杀通道 */ } }
}
export function subscribeLiveLayer(listener: () => void): () => void {
  liveListeners.add(listener)
  return () => liveListeners.delete(listener)
}
/** 编辑卡用:选中层的 live 值快照(useSyncExternalStore 的 getSnapshot,须稳定引用)。 */
export function liveLayerSnapshot(): LiveLayerState {
  return liveLayer
}

export interface ReferableLayer { id: string; label: string; type: string; propsKey?: string; value?: unknown }

export function referLayerToChat(layer: ReferableLayer): void {
  chatFrameRef.current?.contentWindow?.postMessage({ type: 'tintin-cover:refer', layer }, '*')
}


export const referableValue = (value: unknown): unknown => (Array.isArray(value) ? value.map(String).join(" / ") : value)
