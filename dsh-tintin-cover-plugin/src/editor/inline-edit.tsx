// inline-edit — 画布内文字就地编辑(2026-11-10 T1.3,对齐 PhotoCraft/PS 双击进文字):
// hook 承载状态/开启/关闭/渲染元素;值形态: 数组层(hookLines)=逐行 join/split,单行层=原串。
// 组件本体在 CoverInlineEditor.tsx。自 CanvasPanel 提取付账(千行门禁)。
// 2026-11-11 R23 用户报「编辑时没有在原字上编辑」(叠字):PhotoCraft 的文字编辑=在图层
// 自身排版里画光标(type_tool/editing.rs),没有独立覆盖层;React 等价=编辑期间把原图层
// 整体隐藏(attribute + 一次性样式表,React 重渲不丢),只留覆盖层一层字,提交/关闭恢复。
import React from 'react'
import { CoverInlineEditor } from './CoverInlineEditor'
import type { TemplateDef } from '../registry'
import type { LayerDef } from '../registry'

export interface InlineEditorDeps {
  tpl: TemplateDef
  props: Record<string, unknown>
  setProp: (key: string, value: unknown) => void
  hostRef: React.RefObject<HTMLDivElement | null>
  /** 编辑器元素渲染在 content 层(contentRef,position:relative)内——盒坐标必须相对它,
      不能用 playerWrap(会重复计入滚动/居中偏移,2026-11-11 R18 实测 dy 147px) */
  contentRef: React.RefObject<HTMLDivElement | null>
  layerAt: (clientX: number, clientY: number) => string | null
  pcRunning: boolean | null
  fitScale: number
  zoom: number
}

interface InlineState {
  id: string
  def: { id: string; propsKey?: string }
  style: React.CSSProperties
  initial: string
  multiline: boolean
  box: { x: number; y: number; w: number; h: number }
}

const HIDE_STYLE_ID = 'tintin-cover-inline-edit-hide'
function ensureHideStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(HIDE_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = HIDE_STYLE_ID
  style.textContent = '[data-cover-layer][data-inline-editing]{visibility:hidden !important}'
  document.head.append(style)
}

export function useInlineEditor(deps: InlineEditorDeps): {
  open: (clientX: number, clientY: number) => void
  element: React.ReactNode
} {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const [state, setState] = React.useState<InlineState | null>(null)
  const editingElRef = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => () => { editingElRef.current?.removeAttribute('data-inline-editing') }, [])

  const open = React.useCallback((clientX: number, clientY: number): void => {
    const d = depsRef.current
    if (d.pcRunning) return
    const id = d.layerAt(clientX, clientY)
    if (!id) return
    const def: LayerDef | undefined = d.tpl.layerDefs.find((x) => x.id === id && x.type === 'text')
    if (!def) return
    const el = d.hostRef.current?.querySelector(`[data-cover-layer="${id}"]`)
    const pr = d.contentRef.current?.getBoundingClientRect()
    if (!(el instanceof HTMLElement) || !pr) return
    /* 现场测量画布文字节点(2026-11-11 R18):编辑框=原字体原样式原位,不再自带深色底/
       继承字体/居中——否则所见非所得(用户截图实证)。取第一个有文本的叶子节点。 */
    const findText = (root: HTMLElement): HTMLElement | null => {
      for (const n of Array.from(root.querySelectorAll('*'))) {
        if (n.childElementCount === 0 && (n.textContent ?? '').trim()) return n as HTMLElement
      }
      return null
    }
    ensureHideStyle()
    editingElRef.current?.removeAttribute('data-inline-editing')
    editingElRef.current = el
    el.setAttribute('data-inline-editing', '')
    const node = findText(el) ?? el
    const cs = getComputedStyle(node)
    const nr = node.getBoundingClientRect()
    const lr = el.getBoundingClientRect()
    const style: React.CSSProperties = {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      lineHeight: cs.lineHeight === 'normal' ? undefined : cs.lineHeight,
      letterSpacing: cs.letterSpacing === 'normal' ? undefined : cs.letterSpacing,
      color: cs.color,
      textAlign: cs.textAlign as React.CSSProperties['textAlign'],
      textTransform: cs.textTransform === 'none' ? undefined : (cs.textTransform as React.CSSProperties['textTransform']),
    }
    const key = def.propsKey ?? def.id
    const raw = (d.props as Record<string, unknown>)[key]
    const multiline = Array.isArray(raw)
    /* 覆盖层高度留足行数(原层已隐藏,输入多行/换行后要能看见;lineHeight 实测 px) */
    const lh = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.2 || 16
    const lineCount = multiline ? Math.max(1, (raw as string[]).length) : 1
    setState({
      id,
      def: { id: def.id, propsKey: key },
      style,
      initial: multiline ? (raw as string[]).join('\n') : String(raw ?? ''),
      multiline,
      box: {
        x: nr.left - pr.left,
        y: nr.top - pr.top,
        w: Math.max(48, lr.right - nr.left),
        h: Math.max(nr.height + 2, lr.bottom - nr.top, Math.round(lineCount * lh + 8)),
      },
    })
  }, [])

  const close = React.useCallback(() => {
    editingElRef.current?.removeAttribute('data-inline-editing')
    editingElRef.current = null
    setState(null)
  }, [])

  const element = React.useMemo(() => {
    const d = depsRef.current
    if (!state) return null
    return (
      <CoverInlineEditor
        box={state.box}
        style={state.style}
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
  }, [state, close])

  return { open, element }
}
