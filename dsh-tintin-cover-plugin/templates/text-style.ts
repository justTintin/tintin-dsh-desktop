// 文字图层样式覆盖(§9.7-2 后续:面板可调字号/颜色/位移;props.__styles 投影到模板节点)。
// 约定:props.styles = { [layerId]: { scale?, color?, dx?, dy? } };
// 缺省 = 模板原设计。所有模板文字节点经 layerStyle() 取值,编辑器与模板只认这一份。
import type { ImageLook } from './image-style'

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
 *  渲染机即本机,画布与导出同源解析;缺字字形回落微软雅黑) */
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
} {
  const s = props?.styles?.[layerId]
  const scale = typeof s?.scale === 'number' && Number.isFinite(s.scale) ? Math.min(3, Math.max(0.3, s.scale)) : 1
  const dx = clampOffset(s?.dx)
  const dy = clampOffset(s?.dy)
  const rotate = typeof s?.rotate === 'number' && Number.isFinite(s.rotate) ? Math.min(180, Math.max(-180, Math.round(s.rotate))) : undefined
  const translate = dx === undefined && dy === undefined && rotate === undefined
    ? ''
    : `translate(${dx ?? 0}px, ${dy ?? 0}px)${rotate ? ` rotate(${rotate}deg)` : ''}`
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
  return {
    fontSize: Math.round(base.fontSize * scale),
    color: s?.color ?? base.color,
    translate,
    fontFamily: font ? `"${font}", "Microsoft YaHei", sans-serif` : undefined,
    fontWeight: weight,
    fontStyle: s?.italic === true ? 'italic' : undefined,
    textShadow: shadow ? `${shadow.dx}px ${shadow.dy}px ${shadow.blur}px ${shadow.color}` : undefined,
    strokeCss: stroke ? `${stroke.width}px ${stroke.color}` : undefined,
  }
}

/** 阴影/描边颜色消毒(2026-11-02):只放行 CSS 颜色安全字符,防注入 */
function sanitizeShadowColor(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[^#(),.%\sa-zA-Z0-9]/gu, '').slice(0, 40) || 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.6)'
}
