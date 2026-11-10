// inline-edit — 画布内文字就地编辑(2026-11-10 T1.3,对齐 PhotoCraft/PS 双击进文字):
// hook 承载状态/开启/关闭/渲染元素;值形态: 数组层(hookLines)=逐行 join/split,单行层=原串。
// 组件本体在 CoverInlineEditor.tsx。自 CanvasPanel 提取付账(千行门禁)。
import React from 'react'
import { CoverInlineEditor } from './CoverInlineEditor'
import type { TemplateDef } from '../registry'
import type { LayerDef } from '../registry'

export interface InlineEditorDeps {
  tpl: TemplateDef
  props: Record<string, unknown>
  setProp: (key: string, value: unknown) => void
  hostRef: React.RefObject<HTMLDivElement | null>
  playerWrapRef: React.RefObject<HTMLDivElement | null>
  layerAt: (clientX: number, clientY: number) => string | null
  pcRunning: boolean | null
  fitScale: number
  zoom: number
}

interface InlineState {
  id: string
  def: { id: string; propsKey?: string }
  px: number
  color: string
  initial: string
  multiline: boolean
  box: { x: number; y: number; w: number; h: number }
}

export function useInlineEditor(deps: InlineEditorDeps): {
  open: (clientX: number, clientY: number) => void
  element: React.ReactNode
} {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const [state, setState] = React.useState<InlineState | null>(null)

  const open = React.useCallback((clientX: number, clientY: number): void => {
    const d = depsRef.current
    if (d.pcRunning) return
    const id = d.layerAt(clientX, clientY)
    if (!id) return
    const def: LayerDef | undefined = d.tpl.layerDefs.find((x) => x.id === id && x.type === 'text')
    if (!def) return
    const el = d.hostRef.current?.querySelector(`[data-cover-layer="${id}"]`)
    const pr = d.playerWrapRef.current?.getBoundingClientRect()
    if (!el || !pr) return
    const r = el.getBoundingClientRect()
    const key = def.propsKey ?? def.id
    const raw = (d.props as Record<string, unknown>)[key]
    const multiline = Array.isArray(raw)
    const styles = (d.props.styles as Record<string, { scale?: number; color?: string }> | undefined)?.[id]
    setState({
      id,
      def: { id: def.id, propsKey: key },
      px: Math.round((def.fontSize ?? 24) * (typeof styles?.scale === 'number' ? styles.scale : 1)),
      color: styles?.color ?? '#ffffff',
      initial: multiline ? (raw as string[]).join('\n') : String(raw ?? ''),
      multiline,
      box: { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height },
    })
  }, [])

  const close = React.useCallback(() => setState(null), [])

  const element = React.useMemo(() => {
    const d = depsRef.current
    if (!state) return null
    return (
      <CoverInlineEditor
        box={state.box}
        zoomScale={d.fitScale * d.zoom}
        fontSizePx={state.px}
        color={state.color}
        initial={state.initial}
        multiline={state.multiline}
        onCommit={(text) => {
          if (state.multiline) {
            d.setProp(state.def.propsKey ?? state.def.id, text.split('\n').map((x) => x.trimStart()).filter((x) => x !== ''))
          } else d.setProp(state.def.propsKey ?? state.def.id, text)
        }}
        onClose={close}
      />
    )
  }, [state, deps.fitScale, deps.zoom, close])

  return { open, element }
}
