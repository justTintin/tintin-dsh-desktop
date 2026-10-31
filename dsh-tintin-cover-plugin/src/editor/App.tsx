// 封面制作编辑器(WP-6 MVP):三栏 = 素材/图层面板 | Player 实时画布 | 会话/导出面板。
// 铁律 8:本文件属插件包;样式内联,无外部 UI 库依赖(积木选型见需求文档 §9.8)。
// 2026-10-29:图层面板族迁 panels.tsx(千行付账);画布加选中图片层旋转手柄。
import { Player } from '@remotion/player'
import React from 'react'
import { getTemplate } from '../registry'
import { sanitizeCustomLayers, undo, useEditor } from './store'
import { useCanvasZoom } from './use-canvas-zoom'
import { chatFrameRef, iconBtn, referableValue } from './ui'
import { AssetsPanel, ExportModal, LayersPanel } from './panels'
import { ServerSettingsModal } from './server-settings'
import { SkillsModal } from './skills-modal'

function CanvasPanel(): React.ReactElement {
  const { templateId, props, hiddenLayers } = useEditor()
  const tpl = getTemplate(templateId)
  const selectLayer = useEditor((s) => s.selectLayer)
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const addCustomLayer = useEditor((s) => s.addCustomLayer)
  const setCustomLayer = useEditor((s) => s.setCustomLayer)
  const setLayerStyleTop = useEditor((s) => s.setLayerStyle)
  const showGuides = useEditor((s) => s.guides)
  const showGrid = useEditor((s) => s.canvasGrid)
  const zoom = useEditor((s) => s.zoom)
  const onRotateDown = (e: React.PointerEvent): void => {
    if (!handleBox || !selectedLayer) return
    e.stopPropagation()
    const wrap = playerWrapRef.current?.getBoundingClientRect()
    const cx = (wrap?.left ?? 0) + handleBox.x + handleBox.w / 2
    const cy = (wrap?.top ?? 0) + handleBox.y + handleBox.h / 2
    const custom = selectedLayer.startsWith('img-')
    const styles = (props.styles as Record<string, { rotate?: number }> | undefined)?.[selectedLayer]
    const base = custom
      ? ((props.customLayers as Array<{ id: string; rotate?: number }> | undefined) ?? []).find((l) => l.id === selectedLayer)?.rotate ?? 0
      : styles?.rotate ?? 0
    const el = (hostRef.current?.querySelector(`[data-cover-layer="${selectedLayer}"]`) as HTMLElement | null) ?? null
    rotRef.current = { cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), base, id: selectedLayer, custom, el, baseTransform: el?.style.transform ?? '', curDeg: base }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  /** 基 transform 串内的 rotate 值替换;无 rotate 时追加 */
  const withRotate = (base: string, deg: number): string => {
    const r = `rotate(${deg}deg)`
    const i = base.lastIndexOf('rotate(')
    if (i < 0) return base ? `${base} ${r}` : r
    const end = base.indexOf(')', i)
    return base.slice(0, i) + r + base.slice(end + 1)
  }
  const onRotateMove = (e: React.PointerEvent): void => {
    const rot = rotRef.current
    if (!rot) return
    let deg = rot.base + ((Math.atan2(e.clientY - rot.cy, e.clientX - rot.cx) - rot.a0) * 180) / Math.PI
    deg = Math.round(deg)
    for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(deg - s) <= 4) { deg = s; break }
    if (deg > 180) deg -= 360
    if (deg < -180) deg += 360
    rot.curDeg = deg
    if (rot.el) rot.el.style.transform = withRotate(rot.baseTransform, deg) // 纯视觉预览,props 零写入
  }
  const onRotateUp = (e: React.PointerEvent): void => {
    const rot = rotRef.current
    rotRef.current = null
    if (rot?.el) rot.el.style.transform = '' // React 离散事件内同步重设新值,无回跳
    setHandleBox(null) // 触发重算:旋转后的包围盒已变
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (!rot || rot.curDeg === rot.base) return // 未变化:不动
    if (rot.custom) setCustomLayer(rot.id, { rotate: rot.curDeg })
    else setLayerStyle(rot.id, { rotate: rot.curDeg })
  }

  /** 合成盒(Player 内按模板比例缩放的画布容器)= 拖动/对齐/落点的统一坐标系 */
  const compositionRect = (): DOMRect | null => {
    const el = hostRef.current?.querySelector('[data-cover-layer]') as HTMLElement | null
    if (el && el.offsetParent) return el.offsetParent.getBoundingClientRect()
    return playerWrapRef.current?.getBoundingClientRect() ?? null
  }
  /** 客户端坐标 → 画布 px(含换算比例) */
  const canvasPoint = (clientX: number, clientY: number): { x: number; y: number; scale: number } => {
    const rect = compositionRect()
    const scale = rect && rect.width > 0 ? rect.width / tpl.width : 1
    return { x: (clientX - (rect?.left ?? 0)) / scale, y: (clientY - (rect?.top ?? 0)) / scale, scale }
  }
  /** 图层元素的画布盒(含 translate/scale 的视觉框 → 画布 px) */
  const canvasBoxOf = (el: Element): { left: number; top: number; w: number; h: number } => {
    const pr = compositionRect()
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
  }
  /** 拖入图片 → 同步三写 → 新图层(锚点居中于投放点)。
   *  例外(2026-10-31 用户裁决:产品图可移动,移动不产生新副本): 拖入的与当前产品图是同一张时,
   *  平移产品槽位到投放点(select 便于继续拖),不再新增图层。 */
  const dropAsLayer = (name: string, clientX: number, clientY: number): void => {
    const point = canvasPoint(clientX, clientY)
    const base = (s: string) => s.replace(/^public\//, '').split('/').pop() ?? ''
    const cur = String((props as { image?: string }).image ?? '')
    if (base(name) && base(name) === base(cur)) {
      const el = hostRef.current?.querySelector('[data-cover-layer="product"]')
      if (el) {
        const box = canvasBoxOf(el)
        const styles = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.product
        setLayerStyle('product', {
          dx: Math.round((styles?.dx ?? 0) + (point.x - (box.left + box.w / 2))),
          dy: Math.round((styles?.dy ?? 0) + (point.y - (box.top + box.h / 2))),
        })
        selectLayer('product')
        return
      }
    }
    void (async () => {
      try {
        if (!name.startsWith('public/')) {
          await fetch('/tintin/cover/api/acp/asset-sync', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
          })
        }
        addCustomLayer(name.replace(/^public\//, ''), point.x - 180, point.y - 135, 360)
      } catch { /* 同步失败不建层 */ }
    })()
  }
  const uploadAsLayer = (file: File, clientX: number, clientY: number): void => {
    void (async () => {
      try {
        const buf = await file.arrayBuffer()
        const r = await fetch(`/tintin/cover/api/upload-image?name=${encodeURIComponent(file.name)}`, {
          method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf,
        }).then((resp) => resp.json())
        if (r.ok && r.name) dropAsLayer(String(r.name), clientX, clientY)
      } catch { /* 上传失败静默 */ }
    })()
  }
  // PhotoCraft 为主(2026-10-27 15:09 裁决):画布 = PhotoCraft 截图轮询
  const [pcRunning, setPcRunning] = React.useState<boolean | null>(null) // null=未探测
  const [shot, setShot] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (pcRunning === false) return
    let stop = false
    const tick = async (): Promise<void> => {
      if (isBusy()) return // 拖动中冻结:props 回流会触发整树重渲(抖动源),拖完下个轮询自然追上
      try {
        const r = await fetch('/tintin/cover/api/pc/screenshot').then((resp) => resp.json())
        if (!stop && r.ok && r.data) { setPcRunning(true); setShot(`data:image/png;base64,${r.data}`) }
        else if (!stop && pcRunning === null) setPcRunning(false)
      } catch { if (!stop) setPcRunning(false) }
    }
    void tick()
    const t = setInterval(tick, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [pcRunning])

  const layerAt = (clientX: number, clientY: number): string | null => {
    const host = hostRef.current
    if (!host) return null
    const el = document.elementFromPoint(clientX, clientY)
    const marked = el instanceof Element ? el.closest('[data-cover-layer]') : null
    if (!marked || !host.contains(marked)) return null
    const id = marked.getAttribute('data-cover-layer') || ''
    return hiddenLayers.includes(id) ? null : id
  }

  /** 参考线/Δ读数:直接 DOM 写,不触发渲染 */
  const updateGuides = (gv: number | null, gh: number | null): void => {
    const v = guideVRef.current
    const h = guideHRef.current
    if (v) { v.style.display = gv !== null && showGuides ? 'block' : 'none'; if (gv !== null) v.style.left = `${(gv / tpl.width) * 100}%` }
    if (h) { h.style.display = gh !== null && showGuides ? 'block' : 'none'; if (gh !== null) h.style.top = `${(gh / tpl.height) * 100}%` }
  }
  const showReadout = (clientX: number, clientY: number, dx: number, dy: number): void => {
    const el = readoutRef.current
    if (!el) return
    el.style.display = 'block'
    el.style.left = `${clientX + 14}px`
    el.style.top = `${clientY + 14}px`
    el.textContent = `${Math.round(dx)} px, ${Math.round(dy)} px`
  }
  const hideReadout = (): void => {
    const el = readoutRef.current
    if (el) el.style.display = 'none'
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (pcRunning) return // PhotoCraft 为主:画布交互在原生窗口,网页仅镜像
    if (dragRef.current) return // 已在拖动:忽略第二指
    const id = layerAt(e.clientX, e.clientY)
    selectLayer(id)
    if (!id) return
    const compRect = compositionRect()
    if (!compRect) return
    const scale = compRect.width / tpl.width
    const dragEl = document.querySelector(`[data-cover-layer="${id}"]`)
    const baseBox = dragEl ? canvasBoxOf(dragEl) : null
    let baseX = 0
    let baseY = 0
    let kind: 'custom' | 'fixed' = 'fixed'
    if (id.startsWith('img-')) {
      const layer = (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; x: number; y: number }>) : []).find((l) => l.id === id)
      if (!layer) return
      kind = 'custom'
      baseX = layer.x
      baseY = layer.y
    } else {
      const styles = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[id]
      baseX = styles?.dx ?? 0
      baseY = styles?.dy ?? 0
    }
    hostRef.current?.setPointerCapture?.(e.pointerId) // 两分支都捕获:拖出画布事件不断流
    dragRef.current = {
      kind, layerId: id, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, baseX, baseY, scale,
      baseLeft: baseBox ? baseBox.left - baseX : 0, baseTop: baseBox ? baseBox.top - baseY : 0, boxW: baseBox?.w ?? 200, boxH: baseBox?.h ?? 200,
      el: dragEl as HTMLElement | null, active: false, curX: baseX, curY: baseY,
      snapX: null, snapY: null, raf: 0, curCX: e.clientX, curCY: e.clientY,
    }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag) {
      // 悬停手型反馈
      const host = hostRef.current
      if (host) host.style.cursor = layerAt(e.clientX, e.clientY) ? 'grab' : 'default'
      return
    }
    if (e.pointerId !== drag.pointerId) return
    e.preventDefault() // 拖动中禁原生行为(文本选择/图片拖拽)——选区重绘是抖动源之一
    const dxs = e.clientX - drag.startX
    const dys = e.clientY - drag.startY
    if (!drag.active) {
      if (Math.hypot(dxs, dys) < 3) return // 死区:手抖不算拖
      drag.active = true
      if (drag.el) { drag.el.style.outline = '2px solid rgba(79,124,255,0.9)'; drag.el.style.willChange = 'translate' } // 提升合成层,预览不重绘整栈
      if (outlineRef.current) outlineRef.current.style.display = 'none' // 常驻边缘框让位给拖动轮廓
      const host = hostRef.current
      if (host) host.style.userSelect = 'none'
    }
    const scale = Math.max(drag.scale, 0.05)
    const rawX = drag.baseX + dxs / scale
    const rawY = drag.baseY + dys / scale
    /* 吸附:阈值按屏幕像素(8/scale)恒定手感;滞回=已吸附的轴保持到离开 guide 点 12 屏幕px,
       消灭参考线边界反复跳入跳出的抖动 */
    let x = rawX
    let y = rawY
    let gv: number | null = null
    let gh: number | null = null
    if (showGuides) {
      const left = drag.baseLeft + rawX
      const top = drag.baseTop + rawY
      const T = 8 / scale
      const stick = 12 / scale
      const candsX = [
        { at: 0, guide: 0 }, { at: (tpl.width - drag.boxW) / 2, guide: tpl.width / 2 }, { at: tpl.width - drag.boxW, guide: tpl.width },
      ]
      const candsY = [
        { at: 0, guide: 0 }, { at: (tpl.height - drag.boxH) / 2, guide: tpl.height / 2 }, { at: tpl.height - drag.boxH, guide: tpl.height },
      ]
      if (drag.snapX) {
        if (Math.abs(left - drag.snapX.at) <= stick) { x = drag.snapX.at; gv = drag.snapX.guide }
        else drag.snapX = null
      }
      if (!drag.snapX) for (const c of candsX) if (Math.abs(left - c.at) <= T) { x = c.at; gv = c.guide; drag.snapX = c; break }
      if (drag.snapY) {
        if (Math.abs(top - drag.snapY.at) <= stick) { y = drag.snapY.at; gh = drag.snapY.guide }
        else drag.snapY = null
      }
      if (!drag.snapY) for (const c of candsY) if (Math.abs(top - c.at) <= T) { y = c.at; gh = c.guide; drag.snapY = c; break }
    }
    drag.curX = x
    drag.curY = y
    drag.curCX = e.clientX
    drag.curCY = e.clientY
    /* rAF 合帧:120Hz+ 指针流→每帧一次 DOM 写(参考线/translate/读数),与显示器刷新对齐 */
    if (!drag.raf) drag.raf = requestAnimationFrame(() => {
      drag.raf = 0
      if (dragRef.current !== drag || !drag.active) return
      updateGuides(gv, gh)
      if (!drag.el?.isConnected) drag.el = (hostRef.current?.querySelector(`[data-cover-layer="${drag.layerId}"]`) as HTMLElement | null) ?? null
      if (drag.el) drag.el.style.translate = `${x - drag.baseX}px ${y - drag.baseY}px` // 与模板 translate/rotate 基变换可叠加;props 零写入
      showReadout(drag.curCX, drag.curCY, x - drag.baseX, y - drag.baseY)
    })
  }
  const endDragVisual = (drag: NonNullable<NonNullable<typeof dragRef.current>>): void => {
    if (drag.raf) cancelAnimationFrame(drag.raf)
    updateGuides(null, null)
    hideReadout()
    if (drag.el) { drag.el.style.outline = ''; drag.el.style.translate = ''; drag.el.style.willChange = '' }
    const host = hostRef.current
    if (host) host.style.userSelect = ''
  }
  const commitDrag = (drag: NonNullable<NonNullable<typeof dragRef.current>>): void => {
    if (!drag.active) return // 死区内松手=点击,不动
    const dx = Math.round(drag.curX - drag.baseX)
    const dy = Math.round(drag.curY - drag.baseY)
    if (dx === 0 && dy === 0) return // 0,0 早退(对照 PhotoCraft finish)
    if (drag.kind === 'custom') setCustomLayer(drag.layerId, { x: Math.round(drag.curX), y: Math.round(drag.curY) })
    else setLayerStyle(drag.layerId, { dx: Math.round(drag.curX), dy: Math.round(drag.curY) })
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    endDragVisual(drag)
    commitDrag(drag) // 离散事件内同步提交:清预览与写 props 同帧,无回跳
    try { hostRef.current?.releasePointerCapture?.(e.pointerId) } catch { /* 已隐式释放 */ }
  }
  const onPointerCancel = (): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    endDragVisual(drag) // 丢弃预览:props 未动,元素回原位
  }
  /** 方向键微调(对照 PhotoCraft nudge):1 画布px/步,Shift=10px */
  const onCanvasKeyDown = (e: React.KeyboardEvent): void => {
    if (pcRunning || !selectedLayer || dragRef.current) return
    const step = e.shiftKey ? 10 : 1
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key]
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    if (selectedLayer.startsWith('img-')) {
      const layer = ((props.customLayers as Array<{ id: string; x: number; y: number }> | undefined) ?? []).find((l) => l.id === selectedLayer)
      if (!layer) return
      setCustomLayer(selectedLayer, { x: layer.x + d[0], y: layer.y + d[1] })
    } else {
      const styles = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[selectedLayer]
      setLayerStyle(selectedLayer, { dx: (styles?.dx ?? 0) + d[0], dy: (styles?.dy ?? 0) + d[1] })
    }
  }

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onCanvasKeyDown}
      /* 捕获失败的兜底:指针已松开(无按键)却仍挂着拖动态 = 丢弃 */
      onPointerLeave={(e) => { if (!e.buttons && dragRef.current) onPointerCancel() }}
      onDragOver={(e) => { if (!pcRunning) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={(e) => {
        if (pcRunning) return
        e.preventDefault()
        const layerName = e.dataTransfer.getData('application/x-tintin-cover-layer')
        if (layerName) { dropAsLayer(layerName, e.clientX, e.clientY); return }
        const file = e.dataTransfer.files?.[0]
        if (file && /image\//i.test(file.type)) uploadAsLayer(file, e.clientX, e.clientY)
      }}
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#101012', gap: 12, outline: 'none' }}>
      {/* Δ读数浮层(对照 PhotoCraft offset_readout):直接 DOM 写,拖动中跟指针 */}
      <div ref={readoutRef} style={{ position: 'fixed', display: 'none', zIndex: 13000, pointerEvents: 'none', background: 'rgba(20,20,22,0.92)', color: '#e8e8e6', border: '1px solid rgba(79,124,255,0.55)', borderRadius: 6, padding: '2px 7px', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' }} />
      {pcRunning ? (
        <>
          {shot ? <img src={shot} alt="PhotoCraft" style={{ maxWidth: '96%', maxHeight: '74vh', borderRadius: 10, boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }} /> : null}
          <div style={{ color: '#8b8b88', fontSize: 11 }}>PhotoCraft 实时镜像 · 图层与编辑在 PhotoCraft 窗口 · 会话可直接驱动</div>
        </>
      ) : (
        <>
          <div ref={playerWrapRef} style={{ position: 'relative', width: '100%', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
            {/* 滚动层(2026-10-31 画布缩放 §2.6):内容=画布×fitScale×zoom,超出即滚动;对齐工具条/边缘框/旋转柄
                在 playerWrap 层不随滚动(按实时 rect 定位)。Ctrl+滚轮缩放(锚点=光标,App 级 wheel 监听) */}
            <div ref={scrollRef} style={{ position: 'absolute', inset: 0, overflow: 'auto', display: 'flex', alignItems: zoom > 1 ? 'flex-start' : 'center', justifyContent: zoom > 1 ? 'flex-start' : 'center' }} onScroll={measureSelBox}>
              <div style={{ position: 'relative', width: Math.round(tpl.width * fitScale * zoom), height: Math.round(tpl.height * fitScale * zoom), flexShrink: 0, margin: 'auto' }}>
                <Player
                  component={tpl.component}
                  inputProps={{ ...props, hiddenLayers }}
                  durationInFrames={1}
                  compositionWidth={tpl.width}
                  compositionHeight={tpl.height}
                  fps={30}
                  style={{ width: '100%', height: '100%', borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }}
                />
                {/* 画布网格(显示开关;编辑器视觉辅助,不进导出) */}
                {showGrid && !pcRunning ? (
                  <div data-preview-grid style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40, backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 40px), repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 40px)' }} />
                ) : null}
                {/* 拖动吸附参考线(青色十字;ref 直写,拖动全程零重渲染)——在缩放内容层内,随缩放对齐画布 */}
                <div ref={guideVRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#22d3ee', pointerEvents: 'none', zIndex: 95, display: 'none' }} />
                <div ref={guideHRef} style={{ position: 'absolute', left: 0, right: 0, height: 1, background: '#22d3ee', pointerEvents: 'none', zIndex: 95, display: 'none' }} />
              </div>
            </div>
            {/* 选中边缘框(2026-10-31 §2.6:常驻=任何选中图层都有,旋转时保持;拖动中由拖动轮廓接管) */}
            {handleBox && !pcRunning ? (
              <div ref={outlineRef} style={{ position: 'absolute', left: handleBox.x - 2, top: handleBox.y - 2, width: handleBox.w + 4, height: handleBox.h + 4, border: '1.5px solid rgba(79,124,255,0.85)', borderRadius: 4, pointerEvents: 'none', zIndex: 86 }} />
            ) : null}
            {/* 对齐工具条(选中图层时出现;相对画布六向)。阻断冒泡:否则宿主 onPointerDown 按
                坐标命中落空 → selectLayer(null) → 工具条随选中态卸载,点击永远无效(实测) */}
            {selectedLayer && !pcRunning ? (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: 'rgba(30,30,32,0.92)', border: '1px solid #3a3a3e', borderRadius: 8, padding: '3px 5px', zIndex: 80 }}>
                {([
                  ['left', '⇤', '左对齐画布'],
                  ['centerX', '⇔', '水平居中'],
                  ['right', '⇥', '右对齐画布'],
                  ['top', '⇧', '顶对齐画布'],
                  ['centerY', '⇕', '垂直居中'],
                  ['bottom', '⇩', '底对齐画布'],
                ] as const).map(([mode, glyph, titleText]) => (
                  <button
                    key={mode}
                    title={titleText}
                    onClick={() => selectedLayer && alignLayer(selectedLayer, mode)}
                    style={{ width: 26, height: 24, borderRadius: 6, border: 0, cursor: 'pointer', background: 'transparent', color: '#c9c9c7', fontSize: 13, lineHeight: 1 }}
                  >{glyph}</button>
                ))}
              </div>
            ) : null}
            {/* 旋转手柄(选中的图片层=自定义层/产品图;拖动绕中心旋转,虚线柄+连接杆) */}
            {isImageLayer && handleBox && !pcRunning ? (
              <>
                <div style={{ position: 'absolute', left: handleBox.x + handleBox.w / 2 - 1, top: handleBox.y - 20, width: 2, height: 20, background: '#4f7cff', pointerEvents: 'none', zIndex: 88 }} />
                <div
                  onPointerDown={onRotateDown}
                  onPointerMove={onRotateMove}
                  onPointerUp={onRotateUp}
                  title="拖动旋转(接近水平/垂直自动吸附)"
                  style={{ position: 'absolute', left: handleBox.x + handleBox.w / 2 - 9, top: handleBox.y - 38, width: 18, height: 18, borderRadius: 999, background: '#4f7cff', border: '2px solid #fff', cursor: 'grab', zIndex: 90, boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }}
                />
              </>
            ) : null}
          </div>
          <div style={{ color: '#8b8b88', fontSize: 11 }}>
            {tpl.width}×{tpl.height} · 模板快出模式 · 点选文字可直接拖动 · 导出走 renderStill
          </div>
        </>
      )}
    </div>
  )
}

/** 预览区顶条(2026-10-29 用户裁决:设置从左面板移到预览区上方横条;横竖屏+预览显示同行) */
function CanvasSettingsStrip(): React.ReactElement {
  const showGuides = useEditor((s) => s.guides)
  const showGrid = useEditor((s) => s.canvasGrid)
  const setGuides = useEditor((s) => s.setGuides)
  const setCanvasGrid = useEditor((s) => s.setCanvasGrid)
  const zoom = useEditor((s) => s.zoom)
  const fitScale = useEditor((s) => s.fitScale)
  const setZoom = useEditor((s) => s.setZoom)
  const zoomBtn = (label: string, factor: number, titleText: string): React.ReactElement => (
    <button
      onClick={() => setZoom(zoom * factor)}
      title={titleText}
      style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #3a3a3e', background: 'transparent', color: '#c9c9c7', fontSize: 13, lineHeight: 1, cursor: 'pointer' }}
    >{label}</button>
  )
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', background: '#141416', borderBottom: '1px solid #2c2c30' }}>
      <OrientationToggle />
      <div style={{ width: 1, height: 18, background: '#333' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#c9c9c7', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={showGuides} onChange={(e) => setGuides(e.target.checked)} style={{ accentColor: '#4f7cff' }} />
        拖动对齐参考线
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#c9c9c7', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={showGrid} onChange={(e) => setCanvasGrid(e.target.checked)} style={{ accentColor: '#4f7cff' }} />
        画布网格
      </label>
      {/* 画布缩放(2026-10-31 §2.6 对照 PhotoCraft):Ctrl+滚轮同款,按钮=无滚轮入口;点百分比=复位适合窗口 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {zoomBtn('−', 1 / 1.25, '缩小画布')}
        <button
          onClick={() => setZoom(1)}
          title="复位为适合窗口"
          style={{ minWidth: 46, height: 24, borderRadius: 6, border: '1px solid #3a3a3e', background: 'transparent', color: '#c9c9c7', fontSize: 11, cursor: 'pointer' }}
        >{Math.round(fitScale * zoom * 100)}%</button>
        {zoomBtn('＋', 1.25, '放大画布')}
      </div>
      <span style={{ flex: 1 }} />
      {/* 撤销移到顶条右端(2026-10-29 用户裁决),原右栏底部入口撤销;提示文字删除 */}
      <button
        onClick={() => undo()}
        title="撤销上一步(会话与面板操作同栈)"
        style={{ border: '1px solid #3a3a3e', background: 'transparent', color: '#c9c9c7', borderRadius: 7, fontSize: 11.5, padding: '4px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >↩ 撤销</button>
    </div>
  )
}

/** 横竖屏设置(2026-10-27 裁决:设置=横竖屏;同族切换保留内容) */
function OrientationToggle(): React.ReactElement {
  const templateId = useEditor((s) => s.templateId)
  const setOrientation = useEditor((s) => s.setOrientation)
  const current = getTemplate(templateId).orientation
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 0, width: 170, flexShrink: 0 }}>
      {([['landscape', '横屏'], ['portrait', '竖屏']] as const).map(([value, label]) => (
        <button
          key={value}
          onClick={() => setOrientation(value)}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            background: current === value ? 'rgba(79,124,255,0.25)' : 'rgba(127,127,127,0.08)',
            border: current === value ? '1px solid rgba(79,124,255,0.6)' : '1px solid transparent',
            color: current === value ? '#bfdbfe' : '#e8e8e6', fontWeight: 700,
          }}
        >{label} {current === value ? '●' : ''}</button>
      ))}
    </div>
  )
}


