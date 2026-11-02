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
  /** 旋转角度(度;2026-10-29 用户裁决:图片层可旋转;文字层暂不用) */
  rotate?: number
  /** 字体粗细(100..900,对齐 PhotoCraft「字体样式」下拉;缺省=该字体默认字面;2026-11-02 用户裁决) */
  weight?: number
  /** 斜体(缺省=正体) */
  italic?: boolean
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
): { fontSize: number; color: string; translate: string; fontFamily?: string; fontWeight?: number; fontStyle?: 'italic' } {
  const s = props?.styles?.[layerId]
  const scale = typeof s?.scale === 'number' && Number.isFinite(s.scale) ? Math.min(3, Math.max(0.3, s.scale)) : 1
  const dx = clampOffset(s?.dx)
  const dy = clampOffset(s?.dy)
  const translate = dx === undefined && dy === undefined ? '' : `translate(${dx ?? 0}px, ${dy ?? 0}px)`
  const font = sanitizeFontFamily(s?.font)
  const weight = clampWeight(s?.weight)
  return {
    fontSize: Math.round(base.fontSize * scale),
    color: s?.color ?? base.color,
    translate,
    fontFamily: font ? `"${font}", "Microsoft YaHei", sans-serif` : undefined,
    fontWeight: weight,
    fontStyle: s?.italic === true ? 'italic' : undefined,
  }
}
