<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// SbCollapseToggle.vue — 分镜脚本卡 收起/展开 切换钮（文字+箭头图标）
// 2026-11-05 用户裁决：文案混剪与仿爆款视频模块共用的收起/展开入口；
// 展开态单一来源 = storyboardShotsExpanded（默认收起）。
// ═════════════════════════════════════════════════════════════
import { storyboardShotsExpanded } from '@/composables/storyboardShotsState'
</script>

<template>
  <button
    class="sb-collapse"
    type="button"
    :title="storyboardShotsExpanded ? '收起分镜脚本' : '展开分镜脚本'"
    @click="storyboardShotsExpanded = !storyboardShotsExpanded"
  >
    {{ storyboardShotsExpanded ? '收起分镜脚本' : '展开分镜脚本' }}<span class="sb-caret" :class="{ 'is-open': storyboardShotsExpanded }"></span>
  </button>
</template>

<style scoped>
.sb-collapse {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 28px; min-width: 96px; padding: 0 14px; flex: none;
  background: transparent; color: var(--muted-foreground); border: 1px solid var(--border);
  border-radius: var(--radius-md); cursor: pointer; font-size: 12px;
  transition: color var(--duration-fast, 0.15s), border-color var(--duration-fast, 0.15s);
}
.sb-collapse:hover { color: var(--primary); border-color: var(--primary); }

/* 箭头图标（收起=朝上／展开=朝下，随展开态旋转） */
.sb-caret {
  width: 0; height: 0; display: inline-block;
  border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor;
  transition: transform var(--duration-fast, 0.15s);
}
.sb-caret.is-open { transform: rotate(180deg); }
</style>
