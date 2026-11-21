// layer-geom — 统一几何操作纯函数回归(路线 v2 步骤3+4,设计=§7.27)。
// corner/edge 盒数学用例自 git 历史(12f1a3fecb^ 的 cornerResize/rotatedEdgeResize deg=0)
// 移植对拍;三 kind 提交换算+中心缩放补偿为新契约锁。
import { describe, expect, it } from 'vitest'
import {
  beginResize, cornerFactor, cornerResizeBox, edgeResizeBox, handleAnchor, handleCursor,
  resizeEntry, sessionPreviewCss, sessionPreviewBox, type GeomBox, type ResizeSession,
} from '../src/editor/layer-geom.ts'

const BOX: GeomBox = { left: 100, top: 200, w: 300, h: 200 }

describe('handleAnchor / handleCursor(单表同源)', () => {
  it('角柄锚=对侧角,边柄锚=对边中点', () => {
    expect(handleAnchor(BOX, 'nw')).toEqual({ x: 400, y: 400 })
    expect(handleAnchor(BOX, 'se')).toEqual({ x: 100, y: 200 })
    expect(handleAnchor(BOX, 'e')).toEqual({ x: 100, y: 300 })
    expect(handleAnchor(BOX, 'n')).toEqual({ x: 250, y: 400 })
  })
  it('cursor 表:角=双轴斜向,边=单轴', () => {
    expect(handleCursor('nw')).toBe('nwse-resize')
    expect(handleCursor('se')).toBe('nwse-resize')
    expect(handleCursor('ne')).toBe('nesw-resize')
    expect(handleCursor('sw')).toBe('nesw-resize')
    expect(handleCursor('e')).toBe('ew-resize')
    expect(handleCursor('n')).toBe('ns-resize')
  })
})

describe('cornerResizeBox(角柄等比,对角锚;git 历史 cornerResize 用例移植)', () => {
  it('SE 拖大:对角(左上)为锚,left/top 不动', () => {
    const f = Math.hypot(500, 350) / Math.hypot(300, 150)
    const r = cornerResizeBox(BOX, 'se', f)
    expect(r.left).toBe(100)
    expect(r.top).toBe(200)
    expect(r.w).toBe(Math.round(300 * f))
  })
  it('NW 向左上拖:对角(右下)为锚', () => {
    const f = Math.hypot(150, 250) / Math.hypot(300, 150)
    const r = cornerResizeBox(BOX, 'nw', f)
    expect(r.left + r.w).toBe(400)
    expect(r.top + r.h).toBe(400)
    expect(r.w).toBe(Math.round(300 * f))
  })
  it('最小钳制 20px', () => {
    const r = cornerResizeBox(BOX, 'se', 0.01)
    expect(r.w).toBe(20)
    expect(r.h).toBe(20)
  })
  it('cornerFactor 下限 8 屏蔽除零', () => {
    expect(cornerFactor(0, 0)).toBe(1)
    expect(cornerFactor(16, 8)).toBe(2)
  })
})

describe('edgeResizeBox(边柄单轴,对边锚;git 历史 rotatedEdgeResize deg=0 用例移植)', () => {
  it('e 右拉加宽,left 锚不动', () => {
    const r = edgeResizeBox(BOX, 'e', { x: 400, y: 0 })
    expect(r).toEqual({ left: 100, top: 200, w: 300, h: 200 })
    const r2 = edgeResizeBox(BOX, 'e', { x: 450, y: 0 })
    expect(r2.w).toBe(350)
    expect(r2.left).toBe(100)
  })
  it('w 左拉:左缘随指针,右缘 400 锚定', () => {
    const r = edgeResizeBox(BOX, 'w', { x: 70, y: 0 })
    expect(r.w).toBe(330)
    expect(r.left).toBe(70)
    expect(r.left + r.w).toBe(400)
  })
  it('n 上拉:顶缘随指针,底缘 400 锚定;最小 20', () => {
    const r = edgeResizeBox(BOX, 'n', { x: 0, y: 180 })
    expect(r.h).toBe(220)
    expect(r.top).toBe(180)
    expect(r.top + r.h).toBe(400)
    const r2 = edgeResizeBox(BOX, 'n', { x: 0, y: 500 })
    expect(r2.h).toBe(20)
    expect(r2.top).toBe(380)
  })
})

