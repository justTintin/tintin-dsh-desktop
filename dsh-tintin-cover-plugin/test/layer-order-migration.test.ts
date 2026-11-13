// 层序迁移回归(2026-11-13 用户裁决「主标题在副标题上面」;acedd29fb4 模板换位只对新建
// 项目生效——既有项目存档里的显式 layerOrder 仍是旧相对序,消费时统一交换):
// · normalizeTitleOrder:旧序交换/已正序不动/缺 id 不动/非数组透传;
// · effectiveOrder:装载旧存档后面板 z 序里 subtitle 在 title 之前(=主标题渲染在上)。
import { describe, expect, it, beforeEach } from 'vitest'
import { normalizeTitleOrder } from '../src/registry'
import { useEditor, effectiveOrder } from '../src/editor/store'

const S = () => useEditor.getState()

describe('normalizeTitleOrder(旧存档层序迁移)', () => {
  it('title 在 subtitle 前=旧序,交换', () => {
    expect(normalizeTitleOrder(['environment', 'title', 'subtitle', 'brand']))
      .toEqual(['environment', 'subtitle', 'title', 'brand'])
  })
  it('subtitle 已在 title 前=新序,原样返回(值相等)', () => {
    expect(normalizeTitleOrder(['environment', 'subtitle', 'title', 'brand']))
      .toEqual(['environment', 'subtitle', 'title', 'brand'])
  })
  it('缺任一 id 或非数组=透传', () => {
    expect(normalizeTitleOrder(['environment', 'title', 'brand'])).toEqual(['environment', 'title', 'brand'])
    expect(normalizeTitleOrder(['environment', 'subtitle', 'brand'])).toEqual(['environment', 'subtitle', 'brand'])
    expect(normalizeTitleOrder(undefined)).toBeUndefined()
    expect(normalizeTitleOrder('title,subtitle')).toBe('title,subtitle')
  })
  it('自定义图层 id 夹在中间不碍事,位置原样保留', () => {
    expect(normalizeTitleOrder(['title', 'img-x', 'subtitle'])).toEqual(['subtitle', 'img-x', 'title'])
  })
})

describe('effectiveOrder 装载旧存档(编辑器消费口径)', () => {
  beforeEach(() => {
    S().setTemplate('video-portrait')
    useEditor.setState({
      props: {
        ...S().props,
        layerOrder: ['environment', 'product', 'titleRule', 'title', 'subtitle', 'subTag', 'brand'],
        customLayers: [],
      },
    })
  })
  it('旧存档装载后 subtitle 先于 title(主标题渲染在上)', () => {
    const order = effectiveOrder(S())
    expect(order.indexOf('subtitle')).toBeLessThan(order.indexOf('title'))
  })
})
