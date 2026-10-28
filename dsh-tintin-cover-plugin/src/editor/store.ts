// 编辑器状态(§9.3:图层树=props 投影;所有操作改同一份 props 快照,撤销走快照栈)
import { temporal } from 'zundo'
import { create } from 'zustand'
import { getTemplate, templateOfOrientation, validateProps, type LayerDef } from '../registry'

export interface EditorState {
  templateId: string
  props: Record<string, unknown>
  hiddenLayers: string[]
  selectedLayer: string | null
  lastExport: { ok: boolean; file?: string; error?: string } | null
  setTemplate: (id: string) => void
  /** 横竖屏切换(2026-10-27 裁决):同族变体切换,内容 props 尽量保留 */
  setOrientation: (orientation: 'landscape' | 'portrait') => void
  setProp: (key: string, value: unknown) => void
  setLayerStyle: (layerId: string, patch: { scale?: number; color?: string; dx?: number; dy?: number; font?: string } | null) => void
  toggleLayer: (id: string) => void
  selectLayer: (id: string | null) => void
  setLastExport: (r: EditorState['lastExport']) => void
  /** 生图引擎(2026-10-27 裁决:server=TinTin 服务端默认 | jimeng=即梦) */
  genEngine: 'server' | 'jimeng'
  setGenEngine: (engine: 'server' | 'jimeng') => void
}

export const useEditor = create<EditorState>()(
  temporal(
    (set) => ({
      templateId: 'video',
      props: { ...getTemplate('video').defaultProps },
      hiddenLayers: [] as string[],
      selectedLayer: null as string | null,
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
          return { templateId: nextId, props: merged }
        }),
      setProp: (key, value) => set((s) => ({ props: { ...s.props, [key]: value } })),
      setLayerStyle: (layerId, patch) =>
        set((s) => {
          const styles = { ...(s.props.styles as Record<string, { scale?: number; color?: string; dx?: number; dy?: number; font?: string }> | undefined) }
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
      setLastExport: (r) => set({ lastExport: r }),
    }),
    { limit: 50 },
  ),
)

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
