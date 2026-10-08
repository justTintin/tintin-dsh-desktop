// ═══════════════════════════════════════════════════════════════
// useImitationVideo — 仿视频（V3.5 / PRD-M-5）编排层（runner：只做编排+响应式 state）
// 纯逻辑全在 imitationVideoLogic.ts（可单测）；本文件不做 DOM，失败分支全部
// clientError 打点（铁律 7），契约缺失显式报错不兜底（铁律 6）。
// 依据：《仿视频流程规范》v1.0（2026-10-02 合并版）§4/§5.1/§5.3/§11-19；
// 端点与响应形态以 2026-10-02 服务端实测为准（/api/storyboard/scripts/imitate、
// /tasks/unified/{id} result={script_id,version,shot_count}、frames multipart）。
// 本地视频预上传已闭（2026-10-02 服务端开通 `POST /api/storyboard/scripts/
// imitate/upload`）：multipart file → 入素材库（source=imitate_upload、file_hash
// 去重）→ 返 {material_id, material} → 以 material://{id} 提交 imitate。
// File/Blob 属 DOM 概念留在本层（UI 文件选择器供给）；纯逻辑层只处理字符串形态。
// ═══════════════════════════════════════════════════════════════

import { onBeforeUnmount, ref } from 'vue'
import { API_PATHS } from '../types/server-api'
import { clientError, clientInfo } from '../utils/clientLog'
import { extractTaskObj, mapTaskStatus } from './copywritingMontageCommonLogic'
import {
  arollTimelineWarning,
  buildFramesConfirmBody,
  buildImitateBody,
  buildStoryboardGenerateBody,
  isStageDReady,
  normalizeServerEnums,
  parseSixViewEntries,
  sixViewFileUrl,
  type SixViewEntry,
  validateGenShots,
  type GenerateStage,
  type ImitationShot,
  type ServerEnums,
} from './imitationVideoLogic'

const POLL_INTERVAL_MS = 2000
const TAG = 'imitation-video'

function serverBridge() {
  const s = (globalThis as unknown as { tintin?: { server?: Record<string, (...a: unknown[]) => Promise<unknown>> } }).tintin?.server
  if (!s) throw new Error('window.tintin.server 桥不可用（宿主未注入）')
  return s
}

export interface ImitateSubmitInput {
  /** material://{id} | http url | 服务端路径 | File（本地视频，经 imitate/upload 预上传） */
  video: unknown
  products?: Array<unknown>
  options?: { ratio?: string; fidelity?: string; max_shots?: number }
  /** 本地 File 预上传进度（0..1） */
  onUploadProgress?: (ratio: number) => void
}

export interface GenerateSubmitInput {
  arollMaterialId?: number
  arollImage?: string
  scriptId: string
  stage: GenerateStage
  onlyShots?: string[]
  fidelityOverride?: 'fast' | 'balanced' | 'high'
  autoMontage?: boolean
  /** 产品图 url/路径数组（2026-10-03 用户裁决：第 2 步选产品图后随任务直传，服务端 ≥1 校验） */
  productImages?: string[]
}

