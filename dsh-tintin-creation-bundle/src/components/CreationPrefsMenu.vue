<!-- CreationPrefsMenu.vue — 创作模式·生成偏好面板（2026-10-30 自 App.vue 原样提取）
     即梦「自动」面板同款：自动开关 + 图片/视频页签 + 九档比例宫格。
     偏好状态归父层（真生成 aspect 消费方在本层 send 链），本组件只出 patch。 -->
<script setup lang="ts">
import { CREATION_RATIOS, type CreationPrefs } from '../composables/creationStudioLogic'

defineProps<{
  prefs: CreationPrefs
}>()

const emit = defineEmits<{
  patch: [patch: Partial<CreationPrefs>]
  close: []
}>()
</script>

<template>
  <div class="menu menu-auto">
    <div class="menu-head">
      <span class="menu-head-title">生成偏好</span>
      <label class="auto-switch" title="跟随默认自动偏好">
        <input type="checkbox" :checked="prefs.auto" @change="emit('patch', { auto: ($event.target as HTMLInputElement).checked })"><i></i><span>自动</span>
      </label>
      <button type="button" class="menu-close" @click="emit('close')">×</button>
    </div>
    <div class="seg-tabs">
      <button type="button" :class="{ on: prefs.modality === 'image' }" @click="emit('patch', { modality: 'image' })">图片</button>
      <button type="button" :class="{ on: prefs.modality === 'video' }" @click="emit('patch', { modality: 'video' })">视频</button>
    </div>
    <div class="ratio-title">选择比例</div>
    <div class="ratio-grid">
      <button v-for="r in CREATION_RATIOS" :key="r" type="button" class="ratio-tile" :class="{ on: prefs.ratio === r }" @click="emit('patch', { ratio: r })">
        <i v-if="r === '智能'" class="ratio-glyph ratio-auto">✦</i>
        <i v-else class="ratio-frame" :style="{ aspectRatio: r.replace(':', '/') }"></i>
        <span>{{ r }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 生成偏好面板（即梦「自动」面板同款：自动开关+图片/视频+选择比例）。
   定位/卡片底 (.menu) 与 .menu-head/.menu-close 基样式自带——scoped 下父级
   只覆盖到根节点，内部行不依赖宿主样式。 */
.menu-auto { position: absolute; left: 16px; right: auto; top: calc(100% + 8px); z-index: 30; width: 430px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-3); padding: 10px 12px 12px; overflow: hidden; }
.menu-head { display: flex; align-items: center; gap: var(--space-2); padding: 2px 0 10px; }
.menu-close { border: none; background: transparent; color: var(--muted-foreground); font-size: 16px; cursor: pointer; }
.menu-head-title { font-size: 13px; font-weight: 700; color: var(--foreground); flex: 1 1 auto; }
.auto-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted-foreground); cursor: pointer; user-select: none; }
.auto-switch input { display: none; }
.auto-switch i { width: 30px; height: 17px; border-radius: 999px; background: rgba(127, 127, 127, 0.35); position: relative; transition: background var(--duration-fast); }
.auto-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 999px; background: #fff; transition: left var(--duration-fast); }
.auto-switch input:checked + i { background: var(--primary); }
.auto-switch input:checked + i::after { left: 15px; }
.seg-tabs { display: grid; grid-template-columns: 1fr 1fr; background: color-mix(in srgb, var(--muted-foreground) 14%, transparent); border-radius: 10px; padding: 3px; margin: 10px 0 12px; }
.seg-tabs button { border: none; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 13px; padding: 7px 0; border-radius: 8px; cursor: pointer; }
.seg-tabs button.on { background: var(--card); color: var(--foreground); font-weight: 600; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); }
.ratio-title { font-size: 12px; color: var(--muted-foreground); margin-bottom: 6px; }
.ratio-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 5px; }
.ratio-tile { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 1px solid var(--border); background: transparent; color: var(--muted-foreground); font: inherit; font-size: 10.5px; padding: 7px 0 5px; border-radius: 9px; cursor: pointer; }
.ratio-tile:hover { border-color: var(--primary); color: var(--foreground); }
.ratio-tile.on { border-color: var(--primary); color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); font-weight: 600; }
.ratio-frame { display: block; width: 15px; max-height: 17px; border: 1.4px solid currentColor; border-radius: 3px; }
.ratio-auto { font-style: normal; font-size: 14px; line-height: 17px; }
</style>
