// 产品封面——电商/发布向构图:左侧文案区 + 右侧白色产品卡片(PoC 移植 + hiddenLayers)
import React from 'react'
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { layerStyle, type StyleProps } from './text-style'

export type ProductCoverProps = {
  brand: string
  title: string
  subtitle: string
  badge: string
  features: string[]
  image: string
  hiddenLayers?: string[]
} & StyleProps

export const ProductCover: React.FC<ProductCoverProps> = ({ brand, title, subtitle, badge, features, image, hiddenLayers = [], styles }) => {
  const hidden = (id: string): boolean => hiddenLayers.includes(id)
  const titleStyle = layerStyle({ styles }, 'title', { fontSize: 76, color: '#0f172a' })
  const subStyle = layerStyle({ styles }, 'subtitle', { fontSize: 28, color: '#475569' })
  const featStyle = layerStyle({ styles }, 'features', { fontSize: 24, color: '#1e293b' })
  return (
    <AbsoluteFill style={{ background: '#eef1f7' }}>
      {!hidden('environment') && (
        <AbsoluteFill style={{ background: 'radial-gradient(1000px 520px at 85% 15%, #dbe4ff 0%, rgba(219,228,255,0) 60%), radial-gradient(800px 460px at 8% 100%, #d5f1fa 0%, rgba(213,241,250,0) 55%), linear-gradient(155deg, #f4f6fb 0%, #e7ebf4 100%)' }} />
      )}
      <AbsoluteFill
        style={{
          backgroundImage: 'linear-gradient(rgba(15,23,42,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.045) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.8), rgba(0,0,0,0.2))',
        }}
      />

      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '64px 76px', gap: 56 }}>
        <div style={{ flex: '0 0 46%', display: 'flex', flexDirection: 'column' }}>
          {!hidden('brand') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 30 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#0f172a,#334155)', color: '#fff', fontWeight: 800, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>G</div>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, color: '#0f172a' }}>{brand}</span>
            </div>
          )}
          {!hidden('title') && (
            <div data-cover-layer="title" style={{ ...titleStyle, fontWeight: 900, lineHeight: 1.05, letterSpacing: -1, transform: titleStyle.translate || undefined }}>{title}</div>
          )}
          {!hidden('subtitle') && (
            <div data-cover-layer="subtitle" style={{ ...subStyle, marginTop: 20, fontWeight: 600, transform: subStyle.translate || undefined }}>{subtitle}</div>
          )}
          {!hidden('features') && (
            <div data-cover-layer="features" style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 14, transform: featStyle.translate || undefined }}>
              {features.map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 999, background: '#4f7cff', color: '#fff', fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
                  <span style={{ ...featStyle, fontWeight: 600 }}>{f}</span>
                </div>
              ))}
            </div>
          )}
          {!hidden('badge') && (
            <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ padding: '9px 24px', borderRadius: 999, background: '#0f172a', color: '#fff', fontSize: 22, fontWeight: 700 }}>{badge}</span>
              <span style={{ color: '#64748b', fontSize: 19 }}>remotion · renderStill</span>
            </div>
          )}
        </div>

        {!hidden('product') && (
          <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 560, height: 560, borderRadius: 32, background: '#ffffff', boxShadow: '0 30px 80px rgba(15,23,42,0.16), 0 4px 16px rgba(15,23,42,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid rgba(15,23,42,0.06)' }}>
              <Img src={staticFile(image)} style={{ width: '92%', height: '92%', objectFit: 'contain' }} />
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'absolute', left: 76, bottom: 42, width: 260, height: 5, borderRadius: 3, background: 'linear-gradient(90deg,#4f7cff,#22d3ee)' }} />
    </AbsoluteFill>
  )
}
