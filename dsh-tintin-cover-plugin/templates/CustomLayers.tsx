// 自定义图片图层(2026-10-28 用户裁决:拖入的图片都是新图层,图层可调层级)。
// · customLayers:props 里的动态图片层(画布 px 定位,width 定缩放,height 随纵横比);
// · layerOrder:全部图层(固定+自定义)的自底向上 z 序;缺省时模板 DOM 序即现状(旧快照兼容)。
// 固定层的 z 由各模板在顶层块上写 zIndex: layerZ(layerOrder, '<id>');本组件渲染自定义层。
import React from 'react'
import { Img, staticFile } from 'remotion'

export interface CustomLayer {
  id: string
  /** 素材名(插件 staticFile 根下) */
  image: string
  x: number
  y: number
  width: number
  opacity?: number
  rotate?: number
  /** 图层组归属(2026-10-31 阶段2,叠放语义):值=模板槽位 id(仅图片组 product/environment 可挂);
   *  缺省=未分组。组内图层按全局 layerOrder 叠放渲染。 */
  group?: string
}

export type LayerOrder = string[] | undefined

/** z 序:layerOrder 中的下标(底→顶);不在表中=最顶(新拖入的图层置顶语义) */
export const layerZ = (order: LayerOrder, id: string): number => {
  const i = order ? order.indexOf(id) : -1
  return 10 + (i >= 0 ? i : order ? order.length : 0)
}

export const CustomLayerOverlay: React.FC<{
  layers?: CustomLayer[]
  order?: LayerOrder
  hidden: (id: string) => boolean
}> = ({ layers, order, hidden }) => (
  <>
    {(layers ?? []).map((layer) =>
      hidden(layer.id) ? null : (
        <Img
          key={layer.id}
          draggable={false}
          data-cover-layer={layer.id}
          src={staticFile(layer.image)}
          style={{
            position: 'absolute',
            left: layer.x,
            top: layer.y,
            width: layer.width,
            opacity: layer.opacity ?? 1,
            transform: layer.rotate ? `rotate(${layer.rotate}deg)` : undefined,
            zIndex: layerZ(order, layer.id),
          }}
        />
      ),
    )}
  </>
)
