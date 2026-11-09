<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ReversePromptImage.vue — 媒体工具「图片反推提示词」（2026-11-08 启用；
// 2026-11-09 用户裁决自运营工具整体迁入，ops 侧随迁出删除）
// 直调服务端 POST /prompt/image（multipart：file | material_id | local_path |
// file_ref 四选一；Florence-2 PromptGen 反推素材层 + 视觉模型结构化，
// openapi 已核实 + 1108 实测响应结构）。响应为「部分成功」形态：error 字段
// 非空时分析层（image_analysis）仍可能有值——错误红条与服务端原文同显，
// 不整体抛错。UI 骨架对齐同族 OtReversePromptVideo（双模式 + dropzone + 结果卡）。
// ═══════════════════════════════════════════════════════════════
import { computed, ref } from 'vue'
import TButton from '@/components/common/TButton.vue'

type Mode = 'file' | 'material'
const mode = ref<Mode>('file')
const materialId = ref('')
const sourceFile = ref<File | null>(null)
const previewUrl = ref('')
const pickError = ref('')
const submitting = ref(false)
const submitError = ref('')

interface PromptResult {
  prompt?: string
  negative_prompt?: string
  style_tags?: unknown[]
  aspect_ratio?: string
  description?: string
  final_prompt?: string
  error?: string
  engine_used?: string
  model_used?: string
  image_analysis?: {
    composition?: { ok?: boolean; composition_desc?: string }
    lighting?: { ok?: boolean; lighting_desc?: string }
  }
}
const result = ref<PromptResult | null>(null)

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']
function isImage(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTS.includes(ext)
}

const fileInput = ref<HTMLInputElement | null>(null)
function onPickClick(): void { fileInput.value?.click() }
function acceptFile(f: File): void {
  if (!isImage(f.name)) {
    pickError.value = `不支持的图片格式：${f.name}（支持 ${IMAGE_EXTS.join(' / ')}）`
    return
  }
  sourceFile.value = f
  previewUrl.value = URL.createObjectURL(f)
  pickError.value = ''
  result.value = null
  submitError.value = ''
}
function onFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0] ?? null
  input.value = '' // 同一文件可重复选择
  if (f) acceptFile(f)
}
function onDrop(e: DragEvent): void {
  const f = e.dataTransfer?.files?.[0] || null
  if (f) acceptFile(f)
}

const canSubmit = computed(() =>
  mode.value === 'file' ? !!sourceFile.value : /^\d+$/.test(materialId.value.trim()),
)

/** 主提示词：final_prompt（结构化成品）优先，空则回退 prompt */
const mainPrompt = computed(() => {
  const r = result.value
  return String(r?.final_prompt || r?.prompt || '').trim()
})
const styleTags = computed<string[]>(() => {
  const arr = result.value?.style_tags
  return Array.isArray(arr) ? arr.map((x) => String(x)).filter(Boolean) : []
})

async function copyText(t: string): Promise<void> {
  try { await navigator.clipboard.writeText(t) } catch { /* 非安全上下文静默 */ }
}

