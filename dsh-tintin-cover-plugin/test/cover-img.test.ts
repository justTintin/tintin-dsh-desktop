// 模板图片安全渲染的判定口径(templates/CoverImg.tsx):未设置不画;staticFile 会同步抛错的值
// 判非法(预览只标本层,不让整张画布崩)——2026-11-01 产品图被置 undefined 打穿画布的回归面。
import { describe, expect, it } from 'vitest'
import { classifyImageName } from '../templates/CoverImg'

describe('classifyImageName', () => {
  it('treats empty values as unset', () => {
    for (const value of [undefined, null, '']) expect(classifyImageName(value)).toBe('unset')
  })

  it('accepts bare asset file names (same rule as the host asset routes)', () => {
    for (const value of ['mouse.jpg', 'cover-c_4147ae8a-f.png', 'lib-813251-1793349401120.png', 'matting-20261031-183218.png']) {
      expect(classifyImageName(value)).toBe('ok')
    }
  })

  it('rejects everything staticFile() throws on or that can never be in the asset dir', () => {
    const invalid = ['https://x.com/a.png', '../a.png', './a.png', '..', 'C:\\Users\\a.png', 'D:/a.png', '/Users/a.png', 'public/a.png', '中文.png', 'a b.png', 42, {}, []]
    for (const value of invalid) expect(classifyImageName(value)).toBe('invalid')
  })
})
