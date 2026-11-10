// canvas-aux — 画布指针辅助三件(2026-11-10 P2 批,自 CanvasPanel 提取付账):
// 悬停预亮(T3.6)/空格纯净预览(T3.9)/Alt+点击循环选层(T3.7)。live 信号走 ui.ts liveLayer。
import React from 'react'
import { liveLayer, notifyLiveLayer } from './ui'

export interface HoverDeps {
  hoverRef: React.RefObject<HTMLDivElement | null>
  hostRef: React.RefObject<HTMLDivElement | null>
  playerWrapRef: React.RefObject<HTMLDivElement | null>
  pcRunning: boolean | null
  purePreview: boolean
}

/** T3.6 悬停预亮(ref 直写零重渲染;隐藏=拖动/缩放/旋转进行中或 PhotoCraft/Space) */
export function updateHover(deps: HoverDeps, dragActive: boolean, clientX: number, clientY: number): void {
  const { hoverRef, hostRef, playerWrapRef, pcRunning, purePreview } = deps
  const hv = hoverRef.current
  if (!hv) return
  if (pcRunning || purePreview || dragActive || liveLayer.scaleId !== null) { hv.style.display = 'none'; return }
  const el = document.elementFromPoint(clientX, clientY)?.closest('[data-cover-layer]') as Element | null
  const pr = playerWrapRef.current?.getBoundingClientRect()
  if (!el || !pr || !hostRef.current?.contains(el)) { hv.style.display = 'none'; return }
  const r = el.getBoundingClientRect()
  hv.style.display = 'block'
  hv.style.left = `${r.left - pr.left - 2}px`
  hv.style.top = `${r.top - pr.top - 2}px`
  hv.style.width = `${r.width + 4}px`
  hv.style.height = `${r.height + 4}px`
}

/** T3.9 空格纯净预览: 按住 Space(非输入焦点)隐藏全部辅助件;返回卸载清理 */
export function usePurePreview(onChange: (v: boolean) => void): void {
  const ref = React.useRef(onChange)
  ref.current = onChange
  React.useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !e.repeat && !isTyping(e.target)) { e.preventDefault(); ref.current(true) }
    }
    const up = (e: KeyboardEvent): void => { if (e.code === 'Space') ref.current(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])
}

/** T3.7 Alt+点击循环选层: 命中点的重叠图层栈里切到下一个(与 Alt+拖复制互不干扰);
 *  返回是否发生切换(栈不足两个=无操作)。 */
export function cycleLayerSelection(
  stack: string[],
  hiddenLayers: string[],
  selectedLayer: string | null,
  select: (id: string) => void,
): boolean {
  const ids = stack.filter((id, i, arr) => id && arr.indexOf(id) === i && !hiddenLayers.includes(id))
  if (ids.length <= 1) return false
  const idx = selectedLayer ? ids.indexOf(selectedLayer) : -1
  const next = ids[(idx + 1) % ids.length]!
  if (next === selectedLayer) return false
  select(next)
  return true
}
