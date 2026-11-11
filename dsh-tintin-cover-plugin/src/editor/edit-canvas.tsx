// edit-canvas — 画布面板(2026-11-11 WP-A2 自 App.tsx 提取付账 + 用户裁决「编辑态弃
// Remotion Player 改自持画布」落地):
// · RenderSurface 直接渲染模板(无 Player 壳,remotion 走 shim);几何/命中全归编辑器;
// · 2026-11-11 用户裁决:画布选择框/角柄/边柄/旋转柄/悬停框整套 chrome 移除(三轮修复
//   不稳:偏移双重计入→修复后实测仍见旧位残影与连杆横穿画布;裁决「无法正常处理就
//   不要此功能」)。保留:点选/Shift 多选/拖动+智能吸附/Alt 循环选层/Alt 复制/快捷键/
//   就地编辑/拖放建层/智能参考线/用户参考线/标尺/网格/纯净预览;尺寸/位置/缩放/旋转/对齐
//   编辑走属性面板数值字段与对齐按钮(align-row;画布浮动对齐条 R15 随裁决删除)。
//   几何数学(sel-geom/image-ops resize 族/text-scale)留档不删,待整套重设计后复用;
// · 拖动/吸附/读数/Alt 循环/空格纯净预览/快捷键/就地编辑/拖放=原行为零改动;
// · 顺手修: 旧 App 级 Ctrl+滚轮监听与 useCanvasZoom 重复挂载(每次滚轮 1.21 倍),
//   本文件只留 useCanvasZoom 锚点缩放。
import React from 'react'
import { getTemplate } from '../registry'
import { RenderSurface } from './render-surface'
import { useCanvasShortcuts } from './canvas-keys'
import { canvasBoxIn, compositionRectIn, compRectRef, layerEl, type CanvasBox } from './canvas-geom'
import { clampScale, lockedOf } from './image-ops'
import { usePurePreview, cycleLayerSelection } from './canvas-aux'
import { useInlineEditor } from './inline-edit'
import { useEditor } from './store'
import { canvasDragFreeze, useCanvasZoom } from './use-canvas-zoom'
import { useUserGuides } from './use-user-guides'
import { CanvasRulers } from './canvas-rulers'
import { liveLayer, notifyLiveLayer } from './ui'

/* PhotoCraft 智能参考线 magenta(crates/engine/src/snap.rs smart guides 同色系) */
const GUIDE_COLOR = '#ff2bbf'
/* R9b 用户参考线青色(PS guides 视觉系) */
const GUIDE_USER_COLOR = 'rgba(0,191,255,0.85)'

