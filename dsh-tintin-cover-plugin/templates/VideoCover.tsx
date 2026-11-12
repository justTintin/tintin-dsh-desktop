// 视频封面(thumbnail)——点击向构图:深色戏剧光 + 超大钩子文案 + 产品打光(PoC 移植 + hiddenLayers)
import React from 'react'
import { AbsoluteFill } from 'remotion'
import { CoverImg } from './CoverImg'
import { imgDropShadow, lookBlend, lookOpacity, lookTransform } from './image-style'
import { useImageHasAlpha } from './image-alpha'
import { layerStyle, type StyleProps } from './text-style'
import { CustomLayerOverlay, layerZ, type CustomLayer, type LayerOrder } from './CustomLayers'

export type VideoCoverProps = {
  hookLines: string[]
  subtitle: string
  subTag: string
  brand: string
  /** 环境底图(2026-11-12: 环境图层此前只有内置渐变, 该 prop 从未被消费——生成背景被静默丢弃) */
  environment?: string
  image: string
  hiddenLayers?: string[]
  customLayers?: CustomLayer[]
  layerOrder?: LayerOrder
} & StyleProps

export const VideoCover: React.FC<VideoCoverProps> = ({ hookLines, subtitle, subTag, brand, environment, image, hiddenLayers = [], customLayers, layerOrder, styles }) => {
  const hidden = (id: string): boolean => hiddenLayers.includes(id)
  const hookStyle = layerStyle({ styles }, 'title', { fontSize: 110, color: '#ffffff' })
  const subtitleStyle = layerStyle({ styles }, 'subtitle', { fontSize: 34, color: '#bfdbfe' })
  /* 标题装饰条默认纵位(2026-11-11 拆层换算):标题块 top150 + 前各行行盒(fontSize×行高)
     + 末行缩小行盒(×0.87) + 原块内 marginTop18;字号被 styles.title.scale 覆盖时同步跟随 */
  const ruleLh = hookStyle.lineHeight ?? 1.16
  const ruleTop = hookLines.length > 0
    ? Math.round(150 + (hookLines.length - 1) * hookStyle.fontSize * ruleLh + Math.round(hookStyle.fontSize * 0.87) * ruleLh + 18)
    : 168
  // 产品图槽位覆盖(2026-10-29:画布可选中拖动+旋转手柄;translateY(-50%) 为原定位,叠加用户位移/旋转;
  // 2026-11-01 对齐 PhotoCraft:翻转/宽高缩放/不透明度/混合模式,见 image-style.ts)
  const productOverride = styles?.product
  const productTransform = `translateY(-50%) translate(${productOverride?.dx ?? 0}px, ${productOverride?.dy ?? 0}px) ${lookTransform(productOverride)}`
  // 主体图形态自适应(2026-11-12): 抠图(透明)免产品渐隐遮罩/-8° 倾斜
  const imageHasAlpha = useImageHasAlpha(image)
  return (
    <AbsoluteFill style={{ background: '#070b18' }}>
      {!hidden('environment') && (
        /* 环境图吃真图(同竖屏 2026-11-12 修): 设了 environment=渲染该图为底层;未设=内置渐变 */
        environment ? (
          <CoverImg name={environment} layerId="environment"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: layerZ(layerOrder, 'environment') }} />
        ) : (
          <>
            <AbsoluteFill style={{ background: 'radial-gradient(900px 640px at 68% 46%, #1d2b6e 0%, #0b1026 58%, #070b18 100%)' }} />
            <div style={{ position: 'absolute', inset: -80, background: 'repeating-linear-gradient(115deg, transparent 0 90px, rgba(79,124,255,0.08) 90px 100px)' }} />
            <div style={{ position: 'absolute', right: -180, top: -220, width: 620, height: 620, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.4), rgba(34,211,238,0) 68%)' }} />
            <div style={{ position: 'absolute', left: -160, bottom: -240, width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,70,229,0.5), rgba(79,70,229,0) 70%)' }} />
          </>
        )
      )}

      {!hidden('subTag') && (
        <div style={{ position: 'absolute', left: 56, top: 48, zIndex: layerZ(layerOrder, 'subTag'), display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ padding: '8px 20px', borderRadius: 8, background: '#22d3ee', color: '#04121a', fontSize: 26, fontWeight: 900, letterSpacing: 2, transform: 'skewX(-8deg)' }}>{subTag}</div>
          <div style={{ width: 180, height: 3, background: 'linear-gradient(90deg,#22d3ee,rgba(34,211,238,0))' }} />
        </div>
      )}

      {!hidden('product') && (
        <div data-cover-layer="product" style={{ position: 'absolute', right: 30, top: '50%', transform: productTransform, width: 640, height: 640, zIndex: layerZ(layerOrder, 'product'), opacity: lookOpacity(productOverride), mixBlendMode: lookBlend(productOverride) }}>
          {/* 抠图(透明)免产品渐隐遮罩/-8° 倾斜(2026-11-12 用户报障「白背景和人混在一起」) */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: imageHasAlpha ? undefined : 'rotate(-8deg)' }}>
            <CoverImg
              name={image}
              style={{
                width: 560, height: 560, objectFit: 'contain',
                ...(imageHasAlpha ? {} : {
                  WebkitMaskImage: 'radial-gradient(circle, black 52%, transparent 74%)',
                  maskImage: 'radial-gradient(circle, black 52%, transparent 74%)',
                }),
                filter: imgDropShadow(productOverride) ?? 'drop-shadow(0 20px 40px rgba(34,211,238,0.15))',
              }}
            />
          </div>
        </div>
      )}

      {!hidden('title') && (
        <div data-cover-layer="title" style={{ position: 'absolute', left: 56, top: 150, width: hookStyle.width ?? 560, zIndex: layerZ(layerOrder, 'title'), opacity: hookStyle.opacity, mixBlendMode: hookStyle.mixBlendMode, transform: hookStyle.translate || undefined }}>
          {hookLines.map((line, i) => (
            <div
              key={line}
              style={{
                fontSize: i === hookLines.length - 1 ? Math.round(hookStyle.fontSize * 0.87) : hookStyle.fontSize,
                fontFamily: hookStyle.fontFamily,
                fontWeight: hookStyle.fontWeight ?? 900,
                fontStyle: hookStyle.fontStyle,
                lineHeight: hookStyle.lineHeight ?? 1.16,
                letterSpacing: hookStyle.letterSpacing,
                textTransform: hookStyle.textTransform,
                textAlign: hookStyle.textAlign,
                color: hookStyle.color === '#ffffff' && i === hookLines.length - 1 ? '#22d3ee' : hookStyle.color,
                textShadow: hookStyle.textShadow ?? '0 6px 0 rgba(2,6,23,0.9), 0 14px 44px rgba(0,0,0,0.7)',
                WebkitTextStroke: hookStyle.strokeCss ?? '2px rgba(2,6,23,0.65)',
                transform: 'skewX(-4deg) rotate(-2deg)',
                marginLeft: i % 2 === 1 ? 26 : 0,
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

      {!hidden('subtitle') && (
        <div
          data-cover-layer="subtitle"
          style={{
            position: 'absolute', left: 60, bottom: 112, maxWidth: 620, zIndex: layerZ(layerOrder, 'subtitle'),
            ...subtitleStyle, fontWeight: subtitleStyle.fontWeight ?? 600, letterSpacing: subtitleStyle.letterSpacing ?? 1,
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
        </div>
      )}
      <CustomLayerOverlay layers={customLayers} order={layerOrder} hidden={hidden} />
    </AbsoluteFill>
  )
}