/** 会话框(2026-10-28 会话移植,需求文档 §十一):右栏换成 OpenFilm 官方聊天组件
    (/tintin/cover/chat iframe;真实 ACP agent 会话,令牌旁路驱动 comfygen/编辑器 API)。
    编辑器侧只剩三件事:挂 iframe(KeepAlive)、推实时上下文(模板+图层取值)、
    「引用到会话」。agent 改字回流走 props 轮询(useAgentPropsSync)。 */

/** 立即推送当前上下文(模块级取 store 快照,供 iframe load 时机与防抖 effect 共用) */
function pushChatContextNow(): void {
  const s = useEditor.getState()
  const tpl = getTemplate(s.templateId)
  const layers = tpl.layerDefs.map((l) => {
    const key = l.propsKey ?? l.id
    return { id: l.id, label: l.label, type: l.type, propsKey: key, value: referableValue(s.props[key]) }
  })
  chatFrameRef.current?.contentWindow?.postMessage(
    { type: 'tintin-cover:context', templateId: s.templateId, orientation: tpl.orientation, layers, size: { w: tpl.width, h: tpl.height } },
    '*',
  )
}

/** 项目切换后的编辑器状态回读(2026-10-30 项目制):套用新项目目录的 props 快照。
 *  新项目尚无 props 文件时**必须重置为模板默认**(空白画布)——直接 return 会让
 *  画布/图层停留在旧项目内容(实撞:切到新建项目画布还是上一张的图)。 */