export function useImitationVideo() {
  // ── 枚举唯一源（§11-19）──────────────────────────────────────
  const enums = ref<ServerEnums | null>(null)
  const enumsError = ref('')
  async function loadEnums(): Promise<boolean> {
    enumsError.value = ''
    try {
      const raw = await serverBridge().get(API_PATHS.comfygen.enums)
      const normalized = normalizeServerEnums(raw)
      if (!normalized) {
        enumsError.value = '/comfygen/enums 响应不合法（ok!==true 或 cameras/fidelity 缺失）'
        clientError(TAG, enumsError.value, { raw })
        return false
      }
      enums.value = normalized
      clientInfo(TAG, `枚举已加载 source=${normalized.source} cameras=${normalized.cameras.length}`)
      return true
    } catch (e) {
      enumsError.value = `枚举拉取失败：${(e as Error).message}`
      clientError(TAG, enumsError.value, e)
      return false
    }
  }

  // ── 平台字典（2026-10-03 用户裁决：仿写文案对齐文案混剪——GET /copywriting/platforms，
  //    platform 直传服务端，平台指引由服务端织入；拉取失败保留当前值）──
  const ivPlatformOptions = ref<Array<{ name: string; guide: string }>>([])
  const ivPlatform = ref('抖音')
  async function loadIvPlatforms(): Promise<void> {
    try {
      const res = await serverBridge().get(API_PATHS.copywriting.platforms)
      const data = (res && typeof res === 'object' ? res : null) as { default?: string; platforms?: Array<{ name?: string; guide?: string }> } | null
      const list = Array.isArray(data?.platforms) ? data!.platforms! : []
      if (list.length) {
        ivPlatformOptions.value = list
          .filter((x) => x && typeof x.name === 'string' && x.name)
          .map((x) => ({ name: String(x.name), guide: String(x.guide || '') }))
        if (typeof data?.default === 'string' && data.default) ivPlatform.value = data.default
        clientInfo(TAG, `平台字典已加载 n=${ivPlatformOptions.value.length} default=${ivPlatform.value}`)
      }
    } catch (e) { /* 拉取失败保留当前值；打点可追溯（铁律 7） */
      clientError(TAG, '平台字典拉取失败（保留默认抖音）', e)
    }
  }

  // ── Seedance 交付包（v4.9 收口：九宫格图一张+逐镜 prompt_zh/camera_zh/seed_base；
  //    未生成/旧脚本 → null，UI 落占位不兜底造数据）──
  const storyboardPack = ref<Record<string, unknown> | null>(null)
  async function loadStoryboardPack(id: string): Promise<void> {
    if (!id) return
    try {
      storyboardPack.value = (await serverBridge().get(API_PATHS.storyboard.storyboardPack(id))) as Record<string, unknown> | null
    } catch (e) {
      storyboardPack.value = null
      clientInfo(TAG, `storyboard-pack 未取到（未生成或旧脚本）：${(e as Error).message}`)
    }
  }

  // ── Part 1：imitate 提交 + unified 轮询（§4/§5.3）────────────
  const part1TaskId = ref('')
  const part1Phase = ref<'' | 'running' | 'done' | 'failed'>('')
  const part1Error = ref('')
  const part1Note = ref('')
  /** 拆解进度反馈（2026-10-03 用户裁决：拆解中必须有进度条）：progress=服务端 0-100
   *  （实测 completed=100），缺省/未知=-1 → UI 走不定态动画；已用时秒表+last_message */
  const part1Progress = ref(-1)
  const part1ElapsedSec = ref(0)
  const part1Message = ref('')
  let part1StartedAt = 0
  /** Part 1 源素材 id（预上传回填 / material:// 输入解析；供后续产品图等引用） */
  const part1MaterialId = ref('')
  /** Part 1 完整结果（shots[] + 提示词字段——拆解接口=脚本+反推提示词唯一来源） */
  const part1Result = ref<Record<string, unknown>>({})
  const scriptId = ref('')
  const scriptVersion = ref(0)
  const shotCount = ref(0)

  let part1Timer: ReturnType<typeof setInterval> | null = null
  function stopPart1Polling(): void {
    if (part1Timer) { clearInterval(part1Timer); part1Timer = null }
  }
  onBeforeUnmount(stopPart1Polling)

  async function submitImitate(input: ImitateSubmitInput): Promise<boolean> {
    let video: unknown = input.video
    part1Note.value = ''
    // File/Blob → 先经 imitate/upload 入素材库，拿 material_id 转成 material:// URI
    if (typeof File !== 'undefined' && (input.video instanceof File || input.video instanceof Blob)) {
      try {
        const form = new FormData()
        form.append('file', input.video, input.video instanceof File ? input.video.name : 'source.mp4')
        const resp = (await serverBridge().upload(
          API_PATHS.storyboard.imitateUpload,
          form,
          input.onUploadProgress,
        )) as Record<string, unknown> | null
        const mid = resp?.material_id ?? (resp?.material as Record<string, unknown> | undefined)?.id
        if (mid === undefined || mid === null || mid === '') {
          const keys = resp ? Object.keys(resp).join(',') : 'null'
          part1Error.value = `预上传响应缺 material_id（实得字段：${keys}）`
          clientError(TAG, part1Error.value, { resp })
          return false
        }
        video = `material://${mid}`
        part1MaterialId.value = String(mid)
        part1Note.value = `本地视频已入素材库 id=${mid}`
        clientInfo(TAG, `预上传完成 material_id=${mid}`)
      } catch (e) {
        part1Error.value = `本地视频预上传失败：${(e as Error).message}`
        clientError(TAG, part1Error.value, e)
        return false
      }
    }
    // 素材引用输入也解析出 id（反推提示词 /prompt/video 需 material 引用）
    const materialRef = /^material:\/\/(\d+)/.exec(String(video))
    if (materialRef) part1MaterialId.value = materialRef[1]
    const built = buildImitateBody({ video, products: input.products, options: input.options })
    part1Note.value = part1Note.value || built.note
    if (!built.ok) {
      const msg = built.needsUpload
        ? '本地路径字符串无法直传（渲染层不读盘）：请传入文件选择器的 File 对象，或素材库 material://{id} / 服务端路径'
        : built.note
      part1Error.value = msg
      clientError(TAG, `imitate 提交被拒：${msg}`)
      return false
    }
    try {
      const resp = (await serverBridge().post(API_PATHS.storyboard.imitate, built.body)) as Record<string, unknown> | null
      const taskId = resp && (resp.task_id ?? resp.id)
      if (!taskId || typeof taskId !== 'string' && typeof taskId !== 'number') {
        const keys = resp ? Object.keys(resp).join(',') : 'null'
        part1Error.value = `imitate 响应缺 task_id（实得字段：${keys}）`
        clientError(TAG, part1Error.value, { resp })
        return false
      }
      part1TaskId.value = String(taskId)
      part1Phase.value = 'running'
      part1Error.value = ''
      part1StartedAt = Date.now()
      part1ElapsedSec.value = 0
      part1Progress.value = -1
      part1Message.value = ''
      clientInfo(TAG, `Part1 已提交 task=${taskId}`)
      startPart1Polling()
      return true
    } catch (e) {
      part1Error.value = `imitate 提交失败：${(e as Error).message}`
      clientError(TAG, part1Error.value, e)
      return false
    }
  }

  function startPart1Polling(): void {
    stopPart1Polling()
    const tick = async (): Promise<void> => {
      try {
        const resp = await serverBridge().get(API_PATHS.tasks.unifiedItem(part1TaskId.value))
        const task = extractTaskObj(resp)
        const info = mapTaskStatus(task.status ?? task.state, task)
        // 进度/用时/阶段文案同步刷新（running 态 UI 每个轮询周期更新一次）
        part1ElapsedSec.value = Math.round((Date.now() - part1StartedAt) / 1000)
        const rawProg = Number((task as Record<string, unknown>).progress)
        part1Progress.value = Number.isFinite(rawProg) && rawProg >= 0 ? Math.min(100, Math.round(rawProg)) : -1
        part1Message.value = String((task as Record<string, unknown>).last_message ?? '')
        if (info.phase === 'running') return
        stopPart1Polling()
        if (info.phase === 'failed') {
          part1Phase.value = 'failed'
          part1Error.value = info.error
          clientError(TAG, `Part1 失败 task=${part1TaskId.value}`, { error: info.error })
          return
        }
        const result = (task.result ?? {}) as Record<string, unknown>
        const sid = result.script_id
        if (!sid) {
          part1Phase.value = 'failed'
          part1Error.value = `Part1 完成但 result 缺 script_id（实得字段：${Object.keys(result).join(',') || '空'}）`
          clientError(TAG, part1Error.value, { task })
          return
        }
        scriptId.value = String(sid)
        scriptVersion.value = Number(result.version) || 0
        shotCount.value = Number(result.shot_count) || 0
        // 完整结果保留（含 shots[] 与提示词字段——2026-10-02 用户裁决：拆解接口即
        // 脚本+反推提示词的唯一来源，客户端不再单独调 /prompt/video）
        part1Result.value = result
        part1Phase.value = 'done'
        clientInfo(TAG, `Part1 完成 script=${sid} shots=${shotCount.value}`)
      } catch (e) {
        clientError(TAG, `Part1 轮询异常 task=${part1TaskId.value}`, e)
      }
    }
    // 首拍立即执行（不等首个周期）——提交后 UI 即刻进 running 并出进度条
    void tick()
    part1Timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  }

  // ── 脚本读写（HumanGate① 数据面，§5.3）────────────────────────
  async function loadScript(id: string): Promise<Record<string, unknown> | null> {
    try {
      const resp = await serverBridge().get(API_PATHS.storyboard.scriptsItem(id))
      const data = (resp && ((resp as Record<string, unknown>).data ?? resp)) as Record<string, unknown> | null
      if (!data) {
        clientError(TAG, `脚本读取为空 id=${id}`, { resp })
        return null
      }
      return data
    } catch (e) {
      clientError(TAG, `脚本读取失败 id=${id}`, e)
      return null
    }
  }

  async function saveScript(id: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      const resp = await serverBridge().put(API_PATHS.storyboard.scriptsItem(id), payload)
      if (resp === null || (resp as Record<string, unknown>)?.error) {
        clientError(TAG, `脚本保存失败 id=${id}`, { resp })
        return false
      }
      return true
    } catch (e) {
      clientError(TAG, `脚本保存异常 id=${id}`, e)
      return false
    }
  }

  // ── HumanGate②：帧确认 / 手动换帧（multipart，实测口径）──────
  /** 闸门① 九宫分镜整体确认（v4.3：PUT draft/confirm → draft_status=confirmed，解锁 frames 精稿） */
  async function confirmDraft(id: string): Promise<boolean> {
    try {
      const resp = (await serverBridge().put(API_PATHS.storyboard.draftConfirm(id), {})) as Record<string, unknown> | null
      if (resp === null || (resp as Record<string, unknown>)?.error) {
        clientError(TAG, `九宫粗稿确认失败 id=${id}`, { resp })
        return false
      }
      clientInfo(TAG, `九宫粗稿已确认（draft_status=confirmed）id=${id}`)
      return true
    } catch (e) {
      clientError(TAG, `九宫粗稿确认异常 id=${id}`, e)
      return false
    }
  }

  async function confirmShotFrames(id: string, name: string): Promise<boolean> {
    const form = new FormData()
    Object.entries(buildFramesConfirmBody()).forEach(([k, v]) => form.append(k, String(v)))
    return uploadShotFrames(id, name, form, `确认帧 ${name}`)
  }

  async function replaceShotFrames(
    id: string,
    name: string,
    files: { first?: File | Blob; last?: File | Blob },
  ): Promise<boolean> {
    if (!files.first && !files.last) {
      clientError(TAG, `换帧缺少文件：${name}（first/last 至少一项）`)
      return false
    }
    const form = new FormData()
    if (files.first) form.append('first', files.first, files.first instanceof File ? files.first.name : 'first.png')
    if (files.last) form.append('last', files.last, files.last instanceof File ? files.last.name : 'last.png')
    return uploadShotFrames(id, name, form, `换帧 ${name}`)
  }

  async function uploadShotFrames(id: string, name: string, form: FormData, action: string): Promise<boolean> {
    try {
      // frames 端点=PUT multipart（POST 会被 405 拒——2026-10-06 实测修复）
      const resp = await serverBridge().upload(API_PATHS.storyboard.shotFrames(id, name), form, undefined, 'PUT')
      if (resp === null || (resp as Record<string, unknown>)?.error) {
        clientError(TAG, `${action} 失败`, { resp, id, name })
        return false
      }
      clientInfo(TAG, `${action} 成功`)
      return true
    } catch (e) {
      clientError(TAG, `${action} 异常`, e)
      return false
    }
  }

  // ── Part 2：storyboard_generate 提交 + scheduled 轮询（§5.1）──
  const genTaskId = ref('')
  /** 最近一次 videos 提交的任务 id（E-1.2「生成任务转草稿」入口用——from-task 只认成片任务；
   *  A-roll 等后续任务不覆盖它，保证转草稿指向逐镜视频任务） */
  const videosTaskId = ref('')
  const genPhase = ref<'' | 'running' | 'done' | 'failed'>('')
  const genError = ref('')
  const genResult = ref<Record<string, unknown>>({})
  /** comfygen job_ids（服务端任务运行中即写 result.job_ids——/comfygen/jobs 精确关联锚点，2026-10-06） */
  const genJobIds = ref<string[]>([])

  let genTimer: ReturnType<typeof setInterval> | null = null
  function stopGenPolling(): void {
    if (genTimer) { clearInterval(genTimer); genTimer = null }
  }
  onBeforeUnmount(stopGenPolling)

  /** 提交前本地把关（gen_spec 镜像 + 阶段 D 闸门 + A-roll 对轨提示）；返回错误列表（空=通过） */
  function preflightGenerate(shots: ImitationShot[], stage: GenerateStage): string[] {
    const issues = validateGenShots(shots, enums.value).map((i) => `第${i.index + 1}镜 ${i.field}：${i.message}`)
    if (stage === 'videos' && !isStageDReady(shots)) {
      issues.push('阶段 D 闸门未开：存在 frames_status 未 confirmed 的 AI 镜头（HumanGate②）')
    }
    return issues
  }

  async function submitGenerate(input: GenerateSubmitInput, shots: ImitationShot[] = []): Promise<boolean> {
    const issues = shots.length ? preflightGenerate(shots, input.stage) : []
    if (issues.length) {
      genError.value = issues.join('；')
      clientError(TAG, `生成提交被本地校验拒绝：${genError.value}`)
      return false
    }
    try {
      const body = buildStoryboardGenerateBody(input)
      const resp = (await serverBridge().post(API_PATHS.scheduled.tasksList, body)) as Record<string, unknown> | null
      const taskId = resp && (resp.task_id ?? resp.id)
      if (taskId === undefined || taskId === null || taskId === '') {
        const keys = resp ? Object.keys(resp).join(',') : 'null'
        genError.value = `生成任务响应缺 id/task_id（实得字段：${keys}）`
        clientError(TAG, genError.value, { resp })
        return false
      }
      genTaskId.value = String(taskId)
      if (input.stage === 'videos') videosTaskId.value = String(taskId)
      genPhase.value = 'running'
      genError.value = ''
      genResult.value = {}
      genStage.value = input.stage
      genStartedAt = Date.now()
      genElapsedSec.value = 0
      genProgress.value = -1
      genMessage.value = ''
      clientInfo(TAG, `storyboard_generate 已提交 task=${genTaskId.value} stage=${input.stage}`)
      startGenPolling()
      return true
    } catch (e) {
      genError.value = `生成任务提交失败：${(e as Error).message}`
      clientError(TAG, genError.value, e)
      return false
    }
  }

  // ── 生成进度反馈（2026-10-04 用户裁决：分镜头确认步与第 1 步同款进度条）──
  const genProgress = ref(-1)      // 服务端 0-100；缺省/未知=-1 → UI 不定态
  const genElapsedSec = ref(0)
  const genMessage = ref('')
  /** 最近提交的生成阶段（storyboard/frames/videos/aroll）——UI 按阶段归位进度显示 */
  const genStage = ref<GenerateStage | ''>('')
  let genStartedAt = 0

  function startGenPolling(): void {
    stopGenPolling()
    const tick = async (): Promise<void> => {
      try {
        const resp = await serverBridge().get(API_PATHS.scheduled.tasksItem(genTaskId.value))
        const task = extractTaskObj(resp)
        const info = mapTaskStatus(task.status ?? task.state, task)
        genElapsedSec.value = Math.round((Date.now() - genStartedAt) / 1000)
        const rawProg = Number((task as Record<string, unknown>).progress)
        genProgress.value = Number.isFinite(rawProg) && rawProg >= 0 ? Math.min(100, Math.round(rawProg)) : -1
        genMessage.value = String((task as Record<string, unknown>).last_message ?? '')
        const resObj = (task.result ?? {}) as Record<string, unknown>
        const jids = Array.isArray(resObj.job_ids) ? resObj.job_ids.map((x) => String(x)) : []
        if (jids.length) genJobIds.value = jids
        if (info.phase === 'running') return
        stopGenPolling()
        genPhase.value = info.phase === 'done' ? 'done' : 'failed'
        genError.value = info.error
        genResult.value = (task.result ?? {}) as Record<string, unknown>
        if (info.phase === 'failed') clientError(TAG, `storyboard_generate 失败 task=${genTaskId.value}`, { error: info.error })
        else clientInfo(TAG, `storyboard_generate 完成 task=${genTaskId.value}`)
      } catch (e) {
        clientError(TAG, `生成轮询异常 task=${genTaskId.value}`, e)
      }
    }
    void tick()
    genTimer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  }

  /** A-roll 对轨 warning（§3：±15% 仅提示；voice 时长由脚本记录提供） */
  function timelineWarning(shots: ImitationShot[], voiceDurSec: unknown): string {
    return arollTimelineWarning(shots, voiceDurSec)
  }

  // ── 六视图（§11-51：选品/上传产品图触发；九宫格回填前左栏展示，2026-10-08 用户裁决上下共存）──
  const sixViewTaskId = ref('')
  const sixViewPhase = ref<'' | 'running' | 'done' | 'failed'>('')
  const sixViews = ref<SixViewEntry[]>([])
  const sixViewError = ref('')
  let sixViewTimer: ReturnType<typeof setInterval> | null = null
  function stopSixViewPolling(): void {
    if (sixViewTimer) { clearInterval(sixViewTimer); sixViewTimer = null }
  }
  onBeforeUnmount(stopSixViewPolling)

  /** 提交六视图编排并轮询（productImages=第 2 步选品图，缺省服务端读脚本选品留痕；
   *  服务端 400 文案自带指引——「请求未传 product_images 且脚本无选品留痕」） */
  async function submitSixView(productImages: string[] = []): Promise<boolean> {
    if (!scriptId.value) {
      sixViewPhase.value = 'failed'
      sixViewError.value = '尚无脚本（先完成第 1 步拆解）——六视图挂脚本提交'
      clientError(TAG, sixViewError.value)
      return false
    }
    stopSixViewPolling()
    sixViewPhase.value = 'running'
    sixViewError.value = ''
    try {
      const resp = (await serverBridge().post(API_PATHS.storyboard.sixView(scriptId.value), {
        product_images: productImages,
      })) as Record<string, unknown> | null
      const syncUrls = parseSixViewEntries((resp as Record<string, unknown>)?.result ?? resp)
        .map((e) => ({ ...e, url: e.url || sixViewFileUrl(scriptId.value, e.view) }))
      if (syncUrls.length) {
        sixViews.value = syncUrls
        sixViewPhase.value = 'done'
        clientInfo(TAG, `六视图同步返回 ${syncUrls.length} 张`)
        return true
      }
      const taskId = resp && (resp.task_id ?? resp.id)
      if (!taskId || (typeof taskId !== 'string' && typeof taskId !== 'number')) {
        sixViewPhase.value = 'failed'
        sixViewError.value = `六视图提交响应缺 task_id（实得字段：${resp ? Object.keys(resp).join(',') : 'null'}）`
        clientError(TAG, sixViewError.value, { resp })
        return false
      }
      sixViewTaskId.value = String(taskId)
      clientInfo(TAG, `六视图已提交 task=${sixViewTaskId.value}`)
      startSixViewPolling()
      return true
    } catch (e) {
      sixViewPhase.value = 'failed'
      sixViewError.value = `六视图提交失败：${(e as Error).message}`
      clientError(TAG, sixViewError.value, e)
      return false
    }
  }

  function startSixViewPolling(): void {
    stopSixViewPolling()
    const tick = async (): Promise<void> => {
      try {
        const resp = (await serverBridge().get(API_PATHS.storyboard.sixViewResult(sixViewTaskId.value))) as Record<string, unknown> | null
        const st = String(resp?.status ?? '').toLowerCase()
        if (st === 'running' || st === 'pending' || st === '') return
        stopSixViewPolling()
        if (st === 'failed' || st === 'error') {
          sixViewPhase.value = 'failed'
          sixViewError.value = String(resp?.error || '六视图任务失败')
          clientError(TAG, `六视图任务失败 task=${sixViewTaskId.value}`, { resp })
          return
        }
        const urls = parseSixViewEntries((resp?.result ?? resp) as Record<string, unknown>)
          .map((e) => ({ ...e, url: e.url || sixViewFileUrl(scriptId.value, e.view) }))
        if (!urls.length) {
          sixViewPhase.value = 'failed'
          sixViewError.value = `六视图完成但响应无视图列表（实得字段：${resp ? Object.keys(resp).join(',') : 'null'}）`
          clientError(TAG, sixViewError.value, { resp })
          return
        }
        sixViews.value = urls
        sixViewPhase.value = 'done'
        clientInfo(TAG, `六视图完成 ${urls.length} 张`)
      } catch (e) {
        clientError(TAG, '六视图轮询异常（下个周期重试）', e)
      }
    }
    void tick()
    sixViewTimer = setInterval(() => { void tick() }, 2000)
  }

  return {
    // 枚举
    enums, enumsError, loadEnums,
    // 平台字典（仿写文案）
    ivPlatformOptions, ivPlatform, loadIvPlatforms,
    // Seedance 交付包（九宫格图+提示词）
    storyboardPack, loadStoryboardPack,
    // Part 1
    part1TaskId, part1Phase, part1Error, part1Note, part1MaterialId, part1Result, scriptId, scriptVersion, shotCount,
    part1Progress, part1ElapsedSec, part1Message,
    submitImitate,
    // 脚本（HumanGate①）
    loadScript, saveScript,
    // HumanGate②
    confirmShotFrames, replaceShotFrames, confirmDraft,
    // Part 2
    genTaskId, genPhase, genError, genResult, genProgress, genElapsedSec, genMessage, genStage, genJobIds, videosTaskId,
    // 六视图（§11-51）
    sixViewTaskId, sixViewPhase, sixViews, sixViewError, submitSixView,
    submitGenerate, preflightGenerate, timelineWarning,
  }
}
