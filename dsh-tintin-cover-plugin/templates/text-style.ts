// 文字图层样式覆盖(§9.7-2 后续:面板可调字号/颜色/位移;props.__styles 投影到模板节点)。
// 约定:props.styles = { [layerId]: { scale?, color?, dx?, dy? } };
// 缺省 = 模板原设计。所有模板文字节点经 layerStyle() 取值,编辑器与模板只认这一份。
import type React from 'react'
import { BLEND_MODES, type ImageLook } from './image-style'

export interface TextStyleOverride {
  scale?: number
  color?: string
  /** 水平位移(画面像素;正值向右,夹取 ±1200) */
  dx?: number
  /** 垂直位移(正值向下,夹取 ±1200) */
  dy?: number
  /** 字体族(系统字体名;缺省 = 模板默认黑体系) */
  font?: string
  /** 字体粗细(100..900,对齐 PhotoCraft「字体样式」下拉;缺省=该字体默认字面;2026-11-02 用户裁决) */
  weight?: number
  /** 斜体(缺省=正体) */
  italic?: boolean
  /** 投影(2026-11-02 对齐 PhotoCraft 图层样式;设置后覆盖模板硬编码阴影,删除字段=还原) */
  shadow?: { dx: number; dy: number; blur: number; color: string }
  /** 描边(仅文字;WebkitTextStroke 宽度 px + 颜色;设置后覆盖模板描边) */
  stroke?: { width: number; color: string }
  /** 旋转(度,±180;画布旋转手柄写入;2026-11-10 对齐 PhotoCraft 文字变换) */
  rotate?: number
  /** 几何缩放(0.3..3,等比,原点=层中心;画布角柄写入;2026-11-11 对齐 PhotoCraft
   *  Free Transform——文字画布缩放=几何变换不改字号,字号仍由 scale/编辑卡管) */
  gscale?: number
  /** 不透明度(0..1;图层面板头行写入;2026-11-11 对齐 PhotoCraft layers.rs 头行,
   *  文字层与图片层同通道;缺省=1) */
  opacity?: number
  /** 混合模式(BLEND_MODES 白名单;缺省=正常。CSS mixBlendMode 浏览器与 Remotion
   *  渲染同源) */
  blend?: string
}

/** 图片槽位(产品图)的条目另带外观/变换字段(image-style.ts,2026-11-01 对齐 PhotoCraft) */
export type StyleProps = { styles?: Record<string, TextStyleOverride & ImageLook> }

const clampOffset = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.min(1200, Math.max(-1200, Math.round(v)))
}

/** 字体族名消毒(2026-11-02 用户裁决:对齐 PhotoCraft,任意本机已装字体;不再是白名单):
 *  去引号/反斜杠/花括号/分号防 CSS 注入,截断 80 字符;空=未设置 */
export function sanitizeFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const font = value.trim().replace(/["'\\{};]/gu, '').slice(0, 80)
  return font || undefined
}

const clampWeight = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(900, Math.max(100, Math.round(v))) : undefined

/** 单图层样式合成:基准字号/颜色 × 覆盖(scale 夹取 0.4..2.2;font=本机已装字体族名,
 *  渲染机即本机,画布与导出同源解析;缺字字形回落微软雅黑)。返回直接可散布进
 *  style 的形状(opacity/mixBlendMode 恒输出,模板文字节点展开即生效)。 */
export function layerStyle(
  props: StyleProps | undefined,
  layerId: string,
  base: { fontSize: number; color: string },
): {
  fontSize: number
  color: string
  translate: string
  fontFamily?: string
  fontWeight?: number
  fontStyle?: 'italic'
  textShadow?: string
  strokeCss?: string
  opacity: number
  mixBlendMode?: React.CSSProperties['mixBlendMode']
} {
  const s = props?.styles?.[layerId]
  const scale = typeof s?.scale === 'number' && Number.isFinite(s.scale) ? Math.min(3, Math.max(0.3, s.scale)) : 1
  const dx = clampOffset(s?.dx)
  const dy = clampOffset(s?.dy)
  const rotate = typeof s?.rotate === 'number' && Number.isFinite(s.rotate) ? Math.min(180, Math.max(-180, Math.round(s.rotate))) : undefined
  const gscale = typeof s?.gscale === 'number' && Number.isFinite(s.gscale) ? Math.min(3, Math.max(0.3, s.gscale)) : undefined
  // 变换链: translate → rotate → uniform scale(scale 段缺省不输出;顺序对均匀缩放无关)
  const xform = [
    dx === undefined && dy === undefined ? null : `translate(${dx ?? 0}px, ${dy ?? 0}px)`,
    rotate ? `rotate(${rotate}deg)` : null,
    gscale !== undefined && gscale !== 1 ? `scale(${gscale})` : null,
  ].filter((v): v is string => v !== null)
  const translate = xform.join(' ')
  const font = sanitizeFontFamily(s?.font)
  const weight = clampWeight(s?.weight)
  const shadow = s?.shadow && typeof s.shadow.blur === 'number' && typeof s.shadow.color === 'string'
    ? {
        dx: Number.isFinite(s.shadow.dx) ? Math.round(s.shadow.dx) : 0,
        dy: Number.isFinite(s.shadow.dy) ? Math.round(s.shadow.dy) : 0,
        blur: Math.max(0, Math.round(s.shadow.blur)),
        color: sanitizeShadowColor(s.shadow.color),
      }
    : undefined
  const stroke = s?.stroke && typeof s.stroke.width === 'number' && typeof s.stroke.color === 'string'
    ? { width: Math.max(0, Math.round(s.stroke.width)), color: sanitizeShadowColor(s.stroke.color) }
    : undefined
  // 头行外观通道(2026-11-11 对齐 PhotoCraft layers.rs):不透明度夹取 0..1,混合模式白名单
  const opacity = typeof s?.opacity === 'number' && Number.isFinite(s.opacity) ? Math.min(1, Math.max(0, s.opacity)) : 1
  const blend = typeof s?.blend === 'string' && s.blend !== 'normal' && BLEND_MODES.some(([id]) => id === s.blend)
    ? s.blend as React.CSSProperties['mixBlendMode']
    : undefined
  return {
    fontSize: Math.round(base.fontSize * scale),
    color: s?.color ?? base.color,
    translate,
    fontFamily: font ? `"${font}", "Microsoft YaHei", sans-serif` : undefined,
    fontWeight: weight,
    fontStyle: s?.italic === true ? 'italic' : undefined,
    textShadow: shadow ? `${shadow.dx}px ${shadow.dy}px ${shadow.blur}px ${shadow.color}` : undefined,
    strokeCss: stroke ? `${stroke.width}px ${stroke.color}` : undefined,
    opacity,
    mixBlendMode: blend,
  }
}

/** 阴影/描边颜色消毒(2026-11-02):只放行 CSS 颜色安全字符,防注入 */
function sanitizeShadowColor(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[^#(),.%\sa-zA-Z0-9]/gu, '').slice(0, 40) || 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.6)'
}
