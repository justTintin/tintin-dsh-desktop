// 封面组件——整张封面由代码描述;标题/副题/角标全是 props(参数化出图)。
// 移植自 PoC D:\Project\cover-demo(2026-10-26 实测通过),新增 hiddenLayers 图层显隐
// (§9.3 图层树=props 投影;编辑器/会话工具操作同一份 props)。
import React from 'react'
import { AbsoluteFill, Img, staticFile } from 'remotion'
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

export const Cover: React.FC<CoverProps> = ({ title, subtitle, badge, bgImage, hiddenLayers = [], customLayers, layerOrder, styles }) => {
  const hidden = (id: string): boolean => hiddenLayers.includes(id)
  const titleStyle = layerStyle({ styles }, 'title', { fontSize: 88, color: '#ffffff' })
  const subStyle = layerStyle({ styles }, 'subtitle', { fontSize: 34, color: '#93c5fd' })
  return (
    <AbsoluteFill style={{ background: '#0b1026' }}>
      {!hidden('environment') && (
        bgImage ? (
          <Img draggable={false} src={staticFile(bgImage)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
        ) : (
          <AbsoluteFill
            style={{
              background: 'radial-gradient(1200px 600px at 78% -10%, #4f46e5 0%, rgba(79,70,229,0) 55%), radial-gradient(900px 500px at -10% 110%, #0ea5e9 0%, rgba(14,165,233,0) 50%), linear-gradient(160deg, #0b1026 0%, #111a3e 100%)',
            }}
          />
        )
      )}
      {!hidden('grid') && (
        <AbsoluteFill
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.25))',
          }}
        />
      )}
      <div style={{ position: 'absolute', right: -120, top: -140, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(96,165,250,0.5), rgba(96,165,250,0) 70%)' }} />
      <div style={{ position: 'absolute', left: -80, bottom: -160, width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle, rgba(14,165,233,0.35), rgba(14,165,233,0) 70%)' }} />

      <div style={{ position: 'absolute', inset: 0, padding: '72px 84px', display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: layerZ(layerOrder, 'title') }}>
        {!hidden('brand') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 34 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: 'linear-gradient(135deg,#4f7cff,#22d3ee)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: '#fff', boxShadow: '0 8px 30px rgba(79,124,255,0.55)' }}>T</div>
            <span style={{ fontSize: 26, fontWeight: 700, color: '#e2e8f0', letterSpacing: 2 }}>TINTIN DESKTOP</span>
          </div>
        )}
        {!hidden('title') && (
          <div data-cover-layer="title" style={{ ...titleStyle, fontWeight: 900, lineHeight: 1.12, textShadow: '0 10px 40px rgba(0,0,0,0.45)', maxWidth: 1000, transform: titleStyle.translate || undefined }}>
            {title}
          </div>
        )}
        {!hidden('subtitle') && (
          <div data-cover-layer="subtitle" style={{ ...subStyle, marginTop: 26, fontWeight: 500, letterSpacing: 1, transform: subStyle.translate || undefined }}>
            {subtitle}
          </div>
        )}
        {!hidden('footer') && (
          <>
            <div style={{ position: 'absolute', left: 84, bottom: 64, display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ padding: '8px 22px', borderRadius: 999, background: 'rgba(79,124,255,0.22)', border: '1px solid rgba(147,197,253,0.45)', color: '#bfdbfe', fontSize: 22, fontWeight: 600 }}>{badge}</span>
              <span style={{ color: 'rgba(226,232,240,0.55)', fontSize: 20 }}>remotion · renderStill</span>
            </div>
            <div style={{ position: 'absolute', right: 84, bottom: 64, width: 220, height: 4, borderRadius: 2, background: 'linear-gradient(90deg,#4f7cff,#22d3ee)' }} />
          </>
        )}
      </div>
      <CustomLayerOverlay layers={customLayers} order={layerOrder} hidden={hidden} />
    </AbsoluteFill>
  )
}
