// sel-geom 纯几何对拍(2026-11-11 WP-A3 旋转感知选择框)
import { describe, expect, it } from 'vitest'
import { cursorFor, decompose, frameFromLayout, parseMatrix, rotCorners, rotEdges, rotateHandlePos } from '../src/editor/sel-geom'

describe('parseMatrix / decompose', () => {
  it('none 与 matrix3d → null', () => {
    expect(parseMatrix('none')).toBeNull()
    expect(parseMatrix('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)')).toBeNull()
    expect(parseMatrix(undefined)).toBeNull()
  })
  it('单位阵 → deg 0 / sx sy 1', () => {
    expect(decompose(parseMatrix('matrix(1,0,0,1,0,0)'))).toEqual({ deg: 0, sx: 1, sy: 1, tx: 0, ty: 0 })
  })
  it('rotate(90deg) → deg 90(scale 轴随转)', () => {
    const d = decompose(parseMatrix('matrix(0,1,-1,0,0,0)'))
    expect(d.deg).toBeCloseTo(90)
    expect(d.sx).toBeCloseTo(1)
    expect(d.sy).toBeCloseTo(1)
  })
  it('translate 透传 e/f;scale 模长', () => {
    const d = decompose(parseMatrix('matrix(2,0,0,3,10,-4)'))
    expect(d.sx).toBe(2)
    expect(d.sy).toBe(3)
    expect(d.tx).toBe(10)
    expect(d.ty).toBe(-4)
  })
})

describe('frameFromLayout', () => {
  it('视觉中心 = 布局中心 + 平移;视觉宽高 = 布局 × 轴缩放', () => {
    const f = frameFromLayout({ left: 100, top: 100, w: 200, h: 100 }, { deg: 0, sx: 1.5, sy: 2, tx: 10, ty: 5 })
    expect(f.cx).toBe(100 + 100 + 10)
    expect(f.cy).toBe(100 + 50 + 5)
    expect(f.w).toBe(300)
    expect(f.h).toBe(200)
  })
})

describe('rotCorners(视觉方位标注)', () => {
  it('轴对齐退化为 CSS 命名', () => {
    const cs = rotCorners({ cx: 100, cy: 100, w: 200, h: 100, deg: 0 })
    const by = Object.fromEntries(cs.map((c) => [c.corner, c]))
    expect(by.nw).toEqual({ corner: 'nw', x: 0, y: 50 })
    expect(by.ne).toEqual({ corner: 'ne', x: 200, y: 50 })
    expect(by.se).toEqual({ corner: 'se', x: 200, y: 150 })
    expect(by.sw).toEqual({ corner: 'sw', x: 0, y: 150 })
  })
  it('rotate(90°): 200×100 的框视觉上变 100 宽 200 高,角点集正确', () => {
    const cs = rotCorners({ cx: 100, cy: 100, w: 200, h: 100, deg: 90 })
    const set = cs.map((c) => `${c.x},${c.y}`).sort()
    // deg=90: u=(0,1), v=(-1,0);角点 = c ± 100·u ± 50·v → x∈{50,150}, y∈{0,200}
    expect(set).toEqual(['50,0', '150,0', '50,200', '150,200'].sort())
    // 视觉最上左 = nw: min(x+y)=50 → (50,0)
    expect(cs.find((c) => c.corner === 'nw')).toEqual({ corner: 'nw', x: 50, y: 0 })
  })
})

describe('rotEdges / rotateHandlePos', () => {
  it('轴对齐: n/s/w/e 四中点', () => {
    const e = rotEdges({ cx: 100, cy: 100, w: 200, h: 100, deg: 0 })
    expect(e.n).toEqual({ x: 100, y: 50 })
    expect(e.s).toEqual({ x: 100, y: 150 })
    expect(e.w).toEqual({ x: 0, y: 100 })
    expect(e.e).toEqual({ x: 200, y: 100 })
  })
  it('旋转柄在视觉上边外侧(deg=0 → 上方;deg=90 → 左侧)', () => {
    expect(rotateHandlePos({ cx: 100, cy: 100, w: 200, h: 100, deg: 0 }, 20)).toEqual({ x: 100, y: 30 })
    const p90 = rotateHandlePos({ cx: 100, cy: 100, w: 200, h: 100, deg: 90 }, 20)
    expect(p90.x).toBeLessThan(100) // 旋转 90° 后"上边"朝屏幕左
    expect(p90.y).toBe(100)
  })
})

describe('cursorFor(45° 桶近似方位光标)', () => {
  it('四向映射', () => {
    expect(cursorFor(0)).toBe('ew-resize')
    expect(cursorFor(90)).toBe('ns-resize')
    expect(cursorFor(45)).toBe('nwse-resize')
    expect(cursorFor(135)).toBe('nesw-resize')
    expect(cursorFor(-45)).toBe('nesw-resize')
    expect(cursorFor(370)).toBe('ew-resize')
  })
})