describe('resizeEntry 三 kind 提交换算', () => {
  it('custom:盒即布局;width/height 直映;height 缺省=不钉死', () => {
    const s = beginResize('img-a', 'custom', 'se', BOX, { x: 100, y: 200, width: 300 }, { x: 400, y: 400 }, 1)
    const e = resizeEntry(s, { left: 100, top: 200, w: 450, h: 300 })
    expect(e).toEqual({ id: 'img-a', custom: true, x: 100, y: 200, width: 450 })
    const s2 = beginResize('img-a', 'custom', 'se', BOX, { x: 100, y: 200, width: 300, height: 150 }, { x: 400, y: 400 }, 1)
    const e2 = resizeEntry(s2, { left: 100, top: 200, w: 450, h: 225 })
    expect(e2.height).toBe(225)
  })
  it('text:盒比→gscale(钳 0.3..3);中心缩放位移补偿进 dx/dy', () => {
    const s = beginResize('title', 'text', 'nw', BOX, { dx: 10, dy: 20, gscale: 1 }, { x: 100, y: 200 }, 1)
    // 等比 f=2:新盒={left:-200,top:0,w:600,h:400}(锚 se 400,400)
    const e = resizeEntry(s, { left: -200, top: 0, w: 600, h: 400 })
    expect(e.gscale).toBe(2)
    // 补偿:dx'=10+(-200-100)+(600-300)/2=10-300+150=-140;dy'=20-200+100=-80
    expect(e.x).toBe(-140)
    expect(e.y).toBe(-80)
  })
  it('text gscale 钳 0.3..3', () => {
    const s = beginResize('title', 'text', 'se', BOX, { gscale: 2.5 }, { x: 400, y: 400 }, 1)
    const e = resizeEntry(s, { left: 100, top: 200, w: 30, h: 20 })
    expect(e.gscale).toBe(0.3) // 2.5×0.1=0.25 → 钳 0.3
  })
  it('slot:边柄 e=只写 sx(sy 不动),位移补偿=Δw/2', () => {
    const s = beginResize('product', 'slot', 'e', BOX, { dx: 0, dy: 0, sx: 1, sy: 1 }, { x: 400, y: 300 }, 1)
    const e = resizeEntry(s, { left: 100, top: 200, w: 450, h: 200 })
    expect(e.sx).toBe(1.5)
    expect(e.sy).toBeUndefined()
    expect(e.x).toBe(75) // 0+(0)+(450-300)/2
    expect(e.y).toBe(0)
  })
  it('slot:角柄=双轴等比+钳制', () => {
    const s = beginResize('product', 'slot', 'nw', BOX, { dx: 5, dy: 6, sx: 2, sy: 2 }, { x: 100, y: 200 }, 1)
    const e = resizeEntry(s, { left: 250, top: 300, w: 150, h: 100 })
    expect(e.sx).toBe(1)
    expect(e.sy).toBe(1)
    expect(e.x).toBe(80) // 5+(250-100)+(150-300)/2=5+150-75
    expect(e.y).toBe(56) // 6+(300-200)+(100-200)/2=6+100-50
  })
})

describe('会话预览 CSS(与提交同数学)', () => {
  it('origin=锚的本地位(g=盒宽/布局宽);scale=盒比', () => {
    const s = beginResize('img-a', 'custom', 'se', BOX, { width: 300, height: 200 }, { x: 400, y: 400 }, 1)
    const css = sessionPreviewCss(s, { left: 100, top: 200, w: 450, h: 300 }, 300, 200)
    expect(css.origin).toBe('0px 0px') // 锚=左上(0,0)/g=1
    expect(css.scale).toBe('1.5')
  })
  it('槽位边柄=双值 scale(fx 1)', () => {
    const s = beginResize('product', 'slot', 'e', BOX, { sx: 1, sy: 1 }, { x: 400, y: 300 }, 1)
    const css = sessionPreviewCss(s, { left: 100, top: 200, w: 450, h: 200 }, 300, 200)
    expect(css.scale).toBe('1.5 1')
  })
  it('sessionPreviewBox 角柄走等比/边柄走单轴', () => {
    const s = beginResize('img-a', 'custom', 'se', BOX, {}, { x: 400, y: 400 }, 1)
    // f=hypot(450,350)/hypot(300,200)≈1.5811 → w=round(300f)=474,h=round(200f)=316;锚(100,200)不动
    const corner = sessionPreviewBox(s, { x: 550, y: 550 })
    expect(corner.w).toBe(474)
    expect(corner.h).toBe(316)
    expect(corner.left).toBe(100)
    expect(corner.top).toBe(200)
    const e = beginResize('img-a', 'custom', 'e', BOX, {}, { x: 400, y: 300 }, 1)
    const edge = sessionPreviewBox(e, { x: 450, y: 999 })
    expect(edge.w).toBe(350)
    expect(edge.h).toBe(200)
  })
})
