// use-user-guides — 用户参考线拖拽钩子(2026-11-11 §6.5 R9b,自 edit-canvas 提取付账:
// 千行门禁)。对照 PS: 标尺拖出建线,画布内拖动移线,拖回标尺/画布外删线。
// 拖拽态=ref(零重渲染),预览线 ref 直写;提交走 store(建/移各一条撤销)。
import React from 'react'
import type { TemplateDef } from '../registry'

export interface UserGuidesDeps {
  pcRunning: boolean | null
  purePreview: boolean
  fitScale: number
  zoom: number
  tpl: TemplateDef
  contentRef: React.RefObject<HTMLDivElement | null>
  userGuides: { h: number[]; v: number[] }
  addUserGuide: (axis: 'h' | 'v', pos: number) => void
  removeUserGuide: (axis: 'h' | 'v', pos: number) => void
}

export interface UserGuidesHook {
  guideDragRef: React.MutableRefObject<{ axis: 'h' | 'v'; mode: 'create' | 'move'; index: number } | null>
  previewHRef: React.RefObject<HTMLDivElement>
  previewVRef: React.RefObject<HTMLDivElement>
  startGuideDrag: (axis: 'h' | 'v', e: React.PointerEvent) => void
  moveGuidePreview: (e: React.PointerEvent) => void
  finishGuideDrag: (e: React.PointerEvent) => void
}

export function useUserGuides(deps: UserGuidesDeps): UserGuidesHook {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const guideDragRef = React.useRef<{ axis: 'h' | 'v'; mode: 'create' | 'move'; index: number } | null>(null)
  const previewHRef = React.useRef<HTMLDivElement>(null)
  const previewVRef = React.useRef<HTMLDivElement>(null)

  const startGuideDrag = (axis: 'h' | 'v', e: React.PointerEvent): void => {
    const d = depsRef.current
    if (d.pcRunning || d.purePreview) return
    e.stopPropagation()
    const scale = Math.max(d.fitScale * d.zoom, 0.0001)
    const content = d.contentRef.current
    if (!content) return
    const cr = content.getBoundingClientRect()
    const pos = axis === 'h' ? (e.clientY - cr.top) / scale : (e.clientX - cr.left) / scale
    /* 命中现有线(4 屏幕px)则移动,否则新建 */
    const guides = axis === 'h' ? d.userGuides.h : d.userGuides.v
    const idx = guides.findIndex((g) => Math.abs(g - pos) <= 4 / scale)
    guideDragRef.current = { axis, mode: idx >= 0 ? 'move' : 'create', index: idx }
    if (idx >= 0) {
      // 抓到现有线:从旧位拔起(删旧),预览跟随,松手落新位
      d.removeUserGuide(axis, guides[idx]!)
    }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 同画布守卫 */ }
    const pv = axis === 'h' ? previewHRef.current : previewVRef.current
    if (pv) {
      pv.style.display = 'block'
      if (axis === 'h') pv.style.top = `${(pos / d.tpl.height) * 100}%`
      else pv.style.left = `${(pos / d.tpl.width) * 100}%`
    }
  }

  const moveGuidePreview = (e: React.PointerEvent): void => {
    const drag = guideDragRef.current
    const d = depsRef.current
    const content = d.contentRef.current
    if (!drag || !content) return
    const scale = Math.max(d.fitScale * d.zoom, 0.0001)
    const cr = content.getBoundingClientRect()
    const pos = drag.axis === 'h' ? (e.clientY - cr.top) / scale : (e.clientX - cr.left) / scale
    const pv = drag.axis === 'h' ? previewHRef.current : previewVRef.current
    if (pv) {
      if (drag.axis === 'h') pv.style.top = `${(pos / d.tpl.height) * 100}%`
      else pv.style.left = `${(pos / d.tpl.width) * 100}%`
    }
  }

  const finishGuideDrag = (e: React.PointerEvent): void => {
    const drag = guideDragRef.current
    guideDragRef.current = null
    if (!drag) return
    const d = depsRef.current
    const pv = drag.axis === 'h' ? previewHRef.current : previewVRef.current
    if (pv) pv.style.display = 'none'
    const content = d.contentRef.current
    if (!content) return
    const scale = Math.max(d.fitScale * d.zoom, 0.0001)
    const cr = content.getBoundingClientRect()
    const pos = Math.round(drag.axis === 'h' ? (e.clientY - cr.top) / scale : (e.clientX - cr.left) / scale)
    const limit = drag.axis === 'h' ? d.tpl.height : d.tpl.width
    if (pos < -8 || pos > limit + 8) return // 拖出画布=删除(mode=move 时旧线已拔起)
    d.addUserGuide(drag.axis, pos)
  }

  return { guideDragRef, previewHRef, previewVRef, startGuideDrag, moveGuidePreview, finishGuideDrag }
}
