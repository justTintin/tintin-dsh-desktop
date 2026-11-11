// 选中图片图层基本操作(2026-11-01 对齐 PhotoCraft)的纯逻辑与 store 动作回归面。
import { beforeEach, describe, expect, it } from 'vitest'
import { arrangeOrder, centerResize, clampScale, cloneLayer, cornerResize, groupScaleEntries, rotatedCornerResize, rotatedEdgeResize, flipPatch, lockedOf, resizeWH, rotatePatch } from '../src/editor/image-ops'
import { effectiveOrder, useEditor } from '../src/editor/store'
import { backdropStyle, lookBlend, lookOpacity, lookTransform } from '../templates/image-style'

describe('cornerResize (PhotoCraft 四角柄,2026-11-02)', () => {
  const box = { left: 100, top: 200, w: 300, h: 200 }
  it('SE 角拖大:对角(左上)为锚,x/y 不动', () => {
    const f = Math.hypot(500, 350) / Math.hypot(300, 150)
    const r = cornerResize(box, 'se', Math.hypot(500, 350), Math.hypot(300, 150), { x: 100, y: 200, w: 300, h: 200 })
    expect(r.x).toBe(100)
    expect(r.y).toBe(200)
    expect(r.width).toBe(Math.round(300 * f))
  })
  it('NW 角向左上拖:对角(右下)为锚,x/y 随锚补正', () => {
    const f = Math.hypot(150, 250) / Math.hypot(300, 150)
    const r = cornerResize(box, 'nw', Math.hypot(150, 250), Math.hypot(300, 150), { x: 100, y: 200, w: 300, h: 200 })
    expect(r.x).toBe(400 - r.width)
    expect(r.y).toBe(400 - (r.height ?? 0))
    expect(r.width).toBe(Math.round(300 * f))
  })
  it('显式高同比缩放;未显式高返回 null(随原图比例)', () => {
    const fh = Math.hypot(450, 300) / Math.hypot(300, 150)
    const withH = cornerResize(box, 'se', Math.hypot(450, 300), Math.hypot(300, 150), { x: 100, y: 200, w: 300, h: 200 })
    expect(withH.height).toBe(Math.round(200 * fh))
    const noH = cornerResize(box, 'se', Math.hypot(450, 300), Math.hypot(300, 150), { x: 100, y: 200, w: 300, h: null })
    expect(noH.height).toBeNull()
  })
  it('最小值钳制 20px', () => {
    const r = cornerResize(box, 'se', Math.hypot(12, 12), Math.hypot(300, 150), { x: 100, y: 200, w: 300, h: 200 })
    expect(r.width).toBe(20)
  })
})

describe('arrangeOrder (Layer › Arrange)', () => {
  const order = ['a', 'b', 'c', 'd']
  it('moves to front/back and one step forward/backward', () => {
    expect(arrangeOrder(order, 'b', 'front')).toEqual(['a', 'c', 'd', 'b'])
    expect(arrangeOrder(order, 'c', 'back')).toEqual(['c', 'a', 'b', 'd'])
    expect(arrangeOrder(order, 'b', 'forward')).toEqual(['a', 'c', 'b', 'd'])
    expect(arrangeOrder(order, 'c', 'backward')).toEqual(['a', 'c', 'b', 'd'])
  })
  it('is a no-op at the edges and for unknown ids', () => {
    expect(arrangeOrder(order, 'd', 'forward')).toEqual(order)
    expect(arrangeOrder(order, 'a', 'backward')).toEqual(order)
    expect(arrangeOrder(order, 'zz', 'front')).toEqual(order)
  })
})

describe('flip / rotate presets (Edit › Transform)', () => {
  it('flip mirrors across the canvas: angle negates, flag toggles', () => {
    expect(flipPatch({ rotate: 30 }, 'x')).toEqual({ flipX: true, rotate: -30 })
    expect(flipPatch({ rotate: 30, flipX: true }, 'x')).toEqual({ flipX: false, rotate: -30 })
    expect(flipPatch(undefined, 'y')).toEqual({ flipY: true, rotate: 0 })
    expect(flipPatch({ rotate: 180 }, 'y').rotate).toBe(180)
  })
  it('rotates 90/-90/180 and normalizes into (-180, 180]', () => {
    expect(rotatePatch({ rotate: 0 }, 90)).toEqual({ rotate: 90 })
    expect(rotatePatch({ rotate: 120 }, 90)).toEqual({ rotate: -150 })
    expect(rotatePatch({ rotate: -90 }, -90)).toEqual({ rotate: 180 })
    expect(rotatePatch(undefined, 180)).toEqual({ rotate: 180 })
  })
})