async function reloadProjectState(): Promise<void> {
  try {
    const r = await fetch('/tintin/cover/api/acp/props').then((x) => x.json())
    const record = r?.record as { templateId?: string; props?: Record<string, unknown>; hiddenLayers?: string[] } | null
    const tid = useEditor.getState().templateId
    if (record && typeof record.templateId === 'string' && record.templateId && record.props && typeof record.props === 'object') {
      if (record.templateId !== tid) useEditor.getState().setTemplate(record.templateId)
      const defaults = getTemplate(useEditor.getState().templateId).defaultProps
      useEditor.setState({
        props: { ...defaults, ...record.props },
        hiddenLayers: Array.isArray(record.hiddenLayers) ? [...record.hiddenLayers] : [],
        selectedLayer: null,
      })
    } else {
      // 新建/空白项目(2026-10-30 用户裁决:画布什么也没有)——模板结构保留但内容
      // 全清空、固定图层全隐藏(图层面板可手动开启),绝不含演示内容
      const t = getTemplate(tid)
      const cleared: Record<string, unknown> = { ...t.defaultProps }
      for (const k of Object.keys(cleared)) {
        const v = cleared[k]
        if (typeof v === 'string') cleared[k] = ''
        else if (Array.isArray(v)) cleared[k] = []
      }
      cleared.customLayers = []
      cleared.layerOrder = t.layerDefs.map((l) => l.id)
      useEditor.setState({ props: cleared, hiddenLayers: t.layerDefs.map((l) => l.id), selectedLayer: null })
    }
  } catch { /* 会话路由未起(旧包) */ }
}

