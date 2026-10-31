// 编辑器状态(§9.3:图层树=props 投影;所有操作改同一份 props 快照,撤销走快照栈)
// 2026-10-28 扩展:customLayers(拖入图片=新图层)+ layerOrder(全图层 z 序,含固定层)。
import { temporal } from 'zundo'
import { create } from 'zustand'
import { getTemplate, templateOfOrientation, validateProps, type LayerDef } from '../registry'
import type { CustomLayer } from '../../templates/CustomLayers'

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
  /** 素材区当前选中项(2026-10-31 §2.5 P1:编辑卡「从素材替换/设为产品图」的数据源) */
  selectedAsset: string | null
  lastExport: { ok: boolean; file?: string; error?: string } | null
  setTemplate: (id: string) => void
  /** 横竖屏切换(2026-10-27 裁决):同族变体切换,内容 props 尽量保留 */
  setOrientation: (orientation: 'landscape' | 'portrait') => void
  setProp: (key: string, value: unknown) => void
  setLayerStyle: (layerId: string, patch: { scale?: number; color?: string; dx?: number; dy?: number; font?: string; rotate?: number } | null) => void
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

function withOrder(state: EditorState, order: string[]): Pick<EditorState, 'props'> {
  return { props: { ...state.props, layerOrder: order } }
}

export const useEditor = create<EditorState>()(
  temporal(
    (set) => ({
      templateId: 'video',
      props: { ...getTemplate('video').defaultProps },
      hiddenLayers: [] as string[],
      selectedLayer: null as string | null,
      selectedAsset: null as string | null,
      lastExport: null as EditorState['lastExport'],
      genEngine: 'server',
      setGenEngine: (engine) => set({ genEngine: engine }),
      setTemplate: (id) =>
        set({ templateId: id, props: { ...getTemplate(id).defaultProps }, hiddenLayers: [], selectedLayer: null }),
      setOrientation: (orientation) =>
        set((s) => {
          const nextId = templateOfOrientation(s.templateId, orientation)
          if (nextId === s.templateId) return {}
          const next = getTemplate(nextId)
          const merged: Record<string, unknown> = { ...next.defaultProps }
          for (const [k, v] of Object.entries(s.props)) if (k in merged && k !== 'styles') merged[k] = v
          // 自定义图层与 z 序跨变体保留(图片不因横竖切换丢失)
          merged.customLayers = s.props.customLayers
          merged.layerOrder = effectiveOrder(s)
          return { templateId: nextId, props: merged }
        }),
      setProp: (key, value) => set((s) => ({ props: { ...s.props, [key]: value } })),
      setLayerStyle: (layerId, patch) =>
        set((s) => {
          const styles = { ...(s.props.styles as Record<string, { scale?: number; color?: string; dx?: number; dy?: number; font?: string; rotate?: number }> | undefined) }
          if (patch === null) delete styles[layerId]
          else styles[layerId] = { ...styles[layerId], ...patch }
          const next = { ...s.props, styles }
          if (Object.keys(styles).length === 0) delete (next as Record<string, unknown>).styles
          return { props: next }
        }),
      toggleLayer: (id) =>
        set((s) => ({
          hiddenLayers: s.hiddenLayers.includes(id) ? s.hiddenLayers.filter((l) => l !== id) : [...s.hiddenLayers, id],
        })),
      selectLayer: (id) => set({ selectedLayer: id }),
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
          return { props: { ...s.props, customLayers: layers, layerOrder: order }, selectedLayer: s.selectedLayer === id ? null : s.selectedLayer }
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
      guides: true,
      canvasGrid: false,
      zoom: 1,
      setZoom: (z) => set({ zoom: Math.min(4, Math.max(0.25, Number.isFinite(z) ? z : 1)) }),
      fitScale: 1,
      setFitScale: (v) => set({ fitScale: Number.isFinite(v) && v > 0 ? v : 1 }),
      setGuides: (v) => set({ guides: v }),
      setCanvasGrid: (v) => set({ canvasGrid: v }),
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

export function currentLayers(): LayerDef[] {
  return getTemplate(useEditor.getState().templateId).layerDefs
}

export function checkCurrent(): { ok: true } | { ok: false; error: string } {
  const s = useEditor.getState()
  const r = validateProps(s.templateId, s.props)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
