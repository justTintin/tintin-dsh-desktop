// 图层面板行模型(2026-10-31 方案 B:快照视图模型,照 PhotoCraft LayersModel——
// 数据由 props+模板派生为只读行列表,面板只渲染行,操作一律以命令进 store)。
// 图层组阶段 1(用户裁决:固定名=图层组,每组默认一个图层,素材可游离):固定槽位渲染为
// "组头+默认图层"两级行;customLayers=游离素材行。props 结构零改动,组仅是呈现与投放语义。

import type { LayerDef } from '../registry'

export type LayerPanelRow =
  | {
      rowType: 'group'
      id: string
      label: string
      type: LayerDef['type']
      /** 图片组:素材拖到组头=设为该组图(props.image/bgImage) */
      imageGroup: boolean
      hidden: boolean
      /** 图片组当前图文件名(空=模板默认) */
      current: string
    }
  | { rowType: 'default'; groupId: string; label: string; detail: string; hidden: boolean }
  | { rowType: 'free'; id: string; label: string; image: string; hidden: boolean }

const fileName = (p: string): string => p.split('/').pop() ?? p

/** 由模板槽位+props 派生面板行(topToBottom=有效 z 序的顶→底序列)。纯函数,无 store 依赖。 */
export function buildLayerRows(args: {
  layerDefs: LayerDef[]
  topToBottom: string[]
  props: Record<string, unknown>
  customLayers: Array<{ id: string; image: string }>
  hiddenLayers: string[]
}): LayerPanelRow[] {
  const { layerDefs, topToBottom, props, customLayers, hiddenLayers } = args
  const defById = new Map(layerDefs.map((l) => [l.id, l]))
  const customById = new Map(customLayers.map((l) => [l.id, l]))
  const rows: LayerPanelRow[] = []
  for (const id of topToBottom) {
    const custom = customById.get(id)
    if (custom) {
      rows.push({ rowType: 'free', id, label: fileName(custom.image), image: custom.image, hidden: hiddenLayers.includes(id) })
      continue
    }
    const def = defById.get(id)
    if (!def) continue
    const key = def.propsKey ?? def.id
    const value = props[key]
    const imageGroup = def.type === 'product' || key === 'bgImage'
    const hidden = hiddenLayers.includes(id)
    rows.push({
      rowType: 'group', id, label: def.label, type: def.type, imageGroup, hidden,
      current: imageGroup && typeof value === 'string' && value ? fileName(value) : '',
    })
    let detail: string
    if (imageGroup) detail = typeof value === 'string' && value ? fileName(value) : '模板默认'
    else if (Array.isArray(value)) detail = value.length ? String(value[0]) : '(空)'
    else if (typeof value === 'string' && value) detail = value
    else detail = def.type === 'graphic' ? '内置图形' : '(空)'
    rows.push({ rowType: 'default', groupId: id, label: '默认图层', detail, hidden })
  }
  return rows
}