function CoverChatPanel(): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const frame = document.createElement('iframe')
    frame.src = '/tintin/cover/chat'
    frame.title = '封面会话'
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent'
    chatFrameRef.current = frame
    /* 会话页每次(重)加载完成即补推上下文——首推 300ms 防抖常早于 iframe 加载完成,
       消息会丢进未就绪的初始 document(2026-10-28 探针实测:@ 菜单图层组空)。 */
    frame.addEventListener('load', pushChatContextNow)
    hostRef.current?.appendChild(frame)
    return () => {
      frame.removeEventListener('load', pushChatContextNow)
      if (chatFrameRef.current === frame) chatFrameRef.current = null
      frame.remove()
    }
  }, [])
  return <div ref={hostRef} style={{ flex: '1 1 auto', minHeight: 0, width: '100%', display: 'flex' }} />
}

/** 编辑器 → 会话上下文推送(模板/横竖/图层+当前取值;输入即推,300ms 防抖;
    另响应会话页的 context-request 拉取——推送丢进未就绪 iframe 时由 @ 菜单打开时补取) */
function useChatContextPush(): void {
  const templateId = useEditor((s) => s.templateId)
  const props = useEditor((s) => s.props)
  const hiddenLayers = useEditor((s) => s.hiddenLayers)
  React.useEffect(() => {
    const timer = setTimeout(pushChatContextNow, 300)
    const onRequest = (event: MessageEvent): void => {
      const data = event.data as { type?: string } | null
      if (data && data.type === 'tintin-cover:context-request') pushChatContextNow()
    }
    window.addEventListener('message', onRequest)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', onRequest)
    }
  }, [templateId, props, hiddenLayers])
}

