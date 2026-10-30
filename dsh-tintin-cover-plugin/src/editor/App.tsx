// 封面制作编辑器(WP-6 MVP):三栏 = 素材/图层面板 | Player 实时画布 | 会话/导出面板。
// 铁律 8:本文件属插件包;样式内联,无外部 UI 库依赖(积木选型见需求文档 §9.8)。
// 2026-10-29:图层面板族迁 panels.tsx(千行付账);画布加选中图片层旋转手柄。
import { Player } from '@remotion/player'
import React from 'react'
import { getTemplate } from '../registry'
import { undo, useEditor } from './store'
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
  const selectedLayer = useEditor((s) => s.selectedLayer)
  /* 拖动吸附参考线(画布 px 坐标;渲染按百分比自适应缩放) */
  const [guideLines, setGuideLines] = React.useState<{ v: number | null; h: number | null }>({ v: null, h: null })
  const hostRef = React.useRef<HTMLDivElement>(null)
  const playerWrapRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<
    | { kind: 'fixed'; layerId: string; startX: number; startY: number; baseDx: number; baseDy: number; scale: number; baseLeft: number; baseTop: number; boxW: number; boxH: number }
    | { kind: 'custom'; layerId: string; startX: number; startY: number; baseX: number; baseY: number; scale: number; baseLeft: number; baseTop: number; boxW: number; boxH: number }
    | null
  >(null)
  /** 旋转手柄(2026-10-29 用户裁决:选中的图片层可旋转;自定义层存 layer.rotate,产品图存 styles.rotate)。
   *  拖动=绕图层中心转,接近 0/±90/180 吸附;旋转中冻结手柄位置(旋转改包围盒,免得手柄跟着漂)。 */
  const isImageLayer = selectedLayer !== null && (selectedLayer.startsWith('img-') || selectedLayer === 'product')
  const [handleBox, setHandleBox] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const rotRef = React.useRef<{ cx: number; cy: number; a0: number; base: number; id: string; custom: boolean } | null>(null)
  React.useLayoutEffect(() => {
    if (rotRef.current) return
    if (!selectedLayer || pcRunning || !isImageLayer) {
      setHandleBox((prev) => (prev === null ? prev : null))
      return
    }
    const el = hostRef.current?.querySelector(`[data-cover-layer="${selectedLayer}"]`)
    const pr = playerWrapRef.current?.getBoundingClientRect()
    if (!el || !pr) {
      setHandleBox((prev) => (prev === null ? prev : null))
      return
    }
    const r = el.getBoundingClientRect()
    const next = { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height }
    // 值不变时回传同一引用,否则每次渲染都 set 新对象 → 无限重渲(React #185,冒烟实测)
    setHandleBox((prev) => (prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5
      && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5 ? prev : next))
  })
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
    rotRef.current = { cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), base, id: selectedLayer, custom }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onRotateMove = (e: React.PointerEvent): void => {
    const rot = rotRef.current
    if (!rot) return
    let deg = rot.base + ((Math.atan2(e.clientY - rot.cy, e.clientX - rot.cx) - rot.a0) * 180) / Math.PI
    deg = Math.round(deg)
    for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(deg - s) <= 4) { deg = s; break }
    if (deg > 180) deg -= 360
    if (deg < -180) deg += 360
    if (rot.custom) setCustomLayer(rot.id, { rotate: deg })
    else setLayerStyle(rot.id, { rotate: deg })
  }
  const onRotateUp = (e: React.PointerEvent): void => {
    rotRef.current = null
    setHandleBox(null) // 触发重算:旋转后的包围盒已变
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
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
  /** 拖入图片 → 同步三写 → 新图层(锚点居中于投放点) */
  const dropAsLayer = (name: string, clientX: number, clientY: number): void => {
    const point = canvasPoint(clientX, clientY)
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

  const onPointerDown = (e: React.PointerEvent): void => {
    if (pcRunning) return // PhotoCraft 为主:画布交互在原生窗口,网页仅镜像
    const id = layerAt(e.clientX, e.clientY)
    selectLayer(id)
    if (!id) return
    const compRect = compositionRect()
    if (!compRect) return
    const scale = compRect.width / tpl.width
    const dragEl = document.querySelector(`[data-cover-layer="${id}"]`)
    const baseBox = dragEl ? canvasBoxOf(dragEl) : null
    if (id.startsWith('img-')) {
      const layer = (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; x: number; y: number }>) : []).find((l) => l.id === id)
      if (!layer) return
      dragRef.current = { kind: 'custom', layerId: id, startX: e.clientX, startY: e.clientY, baseX: layer.x, baseY: layer.y, scale,
        baseLeft: baseBox ? baseBox.left - layer.x : 0, baseTop: baseBox ? baseBox.top - layer.y : 0, boxW: baseBox?.w ?? 200, boxH: baseBox?.h ?? 200 }
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
    hostRef.current?.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current
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
    } else {
      // 悬停手型反馈
      const host = hostRef.current
      if (host) host.style.cursor = layerAt(e.clientX, e.clientY) ? 'grab' : 'default'
    }
  }
  const onPointerUp = (): void => {
    dragRef.current = null
    setGuideLines({ v: null, h: null })
  }

  return (
    <div
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDragOver={(e) => { if (!pcRunning) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={(e) => {
        if (pcRunning) return
        e.preventDefault()
        const layerName = e.dataTransfer.getData('application/x-tintin-cover-layer')
        if (layerName) { dropAsLayer(layerName, e.clientX, e.clientY); return }
        const file = e.dataTransfer.files?.[0]
        if (file && /image\//i.test(file.type)) uploadAsLayer(file, e.clientX, e.clientY)
      }}
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#101012', gap: 12 }}>
      {pcRunning ? (
        <>
          {shot ? <img src={shot} alt="PhotoCraft" style={{ maxWidth: '96%', maxHeight: '74vh', borderRadius: 10, boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }} /> : null}
          <div style={{ color: '#8b8b88', fontSize: 11 }}>PhotoCraft 实时镜像 · 图层与编辑在 PhotoCraft 窗口 · 会话可直接驱动</div>
        </>
      ) : (
        <>
          <div ref={playerWrapRef} style={{ position: 'relative', width: '100%', flex: '1 1 auto', minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Player
              component={tpl.component}
              inputProps={{ ...props, hiddenLayers }}
              durationInFrames={1}
              compositionWidth={tpl.width}
              compositionHeight={tpl.height}
              fps={30}
              style={tpl.height > tpl.width
                ? { height: '100%', width: 'auto', aspectRatio: `${tpl.width}/${tpl.height}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }
                : { width: '100%', maxWidth: 920, maxHeight: '100%', borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }}
            />
            {/* 画布网格(显示开关;编辑器视觉辅助,不进导出) */}
            {showGrid && !pcRunning ? (
              <div data-preview-grid style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40, backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 40px), repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 40px)' }} />
            ) : null}
            {/* 拖动吸附参考线(青色十字) */}
            {showGuides && guideLines.v !== null ? (
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(guideLines.v / tpl.width) * 100}%`, width: 1, background: '#22d3ee', pointerEvents: 'none', zIndex: 95 }} />
            ) : null}
            {showGuides && guideLines.h !== null ? (
              <div style={{ position: 'absolute', left: 0, right: 0, top: `${(guideLines.h / tpl.height) * 100}%`, height: 1, background: '#22d3ee', pointerEvents: 'none', zIndex: 95 }} />
            ) : null}
            {/* 对齐工具条(选中图层时出现;相对画布六向) */}
            {selectedLayer && !pcRunning ? (
              <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: 'rgba(30,30,32,0.92)', border: '1px solid #3a3a3e', borderRadius: 8, padding: '3px 5px', zIndex: 80 }}>
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

/** 项目切换后的编辑器状态回读(2026-10-30 项目制):直接套用新项目目录的 props 快照
    (模板/图层/显隐),不走 origin 门——这是用户主动切换,不是 agent 回流。 */
async function reloadProjectState(): Promise<void> {
  try {
    const r = await fetch('/tintin/cover/api/acp/props').then((x) => x.json())
    const record = r?.record as { templateId?: string; props?: Record<string, unknown>; hiddenLayers?: string[] } | null
    if (!record) return
    if (typeof record.templateId === 'string' && record.templateId) useEditor.getState().setTemplate(record.templateId)
    const defaults = getTemplate(useEditor.getState().templateId).defaultProps
    useEditor.setState({
      props: { ...defaults, ...(record.props && typeof record.props === 'object' ? record.props : {}) },
      hiddenLayers: Array.isArray(record.hiddenLayers) ? [...record.hiddenLayers] : [],
    })
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
function useAgentPropsSync(): void {
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
              useEditor.setState({ props: { ...defaults, ...record.props } })
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
export const EditorApp: React.FC = () => {
  const [showExport, setShowExport] = React.useState(false)
  const [showServer, setShowServer] = React.useState(false)
  /* 封面项目制(2026-10-30 用户裁决):tab=项目;切换=目录+会话(iframe 按纪元重挂)跟随 */
  const [projects, setProjects] = React.useState<Array<{ name: string; mtimeMs: number }>>([])
  const [currentProject, setCurrentProject] = React.useState('')
  const [projectEpoch, setProjectEpoch] = React.useState(0)
  const [renaming, setRenaming] = React.useState<{ from: string; value: string } | null>(null)

  const applyProjectSwitch = (r: { current?: unknown; projects?: Array<{ name: string; mtimeMs: number }> }): void => {
    if (Array.isArray(r.projects)) setProjects(r.projects)
    setCurrentProject(String(r.current ?? ''))
    setProjectEpoch((e) => e + 1)
    void reloadProjectState()
  }
  React.useEffect(() => {
    let stop = false
    void fetch('/tintin/cover/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((x) => x.json())
      .then((r) => { if (!stop && r?.ok) { setProjects(r.projects ?? []); setCurrentProject(String(r.current ?? '')) } })
      .catch(() => {})
    return () => { stop = true }
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
  useChatContextPush()
  useAgentPropsSync()
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
    void fetch('/tintin/cover/api/pc/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
  }
  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 6, border: 0, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
  }
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#141416', color: '#e8e8e6' }}>
      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: '#1a1a1c', borderBottom: '1px solid #333' }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg,#4f7cff,#22d3ee)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff' }}>T</div>
        <span style={{ fontWeight: 700, fontSize: 13, flexShrink: 0 }}>封面制作</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: '0 1 auto', overflowX: 'auto', overflowY: 'hidden', padding: '0 2px' }}>
          {projects.map((p) => {
            const active = p.name === currentProject
            const isRenaming = renaming?.from === p.name
            return (
              <div
                key={p.name}
                onClick={() => { if (!isRenaming && !active) void switchProject(p.name) }}
                onDoubleClick={() => setRenaming({ from: p.name, value: p.name })}
                title={active ? `${p.name}（当前项目）· 双击重命名` : `${p.name} · 点击切换 · 双击重命名`}
                style={{
                  flexShrink: 0, maxWidth: 180, display: 'flex', alignItems: 'center', cursor: 'pointer',
                  padding: '4px 12px', borderRadius: 7, fontSize: 11.5, whiteSpace: 'nowrap',
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
                ) : p.name}
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
        <button onClick={openPhotoCraft} title="用 PhotoCraft 打开精修" style={{ ...iconBtn, background: 'rgba(34,211,238,0.1)', color: '#22d3ee' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
        </button>
        <button onClick={() => setShowServer(true)} title="服务设置（服务端地址 + MCP 自动发现）" style={{ ...iconBtn, background: 'rgba(126,226,168,0.1)', color: '#7ee2a8', fontSize: 14, fontWeight: 800 }}>
          ⚙
        </button>
        <button onClick={() => setShowExport(true)} title="导出封面 PNG" style={{ ...iconBtn, background: 'rgba(79,124,255,0.1)', color: '#93c5fd' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <span style={{ color: '#8b8b88', fontSize: 11 }}>dsh-tintin-cover-plugin</span>
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
                <LayersPanel />
              </div>
            </div>
          </div>
          <AssetsPanel />
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
