// transform-frame — 选择框+8 手柄+缩放会话(路线 v2 步骤4;设计真源=§7.27,PhotoCraft 四约束):
// ①命中/光标同源=layer-geom HANDLES 单表(手柄屏幕像素恒定尺寸 HANDLE_PX/totalScale,缩放无关);
// ②按下即开会话(手柄 pointerdown+setPointerCapture,无第二套拖拽实现);
// ③拖拽几何只存会话 ref,预览=el.style.transformOrigin 锚点+el.style.scale(CSS 独立属性,
//   与提交同数学),文档零改动;④提交=applyGeom 单命令=一条历史;Esc/pointercancel 清预览零成本。
// v1 边界(§7.27):框=主选单层;仅未旋转层(|norm180(rotate)|<0.5)出手柄(旋转层=仅框提示,
//   旋转缩放待 quad→Homography 会话);custom 无显式高=比例层只给角柄(边柄单轴破坏纵横比);
//   锁定层仅框。框色不随主题(选区语义,PhotoCraft Move 框同口径)。
import { useSyncExternalStore } from 'react'
import React from 'react'
import { getTemplate } from '../registry'
import { canvasFrameNow, layerEl, type CanvasBox } from './canvas-geom'
import { lockedOf } from './image-ops'
import {
  beginResize, HANDLE_PX, handleCursor, handlePoint, HANDLES, resizeEntry, sessionPreviewBox,
  sessionPreviewCss, type Handle, type LayerKind, type ResizeSession,
} from './layer-geom'
import { liveLayer, liveLayerSnapshot, subscribeLiveLayer } from './ui'
import { useEditor } from './store'
import { canvasDragFreeze } from './use-canvas-zoom'

const FRAME_COLOR = '#3b82f6'

const norm180 = (deg: number): number => {
  const d = ((deg % 360) + 540) % 360 - 180
  return d === -180 ? 180 : d
}

interface LayerInfo {
  kind: LayerKind | null
  rotated: boolean
  locked: boolean
  /** custom 无显式高=比例层(只给角柄) */
  ratioOnly: boolean
  base: ResizeSession['base']
}

