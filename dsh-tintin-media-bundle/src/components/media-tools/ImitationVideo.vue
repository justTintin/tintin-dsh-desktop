<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ImitationVideo.vue — 仿爆款视频向导（PRD-M-5 · V3.5 客户端 UI）
// 步骤结构=六步（2026-10-02/03 用户裁决定稿）：
//   1 视频拆解 → 2 生成脚本(HumanGate①) → 3 分镜头确认(HumanGate②)
//   → 4 视频生成 → 5 包装特效(HumanGate③) → 6 交付
// 第 1 步自持拆解交互，拆为 ImitationSourceStep 子组件（铁律 4 千行红线拆分，
// 逐符号纯搬迁）；本壳保留步序/脚本数据/第 2-6 步。
// 整体方案与文案混剪对应（§5.3 原则）：同卡片/步骤条/镜头卡视觉形态与交互惯例；
// 审核页不复用 CopywritingStoryboard（深耦合文案线 inject shell），按同形态自持数据。
// 编排=useImitationVideo（runner）；纯逻辑=imitationVideoLogic（可单测）。
// 待服务端契约项（显式占位不发明）：A-roll 数字人人物图上传通道、细化批注
// 映射层端点、草稿链直提（storyboard_montage 走文案线现有入口）。
// ═══════════════════════════════════════════════════════════════
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import VdStepBar from '@/components/media-tools/VdStepBar.vue'
import ImitationSourceStep from '@/components/media-tools/ImitationSourceStep.vue'
import WbPickProductDialog from '@/components/workbench/WbPickProductDialog.vue'
import VoiceoverPickerDialog from '@/components/media-tools/VoiceoverPickerDialog.vue'
import MaterialImagePickerDialog from '@/components/media-tools/MaterialImagePickerDialog.vue'
import VoiceCloneParamsDialog from '@/components/media-tools/VoiceCloneParamsDialog.vue'
import ImitationGenSteps from '@/components/media-tools/ImitationGenSteps.vue'
import ImitationMontageStep from './ImitationMontageStep.vue'
import ImitationFxStep from './ImitationFxStep.vue'
import { useImitationTts } from '@/composables/useImitationTts'
import { toFileUrl } from '@/utils/fileUrl'
import { readCacheDir } from '@/composables/useSettingsConfig'
import { joinPath } from '@/composables/copywritingMontage/context'
import { fmtDur } from '@/composables/copywritingMontageStep3VoiceLogic'
import TSelect from '@/components/common/TSelect.vue'
import { createMontageSharedRuntime } from '@/composables/copywritingMontage/context'
import { useImitationVideo } from '@/composables/useImitationVideo'
import { useImitationMontage } from '@/composables/useImitationMontage'
import type { PickerItem } from '@/composables/useWorkbenchPickers'
import { buildMediaServeUrl } from '@/composables/workbenchChatContext'
import { clientError } from '@/utils/clientLog'
import { API_PATHS } from '@/types/server-api'
import { voiceoverCandidatesFromResponse } from '@/composables/copywritingMontageStep2ConcatLogic'
import type { VoiceoverCandidate } from '@/composables/copywritingMontageStep2ConcatLogic'
import {
  SCENE_ELEMENT_KEYS,
  canConfirmFrames,
  clampDuration,
  enumLabel,
  framesBadgeText,
  genBadgeText,
  arollPreviewUrlFrom,
  isStageDReady,
  parseSixViewEntries,
  sixViewFileUrl,
  sceneElementOptions,
  shotsTotalDuration,
  storyboardGridUrlFrom,
  switchShotSource,
  type GenerateStage,
  type ImitationShot,
  type QualityReport,
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
const { ivPlatformOptions, ivPlatform } = iv
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
    void iv.loadStoryboardPack(scriptId.value)
    seedOrigAudio()
    seedOrigVoiceover()
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

/** 拆解文案固化（orig_voiceover，meta 透传保存）：首次载入把原片口播转写从
 *  voiceover 拷贝固化——此后 voiceover 即"脚本文案"（重新生成后绑定脚本），
 *  拆解原文永不被动覆盖（2026-10-02 用户裁决：两套文案分离） */
const origVoiceoverText = computed(() => {
  const imitate = (record.value?.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown> | undefined
  return String(imitate?.orig_voiceover ?? '')
})
function seedOrigVoiceover(): void {
  if (!record.value) return
  const imitate = { ...(((record.value.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown>) ?? {}) }
  // 拆解文案固化：首次载入把转写拷入 orig_voiceover（只读参考，永不被动覆盖）
  if ((imitate.orig_voiceover === undefined || imitate.orig_voiceover === '') && imitate.voiceover) {
    imitate.orig_voiceover = String(imitate.voiceover)
  }
  // 脚本文案默认空白（2026-10-03 用户裁决）：仅仿写完成挑选后才填充——
  // 初次进入时 voiceover=拆解转写，清空之；已仿写过的原样保留
  const orig = String(imitate.orig_voiceover ?? '')
  writeImitateMeta({ orig_voiceover: orig, voiceover: String(imitate.voiceover ?? '') === orig ? '' : String(imitate.voiceover ?? '') })
}

onMounted(() => {
  void iv.loadEnums()
  void ensureServerUrl()
  void ivTts.loadVoiceSamples()
  void iv.loadIvPlatforms()
})

// ── 产品选择（WbPickProductDialog 单选；写 products 随 PUT 保存，§5.1-2）──
const productPickVisible = ref(false)
/** 当前产品 chip 只认用户主动选择（2026-10-04 用户裁决：服务端拆解会从视频画面
 *  自动提取产品写入 products——那是"探测参考"不是用户选择，不得冒充当前产品）；
 *  选择事实持久化 meta.imitate.product_selected，随脚本保存/恢复。 */
function productPicked(): boolean {
  const imitate = (record.value?.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown> | undefined
  return imitate?.product_selected === true
}
function productLabel(): string {
  if (!productPicked()) return ''
  const p = (record.value?.products as Array<Record<string, unknown>> | undefined)?.[0]
  if (!p) return ''
  const parts = [p.brand, p.model || p.name].filter(Boolean).map(String).filter((v, i, a) => a.indexOf(v) === i)
  return parts.join(' / ') || String(p.name || p.brand || '')
}
function onProductPick(item: PickerItem): void {
  if (!record.value) return
  record.value.products = [{
    brand: String(item.brand || ''),
    model: String(item.model || ''),
    category: String(item.category || ''),
    name: String(item.name || item.model || ''),
  }]
  writeImitateMeta({ product_selected: true })
  // 选品即自动配图（2026-10-08 用户裁决：按产品从素材库自动配 ≤6 张显示）
  void autoMatchProductImages()
}
function clearScriptProduct(): void {
  if (!record.value) return
  record.value.products = []
  writeImitateMeta({ product_selected: false })
}

// ── 产品图（2026-10-03 用户裁决：第 2 步「选择产品图」→ 素材库图片弹窗（仅图片）；
//    选定 ≥1 张才能点「下一步：分镜头确认」——storyboard_generate 的
//    params.product_images 服务端必需（产品锚定，≤6 张），随任务直传）──
const { serverUrl: ivServerUrl } = createMontageSharedRuntime()
const productImgDlgOpen = ref(false)
/** 已选产品图（/material/serve 绝对 url 数组，存 meta.imitate 随脚本持久） */
/** meta.imitate 局部写入（product_images/product_selected 等选择态统一收口） */
function writeImitateMeta(patch: Record<string, unknown>): void {
  if (!record.value) return
  const meta = { ...((record.value.meta as Record<string, unknown>) ?? {}) }
  meta.imitate = { ...((meta.imitate as Record<string, unknown>) ?? {}), ...patch }
  record.value.meta = meta
}

const imitateMeta = computed<Record<string, unknown>>(() => {
  const meta = record.value?.meta as Record<string, unknown> | undefined
  return ((meta?.imitate as Record<string, unknown>) ?? {})
})
const productImages = computed<string[]>(() => { const a = imitateMeta.value.product_images; return Array.isArray(a) ? a.map(String).filter(Boolean) : [] })
const productImageIds = computed<string[]>(() => { const a = imitateMeta.value.product_image_ids; return Array.isArray(a) ? a.map(String).filter(Boolean) : [] })
/** 与 productImageIds 按序对齐的名称（弹窗选中池回显；不过滤保持对齐） */
const productImageNames = computed<string[]>(() => { const a = imitateMeta.value.product_image_names; return Array.isArray(a) ? a.map(String) : [] })
function onProductImagesConfirm(payload: { urls: string[]; names: string[]; keys: string[] }): void {
  writeImitateMeta({ product_images: payload.urls, product_image_names: payload.names, product_image_ids: payload.keys })
  productImgDlgOpen.value = false
  // 六视图（§11-51）：选品图确认即触发（显式带图提交——脚本选品留痕未保存也能跑）
  if (iv.scriptId.value) void iv.submitSixView(payload.urls)
}
function clearProductImages(): void {
  writeImitateMeta({ product_images: [], product_image_names: [], product_image_ids: [] })
}
/** 移除单张产品图（2026-10-08 用户裁决：缩略图右上角 × 删除） */
function removeProductImage(i: number): void {
  const urls = productImages.value.slice()
  const names = (Array.isArray(imitateMeta.value.product_image_names) ? imitateMeta.value.product_image_names.map(String) : []).slice()
  const ids = productImageIds.value.slice()
  urls.splice(i, 1); names.splice(i, 1); ids.splice(i, 1)
  writeImitateMeta({ product_images: urls, product_image_names: names, product_image_ids: ids })
}
/** 白底图检测（2026-10-08 用户裁决：白底优先）：缩到 24px 采样四角像素，
 *  ≥3 角近白（RGB≥240）判白底；跨域污染/加载失败一律按非白底（只降不加） */
function isWhiteBgImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const done = (v: boolean) => { if (!settled) { settled = true; window.clearTimeout(timer); resolve(v) } }
    const timer = window.setTimeout(() => done(false), 8000)
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        const s = 24
        c.width = s; c.height = s
        const ctx = c.getContext('2d')
        if (!ctx) return done(false)
        ctx.drawImage(img, 0, 0, s, s)
        const corners: Array<[number, number]> = [[1, 1], [s - 2, 1], [1, s - 2], [s - 2, s - 2]]
        let white = 0
        for (const [x, y] of corners) {
          const d = ctx.getImageData(x, y, 1, 1).data
          if (d[0] >= 240 && d[1] >= 240 && d[2] >= 240) white++
        }
        done(white >= 3)
      } catch { done(false) }
    }
    img.onerror = () => done(false)
    img.src = url
  })
}
/** 选品自动配图（2026-10-08 用户裁决·二改：走服务端向量语义搜索——产品图在向量库
 *  （POST /material/search：WeMM 编码查询文本→pgvector 余弦，实测 G304 查询全中纯品图），
 *  查询=产品标签+「产品图 白底」语义偏置，top 12 → 白底像素重排（CORS 缺失静默跳过）→ 取 6；
 *  零结果/失败不自动配，仍可「选择产品图」手动选） */
