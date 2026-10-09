// ═══════════════════════════════════════════════════════════════
// pendingMediaTool — 工具内跨卡跳转信号（仿 pendingStoryboard 一次性
// 信号模式，2026-10-09 随「仿视频第 1 步 → 视频去水印字幕」直达按钮移植）。
// 工具组件写入目标卡 id（如 'subtitle-removal'）；App.vue 侦听后切换
// active 并清空（一次性消费，不残留不重复触发）。
// ═══════════════════════════════════════════════════════════════
import { ref } from 'vue'

export const pendingMediaTool = ref<string | null>(null)

/** 请求跳转到指定媒体工具卡（写卡片 id） */
export function setPendingMediaTool(id: string): void {
  pendingMediaTool.value = id
}
