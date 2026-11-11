<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ToolTabPane — 工具页多 Tab 工作区·单个 tab 内容容器（需求规格
// docs/tintin-multitab-workspace.md；本文件为运营包副本（原件在
// dsh-tintin-media-bundle/src/components/ToolTabPane.vue，改动须两包同步）
// ——副本先例同 TButton/OtPickMaterialDialog）。
//
// 渲染层职责（替代 2026-10-20 的 KeepAlive 单实例缓存语义，该裁决
// 已被多 tab 需求取代）：
// - 每 tab 一个 pane，全部同时挂载、v-show 切换显隐：非活动 tab 的
//   DOM 常驻 → 滚动位置天然随 DOM 保留，任务型轮询后台继续跑
//   （验收标准：切 tab 不丢状态；任务型轮询不受切换影响）。
// - 实例键控 :key="tab.id"：同卡多开=同组件类型不同 key=独立实例
//   （组合式函数 state 声明在函数体内，每实例调用即独立——盘点见
//   useToolTabs 头注），互不干涉。
// - LRU discard：模型层判定超保活上限的 tab（discarded 集合），本层
//   v-if 卸载其组件实例=中止其轮询；切回时模型层移出集合 → 重建
//   （=KeepAlive :max 语义的实现级载体，2026-11-12 用户裁决钉 8）。
// - tab 关闭：App 层 v-for 移除整个 pane → 组件 unmount → 轮询清理，
//   无幽灵实例。
// - errorCaptured 边界：单 tab 组件崩溃不沿树冒泡连累其他 tab
//   （崩溃显示错误占位；webview 路线的天然隔离的组件实例等价物）。
// - busy 通道 provide：任务型卡 inject TOOL_TAB_CTX 上报运行态/
//   完成（关闭确认 + tab 栏状态点的数据源）。
// ═══════════════════════════════════════════════════════════════
import { onErrorCaptured, provide, ref, watch } from 'vue'
import type { Component } from 'vue'
import { TOOL_TAB_CTX, type ToolTab, type ToolTabCtx } from '../composables/useToolTabs'

const props = defineProps<{
  tab: ToolTab
  /** 该 tab 承载的工具组件（App 层按 toolId 解析） */
  component: Component
  /** 是否活动 tab（非活动 v-show 隐藏，DOM/轮询保留） */
  active: boolean
  /** 是否被 LRU 淘汰（v-if 卸载实例；切回重建） */
  discarded: boolean
}>()

// 错误边界：捕获子树错误显示占位，阻止继续冒泡（崩溃隔离）
const crashed = ref<Error | null>(null)
onErrorCaptured((err) => {
  crashed.value = err instanceof Error ? err : new Error(String(err))
  return false
})
// discard 重建/重挂时清崩溃态（新实例从干净状态开始）
watch(() => props.discarded, () => { crashed.value = null })

// busy 通道：任务型卡 inject 上报；直接维护 tab.busy/doneAt（tab 对象
// 即模型层数组元素，响应式，tab 栏/LRU/关闭确认零转换消费）
const ctx: ToolTabCtx = {
  busyInc() { props.tab.busy += 1 },
  busyDec() { if (props.tab.busy > 0) props.tab.busy -= 1 },
  notifyDone() { props.tab.doneAt = Date.now() },
}
provide(TOOL_TAB_CTX, ctx)

// 任务完成判定：busy 从 >0 回落到 0 时一次性记 doneAt（后台 tab 完成
// 状态点的数据源）；inc/dec 由卡内多处任务各自成对调用
watch(() => props.tab.busy, (n, o) => {
  if (o > 0 && n === 0) props.tab.doneAt = Date.now()
})
</script>

<template>
  <!-- 滚动层：每 pane 自滚（滚动位置随 DOM 常驻保持）。普通工具页内容
       自然高 → 本层滚动；height:100% 型工具页（产品资料）占满本层内滚。 -->
  <div v-show="active" class="tool-tab-pane">
    <div v-if="crashed" class="pane-crash">
      <div class="pane-crash-title">此工具页出现错误</div>
      <div class="pane-crash-msg">{{ crashed.message }}</div>
    </div>
    <component
      :is="component"
      v-else-if="!discarded"
      :key="tab.id"
      class="pane-content"
    />
  </div>
</template>

<style scoped>
.tool-tab-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 崩溃占位（errorCaptured 边界）：单 tab 崩溃不连累其他 tab */
.pane-crash {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-8, 32px);
  color: var(--muted-foreground);
}
.pane-crash-title { font-size: var(--font-size-h5, 16px); font-weight: 600; color: var(--foreground); }
.pane-crash-msg {
  max-width: 480px;
  font-size: var(--font-size-body);
  word-break: break-all;
  opacity: 0.8;
}
</style>
