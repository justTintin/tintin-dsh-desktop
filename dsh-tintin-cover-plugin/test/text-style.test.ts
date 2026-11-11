// 文字样式覆盖纯函数对拍
import { describe, expect, it } from 'vitest'
import { layerStyle } from '../templates/text-style'

describe('layerStyle(§9.7-2 样式细调)', () => {
  it('缺省 = 模板基准', () => {
    expect(layerStyle(undefined, 'title', { fontSize: 88, color: '#ffffff' })).toEqual({ fontSize: 88, color: '#ffffff', translate: '', fontFamily: undefined, textShadow: undefined, strokeCss: undefined, opacity: 1, mixBlendMode: undefined })
    expect(layerStyle({ styles: {} }, 'title', { fontSize: 88, color: '#ffffff' }).fontSize).toBe(88)
  })
  it('scale 生效并四舍五入;越界夹取 0.3..3(2026-10-28 PhotoCraft 式放宽)', () => {
    expect(layerStyle({ styles: { title: { scale: 1.5 } } }, 'title', { fontSize: 88, color: '#fff' }).fontSize).toBe(132)
    expect(layerStyle({ styles: { title: { scale: 9 } } }, 'title', { fontSize: 88, color: '#fff' }).fontSize).toBe(Math.round(88 * 3))
    expect(layerStyle({ styles: { title: { scale: 0.01 } } }, 'title', { fontSize: 88, color: '#fff' }).fontSize).toBe(Math.round(88 * 0.3))
  })
  it('color 覆盖独立于 scale;非数字 scale 忽略', () => {
    expect(layerStyle({ styles: { title: { color: '#facc15' } } }, 'title', { fontSize: 88, color: '#fff' }).color).toBe('#facc15')
    expect(layerStyle({ styles: { title: { scale: 'big' as unknown as number } } }, 'title', { fontSize: 88, color: '#fff' }).fontSize).toBe(88)
  })
  it('字体=任意本机族名(2026-11-02 对齐 PhotoCraft,白名单已废):引号链回落雅黑', () => {
    expect(layerStyle({ styles: { title: { font: 'KaiTi' } } }, 'title', { fontSize: 88, color: '#fff' }).fontFamily).toBe('"KaiTi", "Microsoft YaHei", sans-serif')
    expect(layerStyle({ styles: { title: { font: 'Microsoft YaHei' } } }, 'title', { fontSize: 88, color: '#fff' }).fontWeight).toBeUndefined()
  })
  it('字重夹取 100..900,斜体透传', () => {
    expect(layerStyle({ styles: { title: { font: 'Arial', weight: 700 } } }, 'title', { fontSize: 88, color: '#fff' }).fontWeight).toBe(700)
    expect(layerStyle({ styles: { title: { font: 'Arial', weight: 5000 } } }, 'title', { fontSize: 88, color: '#fff' }).fontWeight).toBe(900)
    expect(layerStyle({ styles: { title: { font: 'Arial', weight: 'x' as unknown as number } } }, 'title', { fontSize: 88, color: '#fff' }).fontWeight).toBeUndefined()
    expect(layerStyle({ styles: { title: { font: 'Arial', italic: true } } }, 'title', { fontSize: 88, color: '#fff' }).fontStyle).toBe('italic')
    expect(layerStyle({ styles: { title: { font: 'Arial' } } }, 'title', { fontSize: 88, color: '#fff' }).fontStyle).toBeUndefined()
  })
  it('投影/描边(2026-11-02 对齐 PhotoCraft 图层样式)', () => {
    const s = layerStyle({ styles: { title: { shadow: { dx: 0, dy: 6, blur: 14, color: 'rgba(0,0,0,0.6)' }, stroke: { width: 3, color: 'rgba(2,6,23,0.65)' } } } }, 'title', { fontSize: 88, color: '#fff' })
    expect(s.textShadow).toBe('0px 6px 14px rgba(0,0,0,0.6)')
    expect(s.strokeCss).toBe('3px rgba(2,6,23,0.65)')
    const noShadow = layerStyle({ styles: { title: { shadow: undefined, stroke: undefined } } }, 'title', { fontSize: 88, color: '#fff' })
    expect(noShadow.textShadow).toBeUndefined()
    expect(noShadow.strokeCss).toBeUndefined()
  })
  it('投影参数消毒:负值/非数夹取,非法颜色字符剥除', () => {
    const s = layerStyle({ styles: { title: { shadow: { dx: -3.7, blur: -5, color: 'rgba(0,0,0);DROP<>' } } } }, 'title', { fontSize: 88, color: '#fff' })
    expect(s.textShadow).toBe('-4px 0px 0px rgba(0,0,0)DROP')
  })
  it('位移 dx/dy → translate;夹取 ±1200;缺省空串', () => {
    expect(layerStyle({ styles: { title: { dx: 20, dy: -8 } } }, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('translate(20px, -8px)')
    expect(layerStyle({ styles: { title: { dx: 9999 } } }, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('translate(1200px, 0px)')
    expect(layerStyle({}, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('')
  })
})

describe('gscale 几何缩放(2026-11-11 WP-A4: 画布角柄=几何变换不改字号)', () => {
  const base = { fontSize: 88, color: '#fff' }
  it('折入 translate 链尾 scale(g)', () => {
    expect(layerStyle({ styles: { title: { gscale: 1.5 } } }, 'title', base).translate).toBe('scale(1.5)')
    expect(layerStyle({ styles: { title: { dx: 10, rotate: -4, gscale: 2 } } }, 'title', base).translate).toBe('translate(10px, 0px) rotate(-4deg) scale(2)')
  })
  it('缺省/1 不输出 scale 段', () => {
    expect(layerStyle(undefined, 'title', base).translate).toBe('')
    expect(layerStyle({ styles: { title: { gscale: 1 } } }, 'title', base).translate).toBe('')
    expect(layerStyle({ styles: { title: { dx: 6 } } }, 'title', base).translate).toBe('translate(6px, 0px)')
  })
  it('夹取 0.3..3;非数忽略', () => {
    expect(layerStyle({ styles: { title: { gscale: 9 } } }, 'title', base).translate).toBe('scale(3)')
    expect(layerStyle({ styles: { title: { gscale: 0.1 } } }, 'title', base).translate).toBe('scale(0.3)')
    expect(layerStyle({ styles: { title: { gscale: 'x' as unknown as number } } }, 'title', base).translate).toBe('')
  })
})


describe('opacity/blend 外观通道(2026-11-11 R1: 头行扩文字层)', () => {
  const base = { fontSize: 88, color: '#fff' }
  it('opacity 缺省 1,夹取 0..1', () => {
    expect(layerStyle(undefined, 'title', base).opacity).toBe(1)
    expect(layerStyle({ styles: { title: { opacity: 0.35 } } }, 'title', base).opacity).toBe(0.35)
    expect(layerStyle({ styles: { title: { opacity: 5 } } }, 'title', base).opacity).toBe(1)
    expect(layerStyle({ styles: { title: { opacity: -1 } } }, 'title', base).opacity).toBe(0)
    expect(layerStyle({ styles: { title: { opacity: 'x' as unknown as number } } }, 'title', base).opacity).toBe(1)
  })
  it('blend 白名单;normal/非法=undefined', () => {
    expect(layerStyle({ styles: { title: { blend: 'multiply' } } }, 'title', base).mixBlendMode).toBe('multiply')
    expect(layerStyle({ styles: { title: { blend: 'normal' } } }, 'title', base).mixBlendMode).toBeUndefined()
    expect(layerStyle({ styles: { title: { blend: 'drop-the-world' } } }, 'title', base).mixBlendMode).toBeUndefined()
    expect(layerStyle({ styles: { title: { blend: 3 as unknown as string } } }, 'title', base).mixBlendMode).toBeUndefined()
  })
})