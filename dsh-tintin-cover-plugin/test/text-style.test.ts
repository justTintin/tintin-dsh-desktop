// 文字样式覆盖纯函数对拍
import { describe, expect, it } from 'vitest'
import { layerStyle } from '../templates/text-style'

describe('layerStyle(§9.7-2 样式细调)', () => {
  it('缺省 = 模板基准', () => {
    expect(layerStyle(undefined, 'title', { fontSize: 88, color: '#ffffff' })).toEqual({ fontSize: 88, color: '#ffffff', translate: '', fontFamily: undefined })
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
  it('位移 dx/dy → translate;夹取 ±1200;缺省空串', () => {
    expect(layerStyle({ styles: { title: { dx: 20, dy: -8 } } }, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('translate(20px, -8px)')
    expect(layerStyle({ styles: { title: { dx: 9999 } } }, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('translate(1200px, 0px)')
    expect(layerStyle({}, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('')
  })
})
