// ═══════════════════════════════════════════════════════════════
// copywritingMontageTabBusy.ts — 文案混剪卡·多 Tab busy 聚合接线
// （2026-11-12 多 Tab 工作区落地时，根组件 busy 聚合使 CopywritingMontage.vue
// 触千行红线，按「自己功能增长走提取付账」分流纪律提取成独立文件）
// 聚合口径=全部异步步任一运行（方案生成/确认合成/口播文案/混音/素材解析/
// AI 文案/改写/配音；与 useCopywritingMontage.clearAllBusy 槽语义同口径）：
// 运行中→关闭确认生效 + tab 状态点呼吸；结束→状态点闪烁提示。
// ═══════════════════════════════════════════════════════════════
import type { useCopywritingMontage } from './useCopywritingMontage'
import { useToolTabBusy } from './useToolTabs'

type MontageState = ReturnType<typeof useCopywritingMontage>

export function useCopywritingTabBusy(s: MontageState): void {
  useToolTabBusy(() => s.splitBusy.value || s.concatBusy.value || s.confirmBusy.value || s.copyBusy.value
    || s.finalBusy.value || s.manualCopyBusy.value || s.voiceBusy.value || s.rewriteBusy.value)
}