/** agent 改字回流:轮询 /acp/props(2s;origin=agent 才套用),编辑器自己的修改
    防抖 600ms 反向推送(origin=editor,agent 的 cover.props.json 即新值)。 */
function useAgentPropsSync(isBusy: () => boolean): void {
  React.useEffect(() => {
    let stop = false
    let lastAgentTs = 0
    let lastOwnWrite = 0
    let pushing = false
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch('/tintin/cover/api/acp/props').then((x) => x.json())
        if (stop) return
        const record = r?.record as { origin?: string; updatedAt?: number; templateId?: string; props?: Record<string, unknown>; hiddenLayers?: string[] } | null
        if (record && record.origin === 'agent' && typeof record.updatedAt === 'number'
          && record.updatedAt > lastAgentTs && record.updatedAt > lastOwnWrite) {
          lastAgentTs = record.updatedAt
          pushing = true
          try {
            if (typeof record.templateId === 'string' && record.templateId && record.templateId !== useEditor.getState().templateId) {
              useEditor.getState().setTemplate(record.templateId)
            }
            // 套用时并入模板默认值:agent 的旧快照缺新图层键(如后加的 subtitle)不致空白(同 setOrientation 合并语义)
            if (record.props && typeof record.props === 'object') {
              // agent 自下载的新图片只落 cover 目录,staticFile 解析不到——先补三写完成再套用,
              // 否则 Img 按 404 渲染且不再重试(2026-10-28 探针实测)
              const custom = Array.isArray(record.props.customLayers) ? record.props.customLayers : []
              const unsynced = custom
                .map((layer) => String(layer?.image ?? ''))
                .filter((image) => image && !image.startsWith('public/'))
              await Promise.all(unsynced.map((image) =>
                fetch('/tintin/cover/api/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: image }) }).catch(() => {}),
              ))
              const defaults = getTemplate(useEditor.getState().templateId).defaultProps
              const merged = { ...defaults, ...record.props }
              // 组归属净化(2026-10-31 阶段2):智能体写的 customLayers[].group 只认图片组槽位
              merged.customLayers = sanitizeCustomLayers(useEditor.getState().templateId, merged.customLayers)
              useEditor.setState({ props: merged })
            }
            if (Array.isArray(record.hiddenLayers)) useEditor.setState({ hiddenLayers: [...record.hiddenLayers] })
          } finally {
            setTimeout(() => { pushing = false }, 650) // 盖过 600ms 推送防抖,防回流打转
          }
        }
      } catch { /* 会话路由未起(旧包) */ }
    }
    const timer = setInterval(() => { void tick() }, 2000)
    void tick()
    let pushTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useEditor.subscribe(() => {
      if (pushing) return
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(() => {
        const s = useEditor.getState()
        lastOwnWrite = Date.now()
        pushing = true
        void fetch('/tintin/cover/api/acp/props', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId: s.templateId, props: s.props, hiddenLayers: s.hiddenLayers }),
        }).catch(() => {}).finally(() => { pushing = false })
      }, 600)
    })
    return () => { stop = true; clearInterval(timer); unsubscribe(); if (pushTimer) clearTimeout(pushTimer) }
  }, [])
}
/* 项目 tab/打开项目弹层样式(2026-10-30 用户裁决):× 悬停/激活显隐用 :hover 必须
   走样式表(inline 无法表达),一次性注入 */
