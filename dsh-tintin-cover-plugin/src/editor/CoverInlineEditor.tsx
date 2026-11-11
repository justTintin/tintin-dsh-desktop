// CoverInlineEditor — 画布内文字就地编辑(2026-11-10 T1.3;2026-11-11 R18 用户裁决
// 「没有在原来的字体上编辑,要 1:1 还原 PhotoCraft」终改):
// 覆盖层 textarea 不再自带深色底/边框/居中/继承字体——样式全部从画布文字节点现场测量
// (fontFamily/fontSize/fontWeight/fontStyle/lineHeight/letterSpacing/color/textAlign/
// textTransform),定位=文字节点屏幕盒,背景透明/零内边距,输入即所见(原字体原样式原位)。
// 值形态: 数组层(hookLines)=逐行 join/split,单行层=原字符串。Esc/失焦收起。
import React from 'react'

export interface InlineEditorProps {
  /** 画布相对 playerWrap 的编辑盒(渲染 px,已含 zoom;取自文字节点屏幕盒) */
  box: { x: number; y: number; w: number; h: number }
  /** 从画布文字节点测得的原样式(字体/字重/颜色/行高等) */
  style: React.CSSProperties
  initial: string
  multiline: boolean
  onCommit: (text: string) => void
  onClose: () => void
}

export function CoverInlineEditor({ box, style, initial, multiline, onCommit, onClose }: InlineEditorProps): React.ReactElement {
  const [value, setValue] = React.useState(initial)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const schedule = (text: string): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onCommit(text), 250)
  }
  const finish = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    onCommit(value)
    onClose()
  }
  return (
    /* 捕获点击/按键,阻断宿主命中检测(否则双击后一松手就 selectLayer(null) 卸了编辑器) */
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', inset: 0, zIndex: 92 }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => { setValue(e.target.value); schedule(e.target.value) }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); if (timer.current) clearTimeout(timer.current); onClose() }
          if (e.key === 'Enter' && !multiline && !e.shiftKey) { e.preventDefault(); finish() }
          e.stopPropagation()
        }}
        spellCheck={false}
        style={{
          position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
          ...style,
          margin: 0, padding: 0, border: 0, outline: 'none', resize: 'none',
          background: 'transparent', boxSizing: 'content-box',
          overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          caretColor: style.color ?? '#fff', zIndex: 93,
        }}
      />
    </div>
  )
}
