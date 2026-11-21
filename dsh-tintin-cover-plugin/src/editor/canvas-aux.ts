// canvas-aux — 画布指针辅助(2026-11-10 P2 批,自 CanvasPanel 提取付账):
// 空格纯净预览(T3.9)/Alt+点击循环选层(T3.7)。live 信号走 ui.ts liveLayer。
// 2026-11-21 清偿:T3.6 悬停预亮(updateHover/HoverDeps)随 2026-11-11 画布 chrome
// 整体拆除后无运行时引用,按路线 v2 步骤2 清偿(git 历史留档)。
import React from 'react'

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
