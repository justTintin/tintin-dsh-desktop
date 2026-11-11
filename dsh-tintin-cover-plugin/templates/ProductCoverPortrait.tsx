// 商品封面竖版(2026-10-27 横竖屏裁决):1080×1440,产品卡上/文案下,
// 图层词汇与横版一致(environment/product/title/subtitle/features/badge/brand)。
import React from 'react'
import { AbsoluteFill } from 'remotion'
import { CoverImg } from './CoverImg'
import { lookBlend, lookOpacity, lookTransform } from './image-style'
import { layerStyle, type StyleProps } from './text-style'
import { CustomLayerOverlay, layerZ, type CustomLayer, type LayerOrder } from './CustomLayers'

export type ProductCoverProps = {
  brand: string
  title: string
  subtitle: string
  badge: string
  features: string[]
  image: string
  hiddenLayers?: string[]
  customLayers?: CustomLayer[]
  layerOrder?: LayerOrder
} & StyleProps

export const ProductCoverPortrait: React.FC<ProductCoverProps> = ({ brand, title, subtitle, badge, features, image, hiddenLayers = [], customLayers, layerOrder, styles }) => {
  const hidden = (id: string): boolean => hiddenLayers.includes(id)
  const titleStyle = layerStyle({ styles }, 'title', { fontSize: 84, color: '#0f172a' })
  const subStyle = layerStyle({ styles }, 'subtitle', { fontSize: 32, color: '#475569' })
  const featStyle = layerStyle({ styles }, 'features', { fontSize: 27, color: '#1e293b' })
  // 产品图槽位覆盖(2026-10-29:画布可选中拖动+旋转手柄;styles.product dx/dy/rotate;
  // 2026-11-01 对齐 PhotoCraft:翻转/宽高缩放/不透明度/混合模式,见 image-style.ts)
  const productOverride = styles?.product
  const productTransform = `translate(${productOverride?.dx ?? 0}px, ${productOverride?.dy ?? 0}px) ${lookTransform(productOverride)}`
  return (
    <AbsoluteFill style={{ background: '#eef1f7' }}>
      {!hidden('environment') && (
        <AbsoluteFill style={{ background: 'radial-gradient(900px 700px at 80% 8%, #dbe4ff 0%, rgba(219,228,255,0) 60%), radial-gradient(800px 700px at 6% 100%, #d5f1fa 0%, rgba(213,241,250,0) 55%), linear-gradient(165deg, #f4f6fb 0%, #e7ebf4 100%)' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, padding: '56px 60px', display: 'flex', flexDirection: 'column' }}>
        {!hidden('brand') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: 3, color: '#0f172a' }}>{brand}</span>
          </div>
        )}
        {!hidden('product') && (
          <div data-cover-layer="product" style={{ width: '100%', height: 780, borderRadius: 32, background: '#ffffff', boxShadow: '0 30px 80px rgba(15,23,42,0.16), 0 4px 16px rgba(15,23,42,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid rgba(15,23,42,0.06)', flexShrink: 0, transform: productTransform, opacity: lookOpacity(productOverride), mixBlendMode: lookBlend(productOverride), zIndex: layerZ(layerOrder, 'product') }}>
            <CoverImg name={image} style={{ width: '92%', height: '92%', objectFit: 'contain' }} />
          </div>
        )}
        {/* 产品卡与文案列各自带层级(2026-11-01,flex 子项的 z-index 不需要定位):排列按图层序生效 */}
        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', zIndex: layerZ(layerOrder, 'title') }}>
          {!hidden('title') && (
            <div data-cover-layer="title" style={{ ...titleStyle, fontWeight: titleStyle.fontWeight ?? 900, lineHeight: 1.08, letterSpacing: -1, transform: titleStyle.translate || undefined }}>{title}</div>
          )}
          {!hidden('subtitle') && (
            <div data-cover-layer="subtitle" style={{ ...subStyle, marginTop: 18, fontWeight: subStyle.fontWeight ?? 600, transform: subStyle.translate || undefined }}>{subtitle}</div>
          )}
          {!hidden('features') && (
            <div data-cover-layer="features" style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 14, opacity: featStyle.opacity, mixBlendMode: featStyle.mixBlendMode, transform: featStyle.translate || undefined }}>
              {features.map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 999, background: '#4f7cff', color: '#fff', fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
                  <span style={{ ...featStyle, fontWeight: featStyle.fontWeight ?? 600 }}>{f}</span>
                </div>
              ))}
            </div>
          )}
          {!hidden('badge') && (
            <div style={{ marginTop: 34 }}>
              <span style={{ padding: '10px 26px', borderRadius: 999, background: '#0f172a', color: '#fff', fontSize: 24, fontWeight: 700 }}>{badge}</span>
            </div>
          )}
        </div>
      </div>
      <CustomLayerOverlay layers={customLayers} order={layerOrder} hidden={hidden} />
    </AbsoluteFill>
  )
}
