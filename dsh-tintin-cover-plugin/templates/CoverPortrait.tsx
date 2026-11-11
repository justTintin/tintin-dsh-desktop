// 节目封面竖版(WP-2/2026-10-27 横竖屏裁决):1080×1440,内容纵向重排,
// 图层词汇与横版一致(environment/title/subtitle/brand/footer)。
import React from 'react'
import { AbsoluteFill } from 'remotion'
import { CoverImg } from './CoverImg'
import { backdropStyle } from './image-style'
import { layerStyle, type StyleProps } from './text-style'
import { CustomLayerOverlay, layerZ, type CustomLayer, type LayerOrder } from './CustomLayers'

export type CoverProps = {
  title: string
  subtitle: string
  badge: string
  bgImage?: string
  hiddenLayers?: string[]
  customLayers?: CustomLayer[]
  layerOrder?: LayerOrder
} & StyleProps

export const CoverPortrait: React.FC<CoverProps> = ({ title, subtitle, badge, bgImage, hiddenLayers = [], customLayers, layerOrder, styles }) => {
  const hidden = (id: string): boolean => hiddenLayers.includes(id)
  const titleStyle = layerStyle({ styles }, 'title', { fontSize: 104, color: '#ffffff' })
  const subStyle = layerStyle({ styles }, 'subtitle', { fontSize: 38, color: '#93c5fd' })
  return (
    <AbsoluteFill style={{ background: '#0b1026' }}>
      {!hidden('environment') && (
        bgImage ? (
          <CoverImg name={bgImage} style={backdropStyle(styles?.environment)} />
        ) : (
          <AbsoluteFill style={{
            background: 'radial-gradient(1000px 800px at 70% -8%, #4f46e5 0%, rgba(79,70,229,0) 55%), radial-gradient(800px 700px at -10% 108%, #0ea5e9 0%, rgba(14,165,233,0) 50%), linear-gradient(170deg, #0b1026 0%, #111a3e 100%)',
          }} />
        )
      )}
      <div style={{ position: 'absolute', right: -120, top: -140, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(96,165,250,0.5), rgba(96,165,250,0) 70%)' }} />
      <div style={{ position: 'absolute', left: -80, bottom: -160, width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle, rgba(14,165,233,0.35), rgba(14,165,233,0) 70%)' }} />

      <div style={{ position: 'absolute', inset: 0, padding: '84px 64px', display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: layerZ(layerOrder, 'title') }}>
        {!hidden('title') && (
          <div data-cover-layer="title" style={{ ...titleStyle, fontWeight: titleStyle.fontWeight ?? 900, lineHeight: titleStyle.lineHeight ?? 1.14, textShadow: titleStyle.textShadow ?? '0 10px 40px rgba(0,0,0,0.45)', transform: titleStyle.translate || undefined }}>
            {title}
          </div>
        )}
        {!hidden('subtitle') && (
          <div data-cover-layer="subtitle" style={{ ...subStyle, marginTop: 30, fontWeight: 500, letterSpacing: subStyle.letterSpacing ?? 1, transform: subStyle.translate || undefined }}>
            {subtitle}
          </div>
        )}
        {!hidden('footer') && (
          <div style={{ position: 'absolute', left: 64, bottom: 72 }}>
            <span style={{ padding: '9px 24px', borderRadius: 999, background: 'rgba(79,124,255,0.22)', border: '1px solid rgba(147,197,253,0.45)', color: '#bfdbfe', fontSize: 24, fontWeight: 600 }}>{badge}</span>
          </div>
        )}
      </div>
      <CustomLayerOverlay layers={customLayers} order={layerOrder} hidden={hidden} />
    </AbsoluteFill>
  )
}
