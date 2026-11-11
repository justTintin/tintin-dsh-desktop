// inline-edit — 画布内文字就地编辑(2026-11-11 R24 用户裁决「照 PhotoCraft:在图层自身排版里编辑」)。
// PhotoCraft(type_tool/editing.rs)在文字图层自己的排版里画光标,没有独立覆盖层。本实现同样把
// 编辑面直接落在模板文字图层的 DOM 上(contenteditable):光标在真字形之间移动,字距/斜切/行高/
// 颜色全部是模板真样式——物理上不存在第二层字,也没有任何覆盖框。
// · 进入:双击文字层 → 容器 contenteditable,同层非文字子节点(装饰条)临时隐藏,光标落末尾;
// · 输入期间不写 props(避免 React 重渲打断光标);Esc=还原进编辑前的 DOM;失焦=提交,模板重渲;
// · 数组层(hookLines)按 innerText 的块分行提交(trimStart、空行丢弃,与旧口径一致),单行层整体提交
//   (非多行时 Enter 直接提交);
// · 编辑期间阻断冒泡到画布宿主(否则 pointerdown 会触发选择/拖动、dblclick 会二次进入)。
import React from 'react'
import type { TemplateDef } from '../registry'
import type { LayerDef } from '../registry'

export interface InlineEditorDeps {
  tpl: TemplateDef
  props: Record<string, unknown>
  setProp: (key: string, value: unknown) => void
  hostRef: React.RefObject<HTMLDivElement | null>
  /** 保留字段(旧覆盖层实现使用;contenteditable 方案不再需要,但调用点参数不变) */
  contentRef: React.RefObject<HTMLDivElement | null>
  layerAt: (clientX: number, clientY: number) => string | null
  pcRunning: boolean | null
  fitScale: number
  zoom: number
}

interface EditSession {
  id: string
  el: HTMLElement
  key: string
  multiline: boolean
  /** 进入编辑前的 innerHTML(Esc 还原) */
  savedHTML: string
  /** 编辑期间隐藏的非文字子节点(装饰条等)及其原 display */
  hidden: Array<{ el: HTMLElement; display: string }>
  /** 事件监听卸载函数 */
  off: Array<() => void>
}

export function useInlineEditor(deps: InlineEditorDeps): {
  open: (clientX: number, clientY: number) => void
  element: null
} {
  const depsRef = React.useRef(deps)
  depsRef.current = deps
  const sessionRef = React.useRef<EditSession | null>(null)

  /** 收摊:撤 contenteditable/监听/临时隐藏(不动文本) */
  const end = React.useCallback((): void => {
    const s = sessionRef.current
    if (!s) return
    sessionRef.current = null
    s.el.removeAttribute('contenteditable')
    s.el.removeAttribute('spellcheck')
    s.el.style.outline = ''
    for (const h of s.hidden) h.el.style.display = h.display
    for (const off of s.off) off()
  }, [])

  const commit = React.useCallback((): void => {
    const s = sessionRef.current
    if (!s) return
    const text = s.el.innerText
    end()
    const d = depsRef.current
    if (s.multiline) {
      d.setProp(s.key, text.split('\n').map((x) => x.trimStart()).filter((x) => x !== ''))
    } else {
      d.setProp(s.key, text.replace(/\n+$/u, ''))
    }
  }, [end])

  const revert = React.useCallback((): void => {
    const s = sessionRef.current
    if (!s) return
    s.el.innerHTML = s.savedHTML
    end()
  }, [end])

  React.useEffect(() => () => { end() }, [end])

  const open = React.useCallback((clientX: number, clientY: number): void => {
    const d = depsRef.current
    if (d.pcRunning) return
    if (sessionRef.current) return // 已在编辑:双击可编辑区走浏览器选词,不二次进入
    const id = d.layerAt(clientX, clientY)
    if (!id) return
    const def: LayerDef | undefined = d.tpl.layerDefs.find((x) => x.id === id && x.type === 'text')
    if (!def) return
    const el = d.hostRef.current?.querySelector(`[data-cover-layer="${id}"]`)
    if (!(el instanceof HTMLElement)) return

    const key = def.propsKey ?? def.id
    const raw = (d.props as Record<string, unknown>)[key]
    const multiline = Array.isArray(raw)
    /* 先存原始 HTML,再把无文字的同层子节点(装饰条)临时隐藏——隐藏只改这些节点的 inline display,
       savedHTML 快照在隐藏前拍,所以 Esc 恢复即完整还原(含装饰显示) */
    const savedHTML = el.innerHTML
    const hidden: EditSession['hidden'] = []
    for (const child of Array.from(el.children)) {
      const c = child as HTMLElement
      if ((c.textContent ?? '').trim() === '') {
        hidden.push({ el: c, display: c.style.display })
        c.style.display = 'none'
      }
    }

    el.setAttribute('contenteditable', 'true')
    el.setAttribute('spellcheck', 'false')
    el.style.outline = 'none'
    const session: EditSession = { id, el, key, multiline, savedHTML, hidden, off: [] }
    sessionRef.current = session

    /* 画布宿主是 React 根委托监听:在这些原生事件上 stopPropagation 即可阻止冒泡到宿主,
       光标点击、文字选取、双击选词全部留给浏览器原生行为 */
    const stop = (e: Event): void => { e.stopPropagation() }
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'click', 'dblclick', 'keydown', 'keyup', 'keypress'] as const) {
      el.addEventListener(type, stop)
      session.off.push(() => el.removeEventListener(type, stop))
    }
    const onBlur = (): void => commit()
    el.addEventListener('blur', onBlur)
    session.off.push(() => el.removeEventListener('blur', onBlur))
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); revert(); return }
      if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit() }
    }
    el.addEventListener('keydown', onKeyDown)
    session.off.push(() => el.removeEventListener('keydown', onKeyDown))

    el.focus()
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false) // 光标落末尾(不整段选中)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }, [commit, revert])

  return { open, element: null }
}
