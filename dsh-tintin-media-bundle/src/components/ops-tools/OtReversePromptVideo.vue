<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// OtReversePromptVideo — 运营工具「视频反推提示词」（2026-10-02 用户裁决启用）
// 走仿视频拆解接口（POST /api/storyboard/scripts/imitate）一个调用返回
// 【拆解脚本 + 反推提示词】——不单独调 /prompt/video；编排复用
// useImitationVideo（上传入素材库→material://→拆解→unified 轮询）。
// ═══════════════════════════════════════════════════════════════
import { computed, onMounted, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import { useFilePicker } from '@/composables/useFilePicker'
import { useImitationVideo } from '@/composables/useImitationVideo'
import { acceptFileDragOver } from '@/utils/fileUrl'
import { MAX_SOURCE_VIDEO_SEC, probeDurationSec } from '@/utils/videoDuration'

const iv = useImitationVideo()

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'm4v']
type Mode = 'file' | 'material'
const mode = ref<Mode>('file')
const materialId = ref('')
const sourceFile = ref<File | null>(null)
const pickError = ref('')

const picker = useFilePicker({
  dialogTitle: '选择视频',
  filters: [{ name: '视频', extensions: VIDEO_EXTS }],
})
function isVideo(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return VIDEO_EXTS.includes(ext)
}
async function onDrop(e: DragEvent): Promise<void> {
  const f = e.dataTransfer?.files?.[0] || null
  if (f && !isVideo(f.name)) {
    pickError.value = `不支持的视频格式：${f.name}（支持 ${VIDEO_EXTS.join(' / ')}）`
    return
  }
  if (f) {
    // 时长上限校验（2026-10-02 用户裁决：≤60 秒，超限明确提示）
    const sec = await probeDurationSec(f)
    if (sec !== null && sec > MAX_SOURCE_VIDEO_SEC) {
      sourceFile.value = null
      picker.clearFile()
      pickError.value = `视频时长 ${Math.round(sec)} 秒，超过 ${MAX_SOURCE_VIDEO_SEC} 秒上限——请选择 ${MAX_SOURCE_VIDEO_SEC} 秒以内的视频`
      return
    }
    sourceFile.value = f
  }
  pickError.value = ''
  picker.onDrop(e)
}

const canSubmit = computed(() =>
  mode.value === 'file' ? !!sourceFile.value : /^\d+$/.test(materialId.value.trim()),
)

async function submit(): Promise<void> {
  const video = mode.value === 'file' ? sourceFile.value : materialId.value.trim()
  await iv.submitImitate({ video })
}

/** 拆解脚本行（结果 shots[]：visual/camera/duration——服务端实测形态） */
const resultShots = computed<Array<Record<string, unknown>>>(() => {
  const r = iv.part1Result.value || {}
  return Array.isArray(r.shots) ? (r.shots as Array<Record<string, unknown>>) : []
})
/** 反推提示词（逐镜，随拆解 shots[] 返回——2026-10-02 服务端规范定稿：
 *  visual 中文 + scene_en/end_scene_en 英文提示词 + 运镜/时长；无独立顶层字段） */
