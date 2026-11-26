// ═══════════════════════════════════════════════════════════════
// copywritingMontageTrackLogic.ts — 文案混剪·分镜四轨视频源解析纯逻辑
// （2026-11-26 用户裁决：不同视频源=不同轨道各一占位——素材绑定轨(clipGroups 既有)/
//   AI生成轨/在线搜索轨/A-Roll 数字人轨；合成时每镜至少一条轨道有内容（"必须有一个"）；
//   右列单选标记(genMode)驱动批量生成，合成时标记轨优先；无标记按 ai>stock>aroll 兜底。
//   纯逻辑层不做任何 IPC/DOM（IRON-06 分层））
// ═══════════════════════════════════════════════════════════════
import type { ShotTrackSlots, StoryboardShot } from './opsStoryboardLogic'

export type ShotTrack = 'aroll' | 'gen' | 'stock' | 'material'

/** 轨道解析结果：track=该镜合成采用的轨道；local=非素材轨的本地产物路径 */
export interface ShotTrackResolve {
  track: ShotTrack
  local?: string
}

/** 有无该轨产物（素材轨由调用方以 clipGroups 非空判定传入） */
function slotOf(shot: Pick<StoryboardShot, 'slots'>, track: keyof ShotTrackSlots): string | undefined {
  return shot.slots?.[track]?.local || undefined
}

/** 单镜轨道解析（合成预检与逐镜取用的唯一判据）：
 *  ①标记 aroll 且 A-Roll 轨有货 → aroll；②标记 ai 且 AI 轨有货 → gen；
 *  ③素材轨有绑定 → material（现状一镜多片走 clipGroups）；
 *  ④无标记兜底 ai > stock > aroll；⑤全空 → null（合成校验报「必须有一个」） */
export function resolveShotTrack(shot: Pick<StoryboardShot, 'genMode' | 'slots'>, hasMaterial: boolean): ShotTrackResolve | null {
  const aroll = slotOf(shot, 'aroll')
  const gen = slotOf(shot, 'gen')
  const stock = slotOf(shot, 'stock')
  if (shot.genMode === 'aroll' && aroll) return { track: 'aroll', local: aroll }
  if (shot.genMode === 'ai' && gen) return { track: 'gen', local: gen }
  if (hasMaterial) return { track: 'material' }
  if (gen) return { track: 'gen', local: gen }
  if (stock) return { track: 'stock', local: stock }
  if (aroll) return { track: 'aroll', local: aroll }
  return null
}

/** 批量标记过滤：genMode 命中且该轨尚无产物的镜下标（重复点批量不重做已完成的；
 *  genMode 'ai' 对应 slots.gen，'aroll' 对应 slots.aroll） */
export function markedShotIdxs(shots: Array<Pick<StoryboardShot, 'genMode' | 'slots'>>, mode: 'aroll' | 'ai'): number[] {
  const slotKey = mode === 'ai' ? 'gen' : mode
  return shots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.genMode === mode && !slotOf(s, slotKey))
    .map(({ i }) => i)
}
