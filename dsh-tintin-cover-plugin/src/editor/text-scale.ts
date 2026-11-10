// text-scale — 画布变换手柄钩子族(2026-11-11 WP-A3/A4 重写,自 CanvasPanel 提取付账):
// · useRotateHandles: 旋转手柄(图片/文字层,2026-10-29 用户裁决;2026-11-10 扩展文字)。
//   中心改由 sel-geom 旋转感知选择框提供(WP-A3)——旋转中手柄冻结由 onEnd 清框重测。
// · useTextScaleHandles: 文字层四角手柄=几何缩放(2026-11-11 对齐 PhotoCraft Free
//   Transform——拖角缩放整层几何,gstyle 折入层变换,不改字号不重排;字号仍由
//   编辑卡 scale 管)。预览写 el.style.transform 追加 scale,提交写 styles.gscale;
//   live 值经 liveLayer 通道广播(编辑卡字号显示=基准×scale×gscale)。
import React from 'react'
import { canvasBoxIn, compositionRectIn } from './canvas-geom'
import type { TemplateDef } from '../registry'
import { liveLayer, notifyLiveLayer } from './ui'

export interface RotateDeps {
  readout: (clientX: number, clientY: number, text: string) => void
  hideReadout: () => void
  props: Record<string, unknown>
  customLayers: Array<{ id: string; rotate?: number }> | undefined
  /** 选中层视觉中心(屏幕 px,playerWrap 系;WP-A3 起由旋转感知选择框提供) */
  center: { x: number; y: number } | null
  selectedLayer: string | null
  hostRef: React.RefObject<HTMLDivElement | null>
  setLayerStyle: (id: string, patch: Record<string, unknown>) => void
  setCustomLayer: (id: string, patch: Record<string, unknown>) => void
  locked: boolean
  /** 松手回调(清冻结框,触发重测) */
  onEnd: () => void
}

export interface RotateHandles {
  ref: React.MutableRefObject<{
    cx: number; cy: number; a0: number; base: number; id: string; custom: boolean
    el: HTMLElement | null; baseTransform: string; curDeg: number
  } | null>
  onDown: (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}

/** 旋转手柄: 拖动=绕视觉中心转,4° 吸附 ±90/±180,预览写 el.transform(纯视觉),
 *  提交写 styles.rotate/customLayers.rotate。 */
export function useRotateHandles(deps: RotateDeps): RotateHandles {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const ref = React.useRef<RotateHandles['ref'] extends React.MutableRefObject<infer S> ? S : never>(null)
  const withRotate = (base: string, deg: number): string => {
    const r = `rotate(${deg}deg)`
    const i = base.lastIndexOf('rotate(')
    if (i < 0) return base ? `${base} ${r}` : r
    const end = base.indexOf(')', i)
    return base.slice(0, i) + r + base.slice(end + 1)
  }
  const onDown = (e: React.PointerEvent): void => {
    const d = depsRef.current
    if (!d.center || !d.selectedLayer || d.locked) return
    e.stopPropagation()
    const cx = d.center.x
    const cy = d.center.y
    const custom = d.selectedLayer.startsWith('img-')
    const styles = (d.props.styles as Record<string, { rotate?: number }> | undefined)?.[d.selectedLayer]
    const base = custom
      ? (d.customLayers ?? []).find((l) => l.id === d.selectedLayer)?.rotate ?? 0
      : styles?.rotate ?? 0
    const el = (d.hostRef.current?.querySelector(`[data-cover-layer="${d.selectedLayer}"]`) as HTMLElement | null) ?? null
    ref.current = { cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), base, id: d.selectedLayer, custom, el, baseTransform: el?.style.transform ?? '', curDeg: base }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = depsRef.current
    const rot = ref.current
    if (!rot) return
    let deg = rot.base + ((Math.atan2(e.clientY - rot.cy, e.clientX - rot.cx) - rot.a0) * 180) / Math.PI
    deg = Math.round(deg)
    for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) <= 4) { deg = snap; break }
    if (deg > 180) deg -= 360
    if (deg < -180) deg += 360
    rot.curDeg = deg
    if (rot.el) rot.el.style.transform = withRotate(rot.baseTransform, deg)
    d.readout(e.clientX + 14, e.clientY + 14, `${deg}°`)
  }
  const onUp = (e: React.PointerEvent): void => {
    const d = depsRef.current
    const rot = ref.current
    ref.current = null
    d.hideReadout()
    d.onEnd()
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (!rot) return
    if (rot.curDeg === rot.base) { if (rot.el) rot.el.style.transform = rot.baseTransform; return }
    if (rot.el) rot.el.style.transform = ''
    if (rot.custom) d.setCustomLayer(rot.id, { rotate: rot.curDeg })
    else d.setLayerStyle(rot.id, { rotate: rot.curDeg })
  }
  return { ref, onDown, onMove, onUp }
}

