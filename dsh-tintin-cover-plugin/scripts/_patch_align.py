# -*- coding: utf-8 -*-
# 画布:对齐工具条 + 拖动吸附参考线 + 网格/参考线显示开关(PhotoCraft 式)
import io

p = 'src/editor/App.tsx'
with io.open(p, encoding='utf-8') as f:
    text = f.read()

# ── 1) CanvasPanel:接入开关/参考线状态 + 画布盒测量 + 对齐/吸附 ──
old = r'''  const selectLayer = useEditor((s) => s.selectLayer)
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const addCustomLayer = useEditor((s) => s.addCustomLayer)
  const setCustomLayer = useEditor((s) => s.setCustomLayer)'''
new = r'''  const selectLayer = useEditor((s) => s.selectLayer)
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const addCustomLayer = useEditor((s) => s.addCustomLayer)
  const setCustomLayer = useEditor((s) => s.setCustomLayer)
  const setLayerStyleTop = useEditor((s) => s.setLayerStyle)
  const showGuides = useEditor((s) => s.guides)
  const showGrid = useEditor((s) => s.canvasGrid)
  const selectedLayer = useEditor((s) => s.selectedLayer)
  /* 拖动吸附参考线(画布 px 坐标;渲染按百分比自适应缩放) */
  const [guideLines, setGuideLines] = React.useState<{ v: number | null; h: number | null }>({ v: null, h: null })'''
assert old in text
text = text.replace(old, new, 1)

old = r'''  /** 客户端坐标 → 画布 px(含换算比例) */
  const canvasPoint = (clientX: number, clientY: number): { x: number; y: number; scale: number } => {
    const rect = playerWrapRef.current?.getBoundingClientRect()
    const scale = rect && rect.width > 0 ? rect.width / tpl.width : 1
    return { x: (clientX - (rect?.left ?? 0)) / scale, y: (clientY - (rect?.top ?? 0)) / scale, scale }
  }'''
new = r'''  /** 客户端坐标 → 画布 px(含换算比例) */
  const canvasPoint = (clientX: number, clientY: number): { x: number; y: number; scale: number } => {
    const rect = playerWrapRef.current?.getBoundingClientRect()
    const scale = rect && rect.width > 0 ? rect.width / tpl.width : 1
    return { x: (clientX - (rect?.left ?? 0)) / scale, y: (clientY - (rect?.top ?? 0)) / scale, scale }
  }
  /** 图层元素的画布盒(含 translate/scale 的视觉框 → 画布 px) */
  const canvasBoxOf = (el: Element): { left: number; top: number; w: number; h: number } => {
    const pr = playerWrapRef.current?.getBoundingClientRect()
    const scale = pr && pr.width > 0 ? pr.width / tpl.width : 1
    const r = el.getBoundingClientRect()
    return { left: (r.left - (pr?.left ?? 0)) / scale, top: (r.top - (pr?.top ?? 0)) / scale, w: r.width / scale, h: r.height / scale }
  }
  /** 对齐(相对画布;PhotoCraft 式六向)。文字层改 dx/dy 偏移,自定义层改 x/y */
  const alignLayer = (id: string, mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'): void => {
    const el = hostRef.current?.querySelector(`[data-cover-layer="${id}"]`)
    if (!el) return
    const box = canvasBoxOf(el)
    const target = {
      left: 0, centerX: (tpl.width - box.w) / 2, right: tpl.width - box.w,
      top: 0, centerY: (tpl.height - box.h) / 2, bottom: tpl.height - box.h,
    }[mode]
    if (id.startsWith('img-')) {
      const layer = (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; x: number; y: number }>) : []).find((l) => l.id === id)
      if (!layer) return
      if (mode === 'left' || mode === 'centerX' || mode === 'right') setCustomLayer(id, { x: Math.round(target) })
      else setCustomLayer(id, { y: Math.round(target) })
      return
    }
    const styles = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[id]
    if (mode === 'left' || mode === 'centerX' || mode === 'right') {
      setLayerStyle(id, { dx: Math.round((styles?.dx ?? 0) + (target - box.left)) })
    } else {
      setLayerStyle(id, { dy: Math.round((styles?.dy ?? 0) + (target - box.top)) })
    }
  }'''
assert old in text
text = text.replace(old, new, 1)

