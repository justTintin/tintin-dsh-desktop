// CoverInlineEditor — 画布内文字就地编辑(2026-11-10 T1.3,对齐 PhotoCraft/PS 双击进文字):
// 双击文字层 → 覆盖层 textarea 定位到该层包围盒(样式对齐画布) → 输入防抖写 props →
// Esc/失焦收起。值形态: 数组层(hookLines)=逐行 join/split,单行层=原字符串。
import React from 'react'

export interface InlineEditorProps {
  /** 画布相对 playerWrap 的包围盒(渲染 px,已含 zoom) */
  box: { x: number; y: number; w: number; h: number }
  zoomScale: number
  fontSizePx: number
  color: string
  initial: string
  multiline: boolean
  onCommit: (text: string) => void
  onClose: () => void
}

export function CoverInlineEditor({ box, zoomScale, fontSizePx, color, initial, multiline, onCommit, onClose }: InlineEditorProps): React.ReactElement {
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
          position: 'absolute', left: box.x, top: box.y, width: box.w + 40, height: box.h + 24,
          fontSize: fontSizePx * zoomScale, lineHeight: 1.25, color, textAlign: 'center',
          background: 'rgba(20,20,22,0.72)', border: '1.5px solid var(--accent)', borderRadius: 6,
          outline: 'none', resize: 'none', fontFamily: 'inherit', padding: 8, boxSizing: 'border-box',
          overflow: 'hidden', whiteSpace: 'pre-wrap',
        }}
      />
    </div>
  )
}
