// text-scale — 文字层画布缩放手柄(2026-11-10 用户报障「放大拖动文字值不变」+对齐
// PhotoCraft 文字画布操作:拖角改字号,预览-提交分离)。自 CanvasPanel 提取付账(千行门禁)。
// live 值经 liveLayer 通道广播(编辑卡字号/X·Y 实时跟随),props 零写入直到提交。
import React from 'react'
import { canvasBoxIn, compositionRectIn, type CanvasBox } from './canvas-geom'
import type { TemplateDef } from '../registry'
import { liveLayer, notifyLiveLayer } from './ui'

export interface TextScaleDeps {
  props: Record<string, unknown>
  handleBox: { x: number; y: number; w: number; h: number } | null
  selectedLayer: string | null
  /** 选中文字层的定义(id + 基准字号);null=非文字层,手柄不渲染也不响应 */
  selectedTextDef: { id: string; fontSize?: number } | null
  tpl: TemplateDef
  hostRef: React.RefObject<HTMLDivElement | null>
  playerWrapRef: React.RefObject<HTMLDivElement | null>
  canvasBoxOf: (el: Element) => CanvasBox
  setLayerStyle: (id: string, patch: Record<string, unknown>) => void
  locked: boolean
}

export interface TextScaleHandles {
  ref: React.MutableRefObject<{
    id: string; base: number; startPx: number; lastPx: number; startDist: number
    ax: number; ay: number; el: HTMLElement | null
  } | null>
  onDown: (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}

export function useTextScaleHandles(deps: TextScaleDeps): TextScaleHandles {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const ref = React.useRef<TextScaleHandles['ref'] extends React.MutableRefObject<infer S> ? S : never>(null)

  const onDown = (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent): void => {
    const d = depsRef.current
    if (!d.handleBox || !d.selectedLayer || !d.selectedTextDef || d.locked) return
    e.stopPropagation()
    const styles = (d.props.styles as Record<string, { scale?: number }> | undefined)?.[d.selectedLayer]
    const base = d.selectedTextDef.fontSize ?? 24
    const startPx = Math.round(base * (typeof styles?.scale === 'number' ? styles.scale : 1))
    const el = (d.hostRef.current?.querySelector(`[data-cover-layer="${d.selectedLayer}"]`) as HTMLElement | null) ?? null
    const rect = compositionRectIn(d.hostRef.current, d.playerWrapRef.current)
    if (!el || !rect) return
    const box = canvasBoxIn(el, rect, d.tpl.width)
    const ax = corner === 'nw' || corner === 'sw' ? box.left + box.w : box.left
    const ay = corner === 'nw' || corner === 'ne' ? box.top + box.h : box.top
    const scale = Math.max(rect.width / d.tpl.width, 0.05)
    ref.current = {
      id: d.selectedLayer, base, startPx, lastPx: startPx,
      startDist: Math.max(8, Math.hypot((e.clientX - rect.left) / scale - ax, (e.clientY - rect.top) / scale - ay)),
      ax, ay, el,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = depsRef.current
    const r = ref.current
    const rect = compositionRectIn(d.hostRef.current, d.playerWrapRef.current)
    if (!r || !rect) return
    const scale = Math.max(rect.width / d.tpl.width, 0.05)
    const distNow = Math.hypot((e.clientX - rect.left) / scale - r.ax, (e.clientY - rect.top) / scale - r.ay)
    const px = Math.max(Math.max(14, Math.round(r.base * 0.3)), Math.min(Math.round(r.base * 3), Math.round(r.startPx * (distNow / r.startDist))))
    r.lastPx = px
    if (r.el) r.el.style.fontSize = `${px}px` // 预览:props 零写入
    liveLayer.scaleId = r.id
    liveLayer.scalePx = px
    notifyLiveLayer()
  }
  const onUp = (e: React.PointerEvent): void => {
    const d = depsRef.current
    const r = ref.current
    ref.current = null
    liveLayer.scaleId = null
    notifyLiveLayer()
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (!r || !r.el) return
    if (r.lastPx === r.startPx) { r.el.style.fontSize = ''; return } // 未变:还原预览
    d.setLayerStyle(r.id, { scale: Math.min(3, Math.max(0.3, r.lastPx / r.base)) })
  }
  return { ref, onDown, onMove, onUp }
}
