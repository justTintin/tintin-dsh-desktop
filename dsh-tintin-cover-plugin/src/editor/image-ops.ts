// 图片图层操作的纯逻辑(2026-11-01 对齐 PhotoCraft:编辑›变换的翻转/旋转 90°·180°、
// 图层›排列、属性面板变换区 W/H 链接)。无 React/DOM 依赖,单测直接覆盖。
import type { CustomLayer } from '../../templates/CustomLayers'
import { SCALE_MAX, SCALE_MIN, type ImageLook } from '../../templates/image-style'

export type Arrange = 'front' | 'forward' | 'backward' | 'back'

/** 图层›排列(PhotoCraft layer.arrange.*):order 自底向上;front/back=置顶/置底,forward/backward=上移/下移一层 */
export function arrangeOrder(order: readonly string[], id: string, how: Arrange): string[] {
  const i = order.indexOf(id)
  if (i < 0) return [...order]
  const rest = order.filter((v) => v !== id)
  const at = how === 'front' ? rest.length : how === 'back' ? 0 : how === 'forward' ? Math.min(rest.length, i + 1) : Math.max(0, i - 1)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

const norm180 = (deg: number): number => {
  const d = ((deg % 360) + 540) % 360 - 180
  return d === -180 ? 180 : d
}

/** 编辑›变换›水平/垂直翻转:画布方向镜像(与 PhotoCraft 同语义——旋转过的图翻转后角度取反,
 *  翻转后屏幕上的方向与原来相对画布镜像,而非沿图片自身轴) */
export function flipPatch(look: ImageLook | undefined, axis: 'x' | 'y'): ImageLook {
  const rotate = norm180(-(look?.rotate ?? 0))
  return axis === 'x' ? { flipX: !look?.flipX, rotate } : { flipY: !look?.flipY, rotate }
}

/** 编辑›变换›旋转 180°/顺时针 90°/逆时针 90° */
export function rotatePatch(look: ImageLook | undefined, delta: 90 | -90 | 180): ImageLook {
  return { rotate: norm180((look?.rotate ?? 0) + delta) }
}

/** 属性面板 W/H 输入(PhotoCraft「链接宽度和高度」):链接时改一边按纵横比带动另一边 */
export function resizeWH(cur: { w: number; h: number }, edit: { w?: number; h?: number }, linked: boolean, min = 1, max = 8000): { w: number; h: number } {
  const clamp = (v: number): number => Math.min(max, Math.max(min, Math.round(v)))
  const ratio = cur.h > 0 ? cur.w / cur.h : 1
  if (edit.w !== undefined) {
    const w = clamp(edit.w)
    return { w, h: linked ? clamp(w / ratio) : cur.h }
  }
  if (edit.h !== undefined) {
    const h = clamp(edit.h)
    return { w: linked ? clamp(h * ratio) : cur.w, h }
  }
  return { w: clamp(cur.w), h: clamp(cur.h) }
}

/** 产品图槽位的缩放倍率夹取(与模板 lookScale 同界) */
export const clampScale = (v: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(v * 1000) / 1000))

/** 整层复制(PhotoCraft 复制图层):全部属性照搬、新 id;锁定不随副本(副本要能直接拖走) */
export function cloneLayer(layer: CustomLayer, id: string, offset = 0): CustomLayer {
  const { locked: _locked, ...rest } = layer
  return { ...rest, id, x: Math.round(layer.x + offset), y: Math.round(layer.y + offset) }
}

/** 锁定位置判定:自由图层看 customLayers[i].locked,模板槽位看 styles[id].locked */
export function lockedOf(props: Record<string, unknown>, id: string | null | undefined): boolean {
  if (!id) return false
  if (id.startsWith('img-')) {
    const layers = Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id?: string; locked?: unknown } | null>) : []
    return layers.find((l) => l?.id === id)?.locked === true
  }
  return (props.styles as Record<string, { locked?: unknown } | undefined> | undefined)?.[id]?.locked === true
}

/** 旋转层中心锚缩放(2026-11-11 WP-A3 对齐 PhotoCraft 旋转态: |deg|>0.5 的自由层以视觉
 *  中心为锚等比缩放——本地几何改 w/h,布局中心平移补偿,视觉中心不动;未旋转层走
 *  cornerResize 对角锚。f=缩放比;hVis=当前视觉高(box.h,未显式高时视觉高=hVis·f)。 */
export function centerResize(
  cur: { x: number; y: number; w: number; h: number | null },
  f: number,
  hVis: number,
  min = 20,
): { x: number; y: number; width: number; height: number | null } {
  const cx = cur.x + cur.w / 2
  const cy = cur.y + hVis / 2
  const width = Math.max(min, Math.round(cur.w * f))
  const height = cur.h === null ? null : Math.max(min, Math.round(cur.h * f))
  const hNew = Math.max(min, Math.round(hVis * f))
  return {
    x: Math.round(cx - width / 2),
    y: Math.round(cy - (height ?? hNew) / 2),
    width,
    height,
  }
}

/** 边柄单维缩放(PhotoCraft 8 柄的边柄,2026-11-11 WP-A3;仅未旋转自由层):
 *  side=w/e 改宽(对面边为锚),side=n/s 改高(需显式高度)。 */
export function edgeResize(
  box: { left: number; top: number; w: number; h: number },
  side: 'w' | 'e' | 'n' | 's',
  pointer: { x: number; y: number },
  min = 20,
): { x?: number; y?: number; width?: number; height?: number } {
  if (side === 'w') {
    const width = Math.max(min, Math.round(box.left + box.w - pointer.x))
    return { x: Math.round(box.left + box.w - width), width }
  }
  if (side === 'e') return { width: Math.max(min, Math.round(pointer.x - box.left)) }
  if (side === 'n') {
    const height = Math.max(min, Math.round(box.top + box.h - pointer.y))
    return { y: Math.round(box.top + box.h - height), height }
  }
  return { height: Math.max(min, Math.round(pointer.y - box.top)) }
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** 四角缩放(PhotoCraft Free Transform 角柄语义,2026-11-02 用户裁决「对齐 PhotoCraft」):
 *  对角为不动锚,拖拽距离比例驱动等比缩放;显式高度同比,未显式高则只提交宽(高随原图比例)。
 *  box=起始视觉包围盒(画布 px);dist/startDist=指针到锚的当前/起始距离;h 为 null=随比例。
 *  旋转/翻转层的视觉框为 AABB,缩放按 AABB 近似(与对齐/微调同一口径)。 */
export function cornerResize(
  box: { left: number; top: number; w: number; h: number },
  corner: Corner,
  dist: number,
  startDist: number,
  cur: { x: number; y: number; w: number; h: number | null },
  min = 20,
): { x: number; y: number; width: number; height: number | null } {
  const anchorX = corner === 'nw' || corner === 'sw' ? box.left + box.w : box.left
  const anchorY = corner === 'nw' || corner === 'ne' ? box.top + box.h : box.top
  const f = Math.max(8, dist) / Math.max(8, startDist)
  const width = Math.max(min, Math.round(cur.w * f))
  const height = cur.h === null ? null : Math.max(min, Math.round(cur.h * f))
  const hVis = Math.round(box.h * f)
  return {
    x: Math.round(anchorX + (corner === 'nw' || corner === 'sw' ? -width : 0)),
    y: Math.round(anchorY + (corner === 'nw' || corner === 'ne' ? -(height ?? hVis) : 0)),
    width,
    height,
  }
}
