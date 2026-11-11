// 编辑器状态(§9.3:图层树=props 投影;所有操作改同一份 props 快照,撤销走快照栈)
// 2026-10-28 扩展:customLayers(拖入图片=新图层)+ layerOrder(全图层 z 序,含固定层)。
import { temporal } from 'zundo'
import { create } from 'zustand'
import { getTemplate, templateOfOrientation, validateProps, type LayerDef } from '../registry'
import type { CustomLayer } from '../../templates/CustomLayers'
import type { ImageLook } from '../../templates/image-style'
import type { TextStyleOverride } from '../../templates/text-style'
import { arrangeOrder, clampScale, cloneLayer, type Arrange } from './image-ops'

/** 图层组归属净化(2026-10-31 阶段2):只认模板存在的图片组槽位(product/bgImage),
    其余(未知槽位/文字组/装饰组)剥除——组里只能放对应类型的图层。 */
function sanitizeGroup(templateId: string, group: unknown): string | undefined {
  if (typeof group !== 'string' || !group) return undefined
  const def = getTemplate(templateId).layerDefs.find((l) => l.id === group)
  if (!def) return undefined
  return def.type === 'product' || (def.propsKey ?? def.id) === 'bgImage' ? group : undefined
}

/** 智能体 props 回流的 customLayers 净化(逐层剥除非法组归属)。 */
export function sanitizeCustomLayers(templateId: string, layers: unknown): CustomLayer[] {
  if (!Array.isArray(layers)) return []
  return (layers as CustomLayer[]).map((l) => ({ ...(l && typeof l === 'object' ? l : ({} as CustomLayer)), group: sanitizeGroup(templateId, (l as CustomLayer | null)?.group) }))
}

