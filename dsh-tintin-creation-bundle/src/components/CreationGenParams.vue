<!-- CreationGenParams.vue — 创作模式·非 Agent 工具行生成参数（2026-10-30）
     视觉对照即梦非 Agent composer（用户 1030 截图）：中性灰白 pill + 14px 线性
     图标 + 值用「·」连接 + 尾缀蓝色 ✦ 作菜单触发角标；只有类型选择器是主色，
     本组件一律中性色。图片=比例；视频加分辨率/时长（/generate/video 实收）。
     服务端无生成模型选择面，不做模型 pill 不造假档。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { TinIcon } from './tinIcons'
import { CREATION_RATIOS } from '../composables/creationStudioLogic'
import { GENERATION_DURATIONS, GENERATION_RESOLUTIONS, type GenerateKind } from '../composables/creationGenerateLogic'

const props = defineProps<{
  kind: GenerateKind
  ratio: string
  resolution: string
  duration: number
}>()

const emit = defineEmits<{
  'patch-ratio': [ratio: string]
  'patch-resolution': [resolution: string]
  'patch-duration': [seconds: number]
}>()

const openMenu = ref<'ratio' | 'resolution' | 'duration' | ''>('')
function toggle(menu: 'ratio' | 'resolution' | 'duration'): void {
  openMenu.value = openMenu.value === menu ? '' : menu
}
function onDocPointerDown(e: PointerEvent): void {
  const t = e.target as HTMLElement | null
  if (t?.closest('.gp-root')) return
  openMenu.value = ''
}
onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))
function choose(menu: 'ratio' | 'resolution' | 'duration', value: string | number): void {
  openMenu.value = ''
  if (menu === 'ratio') emit('patch-ratio', String(value))
  else if (menu === 'resolution') emit('patch-resolution', String(value))
  else emit('patch-duration', Number(value))
}

const ratioLabel = computed(() => (props.ratio === '智能' ? '智能比例' : `比例 · ${props.ratio}`))
const resolutionLabel = computed(() => (props.resolution ? `分辨率 · ${props.resolution}` : '分辨率 · 自动'))
const durationLabel = computed(() => (props.duration > 0 ? `时长 · ${props.duration}s` : '时长 · 自动'))
</script>

<template>
  <span class="gp-root">
    <button type="button" class="gp-pill" :class="{ 'is-open': openMenu === 'ratio' }" title="画面比例" @click="toggle('ratio')">
      <TinIcon icon="frame" />
      <span>{{ ratioLabel }}</span><span class="spark">✦</span>
    </button>
    <button v-if="kind === 'video'" type="button" class="gp-pill" :class="{ 'is-open': openMenu === 'resolution' }" title="视频分辨率" @click="toggle('resolution')">
      <TinIcon icon="display" />
      <span>{{ resolutionLabel }}</span><span class="spark">✦</span>
    </button>
    <button v-if="kind === 'video'" type="button" class="gp-pill" :class="{ 'is-open': openMenu === 'duration' }" title="视频时长" @click="toggle('duration')">
      <TinIcon icon="clock" />
      <span>{{ durationLabel }}</span><span class="spark">✦</span>
    </button>

    <div v-if="openMenu === 'ratio'" class="menu">
      <div class="menu-title">画面比例</div>
      <div class="menu-list">
        <button type="button" class="menu-item" :class="{ 'is-picked': ratio === '智能' }" @click="choose('ratio', '智能')">
          <span class="menu-name"><TinIcon icon="spark" />智能比例</span>
          <span v-if="ratio === '智能'" class="menu-check">✓</span>
        </button>
        <button v-for="r in CREATION_RATIOS.filter((x) => x !== '智能')" :key="r" type="button" class="menu-item" :class="{ 'is-picked': ratio === r }" @click="choose('ratio', r)">
          <span class="menu-name"><i class="ratio-frame" :style="{ aspectRatio: r.replace(':', '/') }"></i>{{ r }}</span>
          <span v-if="ratio === r" class="menu-check">✓</span>
        </button>
      </div>
    </div>
    <div v-if="openMenu === 'resolution'" class="menu">
      <div class="menu-title">视频分辨率</div>
      <div class="menu-list">
        <button v-for="r in GENERATION_RESOLUTIONS" :key="r" type="button" class="menu-item" :class="{ 'is-picked': resolution === r }" @click="choose('resolution', r)">
          <span class="menu-name">{{ r || '自动（服务端缺省档）' }}</span>
          <span v-if="resolution === r" class="menu-check">✓</span>
        </button>
      </div>
    </div>
    <div v-if="openMenu === 'duration'" class="menu">
      <div class="menu-title">视频时长</div>
      <div class="menu-list">
        <button v-for="d in GENERATION_DURATIONS" :key="d" type="button" class="menu-item" :class="{ 'is-picked': duration === d }" @click="choose('duration', d)">
          <span class="menu-name">{{ d > 0 ? `${d} 秒` : '自动（引擎缺省）' }}</span>
          <span v-if="duration === d" class="menu-check">✓</span>
        </button>
      </div>
    </div>
  </span>
</template>

<style scoped>
.gp-root { position: relative; display: inline-flex; }
/* 即梦非 Agent pill 口径：中性灰白、细线图标、✦ 蓝角标；无底色无 caret */
.gp-pill { display: inline-flex; align-items: center; gap: 5px; border: none; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 13px; font-weight: 500; padding: 4px 7px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.gp-pill:hover { color: var(--foreground); background: color-mix(in srgb, var(--foreground) 6%, transparent); }
.gp-pill.is-open { color: var(--foreground); background: color-mix(in srgb, var(--primary) 10%, transparent); }
.gp-pill .ico { width: 14px; height: 14px; display: block; opacity: 0.9; }
.spark { color: var(--primary); font-size: 10px; line-height: 1; margin-left: 1px; }
.menu { position: absolute; left: 0; top: calc(100% + 8px); z-index: 40; min-width: 200px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-3); overflow: hidden; text-align: left; }
.menu-title { padding: 10px 14px 2px; font-size: 12px; color: var(--muted-foreground); }
.menu-list { max-height: 300px; overflow: auto; padding: 6px; }
.menu-item { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: transparent; color: var(--foreground); font: inherit; font-size: 14px; text-align: left; padding: 9px 10px; border-radius: 10px; cursor: pointer; }
.menu-item:hover { background: var(--surface); }
.menu-item.is-picked { color: var(--primary); font-weight: 600; }
.menu-name { flex: 1 1 auto; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; }
.menu-name .ico { width: 14px; height: 14px; }
.menu-check { color: var(--primary); }
.ratio-frame { display: inline-block; width: 13px; max-height: 15px; border: 1.4px solid currentColor; border-radius: 3px; }
</style>