export function CanvasPanel({ project }: { project: string }): React.ReactElement {
  const { templateId, props, hiddenLayers } = useEditor()
  const tpl = getTemplate(templateId)
  const selectLayer = useEditor((s) => s.selectLayer)
  const toggleMultiSelect = useEditor((s) => s.toggleMultiSelect)
  const multiSelected = useEditor((s) => s.multiSelected)
  const setProp = useEditor((s) => s.setProp)
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const addCustomLayer = useEditor((s) => s.addCustomLayer)
  const setCustomLayer = useEditor((s) => s.setCustomLayer)
  const duplicateCustomLayer = useEditor((s) => s.duplicateCustomLayer)
  const userGuides = useEditor((s) => s.userGuides)
  const addUserGuide = useEditor((s) => s.addUserGuide)
  const removeUserGuide = useEditor((s) => s.removeUserGuide)
  const showGuides = useEditor((s) => s.guides)
  const showGrid = useEditor((s) => s.canvasGrid)
  const zoom = useEditor((s) => s.zoom)
  const fitScale = useEditor((s) => s.fitScale)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  /* R8 标尺(对照 PhotoCraft/PS 画布标尺): 顶/左两条,画布 px 刻度;刻度层随滚动/缩放
     平移对齐(ref 直写零重渲染),指针十字标跟随。 */
  const contentRef = React.useRef<HTMLDivElement>(null)
  const rulerXRef = React.useRef<HTMLDivElement>(null)
  const rulerYRef = React.useRef<HTMLDivElement>(null)
  const markerXRef = React.useRef<HTMLDivElement>(null)
  const markerYRef = React.useRef<HTMLDivElement>(null)
  const selectedLayer = useEditor((s) => s.selectedLayer)
  /* 拖动吸附参考线:直接 DOM 更新(ref),不走 React 状态——拖动全程零重渲染(2026-10-31 方案 B) */
  const guideVRef = React.useRef<HTMLDivElement>(null)
  const guideHRef = React.useRef<HTMLDivElement>(null)
  const readoutRef = React.useRef<HTMLDivElement>(null)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const playerWrapRef = React.useRef<HTMLDivElement>(null)
  /* 预览-提交分离(2026-10-31 方案 B,对照 PhotoCraft MovePreview):拖动中只改被拖元素的 CSS
     translate(纯视觉,模板树零重渲染),pointerup 一次性提交 props;死区 3 屏幕px 内=点击。
     2026-10-31 抖动加固: rAF 合帧(120Hz 指针流→每帧一次 DOM 写)/吸附滞回(防参考线边界反复跳)/
     拖动中禁原生文本选择/被拖元素提升合成层/智能体 props 轮询在拖动中冻结(见 useAgentPropsSync)。 */
  const dragRef = React.useRef<
    | {
        kind: 'custom' | 'fixed'; layerId: string; pointerId: number;
        startX: number; startY: number; baseX: number; baseY: number; scale: number;
        baseLeft: number; baseTop: number; boxW: number; boxH: number;
        el: HTMLElement | null; active: boolean; curX: number; curY: number;
        snapX: { at: number; guide: number } | null; snapY: { at: number; guide: number } | null;
        candsX: { at: number; guide: number }[]; candsY: { at: number; guide: number }[];
        raf: number; curCX: number; curCY: number;
        moves: Array<{ id: string; kind: 'custom' | 'fixed'; baseX: number; baseY: number; el: HTMLElement | null }>;
      }
    | null
  >(null)
  useCanvasZoom(tpl, playerWrapRef, scrollRef)
  /* Ctrl+拖动=等比缩放(2026-11-11 R18 用户裁决:按住 Ctrl 要像 PhotoCraft 变换框一样放大缩小;
     选择框/手柄已按裁决拆除,Ctrl 手势是替代入口;Ctrl+滚轮仍是画布缩放)。
     预览=el.style.scale(CSS 独立属性,与模板 transform 相乘,transform-origin 默认居中);
     提交:文字=gscale(0.3..3,几何缩放不改字号)、自由图片=width/height(围中心扩缩,补偿 x/y)、
     槽位=sx/sy(模板变换原点在中心,天然居中)。 */
  const scaleRef = React.useRef<{
    id: string; kind: 'text' | 'custom' | 'slot'; pointerId: number
    cx: number; cy: number; startDist: number; f: number; el: HTMLElement | null
    baseGscale: number; baseW: number; baseH: number; baseX: number; baseY: number
    baseSx: number; baseSy: number
  } | null>(null)
  /** 合成盒(按模板比例缩放的画布容器)= 拖动/对齐/落点的统一坐标系;
   *  每渲染刷新 compRectRef(text-properties 变换段 W/H/X/Y 的测量基准)。 */
  const compositionRect = (): DOMRect | null => {
    const rect = compositionRectIn(hostRef.current, playerWrapRef.current)
    compRectRef.current = rect // R11c: 属性面板测量共享
    return rect
  }
  React.useLayoutEffect(() => { compositionRect() })
  /** 客户端坐标 → 画布 px(含换算比例) */
  const canvasPoint = (clientX: number, clientY: number): { x: number; y: number; scale: number } => {
    const rect = compositionRect()
    const scale = rect && rect.width > 0 ? rect.width / tpl.width : 1
    return { x: (clientX - (rect?.left ?? 0)) / scale, y: (clientY - (rect?.top ?? 0)) / scale, scale }
  }
  /** 图层元素的画布盒(含 translate/scale 的视觉框 → 画布 px) */
  const canvasBoxOf = (el: Element): CanvasBox => canvasBoxIn(el, compositionRect(), tpl.width)
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
          await fetch('/tintin/ipc/cover/acp/asset-sync', {
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
        const r = await fetch(`/tintin/ipc/cover/upload-image?name=${encodeURIComponent(file.name)}&project=${encodeURIComponent(project)}`, {
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
      if (canvasDragFreeze.active) return // 拖动中冻结:props 回流会触发整树重渲(抖动源),拖完下个轮询自然追上
      try {
        const r = await fetch('/tintin/ipc/cover/pc/screenshot').then((resp) => resp.json())
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
    showReadoutText(clientX, clientY, `${Math.round(dx)} px, ${Math.round(dy)} px`)
  }
  const showReadoutText = (clientX: number, clientY: number, text: string): void => {
    const el = readoutRef.current
    if (!el) return
    el.style.display = 'block'
    el.style.left = `${clientX + 14}px`
    el.style.top = `${clientY + 14}px`
    el.textContent = text
  }
  const hideReadout = (): void => {
    const el = readoutRef.current
    if (el) el.style.display = 'none'
  }

  /* T1.3 双击就地编辑(逻辑在 inline-edit.tsx): 双击文字层 → 覆盖 textarea → 防抖写 props */
  const inline = useInlineEditor({
    tpl, props, setProp, hostRef, contentRef, layerAt, pcRunning, fitScale, zoom,
  })
  const openInlineEdit = (clientX: number, clientY: number): void => inline.open(clientX, clientY)

  const onPointerDown = (e: React.PointerEvent): void => {
    if (pcRunning) return // PhotoCraft 为主:画布交互在原生窗口,网页仅镜像
    if (dragRef.current || scaleRef.current) return // 已在拖动/缩放:忽略第二指
    let id = layerAt(e.clientX, e.clientY)
    /* R8 多选(对照 PhotoCraft Shift+点击加选):Shift+命中层=切换其多选态(主选跟随),
       不启动拖动;普通点击走单选(内部清多选)。 */
    if (e.shiftKey && id) { toggleMultiSelect(id); return }
    /* R8: 命中已选层(主选或多选成员)=保持选择整体拖;命中未选层/空处=替换选择 */
    const alreadyIn = id !== null && (id === selectedLayer || multiSelected.includes(id))
    if (!alreadyIn) selectLayer(id)
    if (!id) return
    // 锁定位置:只选中不拖动;Alt+拖动仍可拖出副本(副本不带锁,同 PhotoCraft)
    if (lockedOf(props, id) && !(e.altKey && id.startsWith('img-'))) return
    /* Ctrl+拖动=等比缩放(PhotoCraft free transform 语义;不落拖动) */
    if (e.ctrlKey && !e.altKey) {
      const el = layerEl(id)
      if (!el) return
      const kind: 'text' | 'custom' | 'slot' = id.startsWith('img-') ? 'custom' : id === 'product' ? 'slot' : 'text'
      if (kind === 'text' && !tpl.layerDefs.some((d) => d.id === id && d.type === 'text')) return
      const layer = kind === 'custom' ? (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; x: number; y: number; width: number; height?: number }>) : []).find((l) => l.id === id) : undefined
      if (kind === 'custom' && !layer) return
      const look = (props.styles as Record<string, { gscale?: number; sx?: number; sy?: number }> | undefined)?.[id]
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      scaleRef.current = {
        id, kind, pointerId: e.pointerId, cx, cy,
        startDist: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)),
        f: 1, el,
        baseGscale: typeof look?.gscale === 'number' ? look.gscale : 1,
        baseW: layer?.width ?? Math.round(el.offsetWidth),
        baseH: layer?.height ?? Math.round(el.offsetHeight),
        baseX: layer?.x ?? 0, baseY: layer?.y ?? 0,
        baseSx: typeof look?.sx === 'number' ? look.sx : 1,
        baseSy: typeof look?.sy === 'number' ? look.sy : 1,
      }
      canvasDragFreeze.active = true
      try { hostRef.current?.setPointerCapture?.(e.pointerId) } catch { /* 合成指针守卫 */ }
      return
    }
    const compRect = compositionRect()
    if (!compRect) return
    const scale = compRect.width / tpl.width
    const dragEl = layerEl(id)
    const baseBox = dragEl ? canvasBoxOf(dragEl) : null
    let baseX = 0
    let baseY = 0
    let kind: 'custom' | 'fixed' = 'fixed'
    if (id.startsWith('img-')) {
      let layer = (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; image: string; x: number; y: number; width: number; opacity?: number; rotate?: number; group?: string }>) : []).find((l) => l.id === id)
      if (!layer) return
      if (e.altKey) {
        /* Alt+拖动=复制图层再拖副本(PhotoCraft Duplicate+Move):整层属性照搬,副本紧贴原层之上 */
        const nid = duplicateCustomLayer(layer.id)
        if (!nid) return
        id = nid
        layer = { ...layer, id: nid }
      }
      kind = 'custom'
      baseX = layer.x
      baseY = layer.y
    } else {
      const styles = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[id]
      baseX = styles?.dx ?? 0
      baseY = styles?.dy ?? 0
    }
    try { hostRef.current?.setPointerCapture?.(e.pointerId) } catch { /* 指针已释放等场景捕获可抛(NotFoundError),拖动链不因此中断 */ } // 两分支都捕获:拖出画布事件不断流
    /* R8 多选整体移: moves=主选+全部多选层,各自基位与元素;主选=layerId(吸附/读数/live 通道) */
    /* 选择集=点击层+主选+多选成员(点 multi 成员时主选也要一起动) */
    const primary = useEditor.getState().selectedLayer
    const moveIds = [...new Set([id, ...(primary ? [primary] : []), ...useEditor.getState().multiSelected])]
    const moves = moveIds.map((mid) => {
      if (mid === id) return { id: mid, kind, baseX, baseY, el: dragEl as HTMLElement | null }
      if (mid.startsWith('img-')) {
        const l = (Array.isArray(props.customLayers) ? (props.customLayers as Array<{ id: string; x: number; y: number }>) : []).find((v) => v.id === mid)
        return { id: mid, kind: 'custom' as const, baseX: l?.x ?? 0, baseY: l?.y ?? 0, el: hostRef.current?.querySelector('[data-cover-layer="' + mid + '"]') as HTMLElement | null }
      }
      const st = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[mid]
      return { id: mid, kind: 'fixed' as const, baseX: st?.dx ?? 0, baseY: st?.dy ?? 0, el: hostRef.current?.querySelector('[data-cover-layer="' + mid + '"]') as HTMLElement | null }
    })
    dragRef.current = {
      kind, layerId: id, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, baseX, baseY, scale,
      baseLeft: baseBox ? baseBox.left - baseX : 0, baseTop: baseBox ? baseBox.top - baseY : 0, boxW: baseBox?.w ?? 200, boxH: baseBox?.h ?? 200,
      el: dragEl as HTMLElement | null, active: false, curX: baseX, curY: baseY,
      snapX: null, snapY: null, candsX: [], candsY: [], raf: 0, curCX: e.clientX, curCY: e.clientY,
      moves,
    }
  }
  /** 标尺对齐: 刻度层平移=内容原点相对 wrap 视口的偏移(随滚动/缩放;ref 直写) */
  const syncRulers = (): void => {
    const wrap = playerWrapRef.current
    const content = contentRef.current
    if (!wrap || !content) return
    const wr = wrap.getBoundingClientRect()
    const cr = content.getBoundingClientRect()
    if (rulerXRef.current) rulerXRef.current.style.transform = `translateX(${cr.left - wr.left}px)`
    if (rulerYRef.current) rulerYRef.current.style.transform = `translateY(${cr.top - wr.top}px)`
  }
  React.useLayoutEffect(() => { syncRulers() }, [tpl, fitScale, zoom])
  /** 标尺十字标跟随指针(视口 px;ref 直写) */
  const syncRulerMarker = (clientX: number, clientY: number): void => {
    const wrap = playerWrapRef.current
    if (!wrap) return
    const wr = wrap.getBoundingClientRect()
    if (markerXRef.current) { markerXRef.current.style.transform = `translateX(${clientX - wr.left}px)`; markerXRef.current.style.display = 'block' }
    if (markerYRef.current) { markerYRef.current.style.transform = `translateY(${clientY - wr.top}px)`; markerYRef.current.style.display = 'block' }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (guideDragRef.current) { moveGuidePreview(e); return } // R9b 参考线拖拽优先
    const sc = scaleRef.current
    if (sc) { // Ctrl 缩放预览:radial 距离比;CSS scale 与模板 transform 相乘
      if (e.pointerId !== sc.pointerId) return
      e.preventDefault()
      const dist = Math.hypot(e.clientX - sc.cx, e.clientY - sc.cy)
      sc.f = Math.min(20, Math.max(0.05, dist / sc.startDist))
      if (sc.el) sc.el.style.scale = `${sc.f}`
      showReadoutText(e.clientX, e.clientY, `缩放 ${Math.round(sc.f * 100)}%`)
      return
    }
    const drag = dragRef.current
    if (!drag) {
      // 悬停光标(2026-11-02 用户裁决:对齐 PhotoCraft=箭头,不用手型;Ctrl 按住=缩放光标)
      const host = hostRef.current
      if (host) host.style.cursor = e.ctrlKey && layerAt(e.clientX, e.clientY) ? 'nwse-resize' : 'default'
      return
    }
    syncRulerMarker(e.clientX, e.clientY)
    if (e.pointerId !== drag.pointerId) return
    e.preventDefault() // 拖动中禁原生行为(文本选择/图片拖拽)——选区重绘是抖动源之一
    const dxs = e.clientX - drag.startX
    const dys = e.clientY - drag.startY
    if (!drag.active) {
      if (Math.hypot(dxs, dys) < 3) return // 死区:手抖不算拖
      drag.active = true
      for (const m of drag.moves) if (m.el) m.el.style.willChange = 'translate' // 全部选中层提升合成层(R8)
      canvasDragFreeze.active = true
      // 层间智能吸附候选(激活时一次实测;拖动中其它层静止):其它图层的 左/中/右、上/中/下 线
      { const xs: { at: number; guide: number }[] = []; const ys: { at: number; guide: number }[] = []
        const push = (arr: { at: number; guide: number }[], at: number, guide: number) => { if (!arr.some((c) => Math.abs(c.at - at) < 0.5)) arr.push({ at, guide }) }
        hostRef.current?.querySelectorAll('[data-cover-layer]').forEach((elm) => {
          const node = elm as HTMLElement
          if (drag.moves.some((m) => m.id === node.dataset.coverLayer)) return // 多选整体作为拖动主体(全部排除出候选)
          const b = canvasBoxOf(node)
          for (const L of [b.left, b.left + b.w / 2, b.left + b.w]) { push(xs, L, L); push(xs, L - drag.boxW / 2, L); push(xs, L - drag.boxW, L) }
          for (const L of [b.top, b.top + b.h / 2, b.top + b.h]) { push(ys, L, L); push(ys, L - drag.boxH / 2, L); push(ys, L - drag.boxH, L) }
        })
        /* T2.4 等距分布候选(2026-11-10 对齐 PhotoCraft/PS 分布提示): 相邻两目标的中间点
           = 拖到这里与两目标等距;guide 值取中点(参考线标出分布位)。 */
        const sx = [...new Set(xs.map((c) => c.at))].sort((a, b) => a - b)
        for (let i = 0; i < sx.length - 1; i++) push(xs, (sx[i]! + sx[i + 1]!) / 2, (sx[i]! + sx[i + 1]!) / 2)
        const sy = [...new Set(ys.map((c) => c.at))].sort((a, b) => a - b)
        for (let i = 0; i < sy.length - 1; i++) push(ys, (sy[i]! + sy[i + 1]!) / 2, (sy[i]! + sy[i + 1]!) / 2)
        /* R9b 用户参考线入候选(对照 PS: 参考线吸附) */
        for (const g of userGuides.v) { push(xs, g, g); push(xs, g - drag.boxW, g) }
        for (const g of userGuides.h) { push(ys, g, g); push(ys, g - drag.boxH, g) }
        drag.candsX = xs
        drag.candsY = ys }
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
        ...(drag.candsX ?? []),
      ]
      const candsY = [
        { at: 0, guide: 0 }, { at: (tpl.height - drag.boxH) / 2, guide: tpl.height / 2 }, { at: tpl.height - drag.boxH, guide: tpl.height },
        ...(drag.candsY ?? []),
      ]
      if (drag.snapX) {
        /* 吸附值换算回基准空间(2026-11-01 修复跳变):固定层 dx=相对槽位原位的偏移,自定义层 x=画布绝对——
           两者统一为 base+x=视觉位,故吸附目标 at(画布绝对)必须减 baseLeft,否则固定层把绝对位当偏移写=跳到槽位原位+at */
        if (Math.abs(left - drag.snapX.at) <= stick) { x = drag.snapX.at - drag.baseLeft; gv = drag.snapX.guide }
        else drag.snapX = null
      }
      if (!drag.snapX) for (const c of candsX) if (Math.abs(left - c.at) <= T) { x = c.at - drag.baseLeft; gv = c.guide; drag.snapX = c; break }
      if (drag.snapY) {
        if (Math.abs(top - drag.snapY.at) <= stick) { y = drag.snapY.at - drag.baseTop; gh = drag.snapY.guide }
        else drag.snapY = null
      }
      if (!drag.snapY) for (const c of candsY) if (Math.abs(top - c.at) <= T) { y = c.at - drag.baseTop; gh = c.guide; drag.snapY = c; break }
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
      const ddx = x - drag.baseX
      const ddy = y - drag.baseY
      for (const m of drag.moves) {
        if (!m.el?.isConnected) m.el = (hostRef.current?.querySelector(`[data-cover-layer="${m.id}"]`) as HTMLElement | null) ?? null
        if (m.el) m.el.style.translate = `${ddx}px ${ddy}px` // 同一指针位移(R8 整体移);props 零写入
      }
      /* live 值广播(2026-11-10 对齐 PhotoCraft #128): 编辑卡 X/Y 拖动中实时跟随 */
      liveLayer.posId = drag.layerId
      liveLayer.posDx = Math.round(drag.curX)
      liveLayer.posDy = Math.round(drag.curY)
      notifyLiveLayer()
      showReadout(drag.curCX, drag.curCY, x - drag.baseX, y - drag.baseY)
    })
  }
  const endDragVisual = (drag: NonNullable<NonNullable<typeof dragRef.current>>): void => {
    if (drag.raf) cancelAnimationFrame(drag.raf)
    updateGuides(null, null)
    hideReadout()
    for (const m of drag.moves) if (m.el) { m.el.style.translate = ''; m.el.style.willChange = '' }
    canvasDragFreeze.active = false
    const host = hostRef.current
    if (host) host.style.userSelect = ''
  }
  const commitDrag = (drag: NonNullable<NonNullable<typeof dragRef.current>>): void => {
    liveLayer.posId = null
    notifyLiveLayer()
    if (!drag.active) return // 死区内松手=点击,不动
    const dx = Math.round(drag.curX - drag.baseX)
    const dy = Math.round(drag.curY - drag.baseY)
    if (dx === 0 && dy === 0) return // 0,0 早退(对照 PhotoCraft finish)
    /* R8: 全部选中层同一 delta 提交(吸附 delta 按主选算,整体平移不破坏相对关系) */
    for (const m of drag.moves) {
      if (m.kind === 'custom') setCustomLayer(m.id, { x: Math.round(m.baseX + dx), y: Math.round(m.baseY + dy) })
      else setLayerStyle(m.id, { dx: Math.round(m.baseX + dx), dy: Math.round(m.baseY + dy) })
    }
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    if (guideDragRef.current) { finishGuideDrag(e); return } // R9b 参考线落位/删除
    const sc = scaleRef.current
    if (sc) { // Ctrl 缩放提交(Ctrl+拖动;死区内 f≈1 不提交)
      scaleRef.current = null
      canvasDragFreeze.active = false
      if (sc.el) sc.el.style.scale = ''
      hideReadout()
      try { hostRef.current?.releasePointerCapture?.(e.pointerId) } catch { /* 已隐式释放 */ }
      const f = sc.f
      if (Math.abs(f - 1) < 0.01) return
      if (sc.kind === 'text') {
        setLayerStyle(sc.id, { gscale: Math.round(Math.min(3, Math.max(0.3, sc.baseGscale * f)) * 1000) / 1000 })
      } else if (sc.kind === 'slot') {
        setLayerStyle(sc.id, { sx: clampScale(sc.baseSx * f), sy: clampScale(sc.baseSy * f) })
      } else {
        const w = Math.max(20, Math.min(8000, Math.round(sc.baseW * f)))
        const h = Math.max(20, Math.min(8000, Math.round(sc.baseH * f)))
        setCustomLayer(sc.id, {
          width: w, height: h,
          x: Math.round(sc.baseX - (w - sc.baseW) / 2),
          y: Math.round(sc.baseY - (h - sc.baseH) / 2),
        })
      }
      return
    }
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    endDragVisual(drag)
    /* T3.7 Alt+点击循环选层(2026-11-10 P2.7): Alt 按住且本次为死区点击(未产生拖动/复制)
       → 在命中点的重叠图层栈里切到下一个;Alt+拖动仍是复制语义,互不干扰。 */
    if (e.altKey && !drag.active) {
      const stack = document.elementsFromPoint(drag.startX, drag.startY)
        .map((el) => (el as Element).closest('[data-cover-layer]'))
        .filter((el): el is Element => Boolean(el))
        .map((el) => el.getAttribute('data-cover-layer') || '')
      if (cycleLayerSelection(stack, hiddenLayers, selectedLayer, selectLayer)) {
        try { hostRef.current?.releasePointerCapture?.(e.pointerId) } catch { /* 已隐式释放 */ }
        return
      }
    }
    commitDrag(drag) // 离散事件内同步提交:清预览与写 props 同帧,无回跳
    try { hostRef.current?.releasePointerCapture?.(e.pointerId) } catch { /* 已隐式释放 */ }
  }
  const onPointerCancel = (): void => {
    if (guideDragRef.current) { // 参考线取消:预览消失(move 旧线已拔起=删除语义)
      guideDragRef.current = null
      if (previewHRef.current) previewHRef.current.style.display = 'none'
      if (previewVRef.current) previewVRef.current.style.display = 'none'
      return
    }
    if (scaleRef.current) { // Ctrl 缩放取消:清预览不提交
      if (scaleRef.current.el) scaleRef.current.el.style.scale = ''
      scaleRef.current = null
      canvasDragFreeze.active = false
      hideReadout()
      return
    }
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    endDragVisual(drag) // 丢弃预览:props 未动,元素回原位
  }
  /* T3.9 空格纯净预览(2026-11-10):按住 Space 隐藏全部辅助线/网格(只看画面) */
  const [purePreview, setPurePreview] = React.useState(false)
  const purePreviewRef = React.useRef(purePreview)
  purePreviewRef.current = purePreview
  usePurePreview(setPurePreview)
  const { guideDragRef, previewHRef, previewVRef, startGuideDrag, moveGuidePreview, finishGuideDrag } = useUserGuides({
    pcRunning, purePreview: purePreviewRef.current, fitScale, zoom, tpl, contentRef, userGuides, addUserGuide, removeUserGuide,
  })
  /* 快捷键(2026-11-01 对齐 PhotoCraft,自 onKeyDown 解耦为窗口级):见 canvas-keys.ts */
  useCanvasShortcuts(() => ({ all: Boolean(pcRunning), layer: Boolean(dragRef.current) }))

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      /* 捕获失败的兜底:指针已松开(无按键)却仍挂着拖动态 = 丢弃 */
      onPointerLeave={(e) => {
        if (!e.buttons && dragRef.current) onPointerCancel()
        if (markerXRef.current) markerXRef.current.style.display = 'none'
        if (markerYRef.current) markerYRef.current.style.display = 'none'
      }}
      onDoubleClick={(e) => openInlineEdit(e.clientX, e.clientY)}
      onDragOver={(e) => { if (!pcRunning) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={(e) => {
        if (pcRunning) return
        e.preventDefault()
        const layerName = e.dataTransfer.getData('application/x-tintin-cover-layer')
        if (layerName) { dropAsLayer(layerName, e.clientX, e.clientY); return }
        const file = e.dataTransfer.files?.[0]
        if (file && /image\//i.test(file.type)) uploadAsLayer(file, e.clientX, e.clientY)
      }}
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-field)', gap: 12, outline: 'none' }}>
      {/* Δ读数浮层(对照 PhotoCraft offset_readout):直接 DOM 写,拖动中跟指针 */}
      <div ref={readoutRef} style={{ position: 'fixed', display: 'none', zIndex: 13000, pointerEvents: 'none', background: 'rgba(24,24,24,0.92)', color: 'var(--text)', border: '1px solid var(--accent-soft)', borderRadius: 6, padding: '2px 7px', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap' }} />
      {pcRunning ? (
        <>
          {shot ? <img src={shot} alt="PhotoCraft" style={{ maxWidth: '96%', maxHeight: '74vh', borderRadius: 10, boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }} /> : null}
          <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>PhotoCraft 实时镜像 · 图层与编辑在 PhotoCraft 窗口 · 会话可直接驱动</div>
        </>
      ) : (
        <>
          <div ref={playerWrapRef} style={{ position: 'relative', width: '100%', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
            {/* 滚动层(2026-10-31 画布缩放 §2.6):内容按 zoom 放大,超出即滚动;对齐工具条
                在 playerWrap 层不随滚动(按实时 rect 定位)。Ctrl+滚轮缩放=useCanvasZoom 锚点缩放 */}
            <div ref={scrollRef} style={{ position: 'absolute', inset: 0, overflow: 'auto', display: 'flex', alignItems: zoom > 1 ? 'flex-start' : 'center', justifyContent: zoom > 1 ? 'flex-start' : 'center' }} onScroll={() => { compositionRect(); syncRulers() }}>
              <div ref={contentRef} data-tintin-cover-canvas="" style={{ position: 'relative', width: Math.round(tpl.width * fitScale * zoom), height: Math.round(tpl.height * fitScale * zoom), flexShrink: 0, margin: 'auto', imageRendering: zoom > 2 ? 'pixelated' : 'auto' }}>
                {/* WP-A2: 自持画布=模板组件直接渲染(无 Player 壳);remotion 经 shim */}
                <RenderSurface
                  component={tpl.component}
                  inputProps={{ ...props, hiddenLayers }}
                  width={tpl.width}
                  height={tpl.height}
                  scale={Math.max(fitScale * zoom, 0.0001)}
                  style={{ width: '100%', height: '100%', borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }}
                />
                {/* 画布网格(显示开关;编辑器视觉辅助,不进导出) */}
                {showGrid && !pcRunning && !purePreview ? (
                  <div data-preview-grid style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40, backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 40px), repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 40px)' }} />
                ) : null}
                {/* 拖动吸附参考线(PhotoCraft magenta;ref 直写,拖动全程零重渲染)——在缩放内容层内,随缩放对齐画布 */}
                <div ref={guideVRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: GUIDE_COLOR, pointerEvents: 'none', zIndex: 95, display: 'none' }} />
                <div ref={guideHRef} style={{ position: 'absolute', left: 0, right: 0, height: 1, background: GUIDE_COLOR, pointerEvents: 'none', zIndex: 95, display: 'none' }} />
                {/* R9b 用户参考线(青线;拖出建/拖动移/拖删;逻辑在 use-user-guides.ts) */}
                {!purePreview ? userGuides.h.map((y) => (
                  <div key={'ug-h' + y} style={{ position: 'absolute', left: 0, right: 0, top: `${(y / tpl.height) * 100}%`, height: 1, background: GUIDE_USER_COLOR, pointerEvents: 'none', zIndex: 94 }} />
                )) : null}
                {!purePreview ? userGuides.v.map((x) => (
                  <div key={'ug-v' + x} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(x / tpl.width) * 100}%`, width: 1, background: GUIDE_USER_COLOR, pointerEvents: 'none', zIndex: 94 }} />
                )) : null}
                <div ref={previewHRef} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, background: GUIDE_USER_COLOR, pointerEvents: 'none', zIndex: 96, display: 'none' }} />
                <div ref={previewVRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 1, background: GUIDE_USER_COLOR, pointerEvents: 'none', zIndex: 96, display: 'none' }} />
                {inline.element}
              </div>
            </div>
            {/* R8 标尺(组件在 canvas-rulers.tsx;刻度平移/十字标 ref 对齐,拖出参考线 R9b) */}
            <CanvasRulers tpl={tpl} scale={Math.max(fitScale * zoom, 0.0001)} rulerXRef={rulerXRef} rulerYRef={rulerYRef} markerXRef={markerXRef} markerYRef={markerYRef} onStartGuideDrag={startGuideDrag} />
          </div>
        </>
      )}
    </div>
  )
}
