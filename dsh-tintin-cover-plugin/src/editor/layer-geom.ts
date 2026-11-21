// layer-geom — 统一几何操作(路线 v2 步骤3+4;设计真源=docs/cover-editor-optimization.md §7.27)。
// PhotoCraft shift_shown 口径:两种存储表示(custom=x/y 画布绝对 vs fixed=dx/dy 槽位偏移)
// 不合并,操作单入口——每个操作=纯函数,输出 GeomEntry,由 store.applyGeom 一次 set
// 提交(一条撤销)。几何字段(x/y/dx/dy/width/height/gscale/sx/sy)此后只许经 applyGeom 进 store。
// 统一读口(真源实证):三种 kind 的 data-cover-layer 元素矩形即视觉 AABB——text 元素自带
// translate→rotate→scale(gscale) 链(rect 反映 gscale);product 槽位元素自带 scale(sx·flip)
// (rect 反映 sx/sy);custom 反映 width/x。旋转层按 AABB 近似(与对齐/微调同一既有口径);
// 手柄仅未旋转层启用(§7.27 v1 边界)。
import { clampScale } from './image-ops'

export type LayerKind = 'custom' | 'slot' | 'text'

export interface GeomBox { left: number; top: number; w: number; h: number }

/** 统一几何提交条目(store.applyGeom 输入):undefined=保留现值。
 *  custom:x/y=画布绝对,width/height=布局尺寸(height 缺省=不钉死随纵横比);
 *  fixed(slot/text):x/y→styles.dx/dy(槽位原位偏移),gscale(文字)/sx,sy(槽位)。 */
export interface GeomEntry {
  id: string
  custom: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  gscale?: number
  sx?: number
  sy?: number
}

// —— 手柄单表(命中/光标/锚同源;PhotoCraft Hit 分类器的 DOM 形态) ——
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Handle = typeof HANDLES[number]
/** 手柄命中/视觉尺寸(屏幕 px;PhotoCraft box_hit HANDLE_PX 同值,缩放无关) */
export const HANDLE_PX = 12

export function handleCursor(h: Handle): string {
  if (h === 'nw' || h === 'se') return 'nwse-resize'
  if (h === 'ne' || h === 'sw') return 'nesw-resize'
  return h === 'n' || h === 's' ? 'ns-resize' : 'ew-resize'
}

/** 会话锚=对侧角/边中点(画布 px):拖 nw 锚 se 角,拖 e 锚 w 边中点(PhotoCraft 对侧锚) */
export function handleAnchor(box: GeomBox, h: Handle): { x: number; y: number } {
  const midX = box.left + box.w / 2
  const midY = box.top + box.h / 2
  switch (h) {
    case 'nw': return { x: box.left + box.w, y: box.top + box.h }
    case 'ne': return { x: box.left, y: box.top + box.h }
    case 'sw': return { x: box.left + box.w, y: box.top }
    case 'se': return { x: box.left, y: box.top }
    case 'e': return { x: box.left, y: midY }
    case 'w': return { x: box.left + box.w, y: midY }
    case 's': return { x: midX, y: box.top }
    case 'n': return { x: midX, y: box.top + box.h }
  }
}

/** 手柄自身在盒上的位置(画布 px;角=角点,边=边中点——选框绘制用) */
export function handlePoint(box: GeomBox, h: Handle): { x: number; y: number } {
  const midX = box.left + box.w / 2
  const midY = box.top + box.h / 2
  switch (h) {
    case 'nw': return { x: box.left, y: box.top }
    case 'n': return { x: midX, y: box.top }
    case 'ne': return { x: box.left + box.w, y: box.top }
    case 'e': return { x: box.left + box.w, y: midY }
    case 'se': return { x: box.left + box.w, y: box.top + box.h }
    case 's': return { x: midX, y: box.top + box.h }
    case 'sw': return { x: box.left, y: box.top + box.h }
    case 'w': return { x: box.left, y: midY }
  }
}

/** 角柄等比比:f=|P−anchor|/startDist(下限 8 屏蔽除零/抖动;git 历史 cornerResize 同式) */
export function cornerFactor(dist: number, startDist: number): number {
  return Math.max(8, dist) / Math.max(8, startDist)
}

/** 角柄新盒(对角锚等比):新盒=起始盒×f,对侧角不动(git 历史 cornerResize 的盒形态泛化) */
export function cornerResizeBox(box0: GeomBox, h: Handle, f: number, min = 20): GeomBox {
  const a = handleAnchor(box0, h)
  const w = Math.max(min, Math.round(box0.w * f))
  const hh = Math.max(min, Math.round(box0.h * f))
  const left = h === 'ne' || h === 'se' ? a.x : a.x - w
  const top = h === 'sw' || h === 'se' ? a.y : a.y - hh
  return { left, top, w, h: hh }
}

/** 边柄新盒(对边锚单轴;未旋转层精确——git 历史 rotatedEdgeResize 的 deg=0 语义,
 *  改指针绝对位驱动:e/s=锚正向侧量宽/高,w/n=负向侧)。另一轴不变。 */
