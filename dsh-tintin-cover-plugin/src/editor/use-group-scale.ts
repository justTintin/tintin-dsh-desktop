// use-group-scale — 多选组缩放手柄钩子(2026-11-11 §6.5 R9c,自 edit-canvas 提取付账)。
// 对照 PS Free Transform 多选: 选区包围盒角柄拖拽=以选区中心为不动点整体缩放。
// 预览-提交分离: 自定义层 DOM 几何精确预览(与提交同一数学);固定层位置平移精确、
// 尺寸缩放提交时生效(gscale/sx·sy 折入模板变换,预览近似)。提交走 applyGroupScale
// (一次 set,一条撤销)。
import React from 'react'
import { groupScaleEntries, type GroupScaleMember } from './image-ops'
import { canvasBoxIn, type CanvasBox } from './canvas-geom'

export interface GroupScaleDeps {
  multiUnion: { x: number; y: number; w: number; h: number } | null
  selectedLayer: string | null
  multiSelected: string[]
  locked: boolean
  tplWidth: number
  hostRef: React.RefObject<HTMLDivElement | null>
  compositionRect: () => DOMRect | null
  props: Record<string, unknown>
  applyGroupScale: (entries: Array<{ id: string; custom: boolean; x: number; y: number; width?: number; height?: number | null; gscale?: number; sx?: number; sy?: number }>) => void
}

export interface GroupScaleHandles {
  ref: React.MutableRefObject<{
    corner: 'nw' | 'ne' | 'sw' | 'se'
    union0: { x: number; y: number; w: number; h: number }
    startDist: number
    f: number
    members: GroupScaleMember[]
    els: Map<string, HTMLElement>
    base: Map<string, { translate: string; left: string; top: string; width: string; height: string }>
    lastEntries: ReturnType<typeof groupScaleEntries> | null
  } | null>
  onDown: (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}

/** 收集全部选中层的组缩放成员数据(DOM 盒+几何现状) */
function collectMembers(deps: GroupScaleDeps): GroupScaleMember[] {
  const ids = [...new Set([deps.selectedLayer, ...deps.multiSelected])].filter((v): v is string => Boolean(v))
  const comp = deps.compositionRect()
  if (!comp || comp.width <= 0) return []
  const out: GroupScaleMember[] = []
  for (const id of ids) {
    const el = deps.hostRef.current?.querySelector(`[data-cover-layer="${id}"]`)
    if (!(el instanceof HTMLElement)) continue
    const box = canvasBoxIn(el, comp, deps.tplWidth)
    if (id.startsWith('img-')) {
      const layer = (Array.isArray(deps.props.customLayers) ? (deps.props.customLayers as Array<{ id: string; x: number; y: number; width: number; height?: number }>) : []).find((l) => l.id === id)
      if (!layer) continue
      out.push({ id, custom: true, box, layout: { x: layer.x, y: layer.y, w: layer.width, h: layer.height ?? null } })
    } else {
      const look = (deps.props.styles as Record<string, { dx?: number; dy?: number; gscale?: number; sx?: number; sy?: number }> | undefined)?.[id] ?? {}
      const isSlot = id === 'product'
      out.push({ id, custom: false, box, dx: look.dx ?? 0, dy: look.dy ?? 0, gscale: look.gscale, sx: isSlot ? (look.sx ?? 1) : undefined, sy: isSlot ? (look.sy ?? 1) : undefined })
    }
  }
  return out
}

export function useGroupScale(deps: GroupScaleDeps): GroupScaleHandles {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const ref = React.useRef<GroupScaleHandles['ref'] extends React.MutableRefObject<infer S> ? S : never>(null)

  const onDown = (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent): void => {
    const d = depsRef.current
    if (!d.multiUnion || d.locked) return
    e.stopPropagation()
    const members = collectMembers(d)
    if (members.length < 2) return
    const u = d.multiUnion
    const scale = Math.max(d.compositionRect()?.width ?? 0 / d.tplWidth, 0.05)
    const qx = corner === 'nw' || corner === 'sw' ? u.x + u.w : u.x
    const qy = corner === 'nw' || corner === 'ne' ? u.y + u.h : u.y
    const px = (e.clientX - (d.compositionRect()?.left ?? 0)) / scale
    const py = (e.clientY - (d.compositionRect()?.top ?? 0)) / scale
    const els = new Map<string, HTMLElement>()
    const base = new Map<string, { translate: string; left: string; top: string; width: string; height: string }>()
    for (const m of members) {
      const el = d.hostRef.current?.querySelector(`[data-cover-layer="${m.id}"]`)
      if (el instanceof HTMLElement) {
        els.set(m.id, el)
        base.set(m.id, { translate: el.style.translate, left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height })
      }
    }
    ref.current = {
      corner, union0: { ...u },
      startDist: Math.max(8, Math.hypot(px - qx, py - qy)),
      f: 1, members, els, base, lastEntries: null,
    }
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 同画布守卫 */ }
  }

  const onMove = (e: React.PointerEvent): void => {
    const r = ref.current
    const d = depsRef.current
    if (!r) return
    const comp = d.compositionRect()
    if (!comp) return
    const scale = Math.max(comp.width / d.tplWidth, 0.05)
    const u = r.union0
    const qx = r.corner === 'nw' || r.corner === 'sw' ? u.x + u.w : u.x
    const qy = r.corner === 'nw' || r.corner === 'ne' ? u.y + u.h : u.y
    const px = (e.clientX - comp.left) / scale
    const py = (e.clientY - comp.top) / scale
    r.f = Math.max(8, Math.hypot(px - qx, py - qy)) / r.startDist
    const unionCenter = { cx: u.x + u.w / 2, cy: u.y + u.h / 2 }
    const entries = groupScaleEntries(unionCenter, r.members, r.f)
    r.lastEntries = entries
    for (const entry of entries) {
      const el = r.els.get(entry.id)
      if (!el) continue
      if (entry.custom) {
        if (entry.width !== undefined) el.style.width = `${entry.width}px`
        if (entry.height !== undefined && entry.height !== null) el.style.height = `${entry.height}px`
        el.style.left = `${entry.x}px`
        el.style.top = `${entry.y}px`
      } else {
        const orig = r.members.find((m) => m.id === entry.id)
        el.style.translate = `${entry.x - (orig?.dx ?? 0)}px ${entry.y - (orig?.dy ?? 0)}px`
      }
    }
  }

  const onUp = (e: React.PointerEvent): void => {
    const r = ref.current
    ref.current = null
    try { (e.target as HTMLElement).releasePointerCapture?.(e.pointerId) } catch { /* 合成指针/已释放:同 setPointerCapture 守卫 */ }
    if (!r) return
    // 还原全部 DOM 预览(提交后 React 重渲写入真值;手动清防外改残留)
    for (const [id, el] of r.els) {
      const b = r.base.get(id)
      if (!b) continue
      el.style.translate = b.translate
      el.style.left = b.left
      el.style.top = b.top
      el.style.width = b.width
      el.style.height = b.height
    }
    if (!r.lastEntries || r.f === 1) return
    d_apply(r.lastEntries, depsRef.current)
  }

  return { ref, onDown, onMove, onUp }
}

function d_apply(entries: ReturnType<typeof groupScaleEntries>, d: GroupScaleDeps): void {
  d.applyGroupScale(entries)
}