async function submit(): Promise<void> {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  submitError.value = ''
  result.value = null
  try {
    const t = (window as unknown as {
      tintin?: { server?: { upload?: (path: string, form: FormData) => Promise<unknown> } }
    }).tintin
    if (!t?.server?.upload) throw new Error('预览环境：无 IPC')
    const form = new FormData()
    if (mode.value === 'file' && sourceFile.value) form.append('file', sourceFile.value)
    else form.append('material_id', materialId.value.trim())
    const data = await t.server.upload('/prompt/image', form)
    if (data === null || data === undefined) throw new Error('无法连接服务端，请检查服务端地址配置。')
    result.value = data as PromptResult
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="rpi">
    <div class="row">
      <label class="rpi-mode" :class="{ on: mode === 'file' }"><input v-model="mode" type="radio" value="file" />本地上传</label>
      <label class="rpi-mode" :class="{ on: mode === 'material' }"><input v-model="mode" type="radio" value="material" />素材库</label>
    </div>

    <div v-if="mode === 'file'" class="rpi-pick">
      <div
        class="dropzone"
        :class="{ 'has-file': !!sourceFile }"
        @click="onPickClick"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <img v-if="previewUrl" :src="previewUrl" class="dropzone__thumb" alt="" />
        <div class="dropzone__text">
          <template v-if="!sourceFile">
            <span class="dropzone__main">点击选择图片或拖拽到此处</span>
            <span class="dropzone__hint">PNG / JPG / WebP；服务端 Florence-2 反推 + 视觉模型结构化</span>
          </template>
          <template v-else>
            <span class="dropzone__main">{{ sourceFile.name }}</span>
            <span class="dropzone__hint">点击重新选择</span>
          </template>
        </div>
      </div>
      <div v-if="pickError" class="rpi-err">{{ pickError }}</div>
    </div>
    <div v-else class="seg-field">
      <span class="lbl">素材库 ID</span>
      <input v-model="materialId" class="rpi-input" placeholder="如 813728" />
    </div>

    <div class="row">
      <TButton :disabled="!canSubmit || submitting" @click="submit">
        {{ submitting ? '⏳ 反推中…' : '✨ 生成提示词' }}
      </TButton>
    </div>

    <div v-if="submitError" class="rpi-err">{{ submitError }}</div>

    <!-- 服务端部分成功：error 原文红条（分析层照常展示） -->
    <div v-if="result?.error" class="rpi-err">服务端提示：{{ result.error }}（模型层异常时分析层结果仍可用）</div>

    <template v-if="result">
      <div v-if="mainPrompt" class="rpi-card">
        <div class="rpi-card-head">
          <span class="rpi-card-title">生图提示词</span>
          <span v-if="result.model_used || result.engine_used" class="rpi-chip">{{ result.model_used || result.engine_used }}</span>
          <button type="button" class="rpi-copy" @click="copyText(mainPrompt)">复制</button>
        </div>
        <pre class="rpi-pre">{{ mainPrompt }}</pre>
      </div>
      <div v-if="result.negative_prompt" class="rpi-card">
        <div class="rpi-card-head">
          <span class="rpi-card-title">负向提示词</span>
          <button type="button" class="rpi-copy" @click="copyText(String(result.negative_prompt))">复制</button>
        </div>
        <pre class="rpi-pre">{{ result.negative_prompt }}</pre>
      </div>
      <div v-if="styleTags.length || result.aspect_ratio" class="rpi-card">
        <div class="rpi-card-head"><span class="rpi-card-title">风格与画幅</span></div>
        <div class="rpi-tags">
          <span v-for="tag in styleTags" :key="tag" class="rpi-chip">{{ tag }}</span>
          <span v-if="result.aspect_ratio" class="rpi-chip">画幅 {{ result.aspect_ratio }}</span>
        </div>
      </div>
      <div v-if="result.description" class="rpi-card">
        <div class="rpi-card-head"><span class="rpi-card-title">画面描述</span></div>
        <pre class="rpi-pre">{{ result.description }}</pre>
      </div>
      <div v-if="result.image_analysis?.composition?.composition_desc || result.image_analysis?.lighting?.lighting_desc" class="rpi-card">
        <div class="rpi-card-head"><span class="rpi-card-title">画面分析（Florence-2 反推层）</span></div>
        <div class="rpi-analysis">
          <span v-if="result.image_analysis?.composition?.composition_desc">构图：{{ result.image_analysis.composition.composition_desc }}</span>
          <span v-if="result.image_analysis?.lighting?.lighting_desc">光照：{{ result.image_analysis.lighting.lighting_desc }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rpi { max-width: 760px; display: flex; flex-direction: column; gap: var(--space-4); }
.row { display: flex; align-items: center; gap: var(--space-3); }
.rpi-mode { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted-foreground); cursor: pointer; padding: 4px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); }
.rpi-mode.on { color: var(--primary); border-color: var(--primary); }

.rpi-pick { display: flex; flex-direction: column; gap: var(--space-2); }
.dropzone {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-4); cursor: pointer;
  border: 1px dashed var(--border); border-radius: var(--radius-lg);
  background: var(--surface-container);
  transition: border-color var(--duration-fast);
}
.dropzone:hover { border-color: var(--primary); }
.dropzone.has-file { border-style: solid; }
.dropzone__thumb { width: 96px; height: 72px; object-fit: cover; border-radius: var(--radius-md); background: var(--surface-container-high); }
.dropzone__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dropzone__main { font-size: 14px; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dropzone__hint { font-size: 12px; color: var(--muted-foreground); }

.seg-field { display: flex; align-items: center; gap: var(--space-2); }
.lbl { font-size: 13px; color: var(--muted-foreground); }
.rpi-input { flex: 0 1 240px; height: 32px; padding: 0 var(--space-3); background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--foreground); outline: none; }
.rpi-input:focus { border-color: var(--primary); }

.rpi-err { font-size: 13px; color: var(--destructive, #e5484d); }

.rpi-card { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-container); padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.rpi-card-head { display: flex; align-items: center; gap: var(--space-2); }
.rpi-card-title { font-size: 13px; font-weight: 700; color: var(--foreground); flex: 1; }
.rpi-copy { height: 24px; padding: 0 10px; font-size: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: transparent; color: var(--muted-foreground); cursor: pointer; }
.rpi-copy:hover { color: var(--primary); border-color: var(--primary); }
.rpi-pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.6 var(--font-mono, ui-monospace, monospace); color: var(--foreground); max-height: 320px; overflow-y: auto; }
.rpi-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.rpi-chip { padding: 2px 10px; font-size: 12px; border-radius: 999px; background: rgba(127, 127, 127, 0.14); color: var(--foreground); }
.rpi-analysis { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted-foreground); }
</style>
