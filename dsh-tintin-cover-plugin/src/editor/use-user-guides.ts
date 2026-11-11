// use-user-guides — 用户参考线拖拽钩子(2026-11-11 §6.5 R9b,自 edit-canvas 提取付账:
// 千行门禁)。对照 PS: 标尺拖出建线,画布内拖动移线,拖回标尺/画布外删线。
// 2026-11-11 用户裁决: 线命中带(7px)可抓——拖回标尺/拖出画布=删除,双击=删除(edit-canvas
// 直接调 removeUserGuide),原位点选=选中(Delete 键删除,见 canvas-keys)。
// 拖拽态=ref(零重渲染),预览线 ref 直写;提交走 store(建/移/删各一条撤销);
// move 模式抓线时隐藏真实线(直写 DOM,落位/取消还原),store 才提交=单条撤销。
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
  moveUserGuide: (axis: 'h' | 'v', from: number, to: number) => void
  removeUserGuide: (axis: 'h' | 'v', pos: number) => void
  setSelectedGuide: (g: { axis: 'h' | 'v'; pos: number } | null) => void
}

export interface UserGuidesHook {
  guideDragRef: React.MutableRefObject<{ axis: 'h' | 'v'; mode: 'create' | 'move'; index: number; value: number } | null>
  previewHRef: React.RefObject<HTMLDivElement>
  previewVRef: React.RefObject<HTMLDivElement>
  startGuideDrag: (axis: 'h' | 'v', e: React.PointerEvent) => void
  moveGuidePreview: (e: React.PointerEvent) => void
  finishGuideDrag: (e: React.PointerEvent) => void
  /** 拖拽被系统打断(pointer cancel):预览消失、被抓线还原,props 零写入 */
  cancelGuideDrag: () => void
}

export function useUserGuides(deps: UserGuidesDeps): UserGuidesHook {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const guideDragRef = React.useRef<{ axis: 'h' | 'v'; mode: 'create' | 'move'; index: number; value: number } | null>(null)
  const previewHRef = React.useRef<HTMLDivElement>(null)
  const previewVRef = React.useRef<HTMLDivElement>(null)
  /* move 模式抓线时被藏起的真实线(移线中只显示预览线;React 树不动,落位/取消还原) */
  const grabbedRef = React.useRef<Element | null>(null)

  const showPreview = (axis: 'h' | 'v', pos: number): void => {
    const d = depsRef.current
    const pv = axis === 'h' ? previewHRef.current : previewVRef.current
    if (!pv) return
    pv.style.display = 'block'
    if (axis === 'h') pv.style.top = `${(pos / d.tpl.height) * 100}%`
    else pv.style.left = `${(pos / d.tpl.width) * 100}%`
  }

  const restoreGrabbed = (): void => {
    const line = grabbedRef.current
    grabbedRef.current = null
    if (line) (line as HTMLElement).style.display = ''
  }

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
    guideDragRef.current = { axis, mode: idx >= 0 ? 'move' : 'create', index: idx, value: idx >= 0 ? guides[idx]! : 0 }
    if (idx >= 0) {
      // 抓线:真实线隐藏(落位/取消时还原),预览线跟随指针;此处不写 store(移线=单条撤销)
      grabbedRef.current = (e.currentTarget as HTMLElement).querySelector('[data-guide-line]')
      if (grabbedRef.current) (grabbedRef.current as HTMLElement).style.display = 'none'
    }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 同画布守卫 */ }
    showPreview(axis, pos)
  }

  const moveGuidePreview = (e: React.PointerEvent): void => {
    const drag = guideDragRef.current
    const d = depsRef.current
    const content = d.contentRef.current
    if (!drag || !content) return
    const scale = Math.max(d.fitScale * d.zoom, 0.0001)
    const cr = content.getBoundingClientRect()
    const pos = drag.axis === 'h' ? (e.clientY - cr.top) / scale : (e.clientX - cr.left) / scale
    showPreview(drag.axis, pos)
  }

  const finishGuideDrag = (e: React.PointerEvent): void => {
    const drag = guideDragRef.current
    guideDragRef.current = null
    if (!drag) return
    const d = depsRef.current
    const pv = drag.axis === 'h' ? previewHRef.current : previewVRef.current
    if (pv) pv.style.display = 'none'
    restoreGrabbed()
    const content = d.contentRef.current
    if (!content) return
    const scale = Math.max(d.fitScale * d.zoom, 0.0001)
    const cr = content.getBoundingClientRect()
    const pos = Math.round(drag.axis === 'h' ? (e.clientY - cr.top) / scale : (e.clientX - cr.left) / scale)
    const limit = drag.axis === 'h' ? d.tpl.height : d.tpl.width
    if (drag.mode === 'move') {
      // 拖回标尺/拖出画布=删除;原位松手=点选(Delete 键删除);否则移动(单条撤销)
      if (pos < 0 || pos > limit) { d.removeUserGuide(drag.axis, drag.value); return }
      if (pos === drag.value) { d.setSelectedGuide({ axis: drag.axis, pos: drag.value }); return }
      d.moveUserGuide(drag.axis, drag.value, pos)
      return
    }
    if (pos < -8 || pos > limit + 8) return // 拖出画布=取消(不建线)
    d.addUserGuide(drag.axis, pos)
  }

  const cancelGuideDrag = (): void => {
    guideDragRef.current = null
    if (previewHRef.current) previewHRef.current.style.display = 'none'
    if (previewVRef.current) previewVRef.current.style.display = 'none'
    restoreGrabbed()
  }

  return { guideDragRef, previewHRef, previewVRef, startGuideDrag, moveGuidePreview, finishGuideDrag, cancelGuideDrag }
}