export function edgeResizeBox(box0: GeomBox, h: Handle, pointer: { x: number; y: number }, min = 20): GeomBox {
  const a = handleAnchor(box0, h)
  switch (h) {
    case 'e': return { ...box0, w: Math.max(min, Math.round(pointer.x - a.x)) }
    case 'w': { const w = Math.max(min, Math.round(a.x - pointer.x)); return { ...box0, left: a.x - w, w } }
    case 's': return { ...box0, h: Math.max(min, Math.round(pointer.y - a.y)) }
    case 'n': { const hh = Math.max(min, Math.round(a.y - pointer.y)); return { ...box0, top: a.y - hh, h: hh } }
    default: return box0
  }
}

// —— 会话(纯数据;拖拽几何只存会话,文档零改动直到提交=一条命令一步历史) ——
export interface ResizeSession {
  id: string
  kind: LayerKind
  handle: Handle
  /** 对侧锚(画布 px) */
  anchor: { x: number; y: number }
  /** 起始视觉盒(画布 px) */
  box0: GeomBox
  /** 起始存储基值(提交换算用) */
  base: { x?: number; y?: number; width?: number; height?: number | null; dx?: number; dy?: number; gscale?: number; sx?: number; sy?: number }
  startDist: number
  pointerId: number
}

export function beginResize(
  id: string, kind: LayerKind, handle: Handle, box0: GeomBox,
  base: ResizeSession['base'], pointer0: { x: number; y: number }, pointerId: number,
): ResizeSession {
  const anchor = handleAnchor(box0, handle)
  return { id, kind, handle, anchor, box0, base, startDist: Math.max(8, Math.hypot(pointer0.x - anchor.x, pointer0.y - anchor.y)), pointerId }
}

/** 会话预览盒(角=等比对角锚;边=对边锚单轴) */
export function sessionPreviewBox(s: ResizeSession, pointer: { x: number; y: number }): GeomBox {
  if (s.handle.length === 2) return cornerResizeBox(s.box0, s.handle, cornerFactor(Math.hypot(pointer.x - s.anchor.x, pointer.y - s.anchor.y), s.startDist))
  return edgeResizeBox(s.box0, s.handle, pointer)
}

/** 会话预览 CSS(el.style.transformOrigin/scale;与提交同数学):
 *  原点=锚在元素本地位(g=盒宽/布局宽,布局 px=模板 px);scale 值=新盒/起始盒(槽位边柄=双值)。 */
export function sessionPreviewCss(s: ResizeSession, newBox: GeomBox, layoutW: number, layoutH: number): { origin: string; scale: string } {
  const gx = newBox.w > 0 && layoutW > 0 ? s.box0.w / layoutW : 1
  const gy = newBox.h > 0 && layoutH > 0 ? s.box0.h / layoutH : 1
  const ox = gx > 0 ? (s.anchor.x - s.box0.left) / gx : 0
  const oy = gy > 0 ? (s.anchor.y - s.box0.top) / gy : 0
  const fx = s.box0.w > 0 ? newBox.w / s.box0.w : 1
  const fy = s.box0.h > 0 ? newBox.h / s.box0.h : 1
  return { origin: `${ox}px ${oy}px`, scale: Math.abs(fx - fy) < 0.001 ? `${fx}` : `${fx} ${fy}` }
}

/** 提交换算:新视觉盒 → GeomEntry(按 kind 分派;单一出口)。
 *  中心缩放的自然位移补偿:dx'=dx0+(新左−旧左)+(新宽−旧宽)/2(translate 先于 scale 链)。 */
export function resizeEntry(s: ResizeSession, newBox: GeomBox): GeomEntry {
  if (s.kind === 'custom') {
    const e: GeomEntry = { id: s.id, custom: true, x: Math.round(newBox.left), y: Math.round(newBox.top), width: Math.max(20, Math.round(newBox.w)) }
    if (s.base.height !== undefined && s.base.height !== null) e.height = Math.max(20, Math.round(newBox.h))
    return e
  }
  const e: GeomEntry = { id: s.id, custom: false }
  const fx = s.box0.w > 0 ? newBox.w / s.box0.w : 1
  const fy = s.box0.h > 0 ? newBox.h / s.box0.h : 1
  if (s.kind === 'text') {
    // 文字=统一几何缩放(gscale;对照面板链接宽高同语义,角/边都取盒比)
    const g0 = s.base.gscale ?? 1
    e.gscale = Math.round(Math.min(3, Math.max(0.3, g0 * fx)) * 1000) / 1000
  } else {
    // 槽位=每轴独立(sx/sy);只写变化轴,不给默认值 硬造显式值
    if (Math.abs(fx - 1) > 0.0005) e.sx = clampScale((s.base.sx ?? 1) * fx)
    if (Math.abs(fy - 1) > 0.0005) e.sy = clampScale((s.base.sy ?? 1) * fy)
  }
  e.x = Math.round((s.base.dx ?? 0) + (newBox.left - s.box0.left) + (newBox.w - s.box0.w) / 2)
  e.y = Math.round((s.base.dy ?? 0) + (newBox.top - s.box0.top) + (newBox.h - s.box0.h) / 2)
  return e
}
