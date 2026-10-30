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
  it('字体白名单外回退默认;白名单内生效', () => {
    expect(layerStyle({ styles: { title: { font: 'Comic Sans MS' } } }, 'title', { fontSize: 88, color: '#fff' }).fontFamily).toBeUndefined()
    expect(layerStyle({ styles: { title: { font: 'KaiTi' } } }, 'title', { fontSize: 88, color: '#fff' }).fontFamily).toBe('KaiTi')
  })
  it('位移 dx/dy → translate;夹取 ±1200;缺省空串', () => {
    expect(layerStyle({ styles: { title: { dx: 20, dy: -8 } } }, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('translate(20px, -8px)')
    expect(layerStyle({ styles: { title: { dx: 9999 } } }, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('translate(1200px, 0px)')
    expect(layerStyle({}, 'title', { fontSize: 88, color: '#fff' }).translate).toBe('')
  })
})
