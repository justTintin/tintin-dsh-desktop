// 画布几何:合成盒(Player 内按模板比例缩放的画布容器)↔ 画布 px。App 的拖动/对齐/手柄与属性卡共用。
export interface CanvasBox { left: number; top: number; w: number; h: number }

/** 合成根屏幕矩形共享单例(R11c): edit-canvas 每次取坐标系时回写,属性面板据此把
 *  屏幕 rect 换算画布 px(W/H/X/Y 测量)——面板与画布分属两组件,走模块单例不走 props */
export const compRectRef: { current: DOMRect | null } = { current: null }

/** 活动画布根(2026-11-11 R18:画布节点打 data-tintin-cover-canvas;页面里若存在第二个
 *  画布树(旧模板残留/双挂载),取层一律优先活动画布——修「对齐只对齐了另一个画布」类问题) */
const canvasRoot = (): ParentNode =>
  (typeof document !== 'undefined' && document.querySelector('[data-tintin-cover-canvas]')) || document

/** 图层节点(模板与自定义层都打 data-cover-layer;优先活动画布内) */
export const layerEl = (id: string): HTMLElement | null => canvasRoot().querySelector(`[data-cover-layer="${id}"]`) as HTMLElement | null

/** 合成盒的屏幕矩形:取任一图层节点的定位父级;画布上一个图层都没有时退回 fallback */
export function compositionRectIn(root: ParentNode | null | undefined, fallback?: Element | null): DOMRect | null {
  const el = root?.querySelector('[data-cover-layer]') as HTMLElement | null | undefined
  if (el && el.offsetParent) return el.offsetParent.getBoundingClientRect()
  return fallback?.getBoundingClientRect() ?? null
}

/** 元素的视觉包围盒(含 translate/rotate/scale)→ 画布 px */
export function canvasBoxIn(el: Element, comp: DOMRect | null, tplWidth: number): CanvasBox {
  const scale = comp && comp.width > 0 ? comp.width / tplWidth : 1
  const r = el.getBoundingClientRect()
  return { left: (r.left - (comp?.left ?? 0)) / scale, top: (r.top - (comp?.top ?? 0)) / scale, w: r.width / scale, h: r.height / scale }
}
