// ═══════════════════════════════════════════════════════════════
// pendingStoryboard — 文案 → 分镜脚本 传递信号（SRC stores/app.ts
// pendingStoryboard 切片 1:1，2026-09-25 随产品资料卡移植）
// 产品资料·文案生成「前往分镜脚本设计」写入；分镜脚本创作卡（P2 批次）
// 挂载时 takePendingStoryboard 一次性消费（对齐 SRC pendingHotspotNav
// 信号模式）。store/app.ts 其余切片未移植，不整包搬运。
// ═══════════════════════════════════════════════════════════════
import { ref } from 'vue'

export interface PendingStoryboard {
  copyText: string
  product: Record<string, string>
}

export const pendingStoryboard = ref<PendingStoryboard | null>(null)

/** 写入分镜草案（「前往分镜脚本设计」前置动作） */
export function setPendingStoryboard(draft: PendingStoryboard): void {
  pendingStoryboard.value = draft
}

/** 消费并清空分镜草案（一次性信号） */
export function takePendingStoryboard(): PendingStoryboard | null {
  const d = pendingStoryboard.value
  pendingStoryboard.value = null
  return d
}
