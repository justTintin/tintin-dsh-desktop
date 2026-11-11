// 图片图层的外观与变换(2026-11-01 用户裁决:选中图片图层的编辑对齐 PhotoCraft——
// 图层面板头的不透明度/混合模式/锁定、编辑›变换的翻转、属性面板变换区的宽高缩放)。
// 自由图层字段在 customLayers[i],产品图槽位在 styles.product;智能体也会写这些字段,
// 模板侧一律夹取/白名单,坏值退回默认,不让单个字段打穿画布。
import type React from 'react'

/** PhotoCraft 的 27 种图层混合模式(crates/color/src/blend.rs LAYER_MODES)里浏览器能等价渲染的
 *  17 种,保持其顺序;plus-lighter=线性减淡(添加)。溶解/线性加深/亮光/实色混合/减去等 CSS 无对应,不提供。 */
export const BLEND_MODES = [
  ['normal', '正常'],
  ['darken', '变暗'], ['multiply', '正片叠底'], ['color-burn', '颜色加深'],
  ['lighten', '变亮'], ['screen', '滤色'], ['color-dodge', '颜色减淡'], ['plus-lighter', '线性减淡(添加)'],
  ['overlay', '叠加'], ['soft-light', '柔光'], ['hard-light', '强光'],
  ['difference', '差值'], ['exclusion', '排除'],
  ['hue', '色相'], ['saturation', '饱和度'], ['color', '颜色'], ['luminosity', '明度'],
] as const

export interface ImageLook {
  rotate?: number
  /** 0..1 */
  opacity?: number
  blend?: string
  flipX?: boolean
  flipY?: boolean
  /** 产品图槽位的宽/高缩放倍率(自由图层直接用 width/height 定尺寸) */
  sx?: number
  sy?: number
  /** 锁定位置(PhotoCraft Lock position):画布拖动/微调/变换手柄与面板几何编辑全部拒绝 */
  locked?: boolean
  /** 投影(2026-11-02 对齐 PhotoCraft 图层样式;图片=drop-shadow 滤镜) */
  shadow?: { dx: number; dy: number; blur: number; color: string }
}

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

export const SCALE_MIN = 0.05
export const SCALE_MAX = 10

export const lookOpacity = (look: ImageLook | undefined): number => clampNum(look?.opacity, 0, 1, 1)
export const lookScale = (v: unknown): number => clampNum(v, SCALE_MIN, SCALE_MAX, 1)

export function lookBlend(look: ImageLook | undefined): React.CSSProperties['mixBlendMode'] {
  const mode = look?.blend
  if (mode === 'normal' || !BLEND_MODES.some(([id]) => id === mode)) return undefined
  return mode as React.CSSProperties['mixBlendMode']
}

/** rotate 恒在 scale 之前且恒输出:编辑器旋转预览按字符串替换 rotate(),翻转/缩放随之保留 */
export function lookTransform(look: ImageLook | undefined): string {
  const r = clampNum(look?.rotate, -360, 360, 0)
  const sx = lookScale(look?.sx) * (look?.flipX ? -1 : 1)
  const sy = lookScale(look?.sy) * (look?.flipY ? -1 : 1)
  return sx === 1 && sy === 1 ? `rotate(${r}deg)` : `rotate(${r}deg) scale(${sx}, ${sy})`
}

/** 环境底图(全幅铺底):外观+翻转+缩放/平移入口(2026-11-11 R20 背景也是图层——
 *  Ctrl+拖动等比缩放=styles.environment.sx/sy,画布拖动=dx/dy;不透明度缺省保持模板原设计 0.85) */
export function backdropStyle(look: (ImageLook & { dx?: number; dy?: number }) | undefined): React.CSSProperties {
  const sx = lookScale(look?.sx) * (look?.flipX ? -1 : 1)
  const sy = lookScale(look?.sy) * (look?.flipY ? -1 : 1)
  const dx = typeof look?.dx === 'number' && Number.isFinite(look.dx) ? Math.round(look.dx) : 0
  const dy = typeof look?.dy === 'number' && Number.isFinite(look.dy) ? Math.round(look.dy) : 0
  const parts: string[] = []
  if (dx !== 0 || dy !== 0) parts.push(`translate(${dx}px, ${dy}px)`)
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`)
  return {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
    opacity: look?.opacity === undefined ? 0.85 : lookOpacity(look),
    mixBlendMode: lookBlend(look),
    transform: parts.length ? parts.join(' ') : undefined,
    transformOrigin: 'center',
  }
}

const clamp255 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)

/** 图片投影滤镜(2026-11-02 对齐 PhotoCraft 图层样式):drop-shadow 组装;未设置=undefined */
export function imgDropShadow(look: ImageLook | undefined): string | undefined {
  const s = look?.shadow
  if (!s || typeof s.blur !== 'number') return undefined
  const color = typeof s.color === 'string' && s.color.trim() ? s.color.trim().replace(/[^#(),.%\sa-zA-Z0-9]/gu, '').slice(0, 40) : 'rgba(0,0,0,0.6)'
  return `drop-shadow(${clamp255(s.dx)}px ${clamp255(s.dy)}px ${clamp255(s.blur)}px ${color})`
}