# ── 2) 拖动吸附:down 时记基准盒,move 时按 6 参照吸附并画参考线 ──
old = r'''    if (id.startsWith('img-')) {
      const layer = (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; x: number; y: number }>) : []).find((l) => l.id === id)
      if (!layer) return
      dragRef.current = { kind: 'custom', layerId: id, startX: e.clientX, startY: e.clientY, baseX: layer.x, baseY: layer.y, scale }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      return
    }
    const styles = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[id]
    dragRef.current = {
      kind: 'fixed',
      layerId: id,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: styles?.dx ?? 0,
      baseDy: styles?.dy ?? 0,
      scale,
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)'''
new = r'''    const dragEl = document.querySelector(`[data-cover-layer="${id}"]`)
    const baseBox = dragEl ? canvasBoxOf(dragEl) : null
    if (id.startsWith('img-')) {
      const layer = (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; x: number; y: number }>) : []).find((l) => l.id === id)
      if (!layer) return
      dragRef.current = { kind: 'custom', layerId: id, startX: e.clientX, startY: e.clientY, baseX: layer.x, baseY: layer.y, scale,
        baseLeft: baseBox ? baseBox.left - layer.x : 0, baseTop: baseBox ? baseBox.top - layer.y : 0, boxW: baseBox?.w ?? 200, boxH: baseBox?.h ?? 200 }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      return
    }
    const styles = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[id]
    dragRef.current = {
      kind: 'fixed',
      layerId: id,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: styles?.dx ?? 0,
      baseDy: styles?.dy ?? 0,
      scale,
      baseLeft: baseBox ? baseBox.left - (styles?.dx ?? 0) : 0, baseTop: baseBox ? baseBox.top - (styles?.dy ?? 0) : 0, boxW: baseBox?.w ?? 200, boxH: baseBox?.h ?? 200,
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)'''
assert old in text
text = text.replace(old, new, 1)

# dragRef 类型扩展
old = r'''  const dragRef = React.useRef<
    | { kind: 'fixed'; layerId: string; startX: number; startY: number; baseDx: number; baseDy: number; scale: number }
    | { kind: 'custom'; layerId: string; startX: number; startY: number; baseX: number; baseY: number; scale: number }
    | null
  >(null)'''
new = r'''  const dragRef = React.useRef<
    | { kind: 'fixed'; layerId: string; startX: number; startY: number; baseDx: number; baseDy: number; scale: number; baseLeft: number; baseTop: number; boxW: number; boxH: number }
    | { kind: 'custom'; layerId: string; startX: number; startY: number; baseX: number; baseY: number; scale: number; baseLeft: number; baseTop: number; boxW: number; boxH: number }
    | null
  >(null)'''
assert old in text
text = text.replace(old, new, 1)

# move 分支:吸附计算(左右中/上下中,阈值 8 画布 px)
old = r'''    const drag = dragRef.current
    if (drag) {
      if (drag.kind === 'custom') {
        const x = drag.baseX + Math.round((e.clientX - drag.startX) / Math.max(drag.scale, 0.05))
        const y = drag.baseY + Math.round((e.clientY - drag.startY) / Math.max(drag.scale, 0.05))
        setCustomLayer(drag.layerId, { x, y })
      } else {
        const dx = drag.baseDx + Math.round((e.clientX - drag.startX) / Math.max(drag.scale, 0.05))
        const dy = drag.baseDy + Math.round((e.clientY - drag.startY) / Math.max(drag.scale, 0.05))
        setLayerStyle(drag.layerId, { dx, dy })
      }
    } else {'''
new = r'''    const drag = dragRef.current
    if (drag) {
      const rawX = (drag.kind === 'custom' ? drag.baseX : drag.baseDx) + (e.clientX - drag.startX) / Math.max(drag.scale, 0.05)
      const rawY = (drag.kind === 'custom' ? drag.baseY : drag.baseDy) + (e.clientY - drag.startY) / Math.max(drag.scale, 0.05)
      /* 吸附:图层盒的 左/水平中/右 与画布参照对齐(阈值 8 画布 px),垂直同理 */
      let x = rawX
      let y = rawY
      let gv: number | null = null
      let gh: number | null = null
      if (showGuides) {
        const left = drag.baseLeft + rawX
        const top = drag.baseTop + rawY
        const T = 8
        const candsX = [
          { at: 0, guide: 0 }, { at: (tpl.width - drag.boxW) / 2, guide: tpl.width / 2 }, { at: tpl.width - drag.boxW, guide: tpl.width },
        ]
        const candsY = [
          { at: 0, guide: 0 }, { at: (tpl.height - drag.boxH) / 2, guide: tpl.height / 2 }, { at: tpl.height - drag.boxH, guide: tpl.height },
        ]
        for (const c of candsX) if (Math.abs(left - c.at) <= T) { x = c.at; gv = c.guide; break }
        for (const c of candsY) if (Math.abs(top - c.at) <= T) { y = c.at; gh = c.guide; break }
      }
      setGuideLines({ v: gv, h: gh })
      if (drag.kind === 'custom') {
        setCustomLayer(drag.layerId, { x: Math.round(x), y: Math.round(y) })
      } else {
        setLayerStyle(drag.layerId, { dx: Math.round(x), dy: Math.round(y) })
      }
    } else {'''
assert old in text
text = text.replace(old, new, 1)

# up 清参考线
old = r'''  const onPointerUp = (): void => { dragRef.current = null }'''
new = r'''  const onPointerUp = (): void => {
    dragRef.current = null
    setGuideLines({ v: null, h: null })
  }'''
assert old in text
text = text.replace(old, new, 1)

with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
    f.write(text)
print('canvas align/snap patched; lines =', len(text.splitlines()))
