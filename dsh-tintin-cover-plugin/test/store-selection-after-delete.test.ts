// 删除后的选中接续(2026-11-11 用户裁决):自动选被删层的下面一个;删到底部=剩下列表最后一个。
// 面板序=effectiveOrder 反转(上→下)。这里直接钉 store 语义。
import { describe, expect, it, beforeEach } from 'vitest'
import { effectiveOrder, useEditor } from '../src/editor/store'

const topToBottom = (): string[] => [...effectiveOrder(useEditor.getState())].reverse()

describe('removeCustomLayer: selection continues below the deleted row', () => {
  beforeEach(() => {
    useEditor.getState().setTemplate('video')
  })

  it('middle layer: selects the row below it', () => {
    const s = useEditor.getState()
    const a = s.addCustomLayer('a.png', 0, 0)
    const b = s.addCustomLayer('b.png', 0, 0) // b 在 a 之上
    useEditor.getState().selectLayer(b)
    const order = topToBottom()
    const below = order[order.indexOf(b) + 1]
    expect(below).toBe(a)
    useEditor.getState().removeCustomLayer(b)
    expect(useEditor.getState().selectedLayer).toBe(below)
  })

  it('bottom layer: selects the last remaining row', () => {
    const s = useEditor.getState()
    const a = s.addCustomLayer('a.png', 0, 0)
    s.addCustomLayer('b.png', 0, 0)
    useEditor.getState().arrangeLayer(a, 'back') // a 置底
    useEditor.getState().selectLayer(a)
    const order = topToBottom()
    expect(order[order.length - 1]).toBe(a)
    const last = order[order.length - 2]
    useEditor.getState().removeCustomLayer(a)
    expect(useEditor.getState().selectedLayer).toBe(last)
  })

  it('batch delete: selects the row below the deleted block and clears multi-select', () => {
    const s = useEditor.getState()
    s.addCustomLayer('a.png', 0, 0)
    const b = s.addCustomLayer('b.png', 0, 0)
    const c = s.addCustomLayer('c.png', 0, 0) // c 最上
    useEditor.getState().selectLayer(c)
    useEditor.getState().toggleMultiSelect(b)
    const order = topToBottom()
    const below = order[order.indexOf(b) + 1]
    useEditor.getState().removeCustomLayers([c, b])
    const st = useEditor.getState()
    expect(st.selectedLayer).toBe(below)
    expect(st.multiSelected).toEqual([])
  })

  it('deleting an unselected layer keeps the current selection', () => {
    const s = useEditor.getState()
    const a = s.addCustomLayer('a.png', 0, 0)
    const b = s.addCustomLayer('b.png', 0, 0)
    useEditor.getState().selectLayer(b)
    useEditor.getState().removeCustomLayer(a)
    expect(useEditor.getState().selectedLayer).toBe(b)
  })
})
