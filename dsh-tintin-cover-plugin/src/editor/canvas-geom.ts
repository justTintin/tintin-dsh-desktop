// 画布几何(路线 v2 步骤3 统一测量入口;设计=docs/cover-editor-optimization.md §7.27):
// CanvasFrame 外部存储=唯一测量真源——画布单写者 publish(每渲染/滚动/缩放),面板
// useSyncExternalStore 订阅或动作类 canvasFrameNow() 现场量。取代旧 compRectRef 裸
// 单例+全局 querySelector(双挂载事故面);五处重复 scale=comp.width/tpl.width 归一为
// frame.scale。画布与面板分属两棵 React 树,跨树共享走模块级外部存储(React 形态的
// PhotoCraft ViewXform::active)。
import { useSyncExternalStore } from 'react'

export interface CanvasBox { left: number; top: number; w: number; h: number }

export interface CanvasFrame {
  /** 合成根屏幕矩形 */
  rect: DOMRect
  /** 每模板 px 的屏幕 px(唯一 scale 换算源) */
  scale: number
  tplW: number
  tplH: number
  /** 活动画布内容根(layerEl 查询域;防双挂载) */
  root: ParentNode
}

let frame: CanvasFrame | null = null
const listeners = new Set<() => void>()

/** 画布写 frame(唯一写者=CanvasPanel;rect 未变不通知,防滚动/渲染风暴) */
export function publishCanvasFrame(next: CanvasFrame | null): void {
  const cur = frame
  if (cur === null && next === null) return
  if (cur !== null && next !== null && cur.rect.left === next.rect.left && cur.rect.top === next.rect.top
    && cur.rect.width === next.rect.width && cur.rect.height === next.rect.height && cur.root === next.root) return
  frame = next
  for (const l of listeners) l()
}

/** 面板订阅(随 frame 变化重渲重测) */
export function useCanvasFrame(): CanvasFrame | null {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange) },
    () => frame,
    () => frame,
  )
}

/** 动作类现场量(点击/提交时刻取现值,不吃订阅快照——面板「点了没反应」教训口径) */
export function canvasFrameNow(): CanvasFrame | null {
  return frame
}

/** 图层节点(模板与自定义层都打 data-cover-layer;优先活动画布内容根) */
export const layerEl = (id: string, root?: ParentNode | null): HTMLElement | null => {
  const scope = root ?? frame?.root ?? (typeof document !== 'undefined' ? document : null)
  return (scope?.querySelector(`[data-cover-layer="${id}"]`) as HTMLElement | null) ?? null
}

/** 合成根屏幕矩形:取任一图层节点的定位父级;画布上一个图层都没有时退回 fallback */
export function compositionRectIn(root: ParentNode | null | undefined, fallback?: Element | null): DOMRect | null {
  const el = root?.querySelector('[data-cover-layer]') as HTMLElement | null | undefined
  if (el && el.offsetParent) return el.offsetParent.getBoundingClientRect()
  return fallback?.getBoundingClientRect() ?? null
}

/** 元素的视觉包围盒(含 translate/rotate/scale)→ 画布 px(唯一 scale 换算入口) */
export function boxInFrame(el: Element, f: CanvasFrame | null): CanvasBox | null {
  if (!f || f.rect.width <= 0) return null
  const r = el.getBoundingClientRect()
  return { left: (r.left - f.rect.left) / f.scale, top: (r.top - f.rect.top) / f.scale, w: r.width / f.scale, h: r.height / f.scale }
}
