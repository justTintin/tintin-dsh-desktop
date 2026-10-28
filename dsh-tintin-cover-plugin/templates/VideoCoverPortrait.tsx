// 视频封面竖版(thumbnail portrait)——WP-2:1080×1440 抖音/小红书向。
// 布局与横版(video)同语言:顶部栏目角标 → 上部钩子大字 → 中下部产品聚光 → 底部品牌条。
// 文案与横版共用 VideoCoverProps(同一套 props 可在横竖版间切换)。
import React from 'react'
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { layerStyle, type StyleProps } from './text-style'
import type { VideoCoverProps } from './VideoCover'

export const VideoCoverPortrait: React.FC<VideoCoverProps> = ({ hookLines, subTag, brand, image, hiddenLayers = [], styles }) => {
  const hidden = (id: string): boolean => hiddenLayers.includes(id)
  const hookStyle = layerStyle({ styles }, 'title', { fontSize: 104, color: '#ffffff' })
  return (
    <AbsoluteFill style={{ background: '#070b18' }}>
      {!hidden('environment') && (
        <>
          <AbsoluteFill style={{ background: 'radial-gradient(760px 900px at 50% 38%, #1d2b6e 0%, #0b1026 58%, #070b18 100%)' }} />
          <div style={{ position: 'absolute', inset: -80, background: 'repeating-linear-gradient(115deg, transparent 0 90px, rgba(79,124,255,0.08) 90px 100px)' }} />
          <div style={{ position: 'absolute', right: -160, top: -160, width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.4), rgba(34,211,238,0) 68%)' }} />
          <div style={{ position: 'absolute', left: -140, bottom: -180, width: 480, height: 480, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,70,229,0.5), rgba(79,70,229,0) 70%)' }} />
        </>
      )}

      {!hidden('subTag') && (
        <div style={{ position: 'absolute', left: 56, top: 56, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ padding: '8px 20px', borderRadius: 8, background: '#22d3ee', color: '#04121a', fontSize: 26, fontWeight: 900, letterSpacing: 2, transform: 'skewX(-8deg)' }}>{subTag}</div>
          <div style={{ width: 160, height: 3, background: 'linear-gradient(90deg,#22d3ee,rgba(34,211,238,0))' }} />
        </div>
      )}

      {!hidden('title') && (
        <div data-cover-layer="title" style={{ position: 'absolute', left: 56, top: 130, width: 968, transform: hookStyle.translate || undefined }}>
          {hookLines.map((line, i) => (
            <div
              key={line}
              style={{
                fontSize: i === hookLines.length - 1 ? Math.round(hookStyle.fontSize * 0.88) : hookStyle.fontSize,
                fontWeight: 900,
                lineHeight: 1.2,
                color: hookStyle.color === '#ffffff' && i === hookLines.length - 1 ? '#22d3ee' : hookStyle.color,
                textShadow: '0 6px 0 rgba(2,6,23,0.9), 0 14px 44px rgba(0,0,0,0.7)',
                WebkitTextStroke: '2px rgba(2,6,23,0.65)',
                transform: 'skewX(-4deg)',
                marginLeft: i % 2 === 1 ? 30 : 0,
              }}
            >
              {line}
            </div>
          ))}
          <div style={{ marginTop: 20, marginLeft: 4, width: 300, height: 14, background: 'linear-gradient(90deg,#facc15,#f97316)', borderRadius: 7, transform: 'rotate(-2deg)' }} />
        </div>
      )}

      {!hidden('product') && (
        <div style={{ position: 'absolute', left: '50%', bottom: 250, transform: 'translateX(-50%)', width: 620, height: 620 }}>
          <div style={{ position: 'absolute', inset: 40, borderRadius: '50%', background: 'radial-gradient(circle, #f8fafc 0%, #cbd5e1 42%, rgba(203,213,225,0) 72%)' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(-8deg)' }}>
            <Img
              src={staticFile(image)}
              style={{
                width: 540, height: 540, objectFit: 'contain',
                WebkitMaskImage: 'radial-gradient(circle, black 58%, transparent 76%)',
                maskImage: 'radial-gradient(circle, black 58%, transparent 76%)',
                filter: 'drop-shadow(0 30px 50px rgba(0,0,0,0.55))',
              }}
            />
          </div>
          <div style={{ position: 'absolute', inset: 26, borderRadius: '50%', border: '3px dashed rgba(34,211,238,0.5)' }} />
        </div>
      )}

      {!hidden('brand') && (
        <div style={{ position: 'absolute', left: 56, right: 56, bottom: 64, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ padding: '8px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#e8e8e6', fontSize: 20, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand}</div>
        </div>
      )}
    </AbsoluteFill>
  )
}
