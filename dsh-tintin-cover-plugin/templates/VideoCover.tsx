// 视频封面(thumbnail)——点击向构图:深色戏剧光 + 超大钩子文案 + 产品打光(PoC 移植 + hiddenLayers)
import React from 'react'
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { layerStyle, type StyleProps } from './text-style'
import { CustomLayerOverlay, layerZ, type CustomLayer, type LayerOrder } from './CustomLayers'

export type VideoCoverProps = {
  hookLines: string[]
  subtitle: string
  subTag: string
  brand: string
  image: string
  hiddenLayers?: string[]
  customLayers?: CustomLayer[]
  layerOrder?: LayerOrder
} & StyleProps

export const VideoCover: React.FC<VideoCoverProps> = ({ hookLines, subtitle, subTag, brand, image, hiddenLayers = [], customLayers, layerOrder, styles }) => {
  const hidden = (id: string): boolean => hiddenLayers.includes(id)
  const hookStyle = layerStyle({ styles }, 'title', { fontSize: 110, color: '#ffffff' })
  const subtitleStyle = layerStyle({ styles }, 'subtitle', { fontSize: 34, color: '#bfdbfe' })
  // 产品图槽位覆盖(2026-10-29:画布可选中拖动+旋转手柄;translateY(-50%) 为原定位,叠加用户位移/旋转)
  const productOverride = styles?.product
  const productTransform = `translateY(-50%) translate(${productOverride?.dx ?? 0}px, ${productOverride?.dy ?? 0}px) rotate(${productOverride?.rotate ?? 0}deg)`
  return (
    <AbsoluteFill style={{ background: '#070b18' }}>
      {!hidden('environment') && (
        <>
          <AbsoluteFill style={{ background: 'radial-gradient(900px 640px at 68% 46%, #1d2b6e 0%, #0b1026 58%, #070b18 100%)' }} />
          <div style={{ position: 'absolute', inset: -80, background: 'repeating-linear-gradient(115deg, transparent 0 90px, rgba(79,124,255,0.08) 90px 100px)' }} />
          <div style={{ position: 'absolute', right: -180, top: -220, width: 620, height: 620, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.4), rgba(34,211,238,0) 68%)' }} />
          <div style={{ position: 'absolute', left: -160, bottom: -240, width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,70,229,0.5), rgba(79,70,229,0) 70%)' }} />
        </>
      )}

      {!hidden('subTag') && (
        <div style={{ position: 'absolute', left: 56, top: 48, zIndex: layerZ(layerOrder, 'subTag'), display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ padding: '8px 20px', borderRadius: 8, background: '#22d3ee', color: '#04121a', fontSize: 26, fontWeight: 900, letterSpacing: 2, transform: 'skewX(-8deg)' }}>{subTag}</div>
          <div style={{ width: 180, height: 3, background: 'linear-gradient(90deg,#22d3ee,rgba(34,211,238,0))' }} />
        </div>
      )}

      {!hidden('product') && (
        <div data-cover-layer="product" style={{ position: 'absolute', right: 30, top: '50%', transform: productTransform, width: 640, height: 640, zIndex: layerZ(layerOrder, 'product') }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(-8deg)' }}>
            <Img
              src={staticFile(image)}
              style={{
                width: 560, height: 560, objectFit: 'contain',
                WebkitMaskImage: 'radial-gradient(circle, black 52%, transparent 74%)',
                maskImage: 'radial-gradient(circle, black 52%, transparent 74%)',
                filter: 'drop-shadow(0 20px 40px rgba(34,211,238,0.15))',
              }}
            />
          </div>
        </div>
      )}

      {!hidden('title') && (
        <div data-cover-layer="title" style={{ position: 'absolute', left: 56, top: 150, width: 560, zIndex: layerZ(layerOrder, 'title'), transform: hookStyle.translate || undefined }}>
          {hookLines.map((line, i) => (
            <div
              key={line}
              style={{
                fontSize: i === hookLines.length - 1 ? Math.round(hookStyle.fontSize * 0.87) : hookStyle.fontSize,
                fontWeight: 900,
                lineHeight: 1.16,
                color: hookStyle.color === '#ffffff' && i === hookLines.length - 1 ? '#22d3ee' : hookStyle.color,
                textShadow: '0 6px 0 rgba(2,6,23,0.9), 0 14px 44px rgba(0,0,0,0.7)',
                WebkitTextStroke: '2px rgba(2,6,23,0.65)',
                transform: 'skewX(-4deg) rotate(-2deg)',
                marginLeft: i % 2 === 1 ? 26 : 0,
              }}
            >
              {line}
            </div>
          ))}
          <div style={{ marginTop: 18, marginLeft: 4, width: 300, height: 14, background: 'linear-gradient(90deg,#facc15,#f97316)', borderRadius: 7, transform: 'rotate(-2deg)' }} />
        </div>
      )}

      {!hidden('subtitle') && (
        <div
          data-cover-layer="subtitle"
          style={{
            position: 'absolute', left: 60, bottom: 112, maxWidth: 620, zIndex: layerZ(layerOrder, 'subtitle'),
            ...subtitleStyle, fontWeight: 600, letterSpacing: 1,
            textShadow: '0 2px 12px rgba(2,6,23,0.85)',
            transform: subtitleStyle.translate || undefined,
          }}
        >
          {subtitle}
        </div>
      )}

      {!hidden('brand') && (
        <div style={{ position: 'absolute', left: 56, bottom: 44, display: 'flex', alignItems: 'center', gap: 16, zIndex: layerZ(layerOrder, 'brand') }}>
          <div style={{ padding: '7px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#e2e8f0', fontSize: 20, fontWeight: 700 }}>{brand}</div>
          <div style={{ color: 'rgba(226,232,240,0.5)', fontSize: 18 }}>remotion · renderStill</div>
        </div>
      )}
      <CustomLayerOverlay layers={customLayers} order={layerOrder} hidden={hidden} />
    </AbsoluteFill>
  )
}