let pjStyleInjected = false
function ensurePjStyle(): void {
  if (pjStyleInjected || typeof document === 'undefined') return
  pjStyleInjected = true
  const s = document.createElement('style')
  s.textContent = [
    '.tintin-pj-tab{position:relative}',
    '.tintin-pj-x{opacity:0;transition:opacity .12s;color:#8b8b88;font-size:11px;line-height:1;cursor:pointer;padding:1px 3px;border-radius:4px}',
    '.tintin-pj-x:hover{color:#f87171;background:rgba(127,127,127,.18)}',
    '.tintin-pj-tab:hover .tintin-pj-x,.tintin-pj-tab.is-active .tintin-pj-x{opacity:1}',
    '.tintin-pj-pop{position:absolute;top:calc(100% + 6px);left:0;width:300px;max-height:340px;overflow:auto;background:#1e1e20;border:1px solid #3a3a3e;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.5);z-index:2100;padding:6px}',
    '.tintin-pj-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;color:#c9c9cf}',
    '.tintin-pj-item:hover{background:#26272b}',
    '.tintin-pj-item.is-current{color:#fff}',
  ].join('\n')
  document.head.append(s)
}

export const EditorApp: React.FC = () => {
  const [showExport, setShowExport] = React.useState(false)
  const [showServer, setShowServer] = React.useState(false)
  /* 封面项目制(2026-10-30 用户裁决):tab=项目;切换=目录+会话(iframe 按纪元重挂)跟随。
     tab × 关闭=仅移出栏(项目目录与数据保留在磁盘,可从「打开项目」重新打开);
     关闭当前项目自动切到剩余项目,无剩余则新建。 */
  const [projects, setProjects] = React.useState<Array<{ name: string; mtimeMs: number }>>([])
  const [currentProject, setCurrentProject] = React.useState('')
  const [projectEpoch, setProjectEpoch] = React.useState(0)
  const [renaming, setRenaming] = React.useState<{ from: string; value: string } | null>(null)
  const [closedProjects, setClosedProjects] = React.useState<string[]>([])
  const [projectListOpen, setProjectListOpen] = React.useState(false)

  const applyProjectSwitch = (r: { current?: unknown; projects?: Array<{ name: string; mtimeMs: number }> }): void => {
    if (Array.isArray(r.projects)) setProjects(r.projects)
    const name = String(r.current ?? '')
    setCurrentProject(name)
    setClosedProjects((list) => list.filter((n) => n !== name))
    setProjectEpoch((e) => e + 1)
    void reloadProjectState()
  }
  const refreshProjects = (): void => {
    void fetch('/tintin/cover/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((x) => x.json())
      .then((r) => { if (r?.ok) { setProjects(r.projects ?? []); setCurrentProject(String(r.current ?? '')) } })
      .catch(() => {})
  }
  React.useEffect(() => {
    refreshProjects()
  }, [])
  const switchProject = async (name: string): Promise<void> => {
    if (!name || name === currentProject) return
    try {
      const r = await fetch('/tintin/cover/api/projects/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((x) => x.json())
      if (r?.ok) applyProjectSwitch(r)
    } catch { /* 请求失败保持原项目 */ }
  }
  const createProject = async (): Promise<void> => {
    try {
      const r = await fetch('/tintin/cover/api/projects/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json())
      if (r?.ok) applyProjectSwitch(r)
    } catch { /* 同上 */ }
  }
  const commitRename = async (): Promise<void> => {
    const task = renaming
    setRenaming(null)
    if (!task) return
    const to = task.value.trim()
    if (!to || to === task.from) return
    try {
      const r = await fetch('/tintin/cover/api/projects/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: task.from, to }) }).then((x) => x.json())
      if (!r?.ok) return
      if (String(r.current ?? '') === to) applyProjectSwitch(r)
      else if (Array.isArray(r.projects)) setProjects(r.projects)
    } catch { /* 同上 */ }
  }
  /** 关闭项目 tab(2026-10-30 用户裁决):仅从栏内移出,项目目录与数据保留在磁盘,
      可从「打开项目」列表重新打开;关闭当前项目=自动切到剩余项目,无剩余则新建 */
  const closeProject = (name: string): void => {
    const next = Array.from(new Set([...closedProjects, name]))
    setClosedProjects(next)
    if (name !== currentProject) return
    const stillOpen = projects.filter((p) => p.name !== name && !next.includes(p.name))
    if (stillOpen.length) void switchProject(stillOpen[0]?.name ?? '')
    else void createProject()
  }
  /** 打开项目列表项点击:已打开=切换;已关闭=重新打开(移出关闭清单+切换) */
  const openProjectFromList = (name: string): void => {
    setClosedProjects((list) => list.filter((n) => n !== name))
    if (name === currentProject) return
    void switchProject(name)
  }
  ensurePjStyle()
  useChatContextPush()
  useAgentPropsSync(() => dragRef.current?.active === true)
  /* 技能管理大弹窗(2026-10-30 用户裁决:形态=视频剪辑 Skill 弹窗;聊天 ▦ 经 postMessage 请求打开) */
  const [showSkills, setShowSkills] = React.useState(false)
  React.useEffect(() => {
    const onRequest = (event: MessageEvent): void => {
      const data = event.data as { type?: string } | null
      if (data && data.type === 'tintin-cover:skills-open') setShowSkills(true)
    }
    window.addEventListener('message', onRequest)
    return () => window.removeEventListener('message', onRequest)
  }, [])
  const openPhotoCraft = (): void => {
    /* 送当前模板+props:主进程按其构建图层底稿,PhotoCraft 随文档启动(不再开空窗) */
    const s = useEditor.getState()
    void fetch('/tintin/cover/api/pc/launch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: s.templateId, props: s.props }),
    })
      .then((r) => r.json())
      .then((r) => { if (r && r.ok === false) window.alert('PhotoCraft 打开失败：' + String(r.error ?? '')) })
      .catch(() => {})
  }
  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 6, border: 0, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
  }
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#141416', color: '#e8e8e6' }}>
      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: '#1a1a1c', borderBottom: '1px solid #333' }}>
        {/* 顶栏(2026-10-30 用户裁决):T 图标与「封面制作」文字删除;「打开项目」=弹全部
            项目列表(含已关闭,点击打开/切换);tab × 关闭项目=仅移出栏,数据保留可重开 */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => { void refreshProjects(); setProjectListOpen((v) => !v) }}
            title="打开项目——列出全部封面项目，点击打开/切换"
            style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid #3a3a3e', background: projectListOpen ? '#26272b' : 'transparent', color: '#c9c9cf', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >打开项目 ▾</button>
          {projectListOpen ? (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 2050 }} onClick={() => setProjectListOpen(false)} />
              <div className="tintin-pj-pop">
                {projects.length === 0 ? <div style={{ fontSize: 11, color: '#8a8a90', padding: 10 }}>还没有封面项目——点「＋」新建</div> : null}
                {projects.map((p) => {
                  const open = !closedProjects.includes(p.name)
                  return (
                    <div
                      key={p.name}
                      className={'tintin-pj-item' + (p.name === currentProject ? ' is-current' : '')}
                      onClick={() => { openProjectFromList(p.name); setProjectListOpen(false) }}
                      title={open ? `切换到 ${p.name}` : `重新打开 ${p.name}（项目数据保留在磁盘）`}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {p.name === currentProject ? <span style={{ fontSize: 10, color: '#8fd6a4' }}>当前</span> : open ? <span style={{ fontSize: 10, color: '#8a8a90' }}>已打开</span> : null}
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: '0 1 auto', overflowX: 'auto', overflowY: 'hidden', padding: '0 2px' }}>
          {projects.filter((p) => !closedProjects.includes(p.name)).map((p) => {
            const active = p.name === currentProject
            const isRenaming = renaming?.from === p.name
            return (
              <div
                key={p.name}
                className={'tintin-pj-tab' + (active ? ' is-active' : '')}
                onClick={() => { if (!isRenaming && !active) void switchProject(p.name) }}
                onDoubleClick={() => setRenaming({ from: p.name, value: p.name })}
                title={active ? `${p.name}（当前项目）· 双击重命名` : `${p.name} · 点击切换 · 双击重命名`}
                style={{
                  flexShrink: 0, maxWidth: 180, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  padding: '4px 10px', borderRadius: 7, fontSize: 11.5, whiteSpace: 'nowrap',
                  background: active ? '#2a2b31' : 'transparent',
                  border: active ? '1px solid #3b3c42' : '1px solid transparent',
                  color: active ? '#e8e8e6' : '#8b8b88', fontWeight: active ? 700 : 400,
                }}
              >
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(e) => setRenaming({ from: p.name, value: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => { void commitRename() }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { void commitRename(); return }
                      if (e.key === 'Escape') { setRenaming(null); e.stopPropagation() }
                    }}
                    style={{ width: 130, background: '#101012', color: '#e8e8e6', border: '1px solid #4f7cff', borderRadius: 5, fontSize: 11.5, padding: '1px 6px', outline: 'none' }}
                  />
                ) : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>}
                {/* × 关闭项目(2026-10-30 用户裁决):悬停/激活时显示;仅移出栏,数据保留可重开 */}
                <span
                  className="tintin-pj-x"
                  title="关闭项目（不删数据，可从「打开项目」重新打开）"
                  onClick={(e) => { e.stopPropagation(); closeProject(p.name) }}
                >×</span>
              </div>
            )
          })}
          <button
            onClick={() => void createProject()}
            title="新建封面项目（默认名=日期时间）"
            style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: '1px solid #3a3a3e', background: 'transparent', color: '#c9c9c7', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >＋</button>
        </div>
        <span style={{ flex: 1 }} />
        {/* 按钮序(2026-10-31 用户裁决):设置第一,其后 PhotoCraft、导出 */}
        <button onClick={() => setShowServer(true)} title="服务设置（服务端地址 + MCP 自动发现）" style={{ ...iconBtn, background: 'rgba(126,226,168,0.1)', color: '#7ee2a8', fontSize: 14, fontWeight: 800 }}>
          ⚙
        </button>
        <button onClick={openPhotoCraft} title="用 PhotoCraft 打开精修" style={{ ...iconBtn, background: 'rgba(34,211,238,0.1)', color: '#22d3ee' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
        </button>
        <button onClick={() => setShowExport(true)} title="导出封面 PNG" style={{ ...iconBtn, background: 'rgba(79,124,255,0.1)', color: '#93c5fd' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
      {showExport ? <ExportModal onClose={() => setShowExport(false)} /> : null}
      {showServer ? <ServerSettingsModal onClose={() => setShowServer(false)} /> : null}
      {showSkills ? <SkillsModal onClose={() => setShowSkills(false)} /> : null}
      {/* 素材横带=底部全宽但不含会话列(2026-10-30 用户裁决:扩展高宽,跨预览列+中栏,中栏底部让位;会话列保持全高) */}
      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
            {/* 预览列 = 设置顶条(横竖屏+预览显示) + 画布 */}
            <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <CanvasSettingsStrip />
              <CanvasPanel />
            </div>
            {/* 中栏 = 图层+编辑整栏(素材移出后整栏让给图层;高度随素材底带让位) */}
            <div style={{ width: 260, flexShrink: 0, background: '#1a1a1c', borderLeft: '1px solid #333', borderRight: '1px solid #333', padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflowX: 'hidden', gap: 10 }}>
              <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <LayersPanel project={currentProject} />
              </div>
            </div>
          </div>
          {/* 素材条感知项目(2026-10-30 用户裁决方案 1):key=项目纪元,切换/新建/改名即重挂
              重拉——此前它只靠 3 秒轮询,切完最慢 3 秒才出新项目素材 */}
          <AssetsPanel key={projectEpoch} project={currentProject} />
        </div>
        {/* 右栏 = 会话列(2026-10-28 裁决:通栏全高官方聊天,不被素材带挤占) */}
        <div style={{ width: 420, flexShrink: 0, background: '#1a1a1c', borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* 会话随项目:epoch 变化=切换/新建/改名当前项目 → iframe 重挂 → start 以新 cwd 起会话(记录随项目目录) */}
          <CoverChatPanel key={projectEpoch} />
        </div>
      </div>
    </div>
  )
}