export interface EditorState {
  templateId: string
  props: Record<string, unknown>
  hiddenLayers: string[]
  selectedLayer: string | null
  /** 多选(2026-11-11 §6.4 R8,PhotoCraft Shift+点击加选): 非主选的其余选中层;
   *  主选=selectedLayer(最后点击)。普通单击清空多选;多选仅移动/对齐/微调/删除语义 */
  multiSelected: string[]
  toggleMultiSelect: (id: string) => void
  clearMultiSelect: () => void
  /** R9a 批量几何(2026-11-11 §6.5): 一次 set 提交多层的 x/y(自定义层)或 dx/dy(固定层)
   *  ——多选整体移/组对齐/组微调=单条撤销记录(此前逐层 set=N 条) */
  applyLayerGeometry: (entries: Array<{ id: string; custom: boolean; x: number; y: number }>) => void
  /** R9a 批量删除自由图层(一次 set,一条撤销) */
  removeCustomLayers: (ids: string[]) => void
  /** R9c 组缩放提交(一次 set,一条撤销): 条目=groupScaleEntries 输出——
   *  custom=x/y/width/height;fixed=x/y→dx/dy+gscale 或 sx/sy(条目键位同 applyLayerGeometry) */
  applyGroupScale: (entries: Array<{ id: string; custom: boolean; x: number; y: number; width?: number; height?: number | null; gscale?: number; sx?: number; sy?: number }>) => void
  /** R9b 用户参考线(2026-11-11 §6.5,对照 PS 标尺拖出): 画布 px 位置;会话内存态
   *  (拖入/拖动/拖删各一条撤销);吸附与画布渲染共用 */
  userGuides: { h: number[]; v: number[] }
  addUserGuide: (axis: 'h' | 'v', pos: number) => void
  moveUserGuide: (axis: 'h' | 'v', from: number, to: number) => void
  removeUserGuide: (axis: 'h' | 'v', pos: number) => void
  /** 选中参考线(2026-11-11 用户裁决:点选参考线+Delete 删除;会话内存态,不进 props) */
  selectedGuide: { axis: 'h' | 'v'; pos: number } | null
  setSelectedGuide: (g: { axis: 'h' | 'v'; pos: number } | null) => void
  /** 素材区当前选中项(2026-10-31 §2.5 P1:编辑卡「从素材替换/设为产品图」的数据源) */
  selectedAsset: string | null
  /** 图层显示名(2026-11-11 WP-B 对齐 PhotoCraft 双击重命名;会话内存态,不进 props 契约、
   *  不进导出;空名=还原默认名。项目切换/回读时整体清空) */
  layerNames: Record<string, string>
  renameLayer: (id: string, name: string) => void
  lastExport: { ok: boolean; file?: string; error?: string } | null
  setTemplate: (id: string) => void
  /** 横竖屏切换(2026-10-27 裁决;2026-11-12 方案1 比例迁移):同族变体切换,内容保留,
   *  几何(图层位置/位移/缩放/参考线/选中线)按新旧画布比例映射 */
  setOrientation: (orientation: 'landscape' | 'portrait') => void
  setProp: (key: string, value: unknown) => void
  setLayerStyle: (layerId: string, patch: TextStyleOverride & ImageLook) => void
  toggleLayer: (id: string) => void
  selectLayer: (id: string | null) => void
  setSelectedAsset: (name: string | null) => void
  setLastExport: (r: EditorState['lastExport']) => void
  /** 生图引擎(2026-10-27 裁决:server=TinTin 服务端默认 | jimeng=即梦) */
  genEngine: 'server' | 'jimeng'
  setGenEngine: (engine: 'server' | 'jimeng') => void
  /** 自定义图片图层(2026-10-28):新增(置顶)/删除/局部改(x/y/width/opacity/rotate);
   *  2026-10-31 阶段2:新增可携带组归属(仅图片组,非法剥除) */
  addCustomLayer: (image: string, x: number, y: number, width?: number, group?: string) => string
  removeCustomLayer: (id: string) => void
  setCustomLayer: (id: string, patch: Partial<CustomLayer>) => void
  /** 全图层 z 序上移/下移(固定层+自定义层同一张序表) */
  moveLayer: (id: string, dir: 'up' | 'down') => void
  /** 拖拽排序(2026-10-29 用户裁决:图层面板拖 ⠿ 调序):active 移到 over 所在位置 */
  reorderLayer: (activeId: string, overId: string) => void
  /** 图层›排列(2026-11-01 对齐 PhotoCraft):置顶/上移一层/下移一层/置底 */
  arrangeLayer: (id: string, how: Arrange) => void
  /** 复制图层(PhotoCraft Ctrl+J):整层属性照搬,副本紧贴原层之上并选中;返回新 id */
  duplicateCustomLayer: (id: string, offset?: number) => string | null
  /** 预览显示开关(2026-10-28:仅编辑器视觉辅助,不进 props、不影响导出) */
  guides: boolean
  canvasGrid: boolean
  /** 画布缩放(2026-10-31 §2.6 对照 PhotoCraft):zoom 相对「适合窗口」倍率(0.25..4);
   *  fitScale=实测的基础适配比例(视口/画布),总缩放=fitScale×zoom——zoom=1 恒为适合窗口 */
  zoom: number
  setZoom: (z: number) => void
  fitScale: number
  setFitScale: (v: number) => void
  setGuides: (v: boolean) => void
  setCanvasGrid: (v: boolean) => void
}

/** 生效 z 序(自底向上):layerOrder 缺失/失效时按 模板固定层→自定义层 播种(旧快照兼容) */
export function effectiveOrder(state: Pick<EditorState, 'templateId' | 'props'>): string[] {
  const custom = Array.isArray(state.props.customLayers) ? (state.props.customLayers as CustomLayer[]) : []
  const customIds = custom.map((l) => l.id)
  const fixed = getTemplate(state.templateId).layerDefs.map((l) => l.id)
  const saved = state.props.layerOrder
  if (!Array.isArray(saved)) return [...fixed, ...customIds]
  const known = new Set([...fixed, ...customIds])
  const ordered = (saved as string[]).filter((id) => known.has(id))
  for (const id of [...fixed, ...customIds]) if (!ordered.includes(id)) ordered.push(id)
  return ordered
}
/** 删除后的选中接续(2026-11-11 用户裁决):面板序(上→下)里被删块的下一个;删到底部=剩下列表最后一个 */
function selectionAfterDelete(state: Pick<EditorState, 'templateId' | 'props'>, drop: Set<string>): string | null {
  const topToBottom = [...effectiveOrder(state)].reverse()
  const idxs = [...drop].map((id) => topToBottom.indexOf(id)).filter((i) => i >= 0)
  const maxIdx = idxs.length ? Math.max(...idxs) : -1
  for (let i = maxIdx + 1; i < topToBottom.length; i += 1) {
    const id = topToBottom[i]
    if (id && !drop.has(id)) return id
  }
  const remaining = topToBottom.filter((id) => !drop.has(id))
  return remaining.length ? remaining[remaining.length - 1] ?? null : null
}

