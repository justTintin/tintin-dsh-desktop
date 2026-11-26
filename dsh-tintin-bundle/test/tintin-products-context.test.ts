import { describe, expect, it } from 'vitest'
import { productContextOf } from '../openfilm-shell/tintin-products'

describe('productContextOf', () => {
  it('保留产品身份与内容字段，剔除条码/仓库等仓储信息', () => {
    const text = productContextOf({
      brand: '罗技(Logitech)',
      model: 'PRO X2 RAPID 有线游戏键盘（白色）',
      category: '键盘',
      goods_no: '920-014099',
      spec_no: '32317',
      features: '无线 / 机械轴',
      selling_points: '响应快\n手感好',
      notes: '白色',
      keywords: ['游戏', '无线'],
      barcode: '6920377923402',
      warehouse: '旺店通-金三角',
    })
    expect(text.startsWith('【产品】')).toBe(true)
    expect(text).toContain('罗技(Logitech)')
    expect(text).toContain('PRO X2 RAPID')
    expect(text).toContain('性能参数：无线 / 机械轴')
    expect(text).toContain('卖点：响应快')
    expect(text).toContain('备注：白色')
    expect(text).toContain('关键词：游戏、无线')
    expect(text).not.toContain('条码')
    expect(text).not.toContain('仓库')
    expect(text).not.toContain('6920377923402')
    expect(text).not.toContain('旺店通')
  })

  it('缺字段时不生成空行，也无条码/仓库残留', () => {
    const text = productContextOf({ brand: '罗技', barcode: '123', warehouse: '仓A' })
    expect(text).toBe('【产品】罗技')
    expect(text).not.toContain('条码')
    expect(text).not.toContain('仓库')
  })
})
