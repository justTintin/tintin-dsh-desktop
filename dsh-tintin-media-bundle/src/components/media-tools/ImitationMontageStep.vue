<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// ImitationMontageStep.vue — 仿视频第 5 步 特效包装（storyboard_montage 草稿链）
// 与第 6 步 交付（导入服务端草稿包→落盘剪映）。2026-10-06 用户裁决：
// 特效包装实体化（参考文案混剪链）、导出拆分到第 6 步。
// ═════════════════════════════════════════════════════════════
import { computed, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'

const props = defineProps<{
  step: number
  scriptId: string
  phase: string
  progress: number
  elapsedSec: number
  message: string
  error: string
  exporting: boolean
  exportStage: string
  exportNote: string
  /** 特效配置（脚本级）：转场 + BGM 名称（第 5 步配置，随脚本保存，草稿链消费） */
  transition: string
  bgmName: string
  result: Record<string, unknown>
}>()

const emit = defineEmits<{
  (e: 'trigger'): void
  (e: 'import'): void
  (e: 'back'): void
  (e: 'next'): void
  (e: 'restart'): void
  (e: 'config-change', patch: { transition?: string; bgmName?: string }): void
  (e: 'download'): void
}>()

// ── BGM 选择（数据源同文案混剪=音频库音乐；写入脚本随草稿链消费）──
interface BgmRow { mid: number | string; filename?: string }
const bgmRows = ref<BgmRow[]>([])
const bgmLoading = ref(false)
const TRANSITIONS = [
  { label: '随机', value: 'random' },
  { label: '模糊', value: 'fade' }, { label: '淡入淡出', value: 'dissolve' },
  { label: '左移', value: 'slideleft' }, { label: '右移', value: 'slideright' },
  { label: '上移', value: 'slideup' }, { label: '下移', value: 'slidedown' },
  { label: '推进', value: 'zoomin' }, { label: '拉远', value: 'zoomout' },
]
watch(() => props.step, (st) => {
  if (st !== 5 || bgmRows.value.length || bgmLoading.value) return
  bgmLoading.value = true
  void (window as unknown as {
    tintin?: { server?: { get?: (p: string) => Promise<unknown> } }
  }).tintin?.server?.get?.('/audio/library?page=1&size=100&kind=music').then((res) => {
    const data = (res && typeof res === 'object' ? res : null) as { items?: Array<Record<string, unknown>>; data?: { items?: Array<Record<string, unknown>> } } | null
    const arr = data?.items ?? data?.data?.items ?? []
    bgmRows.value = arr.map((x) => ({ mid: (x.mid ?? x.id) as number | string, filename: String(x.filename || x.name || '') }))
  }).catch(() => { bgmRows.value = [] }).finally(() => { bgmLoading.value = false })
})

const videoPath = computed(() => String((props.result as Record<string, unknown>)?.video_path || ''))
const serveVideoUrl = computed(() => videoPath.value ? `/material/serve?path=${encodeURIComponent(videoPath.value)}` : '')
const qualityScore = computed(() => (props.result as Record<string, unknown>)?.quality_score as Record<string, unknown> | undefined)

</script>

<template>
  <div class="iv-panel">
    <template v-if="step === 5">
      <div class="seg-card">
        <div class="seg-head">
          <span class="seg-no">配置</span>
          <span class="sb-info">转场与 BGM（随脚本保存，草稿链消费——同文案混剪口径）</span>
        </div>
        <div class="row">
          <label class="cfg-field"><span class="lbl">镜间转场</span>
            <select :value="transition" class="input" @change="emit('config-change', { transition: ($event.target as HTMLSelectElement).value })">
              <option v-for="t in TRANSITIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </label>
          <label class="cfg-field"><span class="lbl">BGM（音频库·音乐）</span>
            <select :value="bgmName" class="input" @change="emit('config-change', { bgmName: ($event.target as HTMLSelectElement).value })">
              <option value="">（不配 BGM）</option>
              <option v-for="b in bgmRows" :key="b.mid" :value="b.filename">{{ b.filename }}</option>
            </select>
          </label>
          <span v-if="bgmLoading" class="muted">BGM 列表加载中…</span>
        </div>
      </div>
      <div class="seg-card">
        <div class="seg-head">
          <span class="seg-no">特效包装</span>
          <span class="sb-info">口播 + 特效包装 → 剪映草稿链（口播/分镜视频已绑脚本）</span>
          <span class="spacer"></span>
          <TButton
            label="开始特效包装"
            variant="primary"
            :loading="phase === 'running'"
            :disabled="phase === 'running' || !scriptId"
            title="提交 storyboard_montage 草稿链任务"
            @click="emit('trigger')"
          />
        </div>
        <div v-if="error" class="iv-err">{{ error }}</div>
        <template v-if="phase === 'running'">
          <div class="row between">
            <span class="muted">草稿链生成中（已用时 {{ elapsedSec }} 秒，耗时较长）</span>
            <span v-if="progress >= 0" class="muted">{{ progress }}%</span>
          </div>
          <div class="iv-bar" :class="{ 'is-indeterminate': progress < 0 }">
            <div v-if="progress >= 0" class="iv-bar-fill" :style="{ width: progress + '%' }"></div>
          </div>
          <div v-if="message" class="muted">{{ message }}</div>
        </template>
        <span v-else-if="phase === 'done'" class="sb-info">✓ 草稿链完成——到「交付」导入剪映草稿</span>
        <div v-else class="muted">点击「开始特效包装」提交草稿链任务。</div>
      </div>
      <div class="row">
        <TButton label="← 上一步" variant="primary" @click="emit('back')" />
        <span class="spacer"></span>
        <TButton label="下一步：交付" :disabled="phase !== 'done'" :title="phase === 'done' ? '' : '先完成特效包装草稿链'" @click="emit('next')" />
      </div>
    </template>

    <template v-else>
      <div class="seg-card">
        <div class="seg-head">
          <span class="seg-no">交付</span>
          <span class="sb-info">导入服务端草稿包 → 落盘剪映草稿目录（解压 + 数据/路径校验，同文案混剪）</span>
        </div>
        <div class="row">
          <TButton label="下载成片" variant="primary" :disabled="!videoPath" :loading="exporting" @click="emit('download')" />
          <span class="muted">{{ videoPath ? '成片已生成（' + videoPath + '）' : '先在第 5 步完成特效包装草稿链' }}</span>
        </div>
        <video v-if="serveVideoUrl" :src="serveVideoUrl" controls preload="metadata" class="iv-montage-video" />
        <div v-if="qualityScore" class="sb-line">质量评分：综合 {{ qualityScore.total }} ｜ 美学 {{ qualityScore.aesthetics }} ｜ 色彩 {{ qualityScore.color_quality }} ｜ 主体突出 {{ qualityScore.subject_prominence }}</div>
      </div>
      <div class="row">
        <TButton label="← 上一步" variant="primary" @click="emit('back')" />
        <span class="spacer"></span>
        <TButton label="重新走一遍（新视频）" variant="secondary" @click="emit('restart')" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.iv-panel { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.spacer { flex: 1; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.sb-info { font-size: 13px; color: var(--foreground); }
.sb-line { font-size: 12px; color: var(--foreground); line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
.iv-err { color: var(--danger, #e74c3c); font-size: 12px; }
.seg-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.seg-head { display: flex; align-items: center; gap: 8px; }
.seg-no { font-size: 13px; font-weight: 600; color: var(--primary); }
.iv-bar { position: relative; height: 6px; overflow: hidden; background: var(--border); border-radius: 999px; }
.iv-bar-fill { height: 100%; background: var(--primary); border-radius: 999px; transition: width 0.6s ease; }
.iv-bar.is-indeterminate::after { content: ''; position: absolute; inset: 0; width: 40%; background: var(--primary); border-radius: 999px; animation: iv-indeterminate 1.2s ease-in-out infinite; }
@keyframes iv-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }
</style>
