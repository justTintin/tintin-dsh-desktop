// 文字图层样式覆盖(§9.7-2 后续:面板可调字号/颜色/位移;props.__styles 投影到模板节点)。
// 约定:props.styles = { [layerId]: { scale?, color?, dx?, dy? } };
// 缺省 = 模板原设计。所有模板文字节点经 layerStyle() 取值,编辑器与模板只认这一份。
export interface TextStyleOverride {
  scale?: number
  color?: string
  /** 水平位移(画面像素;正值向右,夹取 ±360) */
  dx?: number
  /** 垂直位移(正值向下,夹取 ±360) */
  dy?: number
  /** 字体族(系统字体名;缺省 = 模板默认黑体系) */
  font?: string
}

export type StyleProps = { styles?: Record<string, TextStyleOverride> }

const clampOffset = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.min(360, Math.max(-360, Math.round(v)))
}

/** 单图层样式合成:基准字号/颜色 × 覆盖(scale 夹取 0.4..2.2;font 白名单外回退默认) */
export function layerStyle(
  props: StyleProps | undefined,
  layerId: string,
  base: { fontSize: number; color: string },
): { fontSize: number; color: string; translate: string; fontFamily?: string } {
  const s = props?.styles?.[layerId]
  const scale = typeof s?.scale === 'number' && Number.isFinite(s.scale) ? Math.min(2.2, Math.max(0.4, s.scale)) : 1
  const dx = clampOffset(s?.dx)
  const dy = clampOffset(s?.dy)
  const translate = dx === undefined && dy === undefined ? '' : `translate(${dx ?? 0}px, ${dy ?? 0}px)`
  const font = typeof s?.font === 'string' && (FONT_WHITELIST as readonly string[]).includes(s.font) ? s.font : undefined
  return { fontSize: Math.round(base.fontSize * scale), color: s?.color ?? base.color, translate, fontFamily: font }
}

/** 编辑器可选字体(系统可用中文安全名单;渲染机即本机,所见即所得) */
export const FONT_WHITELIST = ['Microsoft YaHei', 'SimHei', 'KaiTi', 'SimSun', 'DengXian', 'FangSong', 'Segoe UI'] as const
