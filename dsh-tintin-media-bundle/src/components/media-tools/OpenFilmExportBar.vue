<!-- 方案二「导出到视频剪辑项目」共用 UI（2026-10-21 用户裁决）：CopywritingStep4Panel 与
     ImitationFxPackPanel 同款，抽成公共件让两个面板留在行数基线内（铁律 4）。
     2026-10-21 二批：补真实进度（宿主三段：准备素材/创建项目/落素材/写时间轴）与
     逐轨检验（剪辑方案·视频素材轨·口播轨·BGM 轨），与方案一「轨道检查」同口径。
     2026-11-07 用户需求三件：①有视频剪辑插件才可导出（探测中/缺失给原因）；
     ②导出携带字幕（VTT 旁挂，检查行见 ofChecks 的「字幕轨」）；③导出后自动渲染成片，
     支持独立「渲染成片」重渲（renderedPath 展示成片落点）。 -->
<template>
  <div>
    <div class="vd4-scheme-line">方案二，导出到视频剪辑项目（可在视频剪辑里继续精剪）</div>
    <TButton label="导出到视频剪辑项目" class="vd4-run" :loading="busy" :disabled="disabled || pluginOk === false"
      title="把剪辑方案时间线转译为视频剪辑（OpenFilm）项目：视频段/口播/BGM/字幕各轨齐备，导出后自动渲染成片，也可在视频剪辑里继续精剪"
      @click="$emit('export')" />
    <div v-if="pluginOk === null" class="muted" style="margin-top:4px;font-size:12px">正在检测视频剪辑插件…</div>
    <div v-else-if="pluginOk === false" class="of-plugin-bad">{{ pluginReason || '视频剪辑插件不可用' }}</div>
    <div v-if="busy" class="pbar" style="margin-top:8px"><div class="pbar-inner" :style="{ width: Math.min(100, Math.max(2, progress ?? 0)) + '%' }"></div></div>
    <div v-if="busy && stage" class="muted" style="margin-top:4px;font-size:12px">{{ stage }}</div>
    <TButton v-if="project" label="渲染成片（重新出视频）" class="vd4-run" variant="secondary" :loading="rendering"
      :disabled="disabled || pluginOk === false"
      title="对已导出的项目再出一次成片（本机 Chromium+ffmpeg，几十秒到几分钟）"
      @click="$emit('render')" />
    <div v-if="checks && checks.length" class="of-checks">
      <div class="of-checks-title">方案二轨道检查</div>
      <div v-for="c in checks" :key="c.label" class="of-check" :class="{ bad: !c.ok }">
        <span class="of-check-mark">{{ c.ok ? '✓' : '✕' }}</span>
        <span class="of-check-name">{{ c.label }}</span>
        <span class="of-check-detail">{{ c.detail }}</span>
      </div>
    </div>
    <div v-if="project" class="export-done-bar">
      <span class="export-done-icon">✓</span>
      <span class="export-done-text">已导出到视频剪辑项目</span>
      <div class="export-done-actions">
        <TButton label="打开视频剪辑" size="small" @click="$emit('open')" />
      </div>
    </div>
    <div v-if="renderedPath" class="of-rendered">
      <span class="export-done-icon">🎬</span>
      <span class="of-rendered-path" :title="renderedPath">成片：{{ renderedPath }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import TButton from '@/components/common/TButton.vue'
import type { OfTrackCheck } from '@/composables/copywritingMontage/useCopywritingMontageStep4Openfilm'

defineProps<{
  busy: boolean
  stage: string
  project: string
  disabled?: boolean
  progress?: number
  checks?: OfTrackCheck[]
  /** null=插件探测中；false=缺失（pluginReason 给原因，导出/渲染禁用）；true=可用 */
  pluginOk?: boolean | null
  pluginReason?: string
  rendering?: boolean
  renderedPath?: string
}>()
defineEmits<{ (e: 'export'): void; (e: 'open'): void; (e: 'render'): void }>()
</script>

<style scoped>
/* 版式与方案一同口径（父面板的 scoped 样式到不了子组件，这里自带一份） */
.vd4-scheme-line { margin-top: 6px; font-size: 12px; color: var(--muted-foreground); }
.vd4-run { width: 100%; height: 40px; margin-top: var(--space-2); }
.pbar { height: 6px; border-radius: 3px; background: var(--surface-container); overflow: hidden; }
.pbar-inner { height: 100%; background: var(--primary); transition: width 0.3s ease; }
.muted { color: var(--muted-foreground); }
.of-plugin-bad { margin-top: 4px; font-size: 12px; color: var(--destructive, #e5484d); }
.of-checks { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.of-checks-title { font-size: 13px; color: var(--foreground); margin-bottom: 2px; }
.of-check { display: flex; align-items: baseline; gap: 6px; font-size: 12px; color: var(--muted-foreground); }
.of-check-mark { color: #4ade80; }
.of-check.bad .of-check-mark { color: #f87171; }
.of-check-name { color: var(--foreground); flex: none; }
.of-check-detail { color: var(--muted-foreground); }
.of-rendered { margin-top: 6px; display: flex; align-items: baseline; gap: 6px; font-size: 12px; color: var(--foreground); min-width: 0; }
.of-rendered-path { color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
