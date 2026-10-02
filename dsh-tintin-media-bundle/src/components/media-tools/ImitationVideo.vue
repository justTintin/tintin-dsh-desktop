<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ImitationVideo.vue — 仿视频向导（PRD-M-5 · V3.5 客户端 UI）
// 步骤结构=流程规范 §5.3 用户流程七步（比文案混剪四步多，文档定义为准）：
//   1 选原视频 → 2 审核脚本(HumanGate①) → 3 素材准备(A-roll+分镜帧)
//   → 4 分镜图确认(HumanGate②·九宫格) → 5 逐镜视频生成
//   → 6 触发草稿链(HumanGate③·两段式) → 7 交付(复用文案线双通道)
// 整体方案与文案混剪对应（§5.3 原则）：同卡片/步骤条/镜头卡视觉形态与交互惯例，
// 差异仅「AI 生成」区块（来源标记/生成参数/逐镜状态）；脚本审核页不复用
// CopywritingStoryboard（深耦合文案线 inject shell），按同形态自持数据。
// 编排=useImitationVideo（runner）；纯逻辑=imitationVideoLogic（可单测）。
// 待服务端契约项（显式占位不发明）：A-roll 数字人人物图上传通道、细化批注
// 映射层端点、草稿链直提（storyboard_montage 走文案线现有入口）。
// ═══════════════════════════════════════════════════════════════
import { computed, onMounted, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import VdStepBar from '@/components/media-tools/VdStepBar.vue'
import WbPickProductDialog from '@/components/workbench/WbPickProductDialog.vue'
import { createMontageSharedRuntime } from '@/composables/copywritingMontage/context'
import { useFilePicker } from '@/composables/useFilePicker'
import { useImitationVideo } from '@/composables/useImitationVideo'
import type { PickerItem } from '@/composables/useWorkbenchPickers'
import { clientError } from '@/utils/clientLog'
import { acceptFileDragOver } from '@/utils/fileUrl'
import { API_PATHS } from '@/types/server-api'
import {
  SCENE_ELEMENT_KEYS,
  canConfirmFrames,
  clampDuration,
  enumLabel,
  framesBadgeText,
  genBadgeText,
  isStageDReady,
  sceneElementOptions,
  shotsTotalDuration,
  switchShotSource,
  type GenerateStage,
  type ImitationShot,
  type SceneElementKey,
} from '@/composables/imitationVideoLogic'

const STEPS = ['1. 视频拆解', '2. 生成脚本', '3. 分镜头确认', '4. 视频生成', '5. 包装特效', '6. 交付']

/** 场景要素键 → 中文标签（展示层专用；数据面键名/枚举值仍按契约英文） */
const SCENE_ELEMENT_LABELS: Record<string, string> = {
  surface: '台面',
  environment: '环境',
  lighting: '光照',
  style: '风格',
  composition: '构图',
}

const iv = useImitationVideo()
const { ensureServerUrl, toAbsolute } = createMontageSharedRuntime()

const step = ref(1)
const record = ref<Record<string, unknown> | null>(null)
const shots = computed<ImitationShot[]>(() => (record.value?.shots as ImitationShot[]) || [])
const scriptId = computed(() => iv.scriptId.value || String(record.value?.id || ''))

async function reloadScript(): Promise<void> {
  if (!scriptId.value) return
  const data = await iv.loadScript(scriptId.value)
  if (data) {
    record.value = data
    seedOrigAudio()
  }
}

/**
 * 每镜固化原片旁白参考（orig_audio，extra=allow 随脚本透传保存）：
 * 第 1 步拆出的=原片脚本（模板）；第 2 步「生成脚本」替换文字——shot.audio 为
 * 新文案（可编辑），原片口播切片留在 orig_audio 供对照（2026-10-02 用户裁决语义）。
 */
function seedOrigAudio(): void {
  for (const s of shots.value) {
    if (s.orig_audio === undefined || s.orig_audio === '') s.orig_audio = String(s.audio ?? '')
  }
}

onMounted(() => {
  void iv.loadEnums()
  void ensureServerUrl()
})

// ── 第 1 步：选原视频（本地上传 File / 素材库 material://{id} / http url）──
type SourceMode = 'file' | 'material' | 'url'
const sourceMode = ref<SourceMode>('file')
const sourceMaterial = ref('')
const sourceUrl = ref('')
const ratio = ref('9:16')
const fidelity = ref('balanced')
/** 本地文件上传进度（0..1；<0 未在上传） */
const uploadRatio = ref(-1)

// 本地视频走工程统一拖入控件（useFilePicker：点击选择/拖拽 + 120px 统一 dropzone，
// 2026-09-07 全程序统一裁决）。上传通道需要真 File：拖入从 dataTransfer 直取；
// 对话框只给路径 → 经宿主 /tintin/media 代理（unlock 已由选择器触发）取回内容成 File。
const VIDEO_PICK_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'm4v']
const sourceFile = ref<File | null>(null)
const fileResolving = ref(false)
const pickError = ref('')
const videoPicker = useFilePicker({
  dialogTitle: '选择原视频',
  filters: [{ name: '视频', extensions: VIDEO_PICK_EXTS }],
})

function isVideoName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return VIDEO_PICK_EXTS.includes(ext)
}