const autoMatchBusy = ref(false)
async function autoMatchProductImages(): Promise<void> {
  if (!record.value || autoMatchBusy.value) return
  const label = productLabel()
  if (!label) return
  autoMatchBusy.value = true
  try {
    const res = (await window.tintin.server.post('/material/search', {
      query: `${label} 产品图 白底`,
      top_k: 12,
    })) as { results?: Array<Record<string, unknown>> } | null
    const keyOf = (it: Record<string, unknown>) => String(it.id ?? it.material_id ?? '')
    const items = (res?.results || []).filter((it) => keyOf(it) && String(it.media_type || 'image') === 'image')
    if (!items.length) return
    // 白底像素重排（白底优先；跨域污染/采样失败=不加分，向量序原样保持）
    const withWhite = await Promise.all(items.map(async (it) => ({
      it,
      white: await isWhiteBgImage(buildMediaServeUrl(ivServerUrl.value, keyOf(it))),
    })))
    const picked = withWhite
      .sort((a, b) => (b.white ? 1 : 0) - (a.white ? 1 : 0))
      .slice(0, 6)
    writeImitateMeta({
      product_images: picked.map((x) => buildMediaServeUrl(ivServerUrl.value, keyOf(x.it))),
      product_image_names: picked.map((x) => String(x.it.filename || x.it.name || '')),
      product_image_ids: picked.map((x) => keyOf(x.it)),
    })
  } catch (e) {
    clientError('imitation-video', '产品图自动匹配失败', e)
  } finally {
    autoMatchBusy.value = false
  }
}
// ── A-roll 阶段③（数字人=人物图+口播音频/实拍=素材 id；aroll 块先 PUT 配置再提任务）──
const arollBusy = ref('')
const arollConfig = computed(() => { const a = (record.value?.aroll as Record<string, unknown> | undefined) || {}; return { source: String(a.source || ''), imageMaterialId: String(a.image_material_id || ''), materialId: String(a.material_id || '') } })
/** A-roll 产物预览（material_id 回填后 /material/serve 流式）；九宫图总览（v4.7 meta 引用） */
const arollPreviewUrl = computed(() => toAbsolute(arollPreviewUrlFrom(arollConfig.value.materialId))); const storyboardGridUrl = computed(() => { const u = storyboardGridUrlFrom(record.value?.meta, scriptId.value); return u ? toAbsolute(`${u}?v=${Number(record.value?.version) || 0}`) : '' })
async function generateAroll(config: { source: string; imageMaterialId: string; materialId: string }): Promise<void> {
  if (arollBusy.value || !record.value) return
  const bad = !record.value.voice_audio_id ? '请先在第 2 步「生成口播配音」并绑定口播音频（A-roll 依赖口播音频先行）。'
    : config.source === 'digital_human' && !config.imageMaterialId.trim() ? '数字人方式需要先填「人物图素材 ID」（素材库图片）。'
    : config.source === 'material' && !config.materialId.trim() ? '实拍方式需要填「A-roll 素材 ID」（已入库素材）。' : ''
  if (bad) { notify('无法生成 A-roll', bad); return }
  arollBusy.value = 'aroll'
  try {
    const a = (record.value.aroll as Record<string, unknown>) ?? {}
    record.value.aroll = { ...a, source: config.source, image_material_id: Number(config.imageMaterialId) || 0, material_id: Number(config.materialId) || 0 }
    if (!(await saveScript())) return
    const ok = await iv.submitGenerate({
      scriptId: scriptId.value, stage: 'aroll',
      arollMaterialId: config.source === 'material' ? Number(config.materialId) || undefined : undefined,
      arollImage: config.source === 'digital_human' && config.imageMaterialId.trim() ? `material://${config.imageMaterialId.trim()}` : undefined,
    }, shots.value)
    if (ok) notify('A-roll 已提交', '素材生成任务已提交（stage=aroll），完成后可重新生成或继续后续阶段。')
  } catch (e) {
    clientError('imitation-video', 'A-roll 生成提交失败', e)
    notify('提交失败', (e as Error).message)
  } finally {
    arollBusy.value = ''
  }
}

/** 时长展示格式化：一位小数、去尾零（浮点噪声修复 2026-10-03） */