function withOrder(state: EditorState, order: string[]): Pick<EditorState, 'props'> {
  return { props: { ...state.props, layerOrder: order } }
}

export const useEditor = create<EditorState>()(
  temporal(
    (set) => ({
      /* 默认竖屏(2026-11-12 用户裁决方案B):编辑器初始模板=video-portrait;
         新建封面项目由路由写入同款竖屏记录(engine.defaultCoverPropsRecord),不再继承上一个项目 */
      templateId: 'video-portrait',
      props: { ...getTemplate('video-portrait').defaultProps },
      hiddenLayers: [] as string[],
      selectedLayer: null as string | null,
      multiSelected: [] as string[],
      toggleMultiSelect: (id) =>
        set((s) => {
          /* R8 语义: 选择集 = {主选} ∪ 多选。toggle 对全集运算——加选保留旧主选在集内
             (对照 PhotoCraft Shift+点击),移除后主选=集内最后一个,空集=全清 */
          const sel = new Set([...s.multiSelected, ...(s.selectedLayer ? [s.selectedLayer] : [])])
          if (sel.has(id)) {
            sel.delete(id)
            const rest = [...sel]
            return { multiSelected: rest, selectedLayer: rest.length ? rest[rest.length - 1]! : null }
          }
          sel.add(id)
          const rest = [...sel]
          return { multiSelected: rest.filter((v) => v !== id), selectedLayer: id }
        }),
      clearMultiSelect: () => set({ multiSelected: [] }),
      applyLayerGeometry: (entries) =>
        set((s) => {
          let customLayers = Array.isArray(s.props.customLayers) ? [...(s.props.customLayers as CustomLayer[])] : []
          let styles = { ...(s.props.styles as Record<string, TextStyleOverride & ImageLook> | undefined) }
          for (const e of entries) {
            if (e.custom) {
              customLayers = customLayers.map((l) => (l.id === e.id ? { ...l, x: Math.round(e.x), y: Math.round(e.y) } : l))
            } else {
              styles[e.id] = { ...styles[e.id], dx: Math.round(e.x), dy: Math.round(e.y) }
            }
          }
          return { props: { ...s.props, customLayers, styles } }
        }),
      userGuides: { h: [], v: [] } as { h: number[]; v: number[] },
      addUserGuide: (axis, pos) =>
        set((s) => {
          const v = Math.round(pos)
          if (v < 0 || v > (axis === 'h' ? getTemplate(s.templateId).height : getTemplate(s.templateId).width)) return {}
          const cur = s.userGuides[axis]
          if (cur.some((g) => Math.abs(g - v) < 0.5)) return {}
          return { userGuides: { ...s.userGuides, [axis]: [...cur, v] } }
        }),
      moveUserGuide: (axis, from, to) =>
        set((s) => {
          const f = Math.round(from)
          const v = Math.round(to)
          if (v === f) return {} // 原位落点=点选语义,不产生撤销记录
          const cur = s.userGuides[axis]
          const i = cur.indexOf(f)
          if (i < 0 || v < -50 || v > (axis === 'h' ? getTemplate(s.templateId).height : getTemplate(s.templateId).width) + 50) return {}
          const next = [...cur]
          next[i] = v
          const merged = next.filter((g, gi) => gi === i || Math.abs(g - v) >= 0.5) // 拖到既有线位=合并,对照 PS
          return {
            userGuides: { ...s.userGuides, [axis]: merged },
            selectedGuide: s.selectedGuide?.axis === axis && s.selectedGuide.pos === f ? { axis, pos: v } : s.selectedGuide,
          }
        }),
      removeUserGuide: (axis, pos) =>
        set((s) => {
          const v = Math.round(pos)
          return {
            userGuides: { ...s.userGuides, [axis]: s.userGuides[axis].filter((g) => g !== v) },
            selectedGuide: s.selectedGuide?.axis === axis && s.selectedGuide.pos === v ? null : s.selectedGuide, // 删线即清选中
          }
        }),
      selectedGuide: null,
      setSelectedGuide: (g) => set({ selectedGuide: g }),
      applyGroupScale: (entries) =>
        set((s) => {
          const customEntries = entries.filter((e) => e.custom)
          const fixedEntries = entries.filter((e) => !e.custom)
          let customLayers = Array.isArray(s.props.customLayers) ? [...(s.props.customLayers as CustomLayer[])] : []
          for (const e of customEntries) {
            customLayers = customLayers.map((l) => {
              if (l.id !== e.id) return l
              const next = { ...l, x: e.x, y: e.y, width: e.width ?? l.width }
              if (e.height !== undefined) next.height = e.height === null ? undefined : e.height
              return next
            })
          }
          const styles = { ...(s.props.styles as Record<string, TextStyleOverride & ImageLook> | undefined) }
          for (const e of fixedEntries) {
            const cur = styles[e.id] ?? {}
            const patch: TextStyleOverride & ImageLook = { ...cur, dx: e.x, dy: e.y }
            if (e.gscale !== undefined) patch.gscale = e.gscale
            if (e.sx !== undefined) patch.sx = e.sx
            if (e.sy !== undefined) patch.sy = e.sy
            styles[e.id] = patch
          }
          return { props: { ...s.props, customLayers, styles } }
        }),
      removeCustomLayers: (ids) =>
        set((s) => {
          const drop = new Set(ids)
          const customLayers = (Array.isArray(s.props.customLayers) ? (s.props.customLayers as CustomLayer[]) : []).filter((l) => !drop.has(l.id))
          const order = effectiveOrder(s).filter((v) => !drop.has(v))
          return {
            props: { ...s.props, customLayers, layerOrder: order },
            selectedLayer: s.selectedLayer && drop.has(s.selectedLayer) ? selectionAfterDelete(s, drop) : s.selectedLayer,
            multiSelected: s.multiSelected.filter((v) => !drop.has(v)),
          }
        }),
      selectedAsset: null as string | null,
      layerNames: {} as Record<string, string>,
      renameLayer: (id, name) =>
        set((s) => {
          const next = { ...s.layerNames }
          const v = name.trim()
          if (!v || next[id] === v) delete next[id] // 空名/未变=还原默认名
          else next[id] = v
          return { layerNames: next }
        }),
      lastExport: null as EditorState['lastExport'],
      genEngine: 'server',
      setGenEngine: (engine) => set({ genEngine: engine }),
      setTemplate: (id) =>
        set({
          /* 模板切换=换文档:参考线是画布脚手架(文档域),随旧模板作废;多选/主选同清。
             同项目横竖切换走 setOrientation(参考线按比例迁移,不在此清) */
          templateId: id,
          props: { ...getTemplate(id).defaultProps },
          hiddenLayers: [],
          selectedLayer: null,
          multiSelected: [],
          userGuides: { h: [], v: [] },
          selectedGuide: null,
        }),
      /* 横竖屏切换=比例迁移(2026-11-12 用户裁决方案1):一切量按「自己的轴」映射——
         x/dx/width/sx 按 wr,y/dy/height/sy 按 hr(x 轴量跟画布宽比,y 轴量跟画布高比),
         往返精确互逆(漂移≤1px 取整界),切换后相对布局关系不变;一次 set=单条撤销。
         保证机制:一切几何消费方只认 tpl.width/height(唯一来源),本迁移函数是位置类
         状态跨模式的唯一入口(新增位置类状态必须挂进来)。 */
      setOrientation: (orientation) =>
        set((s) => {
          const nextId = templateOfOrientation(s.templateId, orientation)
          if (nextId === s.templateId) return {}
          const prev = getTemplate(s.templateId)
          const next = getTemplate(nextId)
          const wr = next.width / prev.width
          const hr = next.height / prev.height
          const clampMap = (arr: number[], factor: number, limit: number): number[] => {
            const out: number[] = []
            for (const g of arr) {
              const v = Math.min(limit, Math.max(0, Math.round(g * factor)))
              if (!out.some((o) => Math.abs(o - v) < 0.5)) out.push(v) // 映射撞线=合并,守唯一性
            }
            return out
          }
          const merged: Record<string, unknown> = { ...next.defaultProps }
          for (const [k, v] of Object.entries(s.props)) if (k in merged && k !== 'styles') merged[k] = v
          // 自定义图层与 z 序跨变体保留(图片不因横竖切换丢失)+ 几何按轴比例映射
          const layers = Array.isArray(s.props.customLayers) ? (s.props.customLayers as CustomLayer[]) : []
          merged.customLayers = layers.map((l) => ({
            ...l,
            x: Math.round(l.x * wr),
            y: Math.round(l.y * hr),
            width: Math.max(20, Math.round(l.width * wr)),
            ...(typeof l.height === 'number' && l.height > 0 ? { height: Math.max(20, Math.round(l.height * hr)) } : {}),
          }))
          merged.layerOrder = effectiveOrder(s)
          // 文字/图片图层位移与槽位缩放按各自轴映射(sx 跟宽比、sy 跟高比)
          const styles = { ...(s.props.styles as Record<string, TextStyleOverride & ImageLook> | undefined) }
          for (const id of Object.keys(styles)) {
            const st = styles[id]!
            const next2: TextStyleOverride & ImageLook = { ...st }
            if (typeof st.dx === 'number') next2.dx = Math.round(st.dx * wr)
            if (typeof st.dy === 'number') next2.dy = Math.round(st.dy * hr)
            if (typeof st.sx === 'number') next2.sx = clampScale(st.sx * wr)
            if (typeof st.sy === 'number') next2.sy = clampScale(st.sy * hr)
            styles[id] = next2
          }
          merged.styles = styles
          // 用户参考线随画布比例迁移(映射后天然落在 [0,新界限],夹取只兜浮点取整)
          const selectedGuide = s.selectedGuide
            ? { axis: s.selectedGuide.axis, pos: Math.round(s.selectedGuide.pos * (s.selectedGuide.axis === 'h' ? hr : wr)) }
            : null
          return {
            templateId: nextId,
            props: merged,
            userGuides: {
              h: clampMap(s.userGuides.h, hr, next.height),
              v: clampMap(s.userGuides.v, wr, next.width),
            },
            selectedGuide,
          }
        }),
      setProp: (key, value) => set((s) => ({ props: { ...s.props, [key]: value } })),
      setLayerStyle: (layerId, patch) =>
        set((s) => {
          const styles = { ...(s.props.styles as Record<string, TextStyleOverride & ImageLook> | undefined) }
          styles[layerId] = { ...styles[layerId], ...patch }
          return { props: { ...s.props, styles } }
        }),
      toggleLayer: (id) =>
        set((s) => ({
          hiddenLayers: s.hiddenLayers.includes(id) ? s.hiddenLayers.filter((l) => l !== id) : [...s.hiddenLayers, id],
        })),
      selectLayer: (id) => set({ selectedLayer: id, multiSelected: [] }),
      setSelectedAsset: (name) => set({ selectedAsset: name }),
      setLastExport: (r) => set({ lastExport: r }),
      addCustomLayer: (image, x, y, width = 360, group?: string) => {
        const id = `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        set((s) => {
          const layers = [...(Array.isArray(s.props.customLayers) ? (s.props.customLayers as CustomLayer[]) : []), { id, image, x: Math.round(x), y: Math.round(y), width, group: sanitizeGroup(s.templateId, group) }]
          const order = [...effectiveOrder(s).filter((v) => v !== id), id] // 置顶
          const next: Partial<EditorState> = { props: { ...s.props, customLayers: layers, layerOrder: order }, selectedLayer: id }
          return next
        })
        return id
      },
      removeCustomLayer: (id) =>
        set((s) => {
          const layers = (Array.isArray(s.props.customLayers) ? (s.props.customLayers as CustomLayer[]) : []).filter((l) => l.id !== id)
          const order = effectiveOrder(s).filter((v) => v !== id)
          return { props: { ...s.props, customLayers: layers, layerOrder: order }, selectedLayer: s.selectedLayer === id ? selectionAfterDelete(s, new Set([id])) : s.selectedLayer, multiSelected: s.multiSelected.filter((v) => v !== id) }
        }),
      setCustomLayer: (id, patch) =>
        set((s) => {
          // x/y 取 patch 后值再取整(2026-10-28 修复:原先 Math.round(l.x) 在 patch 之后又盖回去,拖动永不生效)
          const layers = (Array.isArray(s.props.customLayers) ? (s.props.customLayers as CustomLayer[]) : []).map((l) => {
            if (l.id !== id) return l
            const next = { ...l, ...patch, x: Math.round(patch.x ?? l.x), y: Math.round(patch.y ?? l.y) }
            if ('group' in patch) next.group = sanitizeGroup(s.templateId, patch.group) // 未提供则保留原归属
            return next
          })
          return { props: { ...s.props, customLayers: layers } }
        }),
      /* 对齐/网格开关持久化(2026-11-10 T2.5): localStorage 记忆,进视图不再重置为开 */
      guides: typeof localStorage !== 'undefined' && localStorage.getItem('tintin.cover.guides') !== null ? localStorage.getItem('tintin.cover.guides') === '1' : true,
      canvasGrid: typeof localStorage !== 'undefined' && localStorage.getItem('tintin.cover.grid') === '1',
      zoom: 1,
      setZoom: (z) => set({ zoom: Math.min(4, Math.max(0.25, Number.isFinite(z) ? z : 1)) }),
      fitScale: 1,
      setFitScale: (v) => set({ fitScale: Number.isFinite(v) && v > 0 ? v : 1 }),
      setGuides: (v) => { if (typeof localStorage !== 'undefined') localStorage.setItem('tintin.cover.guides', v ? '1' : '0'); set({ guides: v }) },
      setCanvasGrid: (v) => { if (typeof localStorage !== 'undefined') localStorage.setItem('tintin.cover.grid', v ? '1' : '0'); set({ canvasGrid: v }) },
      moveLayer: (id, dir) =>
        set((s) => {
          const order = effectiveOrder(s)
          const i = order.indexOf(id)
          if (i < 0) return {}
          const j = dir === 'up' ? i + 1 : i - 1 // 数组底→顶:up=向顶
          if (j < 0 || j >= order.length) return {}
          const moved = order[i]!
          const other = order[j]!
          order[i] = other
          order[j] = moved
          return withOrder(s, order)
        }),
      reorderLayer: (activeId, overId) =>
        set((s) => {
          const order = [...effectiveOrder(s)]
          const from = order.indexOf(activeId)
          const to = order.indexOf(overId)
          if (from < 0 || to < 0 || from === to) return {}
          order.splice(from, 1)
          order.splice(to, 0, activeId)
          return withOrder(s, order)
        }),
      arrangeLayer: (id, how) =>
        set((s) => {
          const order = effectiveOrder(s)
          const next = arrangeOrder(order, id, how)
          return next.join('|') === order.join('|') ? {} : withOrder(s, next)
        }),
      duplicateCustomLayer: (id, offset = 0) => {
        const nid = `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        let done = false
        set((s) => {
          const layers = Array.isArray(s.props.customLayers) ? (s.props.customLayers as CustomLayer[]) : []
          const src = layers.find((l) => l.id === id)
          if (!src) return {}
          done = true
          const order = effectiveOrder(s)
          const at = order.indexOf(id)
          return {
            props: { ...s.props, customLayers: [...layers, cloneLayer(src, nid, offset)], layerOrder: [...order.slice(0, at + 1), nid, ...order.slice(at + 1)] },
            selectedLayer: nid,
          }
        })
        return done ? nid : null
      },
    }),
    { limit: 50 },
  ),
)

/** 自定义图层 getter(props 投影;面板/画布共用) */
export function customLayersOf(state: Pick<EditorState, 'props'>): CustomLayer[] {
  return Array.isArray(state.props.customLayers) ? (state.props.customLayers as CustomLayer[]) : []
}

/** 撤销(zundo temporal 快照栈;会话动作与面板手动操作同栈,§9.7-3 建议口径) */
export function undo(): void {
  const t = (useEditor as unknown as { temporal: { getState: () => { undo: () => void } } }).temporal
  t.getState().undo()
}

/** 重做(2026-10-31 §2.6 P1:zundo 的 redo 栈暴露;Ctrl+Shift+Z/顶条按钮) */
export function redo(): void {
  const t = (useEditor as unknown as { temporal: { getState: () => { redo: () => void } } }).temporal
  t.getState().redo()
}

export function currentLayers(): LayerDef[] {
  return getTemplate(useEditor.getState().templateId).layerDefs
}

export function checkCurrent(): { ok: true } | { ok: false; error: string } {
  const s = useEditor.getState()
  const r = validateProps(s.templateId, { ...s.props, hiddenLayers: s.hiddenLayers })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