/** 拖入：先取真 File（上传用），再交共享选择器落路径/展示名 */
function onVideoDrop(e: DragEvent): void {
  const f = e.dataTransfer?.files?.[0] || null
  if (f && !isVideoName(f.name)) {
    pickError.value = `不支持的视频格式：${f.name}（支持 ${VIDEO_PICK_EXTS.join(' / ')}）`
    return
  }
  if (f) sourceFile.value = f
  pickError.value = ''
  videoPicker.onDrop(e)
}

/** 对话框路径 → File（宿主 /tintin/media 同源代理流式取回；失败显式报错不静默） */
async function resolveFileFromPath(path: string): Promise<void> {
  if (!isVideoName(path)) {
    sourceFile.value = null
    pickError.value = `不支持的视频格式：${path}`
    return
  }
  fileResolving.value = true
  try {
    const res = await fetch(`/tintin/media?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const name = path.split(/[\\/]/).pop() || 'source.mp4'
    sourceFile.value = new File([blob], name, { type: blob.type || 'video/mp4' })
    pickError.value = ''
  } catch (err) {
    sourceFile.value = null
    pickError.value = `读取所选文件失败：${(err as Error).message}`
    clientError('imitation-video', pickError.value, err)
  } finally {
    fileResolving.value = false
  }
}

// 路径变化：拖入已直取同名 File 则跳过；对话框新路径则代理解析
watch(videoPicker.filePath, (p) => {
  if (!p) {
    sourceFile.value = null
    return
  }
  const base = p.split(/[\\/]/).pop()
  if (sourceFile.value && sourceFile.value.name === base) return
  void resolveFileFromPath(p)
})

const part1VideoInput = computed<unknown>(() => {
  if (sourceMode.value === 'file') return sourceFile.value
  if (sourceMode.value === 'material') return sourceMaterial.value.trim()
  return sourceUrl.value.trim()
})

const canSubmitPart1 = computed(() => {
  if (sourceMode.value === 'file') return !!sourceFile.value && !fileResolving.value
  if (sourceMode.value === 'material') return /^\d+$/.test(sourceMaterial.value.trim())
  return /^https?:\/\//i.test(sourceUrl.value.trim())
})

// Part 1 完成 → 拉脚本，审核区就地展开（第 1/2 步已合并为「生成脚本」单页）
watch(() => iv.part1Phase.value, async (ph) => {
  if (ph === 'done') await reloadScript()
})

// ── 产品选择（与文案混剪同交互：WbPickProductDialog 公共弹窗单选；选中写进
//    脚本 products 随 PUT 保存——ScriptIn.products=ProductRef[]，阶段 C/D 产品图
//    解析按脚本 products 取图，§5.1-2）──
const productPickVisible = ref(false)
function productLabel(): string {
  const p = (record.value?.products as Array<Record<string, unknown>> | undefined)?.[0]
  if (!p) return ''
  return [p.brand, p.model || p.name].filter(Boolean).join(' / ') || String(p.name || p.brand || '')
}
function onProductPick(item: PickerItem): void {
  if (!record.value) return
  record.value.products = [{
    brand: String(item.brand || ''),
    model: String(item.model || ''),
    category: String(item.category || ''),
    name: String(item.name || item.model || ''),
  }]
}
function clearScriptProduct(): void {
  if (record.value) record.value.products = []
}

// ── 口播文案（脚本主稿）：Part 1 拆解稿在 meta.imitate.voiceover；「重新生成文案」
//    走 /copywriting/voiceover（product_desc 必填=选中产品，duration_s=镜头轨总长）；
//    随脚本保存（ScriptIn.meta 透传）──
const voiceoverText = computed({
  get: () => String(((record.value?.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown> | undefined)?.voiceover ?? ''),
  set: (v: string) => {
    if (!record.value) return
    const meta = { ...((record.value.meta as Record<string, unknown>) ?? {}) }
    meta.imitate = { ...((meta.imitate as Record<string, unknown>) ?? {}), voiceover: v }
    record.value.meta = meta
  },
})

const regenBusy = ref(false)
const regenError = ref('')
async function regenerateVoiceover(): Promise<void> {
  const p = (record.value?.products as Array<Record<string, unknown>> | undefined)?.[0]
  if (!p) {
    regenError.value = '请先「选择产品」——文案按产品信息重写（product_desc 必填）'
    return
  }
  regenBusy.value = true
  regenError.value = ''
  try {
    const productDesc = [p.brand, p.model || p.name, p.category].filter(Boolean).map(String).join(' / ')
    const resp = (await window.tintin.server.post(API_PATHS.copywriting.voiceover, {
      product_desc: productDesc,
      duration_s: shotsTotalDuration(shots.value),
      hint: '电商口播，节奏贴近原片，句子完整不拆行',
    })) as Record<string, unknown> | null
    const text = resp?.voiceover ?? resp?.text ?? resp?.content
    if (!text) {
      const keys = resp ? Object.keys(resp).join(',') : 'null'
      regenError.value = `文案生成响应缺文案字段（实得字段：${keys}）`
      clientError('imitation-video', regenError.value, { resp })
      return
    }
    voiceoverText.value = String(text)
  } catch (e) {
    regenError.value = `文案生成失败：${(e as Error).message}`
    clientError('imitation-video', regenError.value, e)
  } finally {
    regenBusy.value = false
  }
}

// ── 口播配音（TTS 整段直发——拆句禁令；engine=voxcpm=客户端默认裁决）：
//    生成后就地试听；挂接脚本口播轨（voice_audio_id）随包装特效链，属文案线复用链路 ──
const ttsBusy = ref(false)
const ttsError = ref('')
const ttsAudioUrl = ref('')
async function generateVoiceAudio(): Promise<void> {
  const text = voiceoverText.value.trim()
  if (!text) {
    ttsError.value = '口播文案为空：先拆解或「重新生成文案」'
    return
  }
  ttsBusy.value = true
  ttsError.value = ''
  try {
    const resp = (await window.tintin.server.post(API_PATHS.tts, {
      text,
      engine: 'voxcpm',
      target_duration: shotsTotalDuration(shots.value),
    })) as Record<string, unknown> | null
    const url = resp?.audio_url ?? resp?.url ?? resp?.audio ?? resp?.path
    if (!url) {
      const keys = resp ? Object.keys(resp).join(',') : 'null'
      ttsError.value = `配音响应缺音频地址字段（实得字段：${keys}）`
      clientError('imitation-video', ttsError.value, { resp })
      return
    }
    ttsAudioUrl.value = toAbsolute(String(url))
  } catch (e) {
    ttsError.value = `配音生成失败：${(e as Error).message}`
    clientError('imitation-video', ttsError.value, e)
  } finally {
    ttsBusy.value = false
  }
}

function goBack(): void {
  step.value = Math.max(1, step.value - 1)
}

/** 重新走一遍：清选择与脚本态，停留在第 1 步 */
function resetFlow(): void {
  record.value = null
  iv.part1Phase.value = ''
  iv.part1Note.value = ''
  iv.part1Error.value = ''
  iv.genPhase.value = ''
  iv.genError.value = ''
  iv.genResult.value = {}
  sourceFile.value = null
  videoPicker.clearFile()
  uploadRatio.value = -1
  step.value = 1
}

// ── 第 2 步：审核脚本（HumanGate①：逐镜编辑 + AI 生成区块 + 来源切换）──
function toggleSource(i: number): void {
  const cur = shots.value[i]
  if (!cur) return
  shots.value[i] = switchShotSource(cur, cur.source === 'generate' ? 'material' : 'generate', shots.value)
}

const timelineWarn = computed(() => iv.timelineWarning(shots.value, record.value?.voice_dur_sec))

/** PUT 整体替换（§8）：按 ScriptIn 字段组包，shots 原样回传（gen 随 JSONB 透传） */
function buildScriptPayload(): Record<string, unknown> {
  const r = record.value || {}
  return {
    topic: r.topic ?? '',
    meta: r.meta ?? {},
    style: r.style ?? '',
    atmosphere: r.atmosphere ?? '',
    rhythm: r.rhythm ?? '',
    bgm_type: r.bgm_type ?? '',
    guidance: r.guidance ?? '',
    products: r.products ?? [],
    ratio: r.ratio ?? ratio.value,
    total_duration: r.total_duration ?? shots.value.reduce((s, x) => s + (Number(x.duration) || 0), 0),
    shot_count: shots.value.length,
    shots: shots.value.map((s) => ({ ...s, duration: clampDuration(s.duration) })),
    saved_at: r.saved_at ?? '',
    voice_audio_id: r.voice_audio_id ?? 0,
    voice_dur_sec: r.voice_dur_sec ?? 0,
    aroll: r.aroll ?? {},
  }
}

const saving = ref(false)
async function saveScript(): Promise<boolean> {
  saving.value = true
  const ok = await iv.saveScript(scriptId.value, buildScriptPayload())
  saving.value = false
  return ok
}

const enteringPrep = ref(false)
async function enterPrep(): Promise<void> {
  if (!(await saveScript())) return
  enteringPrep.value = true
  // 阶段 B（A-roll）依赖口播音频先行（阶段 A 属文案线现状）；此处先跑阶段 C 分镜帧
  const ok = await iv.submitGenerate({ scriptId: scriptId.value, stage: 'frames' }, shots.value)
  enteringPrep.value = false
  if (ok) step.value = 3
}

// ── 生成任务通用：完成/失败后刷新脚本（帧引用/状态徽标落库后回读）；
//    不自动跳步——步进一律由用户点「下一步」（2026-10-02 用户裁决）──
watch(() => iv.genPhase.value, async (ph, old) => {
  if (old === 'running' && (ph === 'done' || ph === 'failed')) {
    await reloadScript()
  }
})

const genResultSummary = computed(() => {
  const r = iv.genResult.value || {}
  const done = Array.isArray(r.shots_done) ? (r.shots_done as unknown[]).length : 0
  const failed = Array.isArray(r.shots_failed) ? (r.shots_failed as unknown[]).length : 0
  return { done, failed }
})

// ── 第 4 步：分镜图确认（HumanGate②·九宫格视图）──
function frameUrl(name: unknown, which: 'first' | 'last'): string {
  return toAbsolute(`/api/storyboard/scripts/${scriptId.value}/shots/${encodeURIComponent(String(name))}/frames/${which}`)
}
const frameConfirming = ref('')
async function confirmFrame(i: number): Promise<void> {
  const s = shots.value[i]
  const name = s?.gen?.name
  if (!name) return
  frameConfirming.value = String(name)
  if (await iv.confirmShotFrames(scriptId.value, String(name))) await reloadScript()
  frameConfirming.value = ''
}
/** 换帧目标（共享一个隐藏 input）：{idx, which} */
const replaceTarget = ref<{ idx: number; which: 'first' | 'last' } | null>(null)
const frameInput = ref<HTMLInputElement | null>(null)
function pickReplaceFrame(i: number, which: 'first' | 'last'): void {
  replaceTarget.value = { idx: i, which }
  frameInput.value?.click()
}
async function onReplaceFrame(e: Event): Promise<void> {
  const f = (e.target as HTMLInputElement).files?.[0] || null
  const t = replaceTarget.value
  replaceTarget.value = null
  ;(e.target as HTMLInputElement).value = ''
  if (!f || !t) return
  const name = shots.value[t.idx]?.gen?.name
  if (!name) return
  const files = t.which === 'first' ? { first: f } : { last: f }
  if (await iv.replaceShotFrames(scriptId.value, String(name), files)) await reloadScript()
}
/** 单帧重生成（§5.1 only_shots 通道；细化批注映射层端点待契约，暂不提供批注输入） */
const regenFrame = ref('')
async function regenerateFrame(i: number): Promise<void> {
  const name = shots.value[i]?.gen?.name
  if (!name) return
  regenFrame.value = String(name)
  // 单帧重生成：提交后留在本页（分镜头确认），生成状态行可见
  await iv.submitGenerate({ scriptId: scriptId.value, stage: 'frames', onlyShots: [String(name)] }, shots.value)
  regenFrame.value = ''
}

const framesReadyCount = computed(() => shots.value.filter((s) => s.source === 'generate' && s.gen?.frames_status === 'confirmed').length)
const generateShotsCount = computed(() => shots.value.filter((s) => s.source === 'generate').length)

const startVideos = ref('')
async function startVideoGeneration(): Promise<void> {
  startVideos.value = '1'
  if (await iv.submitGenerate({ scriptId: scriptId.value, stage: 'videos' }, shots.value)) step.value = 4
  startVideos.value = ''
}

// ── 第 5 步：逐镜视频生成（徽标/失败重跑/降档）──
const retryFidelity = ref<'fast' | 'balanced' | 'high'>('fast')
const retrying = ref('')
async function retryShot(i: number): Promise<void> {
  const name = shots.value[i]?.gen?.name
  if (!name) return
  retrying.value = String(name)
  if (await iv.submitGenerate(
    { scriptId: scriptId.value, stage: 'videos', onlyShots: [String(name)], fidelityOverride: retryFidelity.value },
    shots.value,
  )) step.value = 4
  retrying.value = ''
}

// ── 第 6/7 步：触发草稿链（HumanGate③ 两段式）与交付 ──
// §5.3：素材就绪后手动触发，交互与文案线产片一致——脚本已存服务端脚本库，
// 在「文案混剪」工具选择该脚本继续 特效包装→草稿/成片（复用既有产片 UI）。
// 直提 storyboard_montage 任务为后续接线项（走既有任务提交入口，不另发明端点）。
const doneCount = computed(() => shots.value.filter((s) => s.source !== 'generate' || s.gen?.status === 'done').length)
</script>

<template>
  <div class="iv-page">
    <VdStepBar :step="step" :steps="STEPS" />
    <div v-if="step > 1" class="row">
      <TButton label="← 上一步" variant="secondary" size="small" @click="goBack" />
    </div>

    <!-- ═══ 第 1 步：生成脚本（选原视频 + 审核脚本合并页，2026-10-02 用户裁决）═══ -->
    <div v-if="step === 1" class="iv-panel">
      <div class="row">
        <label class="iv-mode" :class="{ on: sourceMode === 'file' }"><input v-model="sourceMode" type="radio" value="file" />本地上传</label>
        <label class="iv-mode" :class="{ on: sourceMode === 'material' }"><input v-model="sourceMode" type="radio" value="material" />素材库</label>
        <label class="iv-mode" :class="{ on: sourceMode === 'url' }"><input v-model="sourceMode" type="radio" value="url" />链接</label>
      </div>

      <div v-if="sourceMode === 'file'" class="iv-filepick">
        <div class="dropzone" :class="{ 'is-active': videoPicker.isDragging.value, 'has-file': !!videoPicker.filePath.value }"
          @click="videoPicker.pickFile"
          @drop.prevent="onVideoDrop"
          @dragover.prevent="acceptFileDragOver($event); videoPicker.onDragOver()"
          @dragleave.prevent="videoPicker.onDragLeave">
          <svg v-if="!videoPicker.filePath.value" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <div class="dropzone__text">
            <template v-if="!videoPicker.filePath.value">
              <span class="dropzone__main">点击选择原视频或拖拽到此处</span>
              <span class="dropzone__hint">支持 MP4 / MOV / MKV / AVI / WEBM / FLV / M4V；自动上传入素材库后进入拆解</span>
            </template>
            <template v-else>
              <span class="dropzone__main">{{ videoPicker.fileName.value }}</span>
              <span class="dropzone__hint">{{ fileResolving ? '正在读取文件…' : sourceFile ? `${(sourceFile.size / 1024 / 1024).toFixed(1)} MB · 点击重新选择` : '正在读取文件…' }}</span>
            </template>
          </div>
        </div>
        <div v-if="pickError" class="iv-err">{{ pickError }}</div>
      </div>
      <div v-else-if="sourceMode === 'material'" class="seg-field">
        <span class="lbl">素材库 ID（视频需已在服务端素材库）</span>
        <input v-model="sourceMaterial" class="input" placeholder="如 123" />
      </div>
      <div v-else class="seg-field">
        <span class="lbl">视频链接（服务端下载）</span>
        <input v-model="sourceUrl" class="input" placeholder="https://..." />
      </div>

      <div class="row">
        <label class="seg-field head-field"><span class="lbl">画幅</span>
          <select v-model="ratio" class="input w90">
            <option v-for="r in iv.enums.value?.ratios || []" :key="r.ratio" :value="r.ratio">
              {{ r.ratio }}（{{ r.width }}×{{ r.height }}）
            </option>
          </select>
        </label>
        <label class="seg-field head-field"><span class="lbl">保真档位</span>
          <select v-model="fidelity" class="input w110">
            <option v-for="f in iv.enums.value?.fidelity || []" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </label>
      </div>

      <div class="seg-field">
        <span class="lbl">A-roll 口播人像（可选，第 3 步配置）</span>
        <span class="muted">数字人 / 实拍上传在「3. 分镜头确认」中配置（数字人人物图上传通道待服务端契约，当前可先走实拍）</span>
      </div>

      <div class="row">
        <TButton label="提交拆解" :loading="iv.part1Phase.value === 'running'" :disabled="!canSubmitPart1" @click="iv.submitImitate({
          video: part1VideoInput,
          options: { ratio, fidelity },
          onUploadProgress: (r) => { uploadRatio.value = r },
        })" />
        <span v-if="iv.part1Note.value" class="muted">{{ iv.part1Note.value }}</span>
      </div>
      <div v-if="uploadRatio.value >= 0 && uploadRatio.value < 1 && iv.part1Phase.value !== 'running'" class="muted">本地上传中 {{ Math.round(uploadRatio.value * 100) }}%</div>
      <div v-if="iv.part1Phase.value === 'running'" class="muted">分析进行中（分钟级）：拆镜头 → 运镜测量 → 转写文案 → 生成仿拍脚本…</div>
      <div v-if="iv.part1Error.value" class="iv-err">{{ iv.part1Error.value }}</div>
      <div v-if="iv.enumsError.value" class="iv-err">枚举加载失败：{{ iv.enumsError.value }}（刷新重试：{{ ' ' }}<a class="iv-link" @click="iv.loadEnums">重试</a>）</div>
      <div v-if="iv.part1Phase.value === 'done' && shots.length" class="row">
        <TButton label="下一步：生成脚本" @click="step = 2" />
        <span class="muted">拆解完成：原片脚本（模板）共 {{ shots.length }} 镜 ｜ 总时长 {{ shotsTotalDuration(shots) }} 秒——下一步替换文案文字并配新口播</span>
      </div>
    </div>

    <!-- ═══ 第 2 步：生成脚本（原片脚本为模板：替换文字=新产品文案 + 新文案口播配音；HumanGate①；单脚本全步共用）═══ -->
    <div v-else-if="step === 2 && record && shots.length" class="iv-panel">
      <div class="row between">
        <span class="sb-info">原片脚本（模板）：共 {{ shots.length }} 镜 ｜ 总时长 {{ shotsTotalDuration(shots) }} 秒 ｜ 脚本 {{ scriptId }}</span>
        <span class="muted">本步生成新视频脚本：替换文案文字 + 新文案口播配音；AI/实拍逐镜定稿</span>
      </div>
      <div v-if="timelineWarn" class="iv-warn">{{ timelineWarn }}</div>

      <!-- 新口播文案（主稿）：按所选产品重写原片口播（/copywriting/voiceover） -->
      <div class="seg-field">
        <span class="lbl">新口播文案（主稿，随脚本保存；配音与逐镜替换以此为准）</span>
        <textarea v-model="voiceoverText" rows="4" class="input carry-textarea" placeholder="初值=原片口播转写；选择产品后点「重新生成文案」按新产品重写，也可直接编辑"></textarea>
      </div>
      <div class="row">
        <TButton label="选择产品" @click="productPickVisible = true" />
        <span v-if="productLabel()" class="product-chip" title="当前产品（文案按此重写，产品图随脚本供生成）">当前产品：{{ productLabel() }}</span>
        <button v-if="productLabel()" class="product-clear" title="清除已选产品" @click="clearScriptProduct">×</button>
        <TButton label="重新生成文案" :loading="regenBusy" @click="regenerateVoiceover" />
        <TButton label="生成口播配音（试听）" variant="secondary" :loading="ttsBusy" :disabled="!voiceoverText.trim()" @click="generateVoiceAudio" />
        <audio v-if="ttsAudioUrl" controls preload="none" :src="ttsAudioUrl" class="iv-audio" />
      </div>
      <div class="row">
        <span v-if="regenError" class="iv-err">{{ regenError }}</span>
        <span v-if="ttsError" class="iv-err">{{ ttsError }}</span>
        <span class="muted">配音整段直发（voxcpm）；新文案按镜自动拆分待服务端口播切分修复（§11-26），当前逐镜旁白可手动粘贴替换</span>
      </div>

      <div v-for="(shot, i) in shots" :key="i" class="seg-card">
        <div class="seg-head">
          <span class="seg-no">#{{ i + 1 }}</span>
          <label class="seg-field head-field"><span class="lbl">镜别</span><input v-model="shot.shot_type" class="input w70" placeholder="特写/中景" /></label>
          <label class="seg-field head-field"><span class="lbl">时长(秒)</span><input v-model.number="shot.duration" type="number" min="3" max="15" class="input w60" /></label>
          <span class="iv-badge" :class="shot.source === 'generate' ? 'iv-badge--ai' : 'iv-badge--mat'">{{ genBadgeText(shot) }}</span>
          <span class="spacer"></span>
          <TButton :label="shot.source === 'generate' ? '切换为实拍' : '切换为 AI'" variant="secondary" size="small"
            :title="shot.source === 'generate' ? 'gen 参数与帧引用将保留（切回可恢复）' : '将清空旧实拍绑定并初始化生成参数'"
            @click="toggleSource(i)" />
        </div>
        <label class="seg-field"><span class="lbl">画面描述</span><textarea v-model="shot.visual" rows="2" class="input carry-textarea" /></label>
        <div v-if="shot.orig_audio" class="sb-line iv-orig">原旁白（拆解稿）：{{ shot.orig_audio }}</div>
        <label class="seg-field"><span class="lbl">旁白（新文案，替换原片文字——可编辑）</span><textarea v-model="shot.audio" rows="1" class="input carry-textarea carry-textarea--sm" placeholder="新视频该镜的口播文案（从上方新文案粘贴或手写替换）"></textarea></label>

        <!-- AI 生成区块（§5.3 差异项：来源标记 / 生成参数 / 逐镜状态） -->
        <div v-if="shot.source === 'generate' && shot.gen" class="iv-gen">
          <div class="row">
            <label class="seg-field head-field"><span class="lbl">运镜</span>
              <select v-model="shot.gen.camera" class="input w110">
                <option v-for="c in iv.enums.value?.cameras || []" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>
            </label>
            <label class="seg-field head-field"><span class="lbl">保真</span>
              <select v-model="shot.gen.fidelity" class="input w110">
                <option v-for="f in iv.enums.value?.fidelity || []" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
            </label>
            <label v-for="k in SCENE_ELEMENT_KEYS" :key="k" class="seg-field head-field"><span class="lbl">{{ SCENE_ELEMENT_LABELS[k] || k }}</span>
              <select :value="(shot.gen.scene || {})[k] ?? ''" class="input w110" @change="(shot.gen.scene = { ...(shot.gen.scene || {}), [k]: ($event.target as HTMLSelectElement).value })">
                <option value="">（未设）</option>
                <option v-for="o in sceneElementOptions(iv.enums.value!, k as SceneElementKey)" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div class="row">
        <TButton label="保存脚本" variant="secondary" :loading="saving" @click="saveScript" />
        <span v-if="iv.genError.value" class="iv-err">{{ iv.genError.value }}</span>
        <span class="spacer"></span>
        <TButton label="下一步：分镜头确认" :loading="enteringPrep" @click="enterPrep" />
      </div>
      <WbPickProductDialog :visible="productPickVisible" @close="productPickVisible = false" @pick="onProductPick" />
    </div>

    <!-- ═══ 第 3 步：分镜头确认（HumanGate②：A-roll 状态 + 分镜帧生成/等待 + 九宫格确认同页）═══ -->
    <div v-else-if="step === 3" class="iv-panel">
      <div class="seg-field">
        <span class="lbl">A-roll 口播人像</span>
        <span class="muted">
          状态：{{ (record?.aroll as Record<string, unknown>)?.status || '未配置' }}
          （数字人=口播音频驱动 comfy-dh-001；实拍=上传整片；阶段 B 依赖口播音频先行——当前先跑分镜帧，A-roll 可后续补）
        </span>
      </div>
      <div class="seg-field">
        <span class="lbl">分镜帧（首尾帧）生成</span>
        <span v-if="iv.genPhase.value === 'running'" class="muted">生成中（GPU 远端，单镜约 3~7 分钟）… 已完成 {{ genResultSummary.done }} 镜、失败 {{ genResultSummary.failed }} 镜</span>
        <span v-else-if="iv.genPhase.value === 'failed'" class="iv-err">生成失败：{{ iv.genError.value }}</span>
        <span v-else-if="iv.genPhase.value === 'done'" class="muted">分镜帧已生成（成功 {{ genResultSummary.done }} 镜<template v-if="genResultSummary.failed">、失败 {{ genResultSummary.failed }} 镜</template>）——逐帧确认</span>
      </div>
      <div class="row">
        <TButton label="刷新脚本状态" variant="secondary" @click="reloadScript" />
      </div>
      <div class="iv-divider"></div>
      <div class="row between">
        <span class="sb-info">已确认 {{ framesReadyCount }} / {{ generateShotsCount }} 镜——全帧确认后解锁视频生成</span>
        <span class="muted">每帧可手动替换 / 单帧重生成（按当前脚本参数）；细化批注通道待服务端映射层端点</span>
      </div>
      <div class="iv-grid">
        <div v-for="(shot, i) in shots.filter((s) => s.source === 'generate')" :key="shot.gen?.name || i" class="iv-frame-card">
          <div class="row">
            <span class="seg-no">#{{ i + 1 }}</span>
            <span class="iv-badge" :class="framesBadgeText(shot) === '帧已确认' ? 'iv-badge--ai' : 'iv-badge--mat'">{{ framesBadgeText(shot) }}</span>
            <span class="muted iv-name">{{ shot.gen?.name }}</span>
          </div>
          <div class="iv-frames">
            <figure class="iv-fig">
              <img v-if="shot.gen?.first_frame" :src="frameUrl(shot.gen.name, 'first')" alt="首帧" loading="lazy" />
              <span v-else class="iv-fig-empty">首帧待生成</span>
              <figcaption>首帧</figcaption>
            </figure>
            <figure class="iv-fig">
              <img v-if="shot.gen?.last_frame" :src="frameUrl(shot.gen.name, 'last')" alt="尾帧" loading="lazy" />
              <span v-else class="iv-fig-empty">尾帧待生成</span>
              <figcaption>尾帧</figcaption>
            </figure>
          </div>
          <div class="row iv-frame-actions">
            <TButton label="确认本镜" size="small" :disabled="!canConfirmFrames(shot)" :loading="frameConfirming === shot.gen?.name" @click="confirmFrame(shots.indexOf(shot))" />
            <TButton label="换首帧" variant="secondary" size="small" @click="pickReplaceFrame(shots.indexOf(shot), 'first')" />
            <TButton label="换尾帧" variant="secondary" size="small" @click="pickReplaceFrame(shots.indexOf(shot), 'last')" />
            <TButton label="重生成" variant="secondary" size="small" :loading="regenFrame === shot.gen?.name" @click="regenerateFrame(shots.indexOf(shot))" />
          </div>
        </div>
      </div>
      <div class="row">
        <TButton label="下一步：视频生成" :disabled="!isStageDReady(shots) || !!startVideos" @click="startVideoGeneration" />
        <span v-if="iv.genError.value" class="iv-err">{{ iv.genError.value }}</span>
      </div>
      <input ref="frameInput" type="file" accept="image/png" class="iv-hide" @change="onReplaceFrame" />
    </div>

    <!-- ═══ 第 4 步：逐镜视频生成 ═══ -->
    <div v-else-if="step === 4" class="iv-panel">
      <div class="row between">
        <span class="sb-info">逐镜视频生成（以确认首尾帧为硬约束）</span>
        <span v-if="iv.genPhase.value === 'running'" class="muted">生成中（小时级，取决于镜数与保真档位）…</span>
        <span v-else-if="iv.genPhase.value === 'failed'" class="iv-err">失败：{{ iv.genError.value }}</span>
        <span v-else-if="iv.genPhase.value === 'done'" class="muted">完成（成功 {{ genResultSummary.done }} 镜<template v-if="genResultSummary.failed">、失败 {{ genResultSummary.failed }} 镜</template>）</span>
      </div>
      <div v-for="(shot, i) in shots" :key="i" class="seg-card">
        <div class="seg-head">
          <span class="seg-no">#{{ i + 1 }}</span>
          <span class="iv-badge" :class="shot.gen?.status === 'done' ? 'iv-badge--ai' : shot.gen?.status === 'failed' ? 'iv-badge--fail' : 'iv-badge--mat'">{{ genBadgeText(shot) }}</span>
          <span class="spacer"></span>
          <template v-if="shot.source === 'generate' && shot.gen?.status === 'failed'">
            <label class="seg-field head-field"><span class="lbl">降档</span>
              <select v-model="retryFidelity" class="input w110">
                <option v-for="f in iv.enums.value?.fidelity || []" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
            </label>
            <TButton label="重跑本镜" size="small" :loading="retrying === shot.gen?.name" @click="retryShot(i)" />
          </template>
        </div>
      </div>
      <div class="row">
        <TButton v-if="iv.genPhase.value === 'done' && doneCount === shots.length" label="进入草稿链" @click="step = 5" />
        <TButton label="刷新脚本状态" variant="secondary" @click="reloadScript" />
      </div>
    </div>

    <!-- ═══ 第 5 步：包装特效（HumanGate③·两段式，复用文案线特效包装→草稿链）═══ -->
    <div v-else-if="step === 5" class="iv-panel">
      <div class="seg-field">
        <span class="lbl">素材就绪情况</span>
        <span class="sb-info">共 {{ shots.length }} 镜：已就绪 {{ doneCount }} 镜（实拍绑定或 AI 生成完成）<template v-if="doneCount < shots.length">；仍有 {{ shots.length - doneCount }} 镜未就绪</template></span>
      </div>
      <div class="seg-field">
        <span class="lbl">触发草稿链（口播 + 特效包装 → 剪映草稿）</span>
        <span class="muted">与文案线产片交互一致：脚本已保存到服务端脚本库（{{ scriptId }}），在「文案混剪」工具的「选择分镜脚本」中选用该脚本，走既有 口播配音 → 特效包装 → 草稿/成片 流程；交付通道同样复用文案线（zip 草稿包 / 本地导出剪映）。</span>
      </div>
      <div class="row">
        <TButton label="进入交付说明" @click="step = 6" />
        <TButton label="刷新脚本状态" variant="secondary" @click="reloadScript" />
      </div>
    </div>

    <!-- ═══ 第 6 步：交付 ═══ -->
    <div v-else-if="step === 6" class="iv-panel">
      <div class="seg-field">
        <span class="lbl">交付（复用文案线双通道）</span>
        <span class="muted">
          ① 服务端 zip 草稿包——在文案混剪产片流程中导出（E-1.2 模式 A），下载后导入剪映；
          ② 客户端本地导出剪映——复用既有导出入口，草稿落本机剪映 drafts 目录；
          成片 mp4 同现有渲染通道。A-roll 底层轨 + B-roll 镜头轨 + 口播/音效/BGM 音轨由草稿轨道模型承载。
        </span>
      </div>
      <div class="row">
        <TButton label="重新走一遍（新视频）" variant="secondary" @click="resetFlow" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.iv-page { display: flex; flex-direction: column; gap: 12px; }
.iv-panel { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.spacer { flex: 1; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.sb-info { font-size: 12px; color: var(--muted-foreground); }
.sb-line { font-size: 12px; color: var(--foreground); line-height: 1.5; }
.iv-err { color: var(--danger, #e74c3c); font-size: 12px; }
.iv-warn { color: var(--warning, #f1c40f); font-size: 12px; font-weight: 600; }
.iv-link { color: var(--primary); cursor: pointer; text-decoration: underline; }
.iv-hide { display: none; }
.iv-filepick { display: flex; flex-direction: column; gap: 6px; }
.iv-divider { height: 1px; background: var(--border); margin: 8px 0; }
.iv-orig { color: var(--muted-foreground); font-style: italic; }
.iv-audio { height: 32px; }
.product-chip {
  display: inline-flex; align-items: center; padding: 1px 8px; font-size: 12px;
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-container));
  border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--foreground);
}
.product-clear {
  width: 18px; height: 18px; padding: 0; line-height: 1; font-size: 12px; flex: none;
  background: transparent; color: var(--muted-foreground); border: none; border-radius: 50%; cursor: pointer;
}
.product-clear:hover { color: var(--danger, #e74c3c); }

/* ── 工程统一拖入控件（2026-09-07 用户裁决：全程序拖拽上传区高度统一 min-height 120px；
     样式与 ImageMatting 等工具卡同构）── */
.dropzone {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 120px;
  padding: var(--space-6);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-container));
  border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border));
  border-radius: var(--radius-lg);
  color: var(--muted-foreground);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--easing-default),
    background var(--duration-fast) var(--easing-default);
}
.dropzone:hover,
.dropzone.is-active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-container));
}
.dropzone.has-file {
  border-style: solid;
  color: var(--foreground);
}
.dropzone__text { display: flex; flex-direction: column; gap: 2px; }
.dropzone__main { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--foreground); }
.dropzone__hint { font-size: 12px; color: var(--muted-foreground); }
.w70 { width: 90px; } .w60 { width: 64px; } .w90 { width: 110px; } .w110 { width: 130px; }

.iv-mode {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md);
  font-size: 12px; color: var(--muted-foreground); cursor: pointer;
}
.iv-mode.on { color: var(--primary); font-weight: 600; border-color: var(--primary); }

.seg-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md); }
.seg-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.seg-no { font-weight: 700; color: var(--primary); }
.seg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.seg-field.head-field { flex: 0 0 auto; flex-direction: row; align-items: center; gap: 6px; }
.seg-field .lbl { font-size: 12px; color: var(--muted-foreground); flex: none; }
.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }
.input:focus { border-color: var(--primary); }
.carry-textarea { height: auto; min-height: 72px; padding: 8px 10px; line-height: 1.6; font-family: inherit; resize: vertical; }
.carry-textarea--sm { min-height: 48px; }

.iv-badge { padding: 1px 8px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 600; }
.iv-badge--ai { color: #2ecc71; background: rgba(46, 204, 113, 0.12); }
.iv-badge--mat { color: var(--muted-foreground); background: var(--surface-container); }
.iv-badge--fail { color: #e74c3c; background: rgba(231, 76, 60, 0.12); }
.iv-gen { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;
  background: color-mix(in srgb, var(--primary) 4%, var(--card)); border: 1px dashed var(--border); border-radius: var(--radius-md); }

.iv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.iv-frame-card { display: flex; flex-direction: column; gap: 8px; padding: 10px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md); }
.iv-name { font-family: monospace; }
.iv-frames { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.iv-fig { display: flex; flex-direction: column; gap: 4px; margin: 0; }
.iv-fig img { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: var(--radius-sm);
  background: #101010; display: block; }
.iv-fig-empty { display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 9 / 16;
  background: #101010; color: var(--muted-foreground); font-size: 11px; border-radius: var(--radius-sm); }
.iv-fig figcaption { font-size: 11px; color: var(--muted-foreground); text-align: center; }
.iv-frame-actions { gap: 6px; }
</style>
