// use-canvas-zoom — 画布缩放钩子(2026-10-31 方案 B §2.6 对照 PhotoCraft,自 CanvasPanel 提取付账)。
// 职责:①实测基础适配比例 fitScale(视口/画布,zoom=1 恒为适合窗口);②Ctrl+滚轮缩放,
// 锚点=光标下的文档点(缩放前后该点保持不动),普通滚轮=滚动看放大细节。
// 拖动/吸附/落点坐标按渲染实 rect 换算,天然适配缩放,无需感知本钩子。
import React from 'react'
import { useEditor } from './store'
import type { TemplateDef } from '../registry'

export function useCanvasZoom(tpl: TemplateDef, playerWrapRef: React.RefObject<HTMLDivElement>, scrollRef: React.RefObject<HTMLDivElement>): void {
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => {
      const w = el.clientWidth - 24 // 滚动条/边距余量
      const h = el.clientHeight - 24
      if (w <= 0 || h <= 0) return
      useEditor.getState().setFitScale(Math.min(w / tpl.width, h / tpl.height))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tpl])

  React.useEffect(() => {
    const wrap = playerWrapRef.current
    const scroll = scrollRef.current
    if (!wrap || !scroll) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const st = useEditor.getState()
      const oldZoom = st.zoom
      const newZoom = Math.min(4, Math.max(0.25, oldZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
      if (newZoom === oldZoom) return
      const fs = st.fitScale
      const rect = wrap.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const cwOld = tpl.width * fs * oldZoom
      const chOld = tpl.height * fs * oldZoom
      /* 内容视口内起点:小=auto 居中,大=被滚动(取负 scroll) */
      const leftOld = cwOld <= rect.width ? (rect.width - cwOld) / 2 : -scroll.scrollLeft
      const topOld = chOld <= rect.height ? (rect.height - chOld) / 2 : -scroll.scrollTop
      const docX = (cx - leftOld) / (fs * oldZoom)
      const docY = (cy - topOld) / (fs * oldZoom)
      st.setZoom(newZoom)
      /* 渲染提交后按锚点回设滚动(超视口轴才滚,居中轴交回 auto) */
      requestAnimationFrame(() => {
        const cwNew = tpl.width * fs * newZoom
        const chNew = tpl.height * fs * newZoom
        scroll.scrollLeft = cwNew <= rect.width ? 0 : Math.max(0, Math.min(cwNew - rect.width, docX * fs * newZoom - cx))
        scroll.scrollTop = chNew <= rect.height ? 0 : Math.max(0, Math.min(chNew - rect.height, docY * fs * newZoom - cy))
      })
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [tpl])
}
