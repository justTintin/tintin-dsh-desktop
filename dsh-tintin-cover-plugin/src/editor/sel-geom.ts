// sel-geom — 旋转感知选择框几何(2026-11-11 WP-A3,对齐 PhotoCraft Move 工具变换控件
// transform_controls.rs: 边框与手柄随图层旋转,手柄本身保持屏幕等尺寸)。
// 模型: 图层视觉盒 = 布局盒(offsetLeft/Top/W/H) ⊕ 自身 transform 2D 矩阵分解
// (translate/rotate/scale,transform-origin=中心)。选择框=旋转矩形 {cx,cy,w,h,deg}。
// 纯几何函数无 DOM 依赖,单测覆盖;frameOf 是唯一 DOM 触点(测量层)。
import type { CanvasBox } from './canvas-geom'

export interface Matrix2D { a: number; b: number; c: number; d: number; e: number; f: number }

/** 矩阵分解:deg=宽度边方向角(度);sx/sy=轴缩放模长(含翻转取模长);t=平移 */
export interface Decomp { deg: number; sx: number; sy: number; tx: number; ty: number }

/** 旋转选择框(cx,cy=视觉中心,画布 px;w,h=视觉宽高;deg=边框角度) */
export interface RotFrame { cx: number; cy: number; w: number; h: number; deg: number }

export type SelCorner = 'nw' | 'ne' | 'se' | 'sw'
export type SelEdge = 'n' | 'e' | 's' | 'w'

const r2 = (v: number): number => Math.round(v * 100) / 100 || 0 // ||0: 归一化 -0(90° 整倍数浮点)

/** 解析 computedStyle.transform 的 matrix(a,b,c,d,e,f);none/不支持(matrix3d)→ null */
export function parseMatrix(transform: string | null | undefined): Matrix2D | null {
  if (!transform || transform === 'none') return null
  const m = /^matrix\(([-0-9.eE,\s]+)\)$/.exec(transform.trim())
  if (!m) return null
  const parts = m[1]!.split(',').map((v) => Number(v.trim()))
  if (parts.length !== 6 || parts.some((v) => !Number.isFinite(v))) return null
  return { a: parts[0]!, b: parts[1]!, c: parts[2]!, d: parts[3]!, e: parts[4]!, f: parts[5]! }
}

export function decompose(m: Matrix2D | null): Decomp {
  if (!m) return { deg: 0, sx: 1, sy: 1, tx: 0, ty: 0 }
  return {
    deg: Math.atan2(m.b, m.a) * 180 / Math.PI,
    sx: Math.hypot(m.a, m.b),
    sy: Math.hypot(m.c, m.d),
    tx: m.e,
    ty: m.f,
  }
}

/** 由布局盒 + 分解结果合成旋转框。视觉中心 = 布局中心 + 平移(变换原点=中心,旋转/缩放不动中心);
 *  视觉宽高 = 布局宽高 × 轴缩放模长。 */
export function frameFromLayout(layout: { left: number; top: number; w: number; h: number }, d: Decomp): RotFrame {
  return {
    cx: layout.left + layout.w / 2 + d.tx,
    cy: layout.top + layout.h / 2 + d.ty,
    w: layout.w * d.sx,
    h: layout.h * d.sy,
    deg: d.deg,
  }
}

/** 四个旋转角点(画布 px)。R6(2026-11-11 §6.4): 标签=内容角附着(PhotoCraft 语义)——
 *  nw 恒= C−(w/2)u−(h/2)v,随层旋转走,不做视觉方位标注(视觉标注在 ±90° 整倍数
 *  出现 x+y 平局,手柄会在相邻角之间跳;内容角附着无平局,且 deg=0 时两者重合)。
 *  翻转不改盒几何,角点与翻转无关。 */
export function rotCorners(f: RotFrame): Array<{ corner: SelCorner; x: number; y: number }> {
  const rad = f.deg * Math.PI / 180
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const vx = -uy
  const vy = ux
  const hw = f.w / 2
  const hh = f.h / 2
  return ([
    ['nw', -1, -1],
    ['ne', 1, -1],
    ['sw', -1, 1],
    ['se', 1, 1],
  ] as const).map(([corner, su, sv]) => ({
    corner,
    x: r2(f.cx + su * hw * ux + sv * hh * vx),
    y: r2(f.cy + su * hw * uy + sv * hh * vy),
  }))
}

