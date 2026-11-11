// 画布快捷键(2026-11-01 自 App.tsx 解耦并对齐 PhotoCraft):窗口级监听——在图层面板点选后也生效,
// 焦点在输入框/文本域/下拉框时让行。Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销重做 · Ctrl+0/±缩放 ·
// 方向键微调(Shift=10px) · Ctrl+J 复制图层 · Delete/Backspace 删除自由图层 · Ctrl+[ ] 上下移一层 ·
// Ctrl+Shift+[ ] 置底/置顶。锁定位置的图层拒绝微调。
import React from 'react'
import { lockedOf } from './image-ops'
import { redo, undo, useEditor } from './store'

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/** blocked():all=整体让行(PhotoCraft 镜像模式);layer=拖动/旋转进行中,只放行撤销/缩放 */
export function useCanvasShortcuts(blocked: () => { all: boolean; layer: boolean }): void {
  const ref = React.useRef(blocked)
  ref.current = blocked
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || typing(e.target)) return
      const b = ref.current()
      if (b.all) return
      const s = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const take = (): void => { e.preventDefault(); e.stopPropagation() }
      if (mod && !e.altKey) {
        if (k === 'z') { take(); if (e.shiftKey) redo(); else undo(); return }
        if (k === 'y') { take(); redo(); return }
        if (k === '0') { take(); s.setZoom(1); return }
        if (k === '=' || k === '+') { take(); s.setZoom(s.zoom * 1.25); return }
        if (k === '-') { take(); s.setZoom(s.zoom / 1.25); return }
      }
      const id = s.selectedLayer
      if (!id || b.layer) return
      if (mod && k === 'j') { take(); if (id.startsWith('img-')) s.duplicateCustomLayer(id); return }
      if (mod && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        take()
        const up = e.code === 'BracketRight'
        s.arrangeLayer(id, e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward')
        return
      }
      /* R8 多选: Delete/Backspace 删除全部选中的自由图层;方向键=全部选中层同一 delta 微调 */
      if ((e.key === 'Delete' || e.key === 'Backspace')) {
        const targets = [...new Set([id, ...s.multiSelected])].filter((v) => v.startsWith('img-'))
        if (!targets.length) return
        take()
        s.removeCustomLayers(targets) // R9a: 单条撤销
        return
      }
      const step = e.shiftKey ? 10 : 1
      const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key]
      if (!d || mod) return
      take()
      /* R9a: 一次 set 提交全部微调(单条撤销) */
      const moveIds = [...new Set([id, ...s.multiSelected])]
      const entries: Array<{ id: string; custom: boolean; x: number; y: number }> = []
      for (const mid of moveIds) {
        if (lockedOf(s.props, mid)) continue
        if (mid.startsWith('img-')) {
          const layer = (Array.isArray(s.props.customLayers) ? (s.props.customLayers as Array<{ id: string; x: number; y: number }>) : []).find((l) => l.id === mid)
          if (layer) entries.push({ id: mid, custom: true, x: layer.x + d[0], y: layer.y + d[1] })
        } else {
          const st = (s.props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[mid]
          entries.push({ id: mid, custom: false, x: (st?.dx ?? 0) + d[0], y: (st?.dy ?? 0) + d[1] })
        }
      }
      if (entries.length) s.applyLayerGeometry(entries)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