/** 时长展示格式化：一位小数、去尾零（浮点噪声修复 2026-10-03） */
function formatSec(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${parseFloat(n.toFixed(2))}s`
}

const promptShots = computed<Array<Record<string, unknown>>>(() => resultShots.value)

watch(() => iv.part1Phase.value, ph => {
  if (ph === 'done') void 0
})

onMounted(() => { /* 枚举等非本卡依赖，不拉 */ })
</script>

<template>
  <div class="rpv">
    <div class="row">
      <label class="rpv-mode" :class="{ on: mode === 'file' }"><input v-model="mode" type="radio" value="file" />本地上传</label>
      <label class="rpv-mode" :class="{ on: mode === 'material' }"><input v-model="mode" type="radio" value="material" />素材库</label>
    </div>

    <div v-if="mode === 'file'" class="rpv-pick">
      <div class="dropzone" :class="{ 'is-active': picker.isDragging.value, 'has-file': !!picker.filePath.value }"
        @click="picker.pickFile"
        @drop.prevent="onDrop"
        @dragover.prevent="acceptFileDragOver($event); picker.onDragOver()"
        @dragleave.prevent="picker.onDragLeave">
        <svg v-if="!picker.filePath.value" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <div class="dropzone__text">
          <template v-if="!picker.filePath.value">
            <span class="dropzone__main">点击选择视频或拖拽到此处</span>
            <span class="dropzone__hint">时长 ≤ {{ MAX_SOURCE_VIDEO_SEC }} 秒；自动上传后拆解，返回脚本与提示词</span>
          </template>
          <template v-else>
            <span class="dropzone__main">{{ picker.fileName.value }}</span>
            <span class="dropzone__hint">点击重新选择</span>
          </template>
        </div>
      </div>
      <div v-if="pickError" class="rpv-err">{{ pickError }}</div>
    </div>
    <div v-else class="seg-field">
      <span class="lbl">素材库 ID</span>
      <input v-model="materialId" class="rpv-input" placeholder="如 812729" />
    </div>

    <div class="row">
      <TButton label="拆解并反推" :loading="iv.part1Phase.value === 'running'" :disabled="!canSubmit" @click="submit" />
      <span v-if="iv.part1Note.value" class="muted">{{ iv.part1Note.value }}</span>
    </div>
    <div v-if="iv.part1Phase.value === 'running'" class="muted">拆解进行中（分割 → 逐镜分析 → 运镜 → 转写 → 反推，分钟级）…</div>
    <div v-if="iv.part1Error.value" class="rpv-err">{{ iv.part1Error.value }}</div>

    <template v-if="iv.part1Phase.value === 'done'">
      <div class="rpv-divider"></div>
      <div class="lbl">拆解脚本（{{ resultShots.length }} 镜）</div>
      <div v-for="(s, i) in resultShots" :key="i" class="rpv-shot">
        <b>#{{ i + 1 }}</b> {{ formatSec(s.duration) }} ｜ {{ s.camera || '—' }}
        <span class="muted">{{ s.visual }}</span>
      </div>
      <div class="lbl" style="margin-top: 10px">反推提示词（逐镜）</div>
      <template v-if="promptShots.length">
        <div v-for="(s, i) in promptShots" :key="i" class="rpv-shot">
          <div><b>#{{ i + 1 }}</b> {{ formatSec(s.duration) }} ｜ {{ s.camera || '—' }}<span class="muted">{{ s.visual }}</span></div>
          <div v-if="s.scene_en" class="rpv-en">scene_en: {{ s.scene_en }}</div>
          <div v-if="s.end_scene_en" class="rpv-en">end_scene_en: {{ s.end_scene_en }}</div>
        </div>
      </template>
      <div v-else class="muted">拆解结果未含 shots 明细（旧版服务端）</div>
    </template>
  </div>
</template>

<style scoped>
.rpv { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.lbl { font-size: 12px; color: var(--muted-foreground); }
.rpv-mode { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md);
  font-size: 12px; color: var(--muted-foreground); cursor: pointer; }
.rpv-mode.on { color: var(--primary); font-weight: 600; border-color: var(--primary); }
.rpv-pick { display: flex; flex-direction: column; gap: 6px; }
.rpv-err { color: var(--danger, #e74c3c); font-size: 12px; }
.rpv-input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--foreground); font-size: 13px; outline: none; }
.rpv-divider { height: 1px; background: var(--border); margin: 8px 0; }
.rpv-shot { padding: 6px 10px; background: var(--surface-container); border: 1px solid var(--border);
  border-radius: var(--radius-md); font-size: 12px; color: var(--foreground); }
.rpv-shot b { color: var(--primary); margin-right: 4px; }
.rpv-shot .muted { margin-left: 8px; }
.rpv-en { margin-top: 2px; font-size: 11px; color: var(--muted-foreground); font-family: monospace; }
.rpv-text { min-height: 120px; padding: 8px 10px; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--foreground); font-size: 12px; line-height: 1.6;
  font-family: inherit; resize: vertical; }
.dropzone { display: flex; align-items: center; gap: var(--space-3); min-height: 120px; padding: var(--space-6);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-container));
  border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border));
  border-radius: var(--radius-lg); color: var(--muted-foreground); cursor: pointer; }
.dropzone:hover, .dropzone.is-active { border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-container)); }
.dropzone.has-file { border-style: solid; color: var(--foreground); }
.dropzone__text { display: flex; flex-direction: column; gap: 2px; }
.dropzone__main { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--foreground); }
.dropzone__hint { font-size: 12px; color: var(--muted-foreground); }
</style>
