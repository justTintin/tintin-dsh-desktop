// jianying-text-animations.d.ts — 剪映文字入场动画元数据表（免费档）。
export interface TextIntroAnimationMeta {
  name: string
  vip: boolean
  duration: number
  resource_id: string
  effect_id: string
}
export const TEXT_INTRO_ANIMATIONS: TextIntroAnimationMeta[]
/** 按名称查动画（忽略空格，支持部分匹配）；找不到返回 null */
export function findTextIntroAnimation(name: unknown): TextIntroAnimationMeta | null