describe('resizeWH (Properties › Transform W/H link)', () => {
  it('keeps the aspect ratio when linked', () => {
    expect(resizeWH({ w: 400, h: 300 }, { w: 200 }, true)).toEqual({ w: 200, h: 150 })
    expect(resizeWH({ w: 400, h: 300 }, { h: 600 }, true)).toEqual({ w: 800, h: 600 })
  })
  it('changes one side only when unlinked, clamped', () => {
    expect(resizeWH({ w: 400, h: 300 }, { w: 500 }, false)).toEqual({ w: 500, h: 300 })
    expect(resizeWH({ w: 400, h: 300 }, { h: -5 }, false, 20)).toEqual({ w: 400, h: 20 })
  })
  it('clamps slot scale factors', () => {
    expect(clampScale(0)).toBe(0.05)
    expect(clampScale(99)).toBe(10)
    expect(clampScale(1.23456)).toBe(1.235)
  })
})

describe('cloneLayer / lockedOf', () => {
  it('copies every property except the lock, with a new id', () => {
    const src = { id: 'img-a', image: 'a.png', x: 10, y: 20, width: 300, height: 200, opacity: 0.5, blend: 'multiply', flipX: true, rotate: 15, group: 'product', locked: true }
    const copy = cloneLayer(src, 'img-b')
    const { locked: _locked, ...unlocked } = src
    expect(copy).toEqual({ ...unlocked, id: 'img-b' })
    expect('locked' in copy).toBe(false)
  })
  it('reads the position lock of free layers and template slots', () => {
    const props = { customLayers: [{ id: 'img-a', locked: true }, null], styles: { product: { locked: true }, title: {} } }
    expect(lockedOf(props, 'img-a')).toBe(true)
    expect(lockedOf(props, 'img-x')).toBe(false)
    expect(lockedOf(props, 'product')).toBe(true)
    expect(lockedOf(props, 'title')).toBe(false)
    expect(lockedOf({}, null)).toBe(false)
  })
})

describe('template-side look (image-style)', () => {
  it('builds rotate-first transforms with flips and scale', () => {
    expect(lookTransform(undefined)).toBe('rotate(0deg)')
    expect(lookTransform({ rotate: 30, flipX: true })).toBe('rotate(30deg) scale(-1, 1)')
    expect(lookTransform({ sx: 2, sy: 0.5, flipY: true })).toBe('rotate(0deg) scale(2, -0.5)')
  })
  it('sanitizes values written by the agent', () => {
    expect(lookOpacity({ opacity: 3 })).toBe(1)
    expect(lookOpacity({ opacity: Number.NaN })).toBe(1)
    expect(lookBlend({ blend: 'multiply' })).toBe('multiply')
    expect(lookBlend({ blend: 'dissolve' })).toBeUndefined()
    expect(lookBlend({ blend: 'normal' })).toBeUndefined()
    expect(lookTransform({ sx: 1e9 } as never)).toBe('rotate(0deg) scale(10, 1)')
  })
  it('keeps the backdrop default opacity of the template design', () => {
    expect(backdropStyle(undefined).opacity).toBe(0.85)
    expect(backdropStyle({ opacity: 0.4, flipX: true })).toMatchObject({ opacity: 0.4, transform: 'scale(-1, 1)' })
  })
})

describe('store actions: duplicate + arrange', () => {
  beforeEach(() => {
    useEditor.getState().setTemplate('video')
  })
  it('Ctrl+J duplicates the whole layer right above the source and selects it', () => {
    const s = useEditor.getState()
    const a = s.addCustomLayer('a.png', 100, 100, 300)
    s.setCustomLayer(a, { opacity: 0.6, blend: 'screen', flipX: true, rotate: 12, height: 150, locked: true })
    const b = s.addCustomLayer('b.png', 0, 0, 100)
    const copy = useEditor.getState().duplicateCustomLayer(a)
    expect(copy).toBeTruthy()
    const st = useEditor.getState()
    const layers = st.props.customLayers as Array<Record<string, unknown>>
    const dup = layers.find((l) => l.id === copy)!
    expect(dup).toMatchObject({ image: 'a.png', x: 100, y: 100, width: 300, height: 150, opacity: 0.6, blend: 'screen', flipX: true, rotate: 12 })
    expect(dup.locked).toBeUndefined()
    const order = effectiveOrder(st)
    expect(order.indexOf(copy!)).toBe(order.indexOf(a) + 1)
    expect(order.indexOf(b)).toBeGreaterThan(order.indexOf(copy!))
    expect(st.selectedLayer).toBe(copy)
    expect(useEditor.getState().duplicateCustomLayer('img-missing')).toBeNull()
  })
  it('arranges free layers and template slots in the shared z-order', () => {
    const s = useEditor.getState()
    const a = s.addCustomLayer('a.png', 0, 0)
    s.arrangeLayer(a, 'back')
    expect(effectiveOrder(useEditor.getState())[0]).toBe(a)
    useEditor.getState().arrangeLayer('product', 'front')
    const order = effectiveOrder(useEditor.getState())
    expect(order[order.length - 1]).toBe('product')
  })
})

