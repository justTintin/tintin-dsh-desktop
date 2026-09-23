<script setup lang="ts">
// Minimal WP-3 verification app: proves Vue mounts and stays reactive inside
// the dsh workbench slot (the P1 top risk item). Real card grid (文案混剪/
// 剪映模板) replaces this in the WP-3 continuation; inline styles on purpose
// — CSS injection lands with the real cards.
import { ref, onMounted } from 'vue'

const mountedAt = ref('')
const count = ref(0)
onMounted(() => { mountedAt.value = new Date().toLocaleTimeString() })
</script>

<template>
  <div style="min-width: 320px">
    <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px">媒体工具 · Vue 已挂载</div>
    <p style="margin: 0 0 10px; color: rgba(128,128,128,.9); font-size: 12px">
      挂载时间 {{ mountedAt }} — 响应式计数器证明 Vue 运行时工作
    </p>
    <div style="display: flex; gap: 8px; align-items: center">
      <button
        style="appearance: none; font: inherit; padding: 4px 12px; border-radius: 8px; cursor: pointer"
        :style="{ border: '0.5px solid rgba(128,128,128,.4)', background: count % 2 ? 'rgba(96,165,250,.25)' : 'transparent' }"
        @click="count++"
      >
        点击 {{ count }}
      </button>
      <span style="font-size: 12px; color: rgba(128,128,128,.9)">卡片网格（文案混剪/剪映模板）随 WP-3 接入</span>
    </div>
  </div>
</template>
