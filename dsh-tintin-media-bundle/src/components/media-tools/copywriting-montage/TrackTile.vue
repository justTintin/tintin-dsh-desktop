<script setup lang="ts">
// TrackTile.vue — 分镜卡轨道占位瓦片（2026-11-26 四源四轨裁决）：每轨一瓦片，
// 三态=产物视频 / 任务进行中进度卡 / 占位图。纯展示，状态对象由宿主按轨取好传入。
import { computed, ref, watch } from 'vue'
import type { ShotGenState } from '@/composables/useShotMaterialGen'

const props = defineProps<{
  label: string
  /** 本地产物视频地址（toFileUrl 就绪；空=无产物走占位/进度） */
  videoSrc?: string
  /** 该轨当前任务状态（缺省=无任务） */
  state?: ShotGenState
  /** 占位文案（无产物且无任务时） */
  fallback?: string
  /** 瓦片媒体区宽高比（2026-11-26 用户裁决：默认随分镜脚本输出画幅，如 '9 / 16'） */
  aspect?: string
}>()

const PHASE_TEXT: Record<string, string> = {
  submitting: '提交中…', generating: '生成中…', downloading: '下载中…', done: '完成', failed: '失败',
}
const phaseText = computed(() => (props.state ? (PHASE_TEXT[props.state.phase] || props.state.phase) : ''))
const subLine = computed(() => {
  const s = props.state
  if (!s) return ''
  if (s.phase === 'failed') return s.msg
  const p = s.progress >= 0 ? `${s.progress}%` : '进行中'
  return s.elapsedSec > 0 ? `${p} · ${s.elapsedSec}s` : p
})
const mediaStyle = computed(() => (props.aspect ? { aspectRatio: props.aspect } : {}))

/** 视频点击播放/暂停（2026-11-26 用户裁决：中央半透明大图标，点切播放暂停；
 *  去原生 controls——瓦片尺寸小，交互只保留播放/暂停）。src 切换时复位状态。 */
const vid = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
watch(() => props.videoSrc, () => { playing.value = false })
function togglePlay(): void {
  const v = vid.value
  if (!v) return
  if (v.paused) void v.play()
  else v.pause()
}
</script>

<template>
  <div class="track-tile">
    <!-- 2026-11-26 用户裁决：顶部标题删除——占位框内已有名称，不重复。
         2026-11-26 用户再裁：视频点击播放/暂停，中央半透明大图标；去原生 controls -->
    <div v-if="videoSrc" class="track-media" :style="mediaStyle" @click="togglePlay">
      <video ref="vid" preload="metadata" :src="videoSrc" class="track-video" @play="playing = true" @pause="playing = false" @ended="playing = false" />
      <span class="track-playicon" :class="{ 'is-playing': playing }" aria-hidden="true">
        <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
      </span>
    </div>
    <div v-else-if="state && state.phase !== 'done'" class="track-gen" :class="{ 'is-failed': state.phase === 'failed' }" :style="mediaStyle">
      <span class="track-gen-phase">{{ phaseText }}</span>
      <div v-if="state.phase !== 'failed'" class="iv-bar" :class="{ 'is-indeterminate': state.progress < 0 }">
        <div v-if="state.progress >= 0" class="iv-bar-fill" :style="{ width: state.progress + '%' }"></div>
      </div>
      <span class="track-gen-sub">{{ subLine }}</span>
    </div>
    <div v-else class="track-ph" :style="mediaStyle">
      <svg class="track-ph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M4 17l4.5-3.5 3.5 2.5 3-2 5 3" />
      </svg>
      <span v-if="fallback">{{ fallback }}</span>
    </div>
  </div>
</template>

<style scoped>
.track-tile { width: 104px; flex: 0 0 104px; display: flex; flex-direction: column; gap: 3px; }

.track-media { position: relative; width: 100%; cursor: pointer; }
.track-video { width: 100%; height: 100%; object-fit: cover; display: block; background: #101010; border-radius: var(--radius-sm); }
/* 中央半透明大图标（2026-11-26 用户裁决）：暂停态显 ▶、播放态显 ⏸ */
.track-playicon {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, 0.62); pointer-events: none;
}
.track-playicon svg { width: 34px; height: 34px; filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.5)); }
.track-playicon.is-playing { opacity: 0; transition: opacity 0.25s ease; }
.track-media:hover .track-playicon.is-playing { opacity: 0.62; }
/* 进行中/失败进度卡 */
.track-gen { width: 100%; padding: 8px 4px; display: flex; flex-direction: column; gap: 4px; align-items: stretch; background: #101010; border-radius: var(--radius-sm); min-height: 58px; justify-content: center; }
.track-gen-phase { font-size: 11px; color: var(--foreground); text-align: center; }
.track-gen-sub { font-size: 10px; color: var(--muted-foreground); text-align: center; word-break: break-all; line-height: 1.3; }
.track-gen.is-failed .track-gen-phase { color: var(--danger, #e5484d); font-weight: 600; }
.iv-bar { position: relative; height: 5px; overflow: hidden; background: var(--border); border-radius: 999px; }
.iv-bar-fill { height: 100%; background: var(--primary); border-radius: 999px; transition: width 0.6s ease; }
.iv-bar.is-indeterminate::after { content: ''; position: absolute; inset: 0; width: 40%; background: var(--primary); border-radius: 999px; animation: iv-indeterminate 1.2s ease-in-out infinite; }
@keyframes iv-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }
/* 占位 */
.track-ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 100%; padding: 12px 4px; color: var(--muted-foreground); background: #101010; border-radius: var(--radius-sm); min-height: 58px; }
.track-ph-icon { width: 26px; height: 26px; opacity: 0.5; flex: none; }
.track-ph span { font-size: 11px; }
</style>
