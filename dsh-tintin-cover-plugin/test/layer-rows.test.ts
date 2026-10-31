import { describe, expect, it } from 'vitest'
import { buildLayerRows } from '../src/editor/layer-rows'
import type { LayerDef } from '../src/registry'

const defs: LayerDef[] = [
  { id: 'environment', label: '环境图', type: 'environment', propsKey: 'bgImage' },
  { id: 'product', label: '产品图', type: 'product', propsKey: 'image' },
  { id: 'title', label: '主标题(钩子)', type: 'text', propsKey: 'hookLines' },
  { id: 'brand', label: '品牌条(装饰)', type: 'graphic', propsKey: 'brand' },
  { id: 'grid', label: '网格纹理', type: 'graphic' },
]

describe('buildLayerRows(图层组阶段 1 行模型)', () => {
  it('固定槽位=组头+默认图层两级行,customLayers=游离素材行,保持 z 序', () => {
    const rows = buildLayerRows({
      layerDefs: defs,
      topToBottom: ['img-a', 'title', 'product', 'environment', 'brand', 'grid', 'img-b'],
      props: { bgImage: 'bg-1.png', image: 'matting-1.png', hookLines: ['第一钩', '第二钩'], brand: 'TinTin' },
      customLayers: [{ id: 'img-a', image: 'assets/matting-1.png', group: 'product' }, { id: 'img-b', image: 'assets/x.png' }],
      hiddenLayers: ['brand'],
    })
    expect(rows.map((r) => (r.rowType === 'default' ? `default:${r.groupId}` : r.rowType === 'group' ? `group:${r.id}` : `free:${r.id}`))).toEqual([
      'free:img-a', 'group:title', 'default:title', 'group:product', 'default:product', 'group:environment', 'default:environment', 'group:brand', 'default:brand', 'group:grid', 'default:grid', 'free:img-b',
    ])
    /* 阶段2 叠放:成员行携带组归属,组行累计成员数 */
    const member = rows[0]
    expect(member?.rowType === 'free' && member.group).toBe('product')
    const productGroup = rows.find((r) => r.rowType === 'group' && r.id === 'product')
    expect(productGroup?.rowType === 'group' && productGroup.members).toBe(1)
    const freeB = rows[rows.length - 1]
    expect(freeB?.rowType === 'free' && freeB.group).toBeUndefined()
  })

  it('图片组识别(product 类型或 bgImage 键)并携带当前图文件名', () => {
    const rows = buildLayerRows({
      layerDefs: defs,
      topToBottom: ['product', 'environment'],
      props: { image: 'a/matting-2.png', bgImage: '' },
      customLayers: [],
      hiddenLayers: [],
    })
    const product = rows[0]
    const environment = rows[2]
    expect(product?.rowType === 'group' && product.imageGroup).toBe(true)
    expect(product?.rowType === 'group' && product.current).toBe('matting-2.png')
    expect(environment?.rowType === 'group' && environment.imageGroup).toBe(true)
    expect(environment?.rowType === 'group' && environment.current).toBe('')
  })

  it('默认图层行 detail:图片组空=模板默认,文字组=首行,装饰组字符串直显,无 prop=内置图形', () => {
    const rows = buildLayerRows({
      layerDefs: defs,
      topToBottom: ['product', 'title', 'brand', 'grid'],
      props: { image: '', hookLines: ['钩子一', '钩子二'], brand: '品牌文案' },
      customLayers: [],
      hiddenLayers: [],
    })
    const details = rows.filter((r) => r.rowType === 'default').map((r) => (r.rowType === 'default' ? r.detail : ''))
    expect(details).toEqual(['模板默认', '钩子一', '品牌文案', '内置图形'])
  })

  it('隐藏状态透传到组头与默认行;游离行带文件名', () => {
    const rows = buildLayerRows({
      layerDefs: defs,
      topToBottom: ['brand', 'img-a'],
      props: { brand: 'x' },
      customLayers: [{ id: 'img-a', image: 'lib/m1.png' }],
      hiddenLayers: ['brand'],
    })
    expect(rows[0]?.hidden).toBe(true)
    expect(rows[1]?.hidden).toBe(true)
    expect(rows[2]?.rowType === 'free' && rows[2].label).toBe('m1.png')
  })
})