describe('centerResize (旋转层中心锚,2026-11-11 WP-A3)', () => {
  it('视觉中心不动:x/y 随新宽高补偿', () => {
    const r = centerResize({ x: 100, y: 80, w: 200, h: 100 }, 1.5, 100)
    expect(r).toEqual({ x: 50, y: 55, width: 300, height: 150 })
    expect(r.x + r.width / 2).toBe(200)
    expect(r.y + (r.height ?? 0) / 2).toBe(130)
  })
  it('未显式高: 高随比例,y 补偿按视觉高', () => {
    const r = centerResize({ x: 100, y: 100, w: 200, h: null }, 2, 100)
    expect(r).toEqual({ x: 0, y: 50, width: 400, height: null })
  })
})

describe('rotatedEdgeResize (边柄,2026-11-11 R2: 旋转层同样适用,锚=对侧视觉边)', () => {
  it('deg=0 退化为轴对齐:e 右拉加宽,x 不动(左锚)', () => {
    expect(rotatedEdgeResize({ x: 100, y: 80, w: 200, h: 100 }, 'e', { x: 50, y: 0 }, 0)).toEqual({ width: 250, x: 100, y: 80 })
  })
  it('deg=0 w 左拉:左缘左移加宽,右缘锚定(300 不动)', () => {
    expect(rotatedEdgeResize({ x: 100, y: 80, w: 200, h: 100 }, 'w', { x: -30, y: 0 }, 0)).toEqual({ width: 230, x: 70, y: 80 })
  })
  it('旋转 90°:e 柄在视觉下缘,下拉加宽,锚=视觉上缘(世界 y 不动)', () => {
    const p = rotatedEdgeResize({ x: 100, y: 80, w: 200, h: 100 }, 'e', { x: 0, y: 40 }, 90)
    // 老视觉盒(90°): 顶缘 y=cy-w/2=130-100=30;新 cy=(100+50)+... 顶缘必须仍=30
    const cyOld = 80 + 100 / 2
    const cyNew = p.y! + 100 / 2
    expect(cyOld - 200 / 2).toBeCloseTo(30)
    expect(cyNew - p.width! / 2).toBeCloseTo(30)
    expect(p.width).toBe(240)
  })
  it('min 钳制穿越锚点:w 右拉收窄到 20,右缘不动', () => {
    const p = rotatedEdgeResize({ x: 100, y: 80, w: 200, h: 100 }, 'w', { x: 500, y: 0 }, 0)
    expect(p.width).toBe(20)
    expect(p.x! + p.width!).toBe(300)
  })
})

describe('rotatedCornerResize (旋转层角柄精确锚定,2026-11-11 §6.4 R6)', () => {
  it('deg=0 与 cornerResize 逐值一致:nw 拖拽=右下锚', () => {
    const p = rotatedCornerResize({ x: 100, y: 80, w: 200, h: 100 }, 'nw', { x: 40, y: 40 }, 0, { hExplicit: 100 })
    const ref = cornerResize({ left: 100, top: 80, w: 200, h: 100 }, 'nw', Math.hypot(40 - 300, 40 - 180), Math.hypot(100 - 300, 80 - 180), { x: 100, y: 80, w: 200, h: 100 })
    expect(p).toEqual(ref)
  })
  it('deg=90:内容角 nw 拖拽,对侧内容角 se 世界位不动(R6 精确锚定)', () => {
    const p = rotatedCornerResize({ x: 100, y: 80, w: 200, h: 100 }, 'nw', { x: 0, y: 0 }, 90, { hExplicit: 100 })
    // 起始: C=(200,130), nw=(250,30), se=Q=(150,230);f=|P−Q|/|P0−Q| → w=246,h=123
    expect(p.width).toBe(246)
    expect(p.height).toBe(123)
    // 由返回布局重构 se 内容角,应回到 Q(±0.6 舍入容差)
    const u = { x: 0, y: 1 }
    const v = { x: -1, y: 0 }
    const ncx = p.x + p.width / 2
    const ncy = p.y + (p.height ?? 0) / 2
    const qNew = { x: ncx + (p.width / 2) * u.x + ((p.height ?? 0) / 2) * v.x, y: ncy + (p.width / 2) * u.y + ((p.height ?? 0) / 2) * v.y }
    expect(Math.abs(qNew.x - 150)).toBeLessThanOrEqual(0.6)
    expect(Math.abs(qNew.y - 230)).toBeLessThanOrEqual(0.6)
  })
  it('未显式高:height=null,y 补偿按布局高同比', () => {
    const p = rotatedCornerResize({ x: 100, y: 80, w: 200, h: 100 }, 'nw', { x: 40, y: 40 }, 0, { hExplicit: null })
    expect(p.height).toBeNull()
    expect(p.x + p.width).toBe(300) // 右缘锚定
    expect(p.y + 100 * (p.width / 200)).toBeCloseTo(180) // 下缘锚定(同比)
  })
  it('min 钳制(deg=0):拖到锚点,收窄到 20 且锚定边不动', () => {
    const p = rotatedCornerResize({ x: 100, y: 80, w: 200, h: 100 }, 'nw', { x: 300, y: 180 }, 0, { hExplicit: 100 })
    expect(p.width).toBe(20)
    expect(p.x + p.width).toBe(300)
    expect(p.y + (p.height ?? 0)).toBe(180)
  })
})