export function TransformFrame({ id, totalScale, boxOf }: {
  id: string | null
  /** 总缩放(屏幕 px/画布 px)——手柄屏幕恒定尺寸与框定位共用 */
  totalScale: number
  /** 画布提供的统一测量(boxInFrame;§7.27 单一换算入口) */
  boxOf: (el: Element) => CanvasBox | null
}): React.ReactElement | null {
  const props = useEditor((s) => s.props)
  const templateId = useEditor((s) => s.templateId)
  const hiddenLayers = useEditor((s) => s.hiddenLayers)
  const live = useSyncExternalStore(subscribeLiveLayer, () => liveLayer, () => liveLayer)
  const [measured, setMeasured] = React.useState<{ box: CanvasBox; layoutW: number; layoutH: number } | null>(null)
  const sessionRef = React.useRef<ResizeSession | null>(null)
  const captureRef = React.useRef<HTMLElement | null>(null)
  const previewElRef = React.useRef<HTMLElement | null>(null)
  const endPointerRef = React.useRef<{ x: number; y: number } | null>(null)
  const rafRef = React.useRef(0)
  const readoutRef = React.useRef<HTMLDivElement>(null)
  const endRef = React.useRef<(commit: boolean) => void>(() => {})

  /* 测量(渲染后+关键依赖变化;rAF 等布局落定;图片未加载完补一次 load 监听) */
  React.useLayoutEffect(() => {
    const read = (): void => {
      const frame = canvasFrameNow()
      const el = id ? layerEl(id, frame?.root) : null
      const box = el ? boxOf(el) : null
      setMeasured(el && box ? { box, layoutW: el.offsetWidth, layoutH: el.offsetHeight } : null)
    }
    const raf = requestAnimationFrame(read)
    const frame = canvasFrameNow()
    const el = id ? layerEl(id, frame?.root) : null
    if (el instanceof HTMLImageElement && !el.complete) el.addEventListener('load', read, { once: true })
    return () => { cancelAnimationFrame(raf); el?.removeEventListener('load', read) }
  }, [id, props, templateId, totalScale, boxOf, live.v])

  /* kind/旋转/锁定/基值(统一读口,§7.27:三种 kind 元素矩形即视觉盒) */
  const info = React.useMemo<LayerInfo | null>(() => {
    if (!id) return null
    const tpl = getTemplate(templateId)
    const def = tpl.layerDefs.find((d) => d.id === id)
    const styles = props.styles as Record<string, { dx?: number; dy?: number; gscale?: number; sx?: number; sy?: number; rotate?: number } | undefined> | undefined
    const custom = (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; x: number; y: number; width: number; height?: number; rotate?: number }>) : []).find((l) => l.id === id)
    let kind: LayerKind | null = null
    let rotated = false
    let base: ResizeSession['base'] = {}
    let ratioOnly = false
    if (id.startsWith('img-')) {
      if (!custom) return null
      kind = 'custom'
      rotated = Math.abs(norm180(custom.rotate ?? 0)) > 0.5
      ratioOnly = custom.height === undefined || custom.height === null
      base = { x: custom.x, y: custom.y, width: custom.width, height: custom.height ?? null }
    } else if (def?.type === 'product') {
      kind = 'slot'
      const st = styles?.[id] ?? {}
      rotated = Math.abs(norm180(st.rotate ?? 0)) > 0.5
      base = { dx: st.dx ?? 0, dy: st.dy ?? 0, sx: st.sx, sy: st.sy }
    } else if (def?.type === 'environment') {
      const bg = String((props as Record<string, unknown>)[def.propsKey ?? def.id] ?? '')
      if (!bg) return null // 无底图的装饰环境层没有可缩放对象
      kind = 'slot'
      const st = styles?.[id] ?? {}
      rotated = Math.abs(norm180(st.rotate ?? 0)) > 0.5
      base = { dx: st.dx ?? 0, dy: st.dy ?? 0, sx: st.sx, sy: st.sy }
    } else if (def?.type === 'text') {
      kind = 'text'
      const st = styles?.[id] ?? {}
      rotated = Math.abs(norm180(st.rotate ?? 0)) > 0.5
      base = { dx: st.dx ?? 0, dy: st.dy ?? 0, gscale: st.gscale }
    } else {
      return null
    }
    return { kind, rotated, locked: lockedOf(props, id), ratioOnly, base }
  }, [id, props, templateId])

  const endSession = (commit: boolean): void => {
    const ses = sessionRef.current
    sessionRef.current = null
    canvasDragFreeze.active = false // 会话结束放行 agent/截图轮询(同体拖语义)
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    window.removeEventListener('keydown', onEsc)
    const pel = previewElRef.current
    if (pel) { pel.style.transformOrigin = ''; pel.style.scale = '' }
    previewElRef.current = null
    if (readoutRef.current) readoutRef.current.style.display = 'none'
    if (captureRef.current) { try { captureRef.current.releasePointerCapture(ses?.pointerId ?? 0) } catch { /* 已隐式释放 */ } captureRef.current = null }
    if (!ses || !commit) return
    const p = endPointerRef.current
    if (!p) return
    useEditor.getState().applyGeom([resizeEntry(ses, sessionPreviewBox(ses, p))]) // ④单命令=一条历史
  }
  endRef.current = endSession
  const onEsc = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') endRef.current(false) }

  const toCanvas = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const frame = canvasFrameNow()
    if (!frame || frame.rect.width <= 0) return null
    return { x: (e.clientX - frame.rect.left) / frame.scale, y: (e.clientY - frame.rect.top) / frame.scale }
  }
  const showReadout = (clientX: number, clientY: number, text: string): void => {
    const el = readoutRef.current
    if (!el) return
    el.style.display = 'block'
    el.style.left = `${clientX + 14}px`
    el.style.top = `${clientY + 14}px`
    el.textContent = text
  }

  const startSession = (h: Handle, e: React.PointerEvent): void => {
    if (!measured || !info?.kind || info.locked || info.rotated || sessionRef.current) return
    e.stopPropagation(); e.preventDefault()
    const p = toCanvas(e)
    if (!p) return
    sessionRef.current = beginResize(id!, info.kind, h, measured.box, info.base, p, e.pointerId)
    endPointerRef.current = p
    captureRef.current = e.currentTarget as HTMLElement
    previewElRef.current = layerEl(id!, canvasFrameNow()?.root)
    canvasDragFreeze.active = true // 会话期间冻结轮询(防 agent 回流扰动预览;提交后放行)
    window.addEventListener('keydown', onEsc)
    try { captureRef.current.setPointerCapture(e.pointerId) } catch { /* 合成指针守卫 */ }
  }
  const moveSession = (e: React.PointerEvent): void => {
    const ses = sessionRef.current
    if (!ses || e.pointerId !== ses.pointerId) return
    e.preventDefault()
    endPointerRef.current = toCanvas(e)
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const ses2 = sessionRef.current
      const p = endPointerRef.current
      if (!ses2 || !p) return
      const nb = sessionPreviewBox(ses2, p)
      const css = sessionPreviewCss(ses2, nb, measured?.layoutW ?? 1, measured?.layoutH ?? 1)
      const pel = previewElRef.current
      if (pel) { pel.style.transformOrigin = css.origin; pel.style.scale = css.scale } // ③纯预览,文档零改动
      const f = ses2.box0.w > 0 ? nb.w / ses2.box0.w : 1
      showReadout(e.clientX, e.clientY, `缩放 ${Math.round(f * 100)}%`)
    })
  }

  // 会话期间保持挂载(pointer capture 随卸载丢失=会话卡死);体拖中(live.posId)隐藏防框滞留
  const hide = !id || !measured || !info || !info.kind || hiddenLayers.includes(id) || live.posId === id
  if (hide) return null
  const box = measured!.box
  const s = Math.max(totalScale, 0.0001)
  const hs = HANDLE_PX / s // 手柄边长(content px)=屏幕恒定
  const handles: Handle[] = info.kind === 'custom' && info.ratioOnly ? ['nw', 'ne', 'se', 'sw'] : [...HANDLES]
  const handleable = !info.rotated && !info.locked

  return (
    <>
      <div
        data-cover-frame=""
        title={info.locked ? '图层已锁定位置' : info.rotated ? '旋转层:缩放请用属性面板(角度/宽高)' : undefined}
        style={{ position: 'absolute', left: box.left * s, top: box.top * s, width: box.w * s, height: box.h * s, border: `1px solid ${FRAME_COLOR}`, pointerEvents: 'none', zIndex: 60, boxSizing: 'border-box' }}
      />
      {handleable ? handles.map((h) => {
        const pt = handlePoint(box, h)
        return (
          <div
            key={h}
            data-handle={h}
            onPointerDown={(e) => startSession(h, e)} // ②按下即开会话
            onPointerMove={moveSession}
            onPointerUp={() => endSession(true)}
            onPointerCancel={() => endSession(false)}
            style={{
              position: 'absolute', left: pt.x * s - hs / 2, top: pt.y * s - hs / 2, width: hs, height: hs,
              background: '#ffffff', border: '1px solid #1e293b', boxSizing: 'border-box',
              pointerEvents: 'auto', cursor: handleCursor(h), zIndex: 61, touchAction: 'none',
            }}
          />
        )
      }) : null}
      <div ref={readoutRef} style={{ position: 'fixed', display: 'none', zIndex: 13000, pointerEvents: 'none', background: 'rgba(24,24,24,0.92)', color: 'var(--text)', border: '1px solid var(--accent-soft)', borderRadius: 6, padding: '2px 7px', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap' }} />
    </>
  )
}
