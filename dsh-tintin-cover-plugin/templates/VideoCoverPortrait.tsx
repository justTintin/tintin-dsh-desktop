// 视频封面竖版(thumbnail portrait)——WP-2:1080×1440 抖音/小红书向。
// 布局与横版(video)同语言:顶部栏目角标 → 上部钩子大字 → 中下部产品聚光 → 底部品牌条。
// 文案与横版共用 VideoCoverProps(同一套 props 可在横竖版间切换)。
import React from 'react'
import { AbsoluteFill } from 'remotion'
import { CoverImg } from './CoverImg'
import { imgDropShadow, lookBlend, lookOpacity, lookTransform } from './image-style'
import { layerStyle, type StyleProps } from './text-style'
import type { VideoCoverProps } from './VideoCover'
import { CustomLayerOverlay, layerZ } from './CustomLayers'

export const VideoCoverPortrait: React.FC<VideoCoverProps> = ({ hookLines, subtitle, subTag, brand, image, hiddenLayers = [], customLayers, layerOrder, styles }) => {
  const hidden = (id: string): boolean => hiddenLayers.includes(id)
  const hookStyle = layerStyle({ styles }, 'title', { fontSize: 104, color: '#ffffff' })
  const subtitleStyle = layerStyle({ styles }, 'subtitle', { fontSize: 38, color: '#bfdbfe' })
  // 产品图槽位覆盖(2026-10-29:画布可选中拖动+旋转手柄;translateX(-50%) 为原定位,叠加用户位移/旋转;
  // 2026-11-01 对齐 PhotoCraft:翻转/宽高缩放/不透明度/混合模式,见 image-style.ts)
  const productOverride = styles?.product
  const productTransform = `translateX(-50%) translate(${productOverride?.dx ?? 0}px, ${productOverride?.dy ?? 0}px) ${lookTransform(productOverride)}`
  /* 标题装饰条默认纵位(2026-11-11 拆层换算):标题块 top130 + 前各行行盒 + 末行缩小行盒(×0.88)
     + 原块内 marginTop20;字号被 styles.title.scale 覆盖时同步跟随 */
  const ruleLh = hookStyle.lineHeight ?? 1.2
  const ruleTop = hookLines.length > 0
    ? Math.round(130 + (hookLines.length - 1) * hookStyle.fontSize * ruleLh + Math.round(hookStyle.fontSize * 0.88) * ruleLh + 20)
    : 150
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
        <div style={{ position: 'absolute', left: 56, top: 56, zIndex: layerZ(layerOrder, 'subTag'), display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ padding: '8px 20px', borderRadius: 8, background: '#22d3ee', color: '#04121a', fontSize: 26, fontWeight: 900, letterSpacing: 2, transform: 'skewX(-8deg)' }}>{subTag}</div>
          <div style={{ width: 160, height: 3, background: 'linear-gradient(90deg,#22d3ee,rgba(34,211,238,0))' }} />
        </div>
      )}

      {!hidden('title') && (
        <div data-cover-layer="title" style={{ position: 'absolute', left: 56, top: 130, width: hookStyle.width ?? 968, zIndex: layerZ(layerOrder, 'title'), opacity: hookStyle.opacity, mixBlendMode: hookStyle.mixBlendMode, transform: hookStyle.translate || undefined }}>
          {hookLines.map((line, i) => (
            <div
              key={line}
              style={{
                fontSize: i === hookLines.length - 1 ? Math.round(hookStyle.fontSize * 0.88) : hookStyle.fontSize,
                fontFamily: hookStyle.fontFamily,
                fontWeight: hookStyle.fontWeight ?? 900,
                fontStyle: hookStyle.fontStyle,
                lineHeight: hookStyle.lineHeight ?? 1.2,
                letterSpacing: hookStyle.letterSpacing,
                textTransform: hookStyle.textTransform,
                textAlign: hookStyle.textAlign,
                color: hookStyle.color === '#ffffff' && i === hookLines.length - 1 ? '#22d3ee' : hookStyle.color,
                textShadow: hookStyle.textShadow ?? '0 6px 0 rgba(2,6,23,0.9), 0 14px 44px rgba(0,0,0,0.7)',
                WebkitTextStroke: hookStyle.strokeCss ?? '2px rgba(2,6,23,0.65)',
                transform: 'skewX(-4deg)',
                marginLeft: i % 2 === 1 ? 30 : 0,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      {/* 标题装饰条(2026-11-11 用户裁决:黄色下划条从标题块内拆为独立装饰图层 titleRule,
          图层面板可开关、默认保留;top=原块内流式排版换算:标题 top+各行行盒+块内 margin) */}
      {!hidden('titleRule') && (
        <div style={{ position: 'absolute', left: 60, top: ruleTop, width: 300, height: 14, background: 'linear-gradient(90deg,#facc15,#f97316)', borderRadius: 7, transform: 'rotate(-2deg)', zIndex: layerZ(layerOrder, 'titleRule') }} />
      )}

      {!hidden('product') && (
        <div data-cover-layer="product" style={{ position: 'absolute', left: '50%', bottom: 250, transform: productTransform, width: 620, height: 620, zIndex: layerZ(layerOrder, 'product'), opacity: lookOpacity(productOverride), mixBlendMode: lookBlend(productOverride) }}>
          {image ? (
          <div style={{ position: 'absolute', inset: 40, borderRadius: '50%', background: 'radial-gradient(circle, #f8fafc 0%, #cbd5e1 42%, rgba(203,213,225,0) 72%)' }} />
          ) : null}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(-8deg)' }}>
            <CoverImg
              name={image}
              style={{
                width: 540, height: 540, objectFit: 'contain',
                WebkitMaskImage: 'radial-gradient(circle, black 58%, transparent 76%)',
                maskImage: 'radial-gradient(circle, black 58%, transparent 76%)',
                filter: imgDropShadow(productOverride) ?? 'drop-shadow(0 30px 50px rgba(0,0,0,0.55))',
              }}
            />
          </div>
          {image ? (
          <div style={{ position: 'absolute', inset: 26, borderRadius: '50%', border: '3px dashed rgba(34,211,238,0.5)' }} />
          ) : null}
        </div>
      )}

      {!hidden('subtitle') && (
        <div
          data-cover-layer="subtitle"
          style={{
            position: 'absolute', left: 60, bottom: 150, right: 60, maxWidth: 968, zIndex: layerZ(layerOrder, 'subtitle'),
            ...subtitleStyle, fontWeight: subtitleStyle.fontWeight ?? 600, letterSpacing: subtitleStyle.letterSpacing ?? 1,
            textShadow: '0 2px 12px rgba(2,6,23,0.85)',
            transform: subtitleStyle.translate || undefined,
          }}
        >
          {subtitle}
        </div>
      )}

      {!hidden('brand') && (
        <div style={{ position: 'absolute', left: 56, right: 56, bottom: 64, display: 'flex', alignItems: 'center', gap: 14, zIndex: layerZ(layerOrder, 'brand') }}>
          <div style={{ padding: '8px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#e8e8e6', fontSize: 20, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand}</div>
        </div>
      )}
      <CustomLayerOverlay layers={customLayers} order={layerOrder} hidden={hidden} />
    </AbsoluteFill>
  )
}
