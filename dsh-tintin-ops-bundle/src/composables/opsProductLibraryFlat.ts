// opsProductLibraryFlat — 产品库左栏扁平分页列表纯逻辑（2026-11-14 用户裁决：
// 参考服务端 ERP 列表——过滤条件在搜索之上、行分割线、客户端分页；数据源仍是
// /grouped 树与 /search 平铺，不改服务端契约）。本文件 ops 独有：不并入两包字节
// 副本的 opsProductLibraryLogic.ts（media 持有该副本，新增函数会使其漂移）。
import { searchResultLabel, type ProductItem } from './opsProductLibraryLogic'

export interface ProductFlatEntry {
  id: string
  label: string
  category: string
  brand: string
  goodsNo: string
  availableNum: string
}

export interface FlatFilters {
  category: string
  brand: string
}

/** 条目 → 扁平行。label 口径对齐 searchResultLabel（brand+model → (未命名)）；
 *  category/brand 空值兜底同 buildProductTree（未归类/未知品牌）。 */
export function toFlatEntry(it: ProductItem, category: string, brand: string): ProductFlatEntry {
  return {
    id: String(it.id ?? ''),
    label: searchResultLabel(it),
    category,
    brand,
    goodsNo: String(it.goods_no ?? '').trim(),
    availableNum: String(it.available_num ?? '').trim(),
  }
}

/** /grouped 树 → 扁平行（品类/品牌字典序、叶子按 model 排序——对齐 treeToNodes 口径）。 */
export function flattenTree(tree: Record<string, Record<string, ProductItem[]>>): ProductFlatEntry[] {
  const rows: ProductFlatEntry[] = []
  for (const cat of Object.keys(tree).sort()) {
    for (const brand of Object.keys(tree[cat]).sort()) {
      const leaves = [...tree[cat][brand]].sort((a, b) =>
        String(a.model ?? '').localeCompare(String(b.model ?? '')))
      for (const it of leaves) rows.push(toFlatEntry(it, cat, brand))
    }
  }
  return rows
}

/** /search 平铺条目 → 扁平行（分类/品牌取条目自带字段）。 */
export function flattenItems(items: ProductItem[]): ProductFlatEntry[] {
  return items.map((it) => toFlatEntry(
    it,
    String(it.category ?? '').trim() || '未归类',
    String(it.brand ?? '').trim() || '未知品牌',
  ))
}

/** 过滤：空选=不过滤（全部分类/全部品牌）。 */
export function filterFlat(entries: ProductFlatEntry[], f: FlatFilters): ProductFlatEntry[] {
  return entries.filter((e) =>
    (!f.category || e.category === f.category) && (!f.brand || e.brand === f.brand))
}

/** 过滤下拉候选（去重字典序；随当前列表数据派生，无独立服务端字典）。 */
export function filterOptions(entries: ProductFlatEntry[]): { categories: string[]; brands: string[] } {
  return {
    categories: [...new Set(entries.map((e) => e.category))].sort(),
    brands: [...new Set(entries.map((e) => e.brand))].sort(),
  }
}

/** 分页切片：page 越界自动收敛到末页；pageSize 非法按 1 处理。 */
export function pageSlice(
  entries: ProductFlatEntry[],
  page: number,
  pageSize: number,
): { rows: ProductFlatEntry[]; page: number; totalPages: number; total: number } {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const totalPages = Math.max(1, Math.ceil(entries.length / size))
  const p = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  const start = (p - 1) * size
  return { rows: entries.slice(start, start + size), page: p, totalPages, total: entries.length }
}
