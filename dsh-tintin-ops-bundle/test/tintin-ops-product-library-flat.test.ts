// test/tintin-ops-product-library-flat.test.ts — 产品库左栏扁平分页列表纯逻辑回归
// （2026-11-14 用户裁决：参考 ERP 列表——过滤条件在搜索之上、行分割线、客户端分页；
// 数据源 /grouped 树与 /search 平铺不变，逻辑见 opsProductLibraryFlat.ts）
import { describe, expect, it } from 'vitest'
import {
  filterFlat,
  filterOptions,
  flattenItems,
  flattenTree,
  pageSlice,
  toFlatEntry,
} from '../src/composables/opsProductLibraryFlat'

const TREE = {
  'ARB戴尔部件': {
    '戴尔(Dell)': [
      { id: 'b', brand: '戴尔(Dell)', model: 'B 电源', goods_no: '200', available_num: 3 },
      { id: 'a', brand: '戴尔(Dell)', model: 'A 电源', goods_no: '100', available_num: 0 },
    ],
  },
  键盘: {
    '罗技(Logit)': [{ id: 'c', brand: '罗技(Logit)', model: 'K950 白色', goods_no: '19099', available_num: 2 }],
  },
}

describe('flattenTree / flattenItems', () => {
  it('flattens the grouped tree with category/brand sort and model sort', () => {
    const rows = flattenTree(TREE)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']) // 品类字典序：ARB… < 键盘
    expect(rows[0]).toMatchObject({ category: 'ARB戴尔部件', brand: '戴尔(Dell)', label: '戴尔(Dell) A 电源', goodsNo: '100', availableNum: '0' })
  })

  it('maps flat search items with the same empty-value fallbacks as buildProductTree', () => {
    const rows = flattenItems([{ id: 'x', model: 'M1' }, { id: 'y', brand: 'B', category: 'C', model: '', goods_no: 'g1', available_num: 5 }])
    expect(rows[0]).toMatchObject({ category: '未归类', brand: '未知品牌', label: 'M1' })
    expect(rows[1]).toMatchObject({ category: 'C', brand: 'B', label: 'B', goodsNo: 'g1', availableNum: '5' })
  })

  it('toFlatEntry keeps the searchResultLabel contract (brand+model → (未命名))', () => {
    expect(toFlatEntry({ brand: '戴尔', model: 'HA65' }, 'C', 'B').label).toBe('戴尔 HA65')
    expect(toFlatEntry({}, 'C', 'B').label).toBe('(未命名)')
  })
})

describe('filterFlat / filterOptions', () => {
  const rows = flattenTree(TREE)

  it('empty selections mean no filtering', () => {
    expect(filterFlat(rows, { category: '', brand: '' })).toHaveLength(3)
  })

  it('filters by category and brand conjunctively', () => {
    expect(filterFlat(rows, { category: '键盘', brand: '' }).map((r) => r.id)).toEqual(['c'])
    expect(filterFlat(rows, { category: '键盘', brand: '戴尔(Dell)' })).toHaveLength(0)
    expect(filterFlat(rows, { category: 'ARB戴尔部件', brand: '戴尔(Dell)' }).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('derives deduped sorted dropdown options', () => {
    // .sort() 为 UTF-16 码元序：戴(U+6234) < 罗(U+7F57)
    expect(filterOptions(rows)).toEqual({ categories: ['ARB戴尔部件', '键盘'], brands: ['戴尔(Dell)', '罗技(Logit)'] })
  })
})

describe('pageSlice', () => {
  const rows = flattenTree(TREE)

  it('slices a page and reports totals', () => {
    const p1 = pageSlice(rows, 1, 2)
    expect(p1.rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(p1).toMatchObject({ page: 1, totalPages: 2, total: 3 })
    expect(pageSlice(rows, 2, 2).rows.map((r) => r.id)).toEqual(['c'])
  })

  it('clamps out-of-range pages to the last page and tolerates bad inputs', () => {
    expect(pageSlice(rows, 99, 2).page).toBe(2)
    expect(pageSlice(rows, 0, 2).page).toBe(1)
    expect(pageSlice([], 5, 20)).toMatchObject({ rows: [], page: 1, totalPages: 1, total: 0 })
    expect(pageSlice(rows, 1, 0)).toMatchObject({ totalPages: 3 }) // 非法 pageSize 按 1
  })
})