/** 整体提示词（meta.prompt_en，服务端映射层自动生成：从逐镜 scene 枚举统计主导
 *  风格组装整片创作方向；随脚本保存，只读展示为"整体方向卡"——2026-10-03 实证） */
const overallPromptEn = computed(() => {
  const meta = record.value?.meta as Record<string, unknown> | undefined
  const v = meta?.prompt_en
  return typeof v === 'string' ? v.trim() : ''
})

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
const regenWarn = ref('')
/** 口播语速基准（字/秒。2026-10-07 服务端统一口径=6 并已上线（探针 85 字/14.2s
 *  实证），客户端 VOICEOVER_CPS 同为 6——弹窗（服务端 duration_s）与标签同口径） */
const VOICEOVER_CPS = 6

/** 脚本文案字数/口播时长（2026-10-06 用户裁决：标签行右侧显示；随编辑实时，语速基准同上） */
const voiceoverChars = computed(() => voiceoverText.value.replace(/\s/g, '').length)
const voiceoverEstSec = computed(() => Math.round(voiceoverChars.value / VOICEOVER_CPS))

// ── 十稿挑选（2026-10-03 用户裁决：仿写文案对齐文案混剪——返回约 10 种写法，
//    默认选中第一种，点卡片切换、确定后写入脚本文案框；单稿形态免弹窗直采）──
const voiceoverCandidates = ref<VoiceoverCandidate[]>([])
const voiceoverFailedFormulas = ref<string[]>([])
const voiceoverDlgOpen = ref(false)
const voiceoverSelectedIdx = ref(0)
function closeVoiceoverDlg(): void { voiceoverDlgOpen.value = false }
function confirmVoiceoverCandidate(): void {
  const c = voiceoverCandidates.value[voiceoverSelectedIdx.value]
  if (c) adoptVoiceoverText(c.text)
}

/** 采用文案：写主稿+调 rewrite-visuals 重写画面（旁白预填可编辑）；偏差>30% 提示 */
async function adoptVoiceoverText(text: string): Promise<void> {
  voiceoverDlgOpen.value = false
  voiceoverText.value = text
  // 旧口播配音随旧文案作废（2026-10-08 用户裁决：重新仿写后原配音不可用）——
  // 清结果行+解绑 voice_audio_id（A-roll 依赖口播音频，须按新文案重出后再绑定）
  const hadAudio = !!ttsAudioUrl.value || !!record.value?.voice_audio_id
  if (hadAudio && record.value) {
    ttsAudioUrl.value = ''
    ttsSampleLabel.value = ''
    ttsDurSec.value = 0
    ttsBindNote.value = ''
    record.value.voice_audio_id = 0
    record.value.voice_dur_sec = 0
  }
  const dur = shotsTotalDuration(shots.value)
  const targetChars = Math.round(dur * VOICEOVER_CPS)
  const chars = text.replace(/\s/g, '').length
  if (targetChars > 0 && Math.abs(chars - targetChars) / targetChars > 0.3) {
    regenWarn.value = `生成了 ${chars} 字，按 ${Math.round(dur)} 秒口播应约 ${targetChars} 字——偏差偏大，建议重试或直接编辑`
    clientError('imitation-video', regenWarn.value, { chars, targetChars, dur })
  }
  // 主稿先保存 → ①铺旁白（distribute-voiceover 按镜切分）→ ②重写画面/场景（rewrite-visuals）→ 回读
  if (!(await saveScript())) return
  await distributeFromMaster()
  await rewriteFromMaster()
  if (hadAudio) {
    const prev = distributeNote.value ? distributeNote.value + '；' : ''
    distributeNote.value = prev + '旧口播配音已随旧文案失效解绑——请重新「生成口播配音」（旧音频仍留在音频库）'
  }
}

async function regenerateVoiceover(): Promise<void> {
  const p = (record.value?.products as Array<Record<string, unknown>> | undefined)?.[0]
  if (!p) {
    regenError.value = '请先「选择产品」——文案按产品信息重写（product_desc 必填）'
    return
  }
  regenBusy.value = true
  regenError.value = ''
  regenWarn.value = ''
  try {
    const productDesc = [p.brand, p.model || p.name, p.category].filter(Boolean).map(String).join(' / ')
    const dur = shotsTotalDuration(shots.value)
    const targetChars = Math.round(dur * VOICEOVER_CPS)
    const resp = (await window.tintin.server.post(API_PATHS.copywriting.voiceover, {
      product_desc: productDesc,
      duration_s: dur,
      platform: ivPlatform.value,
      hint: `电商口播，节奏贴近原片，句子完整不拆行；全文约 ${targetChars} 字（对应 ${Math.round(dur)} 秒口播），口语化带货风格`,
    })) as Record<string, unknown> | null
    // 十稿全量（formula 缺省=约 10 种写法）/单稿双形态归一；空响应按实得键名报错
    const parsed = voiceoverCandidatesFromResponse(resp)
    if (!parsed.candidates.length) {
      const keys = resp ? Object.keys(resp).join(',') : 'null'
      regenError.value = `文案生成响应无可用文稿（实得字段：${keys}）`
      clientError('imitation-video', regenError.value, { resp })
      return
    }
    if (parsed.single || parsed.candidates.length === 1) {
      adoptVoiceoverText(parsed.candidates[0]!.text)
      return
    }
    voiceoverCandidates.value = parsed.candidates
    voiceoverFailedFormulas.value = parsed.failedFormulas
    voiceoverSelectedIdx.value = 0
    voiceoverDlgOpen.value = true
  } catch (e) {
    regenError.value = `文案生成失败：${(e as Error).message}`
    clientError('imitation-video', regenError.value, e)
  } finally {
    regenBusy.value = false
  }
}

// ── 口播配音（2026-10-03 用户裁决：功能点与文案混剪 Step3 一样实现——参考声音
//    下拉/试听/设置声音克隆（参数随请求）/上传新样本/TTS resp json+600s 超时，
//    状态与调用收口 useImitationTts）──
const ivTts = useImitationTts({ getTargetDuration: () => shotsTotalDuration(shots.value), getScriptId: () => scriptId.value, saveScript, reloadScript })
const {
  TTS_ENGINE_OPTIONS, TTS_EMO_OPTIONS,
  ttsEngineSel, voiceSamples, voiceSamplesError, selectedSampleKey, sampleOptions, samplePreviewUrl,
  loadVoiceSamples,
  ttsFactor, ttsEmoText, ttsEmoAlpha, qwen3Speaker, qwen3Instruct, qwen3Voices, qwen3VoicesLoading,
  cloneParamsDlg, openCloneParams, closeCloneParams, saveCloneParams,
  distributeNote, distributeBusy, distributeFromMaster, rewriteFromMaster,
} = ivTts

const ttsBusy = ref(false)
const ttsError = ref('')
const ttsAudioUrl = ref('')
const ttsBindNote = ref('')