/** 上/下/左/右 边中点(画布 px);n=视觉上侧(y 更小,x 破平局),w=视觉左侧(x 更小,y 破平局) */
export function rotEdges(f: RotFrame): Record<SelEdge, { x: number; y: number }> {
  const rad = f.deg * Math.PI / 180
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const vx = -uy
  const vy = ux
  const a = { x: f.cx - hh(f) * vx, y: f.cy - hh(f) * vy }
  const b = { x: f.cx + hh(f) * vx, y: f.cy + hh(f) * vy }
  const [top, bottom] = a.y !== b.y ? (a.y < b.y ? [a, b] : [b, a]) : a.x < b.x ? [a, b] : [b, a]
  const c = { x: f.cx - hw(f) * ux, y: f.cy - hw(f) * uy }
  const d = { x: f.cx + hw(f) * ux, y: f.cy + hw(f) * uy }
  const [left, right] = c.x !== d.x ? (c.x < d.x ? [c, d] : [d, c]) : c.y < d.y ? [c, d] : [d, c]
  return {
    n: { x: r2(top.x), y: r2(top.y) },
    s: { x: r2(bottom.x), y: r2(bottom.y) },
    w: { x: r2(left.x), y: r2(left.y) },
    e: { x: r2(right.x), y: r2(right.y) },
  }
}
const hh = (f: RotFrame): number => f.h / 2
const hw = (f: RotFrame): number => f.w / 2

/** 旋转柄位置: 视觉"上"边中点沿外侧法线再抬升 liftPx(画布 px)。
 *  外侧=朝屏幕上方(法线 y 分量<0);法线恰好水平(±90°,浮点近零按 0 处理)时取 x 更小的左侧。 */
export function rotateHandlePos(f: RotFrame, liftPx: number): { x: number; y: number } {
  const rad = f.deg * Math.PI / 180
  const vx = -Math.sin(rad)
  const vy = Math.cos(rad)
  const eps = 1e-9
  const sign = Math.abs(vy) < eps ? (vx < 0 ? 1 : -1) : vy < 0 ? 1 : -1
  const mid = { x: f.cx + sign * hh(f) * vx, y: f.cy + sign * hh(f) * vy }
  return { x: r2(mid.x + sign * vx * liftPx), y: r2(mid.y + sign * vy * liftPx) }
}

/** 手柄光标: 按手柄相对图层中心的方位角 8 向取整映射(旋转后 CSS 光标无法连续旋转,
 *  以 45° 桶近似 PhotoCraft 的方位光标)。cornerAngleDeg 为该柄相对中心的方位角。 */
export function cursorFor(angleDeg: number): string {
  const bucket = ((Math.round((angleDeg % 360 + 360) % 360 / 45) * 45) % 360 + 360) % 360
  switch (bucket) {
    case 0: case 180: return 'ew-resize'
    case 90: case 270: return 'ns-resize'
    case 45: case 225: return 'nwse-resize'
    default: return 'nesw-resize' // 135 / 315
  }
}

/** 手柄方位角(相对图层中心,画布 px 坐标系 y 向下) */
export function angleOf(point: { x: number; y: number }, center: { x: number; y: number }): number {
  return Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI
}

/** 元素 → 旋转框(DOM 测量层;offsetParent 须为合成根,compositionRectIn 同源)。
 *  返回 frame 与分解结果(缩放手柄需要轴缩放语义);不可测(未挂载/3d 矩阵)→ null。 */
export function frameOf(
  el: Element,
  comp: DOMRect | null,
  tplWidth: number,
): { frame: RotFrame; d: Decomp; layout: CanvasBox } | null {
  if (!(el instanceof HTMLElement) || !comp || comp.width <= 0) return null
  const cs = window.getComputedStyle(el)
  const m = parseMatrix(cs.transform)
  if (cs.transform && cs.transform !== 'none' && !m) return null // matrix3d 等不支持形态
  const d = decompose(m)
  const layout = { left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
  const frame = frameFromLayout(layout, d)
  return { frame, d, layout }
}

/** 画布 px → 屏幕 px(合成根屏幕映射 + 换算比例;overlay 定位统一走这里) */
export function toScreen(p: { x: number; y: number }, comp: { left: number; top: number; width: number }, tplWidth: number): { x: number; y: number } {
  const scale = comp.width / tplWidth
  return { x: comp.left + p.x * scale, y: comp.top + p.y * scale }
}
