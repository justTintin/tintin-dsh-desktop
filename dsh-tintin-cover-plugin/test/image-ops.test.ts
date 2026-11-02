// 选中图片图层基本操作(2026-11-01 对齐 PhotoCraft)的纯逻辑与 store 动作回归面。
import { beforeEach, describe, expect, it } from 'vitest'
import { arrangeOrder, clampScale, cloneLayer, flipPatch, lockedOf, resizeWH, rotatePatch } from '../src/editor/image-ops'
import { effectiveOrder, useEditor } from '../src/editor/store'
import { backdropStyle, lookBlend, lookOpacity, lookTransform } from '../templates/image-style'

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