const ttsSampleLabel = ref('')   // 结果行名称=所选参考声音（对齐文案混剪结果行"名称+播放条+时长"）
const ttsDurSec = ref(0)         // 播放器 loadedmetadata 采集的实际时长
const ttsDurText = computed(() => (ttsDurSec.value > 0 ? fmtDur(ttsDurSec.value) : '--:--'))
function onTtsMeta(e: Event): void {
  const d = (e.target as HTMLAudioElement).duration
  ttsDurSec.value = Number.isFinite(d) ? d : 0
}
async function generateVoiceAudio(): Promise<void> {
  const text = voiceoverText.value.trim()
  if (!text) {
    ttsError.value = '口播文案为空：先拆解或「重新生成文案」'
    return
  }
  // 2026-10-06 用户裁决：未选样本直接提示、不发请求（Base 未选样本选项已退役；
  // voxcpm 无参考音频服务端必 400）
  if (!selectedSampleKey.value) {
    ttsError.value = '没有可用的参考声音样本——请先在「参考声音」下拉选择样本（样本在声音克隆页上传维护）'
    return
  }
  ttsBusy.value = true
  ttsError.value = ''
  try {
    // 2026-10-06 用户裁决（推翻 1003「单条 TTS+URL 试听」旧口径）：与文案混剪声音克隆
    // 完全同通道（voiceCloneBatch）——主进程克隆+服务端 whisperx 对齐，产物=wav +
    // <wav>.timing.json + <wav>.aligned.srt（字幕单一来源=服务端，fx 导出链恰在此查
    // sidecar）。outWavPath=口播库恢复同款稳定路径 voice_script_<scriptId>.wav：
    // fx 面板装载后 sidecar 必在 wav 旁边，字幕轨不再缺失。
    const cacheDir = await readCacheDir()
    if (!cacheDir) throw new Error('本地缓存目录不可用，请重启应用后重试')
    const stableId = (scriptId.value || 'tmp').replace(/[^\w.-]/g, '_')
    const outWavPath = joinPath(cacheDir, 'copy-montage', 'voice', `voice_script_${stableId}.wav`)
    const key = 'iv_voice_1'
    const res = await window.tintin.server.voiceCloneBatch({
      tasks: [{ rowIdx: 0, text, videoPath: key, outWavPath }],
      refAudioPath: '',
      apiUrl: toAbsolute(API_PATHS.tts),
      speedMin: 0.9,
      speedMax: 1.2,
      sampleId: Number(selectedSampleKey.value) || 0,
      refAudioUrl: voiceSamples.value.find((s) => String(s.id) === selectedSampleKey.value)?.url || '',
      engine: ttsEngineSel.value,
      ttsParams: {
        durationFactor: ttsFactor.value,
        emoText: ttsEmoText.value,
        emoAlpha: ttsEmoAlpha.value,
        speaker: qwen3Speaker.value,
        instruct: qwen3Instruct.value,
      },
    })
    if (!res) throw new Error('主进程不可达')
    if ('error' in res) throw new Error(res.error)
    const wav = res.results[key]
    if (!wav) throw new Error('克隆完成但响应缺 wav 路径')
    // 试听=本地 wav 直播（fileUrl）；时长用克隆产物实测
    ttsAudioUrl.value = toFileUrl(wav)
    ttsSampleLabel.value = sampleOptions.value.find((o) => o.value === selectedSampleKey.value)?.label || '口播配音'
    ttsDurSec.value = Number(res.durations[key]) || 0
    // 入库绑定（不变：上传音频库→脚本带 voice_audio_id，草稿链按 id 恢复口播）
    try {
      const up = (await window.tintin.server.audioLibraryUpload({ filePath: wav, category: '口播' })) as Record<string, unknown> | null
      const audioId = Number(up?.id)
      if (Number.isInteger(audioId) && audioId > 0 && record.value) {
        record.value.voice_audio_id = audioId
        record.value.voice_dur_sec = ttsDurSec.value || shotsTotalDuration(shots.value)
        await saveScript()
        ttsBindNote.value = `配音已入库（audio_id=${audioId}）并绑定脚本口播轨`
      } else {
        const keys = up ? Object.keys(up).join(',') : 'null'
        ttsBindNote.value = `配音已生成（可试听）；入库响应缺 id（实得字段：${keys}），绑定待重试`
        clientError('imitation-video', `音频入库响应缺 id（实得字段：${keys}）`, { up })
      }
    } catch (bindErr) {
      // 入库失败不阻断试听——文案仍可继续；绑定可重试（如实提示，不静默）
      ttsBindNote.value = `配音已生成（可试听）；入库绑定失败：${(bindErr as Error).message}——可重新生成重试`
      clientError('imitation-video', ttsBindNote.value, bindErr)
    }
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
  montage.stopPolling()
  montage.montagePhase.value = ''
  montage.montageTaskId.value = ''
  montage.montageError.value = ''
  montage.exportNote.value = ''
  record.value = null
  iv.part1Phase.value = ''
  iv.part1Note.value = ''
  iv.part1Error.value = ''
  iv.genPhase.value = ''
  iv.genError.value = ''
  iv.genResult.value = {}
  step.value = 1 // 第 1 步子组件随 v-if 重建，源选择自动清空
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
    ratio: r.ratio ?? '',
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
/** 方案 A（2026-10-06 用户裁决）：口播配音/文案采纳链未完成时禁入第 3 步——
 *  完成回调会自动保存脚本，PUT 落进九宫粗稿任务的提交-执行窗口=服务端判「整体编辑」作废 */
const enterPrepBlocked = computed(() => !productImages.value.length || !!ttsBusy.value || !!distributeBusy.value)
const enterPrepTitle = computed(() => {
  if (ttsBusy.value) return '口播配音生成中——等配音完成（完成后自动入库绑定）再进入下一步'
  if (distributeBusy.value) return '正在按新文案铺旁白/重写画面——等完成后再进入下一步'
  if (!productImages.value.length) return '请先「选择产品图」——生成需要至少 1 张产品图（产品锚定必需）'
  return ''
})
async function enterPrep(): Promise<void> {
  // 已有进行中的生成任务 → 直接回第 3 步重新显示进度/状态（不重复提交；轮询在组合函数层持续）
  if (iv.genPhase.value === 'running' && iv.genTaskId.value) { step.value = 3; return }
  // 九宫粗稿已生成/已确认 → 不重复提交，直接进第 3 步显示/确认
  const genShots = shots.value.filter((s) => s.source === 'generate')
  if (genShots.length > 0 && genShots.every((s) => s.gen?.draft_status === 'generated' || s.gen?.draft_status === 'confirmed')) { step.value = 3; return }
  if (!(await saveScript())) return
  enteringPrep.value = true
  // v4.3 闸门①：提交九宫分镜粗稿（storyboard 低清档），整体确认后才放行高清精稿
  const ok = await iv.submitGenerate({ scriptId: scriptId.value, stage: 'storyboard', productImages: productImages.value }, shots.value)
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

// Part1（视频拆解）完成回读（2026-10-03 修复：轮询置 done 拿到 scriptId 后无人回读
// 脚本，record/shots 恒空 → UI 无运行提示也无结果，用户只见"过一会没返回"）；
// 全手动步进裁决不变——回读后停留第 1 步展示拆解脚本，由用户点「下一步」。
watch(() => iv.part1Phase.value, async (ph) => {
  if (ph === 'done' && iv.scriptId.value) await reloadScript()
})

const genResultSummary = computed(() => {
  const r = iv.genResult.value || {}
  const done = Array.isArray(r.shots_done) ? (r.shots_done as unknown[]).length : 0
  const failed = Array.isArray(r.shots_failed) ? (r.shots_failed as unknown[]).length : 0
  return { done, failed }
})

// ── 第 4 步：分镜图确认（HumanGate②·九宫格视图）──
// 帧地址带脚本 version 击穿 webview 缓存（2026-10-07 服务端重生成换种子=同 URL 不同图常态）
function frameUrl(name: unknown, which: 'first' | 'last' | 'draft_first' | 'draft_last'): string {
  return toAbsolute(`/api/storyboard/scripts/${scriptId.value}/shots/${encodeURIComponent(String(name))}/frames/${which}?v=${Number(record.value?.version) || 0}`)
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
  await iv.submitGenerate({ scriptId: scriptId.value, stage: 'frames', onlyShots: [String(name)], productImages: productImages.value }, shots.value)
  regenFrame.value = ''
}

const framesReadyCount = computed(() => shots.value.filter((s) => s.source === 'generate' && s.gen?.frames_status === 'confirmed').length)
const generateShotsCount = computed(() => shots.value.filter((s) => s.source === 'generate').length)

// ── 质量徽标数据源 + 坏例标注（批1 M0/D7：meta.quality_report 随 reloadScript 刷新；
//    badcase 写 shot 根级 extra（extra=allow 透传往返）随 PUT 持久，服务端消费待契约）──
const qualityReport = computed(() => ((record.value?.meta as Record<string, unknown> | undefined)?.quality_report ?? null) as QualityReport | null)
async function toggleBadcase(i: number): Promise<void> {
  const cur = shots.value[i]
  if (!cur) return
  shots.value[i] = { ...cur, badcase: !cur.badcase }
  await saveScript()
}

// ── 六视图（§11-51）：展示源=轮询结果优先，缺省回落脚本 meta.six_view；
//    重出入口供阶段①卡「重新生成六视图」（按当前选品图重出）──
const sixViewDisplay = computed(() => {
  const raw = iv.sixViews.value.length ? iv.sixViews.value : parseSixViewEntries((record.value?.meta as Record<string, unknown> | undefined)?.six_view)
  return raw.map((e) => ({ view: e.view, url: toAbsolute(e.url || sixViewFileUrl(scriptId.value, e.view)) }))
})
/** 删除六视图（两段式确认：首点武装、再点执行、3 秒自动解除；不可逆，整组可重出） */
const armedDeleteView = ref('')
let armedDeleteTimer: ReturnType<typeof setTimeout> | null = null
function onDeleteSixView(view: string): void {
  if (iv.sixViewPhase.value === 'running') return
  if (armedDeleteView.value !== view) {
    armedDeleteView.value = view
    if (armedDeleteTimer) clearTimeout(armedDeleteTimer)
    armedDeleteTimer = setTimeout(() => { if (armedDeleteView.value === view) armedDeleteView.value = '' }, 3000)
    return
  }
  armedDeleteView.value = ''
  void iv.deleteSixView(view).then((ok) => {
    if (!ok) return
    notify('六视图已删除', `${view} 已物理删除——videos 参考自动少一张；整组重出请点「生成六视图」（约 3 分钟）`)
    if (!iv.sixViews.value.length) void reloadScript()
  })
}
async function regenSixView(): Promise<void> {
  await iv.submitSixView(productImages.value)
}
/** 六视图就绪=done 且有图——第 3→4 步闸门（§11-51：videos 阶段服务端消费六视图） */
const sixViewReady = computed(() => iv.sixViewPhase.value === 'done' && iv.sixViews.value.length > 0)

/** 第 4 步阶段①「重新生成九宫格图」：重提 storyboard 任务（全部镜头重生成，带产品图） */
async function regenStoryboard(): Promise<void> {
  if (iv.genPhase.value === 'running' && iv.genTaskId.value) return
  if (!(await saveScript())) return
  await iv.submitGenerate({ scriptId: scriptId.value, stage: 'storyboard', productImages: productImages.value }, shots.value)
}
function shotVideoUrl(materialId: unknown): string { const mid = Number(materialId); return Number.isInteger(mid) && mid > 0 ? toAbsolute(`/material/serve?material_id=${mid}`) : '' }
const montageStepProps = computed(() => ({ step: step.value, scriptId: scriptId.value, phase: montage.montagePhase.value, progress: montage.montageProgress.value, elapsedSec: montage.montageElapsedSec.value, message: montage.montageMessage.value, error: montage.montageError.value, exporting: montage.exporting.value, exportStage: montage.exportStage.value, exportNote: montage.exportNote.value, transition: cfgTransition.value, bgmName: cfgBgmName.value, result: montage.montageResult.value }))
const startVideos = ref('')
/** 轻提示（横幅式 toast 缺位——用与文案混剪一致的临时提示条替代；显式不静默） */
const notifyMsg = ref('')
function notify(title: string, detail: string): void {
  notifyMsg.value = `${title}：${detail}`
  window.setTimeout(() => { if (notifyMsg.value === `${title}：${detail}`) notifyMsg.value = '' }, 6000)
}
// 第 5 步特效配置（转场/BGM——写入脚本随草稿链消费）
const cfgTransition = ref('random')
const cfgBgmName = ref('')
watch(() => [step.value, record.value?.transition, record.value?.bgm_type] as const, ([st, tr, bgm]) => {
  if (st !== 5) return
  if (typeof tr === 'string' && tr) cfgTransition.value = tr
  cfgBgmName.value = typeof bgm === 'string' ? bgm : ''
})
function onMontageConfig(patch: { transition?: string; bgmName?: string }): void {
  if (!record.value) return
  if (patch.transition !== undefined) record.value.transition = patch.transition
  if (patch.bgmName !== undefined) record.value.bgm_type = patch.bgmName
  void saveScript()
}
async function startMontage(): Promise<void> {
  if (!record.value) return
  record.value.transition = cfgTransition.value
  record.value.bgm_type = cfgBgmName.value
  if (!(await saveScript())) return
  await montage.trigger(scriptId.value, shots.value)
}
async function downloadMontageVideo(): Promise<void> {
  const path = String(montage.montageResult.value?.video_path || '')
  if (!path) return
  const savePath = await window.tintin?.dialog?.saveFile?.({ title: '下载成片', defaultPath: 'imitation_final.mp4', filters: [{ name: '视频文件', extensions: ['mp4'] }] })
  if (!savePath) return
  montage.exporting.value = true
  montage.exportStage.value = '下载中...'
  try {
    const res = (await window.tintin.server.downloadResult(path, savePath)) as { error?: string } | null
    montage.exportNote.value = res && res.error ? `下载失败：${res.error}` : `已下载：${savePath}`
  } catch (e) {
    montage.exportNote.value = `下载失败：${(e as Error).message}`
  } finally {
    montage.exporting.value = false
  }
}
// 第 5/6 步：特效包装草稿链 + 导出（2026-10-06 用户裁决：特效包装实体化、导出拆第 6 步）
const montage = useImitationMontage()
// videos 运行期每 10s 回读——逐镜完成徽标/计数实时（2026-10-06 裁决）
let liveReloadTimer: ReturnType<typeof setInterval> | undefined
let cgTimer: ReturnType<typeof setInterval> | undefined
/** comfygen 逐镜流式计数（/comfygen/jobs 滚动窗口——最新 script 模式 job 的 shots_done/total） */
const cgShots = ref<{ done: number; total: number } | null>(null)
async function pollComfygenShots(): Promise<void> {
  try {
    const jobs = (await window.tintin.server.get('/comfygen/jobs')) as Array<Record<string, unknown>> | null
    const ids = iv.genJobIds.value
    const scriptJobs = (jobs || [])
      .filter((j) => j.shots_total !== undefined && (ids.length ? ids.includes(String(j.job_id)) : j.mode === 'script'))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    if (!scriptJobs.length) { cgShots.value = null; return }
    let done = 0
    let total = 0
    for (const j of scriptJobs) {
      done += Number(j.shots_done) || 0
      total += Number(j.shots_total) || 0
    }
    cgShots.value = { done, total }
  } catch { cgShots.value = null }
}
watch(() => [iv.genPhase.value, iv.genStage.value] as const, ([ph, st]) => {
  if (ph === 'running' && st === 'videos') {
    liveReloadTimer ??= setInterval(() => { void reloadScript(); void pollComfygenShots() }, 10000)
    void pollComfygenShots()
    cgTimer ??= setInterval(() => { void pollComfygenShots() }, 4000)
  } else {
    if (liveReloadTimer) { clearInterval(liveReloadTimer); liveReloadTimer = undefined }
    if (cgTimer) { clearInterval(cgTimer); cgTimer = undefined }
  }
}, { immediate: true })
onBeforeUnmount(() => {
  if (liveReloadTimer) clearInterval(liveReloadTimer)
  if (cgTimer) clearInterval(cgTimer)
})
async function startVideoGeneration(): Promise<void> {
  if (iv.genPhase.value === 'running' && iv.genTaskId.value) { step.value = 4; return }
  // 全部镜头已就绪（实拍绑定或 AI 生成完成）→ 不重提任务直接展示（2026-10-06 用户报障：
  // 完成后返回再进入=整脚本重跑一遍 GPU 小时级任务；原守卫只拦运行中、不拦已完成）
  if (shots.value.length > 0 && doneCount.value === shots.value.length) { step.value = 4; return }
  startVideos.value = '1'
  if (await iv.submitGenerate({ scriptId: scriptId.value, stage: 'videos', productImages: productImages.value }, shots.value)) step.value = 4
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

// ── 闸门① 九宫分镜粗稿（v4.3：draft_status confirmed 后解锁逐镜视频）──
const draftConfirmed = computed(() => { const g = shots.value.filter((s) => s.source === 'generate'); return g.length > 0 && g.every((s) => s.gen?.draft_status === 'confirmed') })
const draftsReady = computed(() => { const g = shots.value.filter((s) => s.source === 'generate'); return g.length > 0 && g.every((s) => s.gen?.draft_status === 'generated' || s.gen?.draft_status === 'confirmed') })
const canConfirmDraft = computed(() => draftsReady.value && !draftConfirmed.value)
/** 素材生成阶段任务统一提交（storyboard→步3/frames→步3/videos→步4；进行中不重复提交） */
async function submitStage(stage: 'storyboard' | 'frames' | 'videos'): Promise<void> {
  if (iv.genPhase.value === 'running' && iv.genTaskId.value) { step.value = stage === 'videos' ? 4 : 3; return }
  startVideos.value = '1'
  try {
    await iv.submitGenerate({ scriptId: scriptId.value, stage, productImages: productImages.value }, shots.value)
  } finally {
    // 忙标志必须复位（恒 '1' 曾把下一步永久禁用——2026-10-06 报障）
    startVideos.value = ''
  }
}
async function confirmDraftAndSubmitVideos(): Promise<void> {
  if (!(await iv.confirmDraft(scriptId.value))) { notify('确认失败', '九宫粗稿确认请求未成功，请重试'); return }
  await reloadScript()
  await startFramesSubmission()
}
async function startFramesSubmission(): Promise<void> { await submitStage('frames') }
async function startVideosSubmission(): Promise<void> { await submitStage('videos') }

// 九宫已确认且精稿未生成 → 自动续跑高清精稿（重入/刷新恢复；已完成不重触发）
watch(() => [draftConfirmed.value, framesReadyCount.value, iv.genPhase.value, iv.genTaskId.value] as const,
  ([confirmed, ready, phase, taskId]) => {
    if (confirmed && ready === 0 && phase !== 'running' && !taskId) void startFramesSubmission()
  })
</script>

<template>
  <div class="iv-page">
    <VdStepBar :step="step - 1" :steps="STEPS" />
    <!-- 换帧共享隐藏 input（第 3 步「换首帧/换尾帧」经 pickReplaceFrame 触发） -->
    <input ref="frameInput" type="file" accept="image/png" class="iv-hide" @change="onReplaceFrame" />

    <!-- ═══ 第 1 步：视频拆解（自持子组件，铁律 4 拆分；完成回读由父级 watch 承担）═══ -->
    <ImitationSourceStep v-if="step === 1" :iv="iv" :shots="shots" :overall-prompt-en="overallPromptEn" @next="step = 2" />

    <!-- ═══ 第 2 步：生成脚本（原片脚本为模板：替换文字=新产品文案 + 新文案口播配音；HumanGate①；单脚本全步共用）═══ -->
    <div v-else-if="step === 2 && record && shots.length" class="iv-panel">
      <div class="row between">
        <span class="sb-info">原片脚本（模板）：共 {{ shots.length }} 镜 ｜ 总时长 {{ shotsTotalDuration(shots) }} 秒 ｜ 脚本 {{ scriptId }}</span>
        <span class="muted">本步生成新视频脚本：替换文案文字 + 新文案口播配音；AI/实拍逐镜定稿</span>
      </div>
      <div v-if="timelineWarn" class="iv-warn">{{ timelineWarn }}</div>

      <!-- 两套文案（2026-10-02 用户裁决）：上=拆解文案（原片口播转写，只读、不绑定脚本）；
           下=脚本文案（重新生成后绑定脚本，配音/逐镜以此为准） -->
      <div class="seg-field">
        <span class="lbl">拆解文案（原片口播转写——只读参考，不绑定脚本）</span>
        <textarea :value="origVoiceoverText" readonly rows="3" class="input carry-textarea iv-orig" placeholder="（原片无口播或拆解未含转写）"></textarea>
      </div>
      <div class="seg-field">
        <div class="row">
          <span class="lbl">脚本文案（重新生成后绑定脚本，可编辑——配音与逐镜替换以此为准）</span>
          <!-- 字数/口播时长（2026-10-06 用户裁决：确认仿写方案后在标签行右侧显示；随编辑实时） -->
          <span v-if="voiceoverText.trim()" class="muted">共 {{ voiceoverChars }} 字 ｜ 约 {{ voiceoverEstSec }} 秒</span>
        </div>
        <textarea v-model="voiceoverText" rows="4" class="input carry-textarea" placeholder="选择产品 →「重新生成文案」按新产品重写（生成后才与脚本绑定），也可直接编辑"></textarea>
      </div>
      <div class="row">
        <TButton label="选择产品" @click="productPickVisible = true" />
        <span v-if="productLabel()" class="product-chip" title="当前产品（文案按此重写，产品图随脚本供生成）">当前产品：{{ productLabel() }}</span>
        <button v-if="productLabel()" class="product-clear" title="清除已选产品" @click="clearScriptProduct">×</button>
        <!-- 平台下拉（2026-10-03 用户裁决：仿写文案对齐文案混剪——字典 GET /copywriting/platforms，
             platform 直传服务端，平台口播风格指引由服务端织入；十稿挑选弹窗确认后写入上方脚本文案框） -->
        <label class="lbl">平台</label>
        <select v-model="ivPlatform" class="input w110" title="投放平台（平台口播风格指引由服务端织入生成）">
          <option v-for="p in ivPlatformOptions" :key="p.name" :value="p.name">{{ p.name }}</option>
          <option v-if="!ivPlatformOptions.length" value="抖音">抖音</option>
        </select>
        <span class="spacer"></span>
        <!-- 未选产品禁用（同文案混剪：product_desc 必填；产品随脚本持久化） -->
        <TButton
          label="重新生成仿写文案"
          :loading="regenBusy"
          :disabled="!productLabel()"
          :title="productLabel() ? '' : '请先「选择产品」——服务端按产品信息生成 10 种文案写法'"
          @click="regenerateVoiceover"
        />
      </div>
      <!-- 选择产品图（2026-10-03 裁决：≥1 张才能进分镜头确认；2026-10-08 用户裁决：
           从底部导航行上移到「选择产品」行下方、独占整行） -->
      <!-- 产品图缩略条（2026-10-08 用户裁决：选品自动配图 ≤6 张缩略显示于产品行下方；
           每图右上角 × 删除，文字 chip 退役；「选择产品图」仍可手动增补） -->
      <div v-if="productImages.length" class="product-img-row">
        <div v-for="(u, i) in productImages" :key="u" class="product-img-thumb">
          <img :src="u" alt="产品图" loading="lazy" />
          <button class="product-img-del" title="移除该图" @click="removeProductImage(i)">×</button>
        </div>
        <span class="muted">已选 {{ productImages.length }}/6 张（随脚本保存，生成任务直传）</span>
        <button class="product-img-clear" title="清空已选产品图" @click="clearProductImages">清空</button>
        <!-- 六视图（§11-51：选品图确认自动生成，九宫格回填前先出——2026-10-08 用户裁决移本行右侧） -->
        <span class="spacer"></span>
        <div class="iv-sixview-inline">
          <div v-if="sixViewDisplay.length" class="iv-sixview2-row">
            <div v-for="(v, i) in sixViewDisplay" :key="i" class="iv-sixview2-item">
              <img :src="v.url" class="iv-sixview2-img" :title="`六视图 · ${v.view}`" />
              <button class="iv-sixview2-del" :class="{ 'is-arm': armedDeleteView === v.view }"
                :disabled="iv.sixViewPhase.value === 'running'"
                :title="armedDeleteView === v.view ? '再次点击确认删除（不可逆）' : `删除视角 ${v.view}（不可逆，整组可重出）`"
                @click="onDeleteSixView(v.view)">{{ armedDeleteView === v.view ? '确认?' : '×' }}</button>
            </div>
          </div>
          <span v-else-if="iv.sixViewPhase.value === 'running'" class="muted">生成中…</span>
          <span v-else-if="iv.sixViewError.value" class="iv-err">{{ iv.sixViewError.value }}</span>
        </div>
      </div>
      <!-- 双按钮各占一半（2026-10-08 用户裁决）：左=选择产品图，右=生成六视图 -->
      <div class="row">
        <TButton
          label="选择产品图"
          variant="secondary"
          style="flex: 1 1 0"
          title="打开素材库图片弹窗（仅图片）；选中的产品图随脚本保存并随生成任务直传"
          @click="productImgDlgOpen = true"
        />
        <TButton
          label="生成六视图"
          variant="primary"
          style="flex: 1 1 0"
          :disabled="iv.sixViewPhase.value === 'running'"
          :loading="iv.sixViewPhase.value === 'running'"
          title="按当前选品的产品图生成六面视图（九宫格回填前先出）"
          @click="regenSixView"
        />
      </div>
      <!-- 参考声音（同文案混剪 Step3：TSelect+常驻播放条，源 GET /voice/samples） -->
      <div class="row ref-row">
        <span class="lbl">参考声音:</span>
        <TSelect :model-value="selectedSampleKey" :options="sampleOptions" @update:model-value="selectedSampleKey = String($event)" />
        <audio v-if="samplePreviewUrl" :src="toAbsolute(samplePreviewUrl)" controls preload="auto" class="iv-audio" title="样本试听" />
        <span v-if="voiceSamplesError" class="muted">{{ voiceSamplesError }}</span>
      </div>
      <div class="row">
        <span class="lbl">配音引擎:</span>
        <TSelect v-model="ttsEngineSel" :options="TTS_ENGINE_OPTIONS" class="tts-engine-select" title="TTS 引擎（客户端默认 VoxCPM2）" />
        <TButton label="设置声音克隆" variant="secondary" @click="openCloneParams()" />
        <span class="spacer"></span>
        <TButton label="生成口播配音" :loading="ttsBusy" :disabled="!voiceoverText.trim()" @click="generateVoiceAudio" />
      </div>
      <div class="row">
        <template v-if="ttsAudioUrl">
          <span class="lbl">口播配音:</span>
          <span class="iv-voice-name" :title="ttsSampleLabel">{{ ttsSampleLabel }}</span>
          <audio :src="ttsAudioUrl" controls preload="auto" class="iv-audio" :title="`口播配音（${ttsSampleLabel}，${ttsDurText}）`" @loadedmetadata="onTtsMeta" />
          <span class="iv-dur" :class="{ none: ttsDurSec <= 0 }">{{ ttsDurText }}</span>
        </template>
        <span v-if="regenError" class="iv-err">{{ regenError }}</span>
        <span v-if="regenWarn" class="iv-warn">{{ regenWarn }}</span>
        <span v-if="ttsError" class="iv-err">{{ ttsError }}</span>
        <span v-if="ttsBindNote" class="muted">{{ ttsBindNote }}</span>
        <span v-if="distributeNote" class="muted">{{ distributeNote }}</span>
        <span v-if="distributeBusy" class="muted">正在按新文案分配逐镜旁白…</span>
        <span class="muted">整段直发不拆句；新文案按镜自动拆分待服务端口播切分修复（§11-26）</span>
      </div>

      <div class="muted">时长保存后由服务端按帧对齐量化（≤0.7s 偏移，设计行为，非 bug）</div>
      <div v-for="(shot, i) in shots" :key="i" class="seg-card">
        <div class="seg-head">
          <span class="seg-no">#{{ i + 1 }}</span>
          <label class="seg-field head-field"><span class="lbl">镜别</span><input v-model="shot.shot_type" class="input w70" placeholder="特写/中景" /></label>
          <label class="seg-field head-field"><span class="lbl">时长(秒)</span><input v-model.number="shot.duration" type="number" min="3" max="15" class="input w60" title="保存后服务端按帧对齐量化，时长可能微调 ≤0.7s（设计行为）" /></label>
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
        <TButton label="← 上一步" variant="primary" @click="goBack" />
        <span class="spacer"></span>
        <TButton
          label="下一步：分镜头确认"
          :loading="enteringPrep"
          :disabled="enterPrepBlocked"
          :title="enterPrepTitle"
          @click="enterPrep"
        />
      </div>
      <div v-if="iv.genError.value" class="iv-err">{{ iv.genError.value }}</div>
      <WbPickProductDialog :visible="productPickVisible" @close="productPickVisible = false" @pick="onProductPick" />

      <!-- 产品图选择弹窗（素材库·仅图片；确定后写 meta.imitate.product_images） -->
      <MaterialImagePickerDialog
        :open="productImgDlgOpen"
        :selected-keys="productImageIds"
        :selected-names="productImageNames"
        @confirm="onProductImagesConfirm"
        @close="productImgDlgOpen = false"
      />

      <!-- 设置声音克隆弹窗（对齐文案混剪 Step3 同名功能：参数随每次 TTS 请求发送） -->
      <VoiceCloneParamsDialog
        :open="cloneParamsDlg.show"
        :engine="ttsEngineSel"
        :initial="{ factor: ttsFactor, emo: ttsEmoText, alpha: ttsEmoAlpha, speaker: qwen3Speaker, instruct: qwen3Instruct }"
        :voices="qwen3Voices"
        :voices-loading="qwen3VoicesLoading"
        @save="saveCloneParams"
        @close="closeCloneParams"
      />

      <!-- 十稿挑选弹窗（共享组件；默认选中第一种，点卡片切换，确定写入脚本文案框） -->
      <VoiceoverPickerDialog
        :open="voiceoverDlgOpen"
        :candidates="voiceoverCandidates"
        :failed-formulas="voiceoverFailedFormulas"
        :selected-idx="voiceoverSelectedIdx"
        @update:selected-idx="voiceoverSelectedIdx = $event"
        @confirm="confirmVoiceoverCandidate"
        @close="closeVoiceoverDlg" />
    </div>

    <!-- ═══ 第 3 步：分镜头确认（阶段① 九宫格确认 + 阶段② 首尾帧+确认全部分镜——2026-10-06 用户裁决）═══ -->
    <ImitationGenSteps
      v-else-if="step === 3"
      mode="frames"
      :iv="iv"
      :shots="shots"
      :grid-url="storyboardGridUrl"
      :quality-report="qualityReport"
      :six-view-ready="sixViewReady"
      @toggle-badcase="toggleBadcase"
      :pack="iv.storyboardPack.value"
      :gen-result-summary="genResultSummary"
      :frames-ready-count="framesReadyCount"
      :generate-shots-count="generateShotsCount"
      :done-all="doneCount === shots.length"
      :aroll-status="String((record?.aroll as Record<string, unknown>)?.status || '')"
      :aroll-config="arollConfig"
      :aroll-preview-url="arollPreviewUrl"
      :aroll-busy="arollBusy"
      :draft-confirmed="draftConfirmed"
      :drafts-ready="draftsReady"
      :can-confirm-draft="canConfirmDraft"
      @confirm-draft="confirmDraftAndSubmitVideos"
      @refresh-grid="reloadScript"
      @frames-confirmed="reloadScript"
      @regen-storyboard="regenStoryboard"
      :frame-confirming="frameConfirming"
      :regen-frame="regenFrame"
      :retrying="retrying"
      :retry-fidelity="retryFidelity"
      :start-videos="startVideos"
      :frame-url="frameUrl"
      :video-url-of="shotVideoUrl"
      :live-shots="cgShots"
      :on-confirm-frame="confirmFrame"
      :on-pick-replace-frame="pickReplaceFrame"
      :on-regenerate-frame="regenerateFrame"
      :on-retry-shot="retryShot"
      @start-videos="startVideoGeneration"
      :on-back="goBack"
      @update:retry-fidelity="retryFidelity = $event"
    />

    <!-- ═══ 第 4 步：逐镜视频生成（整脚本信息在左、首尾帧在右）═══ -->
    <ImitationGenSteps
      v-else-if="step === 4"
      mode="videos"
      :iv="iv"
      :shots="shots"
      :grid-url="storyboardGridUrl"
      :quality-report="qualityReport"
      :six-view-ready="sixViewReady"
      @toggle-badcase="toggleBadcase"
      :pack="iv.storyboardPack.value"
      :gen-result-summary="genResultSummary"
      :frames-ready-count="framesReadyCount"
      :generate-shots-count="generateShotsCount"
      :done-all="doneCount === shots.length"
      :aroll-status="String((record?.aroll as Record<string, unknown>)?.status || '')"
      :aroll-config="arollConfig"
      :aroll-preview-url="arollPreviewUrl"
      :aroll-busy="arollBusy"
      :draft-confirmed="draftConfirmed"
      :drafts-ready="draftsReady"
      :can-confirm-draft="canConfirmDraft"
      @confirm-draft="confirmDraftAndSubmitVideos"
      @refresh-grid="reloadScript"
      @frames-confirmed="reloadScript"
      @generate-aroll="generateAroll"
      @regen-storyboard="regenStoryboard"
      :frame-confirming="frameConfirming"
      :regen-frame="regenFrame"
      :retrying="retrying"
      :retry-fidelity="retryFidelity"
      :start-videos="startVideos"
      @start-videos="startVideoGeneration"
      :frame-url="frameUrl"
      :video-url-of="shotVideoUrl"
      :live-shots="cgShots"
      :on-confirm-frame="confirmFrame"
      :on-pick-replace-frame="pickReplaceFrame"
      :on-regenerate-frame="regenerateFrame"
      :on-retry-shot="retryShot"
      :on-back="goBack"
      @update:retry-fidelity="retryFidelity = $event"
      @next-pack="step = 5"
    />


    <!-- ═══ 第 5/6 步：特效包装（草稿链）与交付（草稿包导入剪映）═══ -->
    <ImitationFxStep
      v-else-if="step === 5"
      section="fx"
      :script-id="scriptId"
      @back="goBack"
      @next="step = 6"
    />

    <!-- ═══ 第 6 步：交付（特效包装导出 + 成片预览/下载）═══ -->
    <ImitationFxStep
      v-else-if="step === 6"
      section="export"
      :script-id="scriptId"
      :gen-task-id="iv.videosTaskId.value"
      @back="goBack"
    />
    <ImitationMontageStep
      v-else-if="step === 6"
      :step="step"
      :script-id="scriptId"
      :phase="montage.montagePhase.value"
      :progress="montage.montageProgress.value"
      :elapsed-sec="montage.montageElapsedSec.value"
      :message="montage.montageMessage.value"
      :error="montage.montageError.value"
      :exporting="montage.exporting.value"
      :export-stage="montage.exportStage.value"
      :export-note="montage.exportNote.value"
      :transition="cfgTransition"
      :bgm-name="cfgBgmName"
      :result="montage.montageResult.value"
      @trigger="startMontage"
      @import="montage.importDraftPackage()"
      @back="goBack"
      @next="step = 6"
      @restart="resetFlow"
      @config-change="onMontageConfig"
      @download="downloadMontageVideo"
      @regen-storyboard="regenStoryboard"
    />
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
.iv-bar { position: relative; height: 6px; overflow: hidden; background: var(--border); border-radius: 999px; }
.iv-bar-fill { height: 100%; background: var(--primary); border-radius: 999px; transition: width 0.6s ease; }
.iv-bar.is-indeterminate::after { content: ''; position: absolute; inset: 0; width: 40%; background: var(--primary); border-radius: 999px; animation: iv-indeterminate 1.2s ease-in-out infinite; }
@keyframes iv-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }
.iv-audio { height: 32px; width: 320px; flex: 0 1 auto; }
.ref-row :deep(.t-select) { flex: 1 1 0; width: auto; min-width: 0; }
.iv-voice-name { font-size: 13px; color: var(--foreground); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iv-dur { font-size: 12px; color: var(--muted-foreground); }
.iv-dur.none { color: var(--border); }
.tts-engine-select { width: 220px; flex: none; }
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
/* 产品图缩略条（2026-10-08 用户裁决：图片化显示替代文字 chip，右上角可删） */
.product-img-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
/* 六视图（§11-51）：产品图行右侧——按钮+六张 3:4 缩略一排 */
.iv-sixview-inline { display: flex; align-items: center; gap: 10px; min-width: 0; }
.iv-sixview2-row { display: flex; gap: 6px; }
.iv-sixview2-item { position: relative; }
.iv-sixview2-del { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0;
  line-height: 15px; font-size: 12px; background: rgba(0, 0, 0, 0.55); color: #fff;
  border: none; border-radius: 50%; cursor: pointer; }
.iv-sixview2-del:hover { background: var(--danger, #e74c3c); }
.iv-sixview2-del.is-arm { width: auto; padding: 0 6px; border-radius: 9px; background: var(--danger, #e74c3c); }
.iv-sixview2-img { height: 72px; aspect-ratio: 3 / 4; object-fit: cover;
  border: 1px solid var(--border); border-radius: var(--radius-md); background: #101010; }
.product-img-thumb { position: relative; width: 168px; aspect-ratio: 1 / 1; overflow: hidden;
  border: 1px solid var(--border); border-radius: var(--radius-sm); background: #101010; }
.product-img-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.product-img-del { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0;
  line-height: 15px; font-size: 12px; background: rgba(0, 0, 0, 0.55); color: #fff;
  border: none; border-radius: 50%; cursor: pointer; }
.product-img-del:hover { background: var(--danger, #e74c3c); }
.product-img-clear { background: transparent; color: var(--muted-foreground); border: none;
  font-size: 12px; cursor: pointer; text-decoration: underline; }
.product-img-clear:hover { color: var(--danger, #e74c3c); }

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
.w70 { width: 90px; } .w60 { width: 64px; } .w110 { width: 130px; } .w140 { width: 160px; }

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
