// ═══════════════════════════════════════════════════════════════
// copywritingMontageTrackLogic.ts — 文案混剪·分镜四轨视频源解析纯逻辑
// （2026-11-26 用户裁决：不同视频源=不同轨道各一占位——素材绑定轨(clipGroups 既有)/
//   AI生成轨/在线搜索轨/A-Roll 数字人轨；合成时每镜至少一条轨道有内容（"必须有一个"）；
//   右列两复选框互不排斥（markARoll/markAI 分别驱动两批量），合成时标记轨优先；
//   无标记按 ai>stock>aroll 兜底。纯逻辑层不做任何 IPC/DOM（IRON-06 分层））
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
 *  ①标记 A-Roll 且 A-Roll 轨有货 → aroll；②标记 AI 且 AI 轨有货 → gen；
 *  ③素材轨有绑定 → material（现状一镜多片走 clipGroups）；
 *  ④无标记兜底 ai > stock > aroll；⑤全空 → null（合成校验报「必须有一个」） */
export function resolveShotTrack(shot: Pick<StoryboardShot, 'markARoll' | 'markAI' | 'slots'>, hasMaterial: boolean): ShotTrackResolve | null {
  const aroll = slotOf(shot, 'aroll')
  const gen = slotOf(shot, 'gen')
  const stock = slotOf(shot, 'stock')
  if (shot.markARoll && aroll) return { track: 'aroll', local: aroll }
  if (shot.markAI && gen) return { track: 'gen', local: gen }
  if (hasMaterial) return { track: 'material' }
  if (gen) return { track: 'gen', local: gen }
  if (stock) return { track: 'stock', local: stock }
  if (aroll) return { track: 'aroll', local: aroll }
  return null
}

/** 批量标记过滤：复选标记命中且该轨尚无产物的镜下标（重复点批量不重做已完成的；
 *  markAI 对应 slots.gen、markARoll 对应 slots.aroll） */
/** 第①步→第②步门控（2026-11-05 用户裁定）：至少一个 tab 生成了分镜（纯文案 tab 不算；
 *  2026-11-26 悬浮导航接管按钮后由容器消费，逻辑层单一来源） */
export function hasAnySplitShots(tabs: Array<{ shots: unknown[] }>): boolean {
  return tabs.some((t) => t.shots.length > 0)
}

export function markedShotIdxs(shots: Array<Pick<StoryboardShot, 'markARoll' | 'markAI' | 'slots'>>, mode: 'aroll' | 'ai'): number[] {
  const slotKey = mode === 'ai' ? 'gen' : mode
  const marked = mode === 'ai' ? 'markAI' : 'markARoll'
  return shots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s[marked] && !slotOf(s, slotKey))
    .map(({ i }) => i)
}
