// 文字样式覆盖纯函数对拍
import { describe, expect, it } from 'vitest'
import { layerStyle } from '../templates/text-style'

describe('layerStyle(§9.7-2 样式细调)', () => {
  it('缺省 = 模板基准', () => {
    expect(layerStyle(undefined, 'title', { fontSize: 88, color: '#ffffff' })).toEqual({ fontSize: 88, color: '#ffffff', translate: '', fontFamily: undefined, textShadow: undefined, strokeCss: undefined })
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
