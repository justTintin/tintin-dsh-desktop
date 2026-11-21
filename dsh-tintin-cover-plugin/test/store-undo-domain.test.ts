// store-undo-domain — 撤销域门禁回归(2026-11-21 PhotoCraft 对照修订)。
// 历史快照只收文档域四键(templateId/props/hiddenLayers/userGuides);选中/缩放/
// 显示开关/会话命名/导出结果=会话视图态,不进栈,撤销也不回滚它们。zundo 2.3.0
// 实证:undo/redo 走 zustand 原生 set 合并语义,快照外字段保留现值;入栈前经
// equality 对 partialize 后快照引用判等。单 it 顺序推进(store 为模块级全文件共享)。
import { describe, expect, it } from 'vitest'
import { redo, undo, useEditor } from '../src/editor/store.ts'

type TemporalPeek = { pastStates: unknown[]; futureStates: unknown[] }
function peek(): TemporalPeek {
  return (useEditor as unknown as { temporal: { getState: () => TemporalPeek } }).temporal.getState()
}

describe('撤销域(文档域快照)', () => {
  it('视图态不入栈;文档域动作各一条;undo 只回滚文档域;redo 对称', () => {
    const base = peek().pastStates.length
    const s = useEditor.getState()
    const props0 = s.props // 模板默认 props(引用在 undo 到底后应原样回归)

    /* 一、视图态动作:七类,零入栈 */
    s.selectLayer('title')
    s.setZoom(2)
    s.setFitScale(0.8)
    s.setGuides(false)
    s.setSelectedAsset('a.png')
    s.renameLayer('title', '主标题')
    s.setLastExport({ ok: true, file: 'x.png' })
    expect(peek().pastStates.length).toBe(base)

    /* 二、文档域动作:四类,各入一条 */
    s.setProp('title', 'A') // props
    s.toggleLayer('subtitle') // hiddenLayers
    s.addUserGuide('v', 100) // userGuides
    useEditor.setState({ props: { ...useEditor.getState().props, title: 'B' } }) // agent 回流通道(直接 setState)
    expect(peek().pastStates.length).toBe(base + 4)

    /* 三、undo 逐条回滚文档域;视图态穿越保持现值 */
    undo()
    expect(useEditor.getState().props.title).toBe('A') // agent 写回退
    undo()
    expect(useEditor.getState().userGuides.v).toEqual([]) // 参考线回退
    undo()
    expect(useEditor.getState().hiddenLayers).toEqual([]) // 隐藏层回退
    undo()
    expect(useEditor.getState().props).toBe(props0) // 最初 props 引用原样回归
    expect(useEditor.getState().zoom).toBe(2) // 缩放/选中/命名/导出结果不受撤销影响
    expect(useEditor.getState().fitScale).toBe(0.8)
    expect(useEditor.getState().selectedLayer).toBe('title')
    expect(useEditor.getState().layerNames.title).toBe('主标题')
    expect(useEditor.getState().lastExport?.ok).toBe(true)

    /* 四、redo 对称重放文档域 */
    redo()
    expect(useEditor.getState().props.title).toBe('A')
    redo()
    expect(useEditor.getState().hiddenLayers).toEqual(['subtitle'])
    redo()
    expect(useEditor.getState().userGuides.v).toEqual([100])
    redo()
    expect(useEditor.getState().props.title).toBe('B')
    expect(peek().futureStates.length).toBe(0)
    expect(useEditor.getState().zoom).toBe(2) // 视图态依旧未动
  })
})