export interface TextScaleDeps {
  readout: (clientX: number, clientY: number, text: string) => void
  hideReadout: () => void
  props: Record<string, unknown>
  selectedLayer: string | null
  /** 选中文字层的定义(id + 基准字号);null=非文字层,手柄不渲染也不响应 */
  selectedTextDef: { id: string; fontSize?: number } | null
  tpl: TemplateDef
  hostRef: React.RefObject<HTMLDivElement | null>
  playerWrapRef: React.RefObject<HTMLDivElement | null>
  setLayerStyle: (id: string, patch: Record<string, unknown>) => void
  locked: boolean
}

export interface TextScaleHandles {
  ref: React.MutableRefObject<{
    id: string; base: number; startDist: number; lastTotal: number
    ax: number; ay: number; el: HTMLElement | null; baseTransform: string
    defPx: number
  } | null>
  onDown: (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}

/** 文字几何缩放手柄(WP-A4): 对角为锚,AABB 距离比驱动 gscale(0.3..3)。
 *  预览=baseTransform 追加 scale(k)(baseTransform 已含 translate/rotate,均匀缩放
 *  追加在后语义等价);提交写 styles.gscale。旋转层同样成立(锚=对角视觉点)。 */
export function useTextScaleHandles(deps: TextScaleDeps): TextScaleHandles {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const ref = React.useRef<TextScaleHandles['ref'] extends React.MutableRefObject<infer S> ? S : never>(null)

  const onDown = (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent): void => {
    const d = depsRef.current
    if (!d.selectedLayer || !d.selectedTextDef || d.locked) return
    e.stopPropagation()
    const styles = (d.props.styles as Record<string, { gscale?: number; scale?: number }> | undefined)?.[d.selectedLayer]
    const base = typeof styles?.gscale === 'number' ? styles.gscale : 1
    const el = (d.hostRef.current?.querySelector(`[data-cover-layer="${d.selectedLayer}"]`) as HTMLElement | null) ?? null
    const rect = compositionRectIn(d.hostRef.current, d.playerWrapRef.current)
    if (!el || !rect) return
    const box = canvasBoxIn(el, rect, d.tpl.width)
    const ax = corner === 'nw' || corner === 'sw' ? box.left + box.w : box.left
    const ay = corner === 'nw' || corner === 'ne' ? box.top + box.h : box.top
    const scale = Math.max(rect.width / d.tpl.width, 0.05)
    const fontScale = typeof styles?.scale === 'number' ? styles.scale : 1
    ref.current = {
      id: d.selectedLayer, base,
      startDist: Math.max(8, Math.hypot((e.clientX - rect.left) / scale - ax, (e.clientY - rect.top) / scale - ay)),
      ax, ay, el, baseTransform: el.style.transform, lastTotal: base,
      defPx: Math.round((d.selectedTextDef.fontSize ?? 24) * fontScale),
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
    const total = Math.min(3, Math.max(0.3, r.base * (distNow / r.startDist)))
    r.lastTotal = total
    if (r.el) r.el.style.transform = `${r.baseTransform} scale(${total})` // 预览:props 零写入
    liveLayer.scaleId = r.id
    liveLayer.scalePx = Math.max(4, Math.round(r.defPx * total))
    notifyLiveLayer()
    d.readout(e.clientX + 14, e.clientY + 14, `${Math.round(total * 100)} %`) // 几何缩放读数=百分比
  }
  const onUp = (e: React.PointerEvent): void => {
    const d = depsRef.current
    const r = ref.current
    ref.current = null
    liveLayer.scaleId = null
    notifyLiveLayer()
    d.hideReadout()
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (!r || !r.el) return
    if (Math.abs(r.lastTotal - r.base) < 0.001) { r.el.style.transform = r.baseTransform; return } // 未变:还原预览
    r.el.style.transform = '' // 提交后由 React 重渲写入新变换(手动清防外改残留)
    d.setLayerStyle(r.id, { gscale: Math.round(r.lastTotal * 1000) / 1000 })
  }
  return { ref, onDown, onMove, onUp }
}