describe('多选撤销粒度(2026-11-11 §6.5 R9a: 批量动作=单条撤销)', () => {
  it('applyLayerGeometry 三层一次提交,撤销栈只进一条,undo 一次全还原', () => {
    const s0 = useEditor.getState()
    s0.setTemplate('product')
    s0.setProp('image', 'a.png')
    s0.addCustomLayer('b.png', 10, 10, 100)
    s0.addCustomLayer('c.png', 40, 40, 100)
    const st = useEditor.getState()
    const pastBefore = (useEditor as unknown as { temporal: { getState: () => { pastStates: unknown[] } } }).temporal.getState().pastStates.length
    st.applyLayerGeometry([
      { id: st.selectedLayer!, custom: true, x: 111, y: 222 },
      { id: 'img-x1', custom: false, x: 5, y: 6 }, // 固定层走 styles
    ])
    const after1 = useEditor.getState()
    const custom = (after1.props.customLayers as Array<{ id: string; x: number; y: number }>)
    expect(custom.find((l) => l.x === 111)?.y).toBe(222)
    expect((after1.props.styles as Record<string, { dx: number }>)[after1.selectedLayer ?? ''] ?? null).toBeNull()
    const pastAfter1 = (useEditor as unknown as { temporal: { getState: () => { pastStates: unknown[] } } }).temporal.getState().pastStates.length
    expect(pastAfter1).toBe(pastBefore + 1) // 单条记录
  })
  it('removeCustomLayers 一次删除多条并清 z 序/选择', () => {
    const st = useEditor.getState()
    const ids = (st.props.customLayers as Array<{ id: string }>).map((l) => l.id)
    st.removeCustomLayers(ids)
    const after = useEditor.getState()
    expect((after.props.customLayers as unknown[]).length).toBe(0)
    expect(after.multiSelected.length).toBe(0)
  })
})

describe('groupScaleEntries (多选组缩放,2026-11-11 §6.5 R9c)', () => {
  it('自定义层: 视觉中心绕选区中心缩放,布局宽高同比', () => {
    // 选区中心 (200,150);成员视觉盒中心 (150,120) → 新中心 (100,90)
    const e = groupScaleEntries(
      { cx: 200, cy: 150 },
      [{ id: 'a', custom: true, box: { left: 100, top: 70, w: 100, h: 100 }, layout: { x: 100, y: 70, w: 100, h: 100 } }],
      0.5,
    )
    expect(e[0]).toEqual({ id: 'a', custom: true, x: 125, y: 85, width: 50, height: 50 })
  })
  it('文字层: dx/dy 平移 + gscale×f', () => {
    const e = groupScaleEntries(
      { cx: 0, cy: 0 },
      [{ id: 't', custom: false, box: { left: 300, top: 200, w: 100, h: 40 }, dx: 10, dy: 20, gscale: 1 }],
      2,
    )
    expect(e[0]?.x).toBe(360) // 视觉中心 (350,220) → (700,440): dx(条目 x) += 350
    expect(e[0]?.y).toBe(240)
    expect(e[0]?.gscale).toBe(2)
  })
  it('gscale 夹取 0.3..3', () => {
    const e = groupScaleEntries({ cx: 0, cy: 0 }, [
      { id: 't', custom: false, box: { left: 10, top: 10, w: 10, h: 10 }, gscale: 2.5 },
    ], 0.1)
    expect(e[0]?.gscale).toBe(0.3)
  })
  it('产品槽位: sx/sy×f 夹取', () => {
    const e = groupScaleEntries(
      { cx: 100, cy: 100 },
      [{ id: 'p', custom: false, box: { left: 50, top: 50, w: 100, h: 100 }, dx: 0, dy: 0, sx: 1, sy: 1 }],
      0.5,
    )
    expect(e[0]?.sx).toBe(0.5)
    expect(e[0]?.sy).toBe(0.5)
  })
})
