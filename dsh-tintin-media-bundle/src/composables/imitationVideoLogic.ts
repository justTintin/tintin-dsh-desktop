// ═══════════════════════════════════════════════════════════════
// imitationVideoLogic — 仿视频（V3.5 / PRD-M-5）客户端纯函数层（无 vue/IPC 依赖，可单测）
// 契约依据：《仿视频流程规范》PRD-M-5·V3.5（2026-10-02 v1.0 + 同日评审复核：
//   §3 数据模型 / §5.1 storyboard_generate 输入与阶段 / §5.3 客户端调用面 /
//   §6 gen_spec 双向校验 / §11 评审遗留 9-13）
//   +《ComfyUI 工作流调用规范》v4.1 §3（camera/fidelity/duration 枚举与比例换算）。
// 实施注记：
//   · 本文件是客户端侧 gen_spec 镜像（提交前把关，铁律 6 显式报错不兜底）；
//     枚举全集的权威来源=服务端定义下发（2026-10-02 用户裁决 A4：scene 四要素与
//     camera/fidelity 枚举归服务端契约，代理 comfygen /api/enums 的服务端端点待立）。
//     在服务端枚举契约落地前，下方 CAMERA_OPTIONS/FIDELITY_OPTIONS 为按规范文档
//     （流程规范 §4 运镜映射表 + v4.1 §3）暂编的过渡本地表，服务端契约发布后替换
//     为服务端下发值；scene 四要素只做存在性/形态校验，不做枚举全集校验（勿臆造）。
//   · 任务级 stage 缺省值未裁决（流程规范 §11-9），buildStoryboardGenerateBody
//     强制显式传 stage，客户端不依赖服务端缺省。
//   · Part 1 输入允许 http url（流程规范 §4），与旧版仿爆款（已退役 2026-10-02，
//     用户裁决 A5：旧款未投产，V3.5 新链取代；服务端 /viral/clone/* 契约与类型保留）
//     不同源，勿互抄。
// ═══════════════════════════════════════════════════════════════

// ── 枚举与常量（§3 / v4.1 §3）──────────────────────────────────

/** 生成后端（§3 gen.backend；v1 只实现 comfygen，其余留适配位） */
export type GenBackend = 'comfygen' | 'jimeng' | 'runninghub' | 'manual'

/** 镜头素材来源（§3：material=实拍缺省 / generate=AI 生成） */
export type ShotSource = 'material' | 'generate'

/** 分镜帧确认闸门（§3 状态机定稿：pending →(阶段C) generated →(人工确认) confirmed；
 *  中间态拼法唯一权威 = generated，原 frames_generated 拼法已废） */
export type FramesStatus = 'pending' | 'generated' | 'confirmed'

/** 生成状态（§3：pending/submitted/done/failed，独立于 frames_status 勿混叙） */
export type GenStatus = 'pending' | 'submitted' | 'done' | 'failed'

/** A-roll 来源（§3 aroll.source） */
export type ArollSource = 'digital_human' | 'material' | 'none'

/** A-roll 状态（§3 aroll.status） */
export type ArollStatus = 'pending' | 'running' | 'done' | 'failed'

/** 素材准备任务阶段（§5.1 输入；注意与 comfygen stage=frames|video|all 同名异值：
 *  任务级 videos ↔ comfygen video，联调传参勿混——流程规范 §11-9） */
export type GenerateStage = 'aroll' | 'frames' | 'videos' | 'all'

/** 保真档位（v4.1 §3：fast 约3分 / balanced 约4.5分 / high 约7分） */
export type Fidelity = 'fast' | 'balanced' | 'high'

/** 运镜枚举（流程规范 §4 运镜映射表 + v4.1 §3；follow 待 comfygen #11，暂不入下拉） */
export type CameraKey =
  | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'orbit'
  | 'handheld' | 'follow' | 'crane_up' | 'crane_down' | 'static'

export const CAMERA_OPTIONS: Array<{ value: CameraKey; label: string }> = [
  { value: 'push_in', label: '推近' },
  { value: 'pull_out', label: '拉远' },
  { value: 'pan_left', label: '左摇/移' },
  { value: 'pan_right', label: '右摇/移' },
  { value: 'orbit', label: '环绕（小角度）' },
  { value: 'handheld', label: '跟拍（暂代手持）' },
  { value: 'crane_up', label: '升' },
  { value: 'crane_down', label: '降' },
  { value: 'static', label: '固定' },
]

export const FIDELITY_OPTIONS: Array<{ value: Fidelity; label: string }> = [
  { value: 'fast', label: '快速（约3分）' },
  { value: 'balanced', label: '均衡（约4.5分）' },
  { value: 'high', label: '高保真（约7分）' },
]

export const GEN_BACKENDS: GenBackend[] = ['comfygen', 'jimeng', 'runninghub', 'manual']
export const FRAMES_STATUS_VALUES: FramesStatus[] = ['pending', 'generated', 'confirmed']
export const GEN_STATUS_VALUES: GenStatus[] = ['pending', 'submitted', 'done', 'failed']
export const GENERATE_STAGE_VALUES: GenerateStage[] = ['aroll', 'frames', 'videos', 'all']

/** duration 合法区间（§4：归一到 3~15s；v4.1 §3 下限 5→3 已放宽） */
export const DURATION_MIN = 3
export const DURATION_MAX = 15

/** A-roll 对轨 warning 阈值（§3：Σduration vs voice_dur_sec 偏差超 ±15% 提示节奏审视） */
export const AROLL_TIMELINE_TOLERANCE = 0.15

// ── 数据模型（§3 shot 增量字段 / 根级 aroll）────────────────────

/** 分镜帧引用（§3 定形：{path|url, source}；帧不入素材库，worker 实现={"path","source"}） */
export interface FrameRef {
  path?: string
  url?: string
  source: 'generated' | 'manual'
}

/** 场景四要素（§3；枚举全集归服务端 gen_spec/comfygen /api/enums，客户端不臆造） */
export interface GenScene {
  surface?: string
  environment?: string
  lighting?: string
  style?: string
  composition?: 'centered' | 'closeup'
}

/** shot.gen 块（§3；material_id 副本已废——回填唯一权威 = shot 根级） */
export interface ShotGenBlock {
  backend?: GenBackend
  name: string
  scene?: GenScene
  scene_en?: string
  end_scene_en?: string
  camera?: CameraKey
  fidelity?: Fidelity
  first_frame?: FrameRef | null
  last_frame?: FrameRef | null
  frames_status?: FramesStatus
  status?: GenStatus
  job_id?: string | null
  check?: unknown
  error?: string | null
}

/** 仿视频 shot（文案线既有字段 shot_type/visual/audio/sfx 等经 extra 透传） */
export interface ImitationShot {
  index?: number
  visual?: string
  audio?: string
  duration: number
  /** 混剪标准绑定字段（实拍绑定 / AI 生成回填 唯一权威，§3） */
  material_id?: number | string | null
  material_path?: string | null
  source?: ShotSource
  gen?: ShotGenBlock
  [extra: string]: unknown
}

/** 根级 aroll 块（§3） */
export interface ArollBlock {
  source: ArollSource
  image_material_id?: number | string | null
  audio_id?: number | string | null
  material_id?: number | string | null
  status?: ArollStatus
  error?: string | null
}

// ── 工具 ────────────────────────────────────────────────────────

/** 纯 ASCII 判定（v4.1 铁律：scene_en/end_scene_en/name 出口校验） */
export function isAscii(s: unknown): boolean {
  return typeof s === 'string' && /^[\x00-\x7F]*$/.test(s)
}

function isDigits(s: string): boolean {
  return /^\d+$/.test(s)
}

/** duration 归一（clamp 3~15，非法输入回退 5；§4「归一到 3~15s」客户端镜像） */
export function clampDuration(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 5
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(v)))
}

/** 生成 ASCII 唯一名 shot_NN（§3 gen.name：重试合并键；与既有名冲突时递增） */
export function nextGenName(existingNames: Array<string | undefined | null>, start = 1): string {
  const used = new Set(existingNames.filter((n): n is string => typeof n === 'string'))
  let i = start
  while (used.has(`shot_${String(i).padStart(2, '0')}`)) i += 1
  return `shot_${String(i).padStart(2, '0')}`
}

// ── 状态机（§3 两条独立状态机 + §5.1-1 阶段 D 闸门）─────────────

/** 帧是否可确认（HumanGate②：仅 generated 态允许确认） */
export function canConfirmFrames(shot: ImitationShot): boolean {
  return shot.source === 'generate' && shot.gen?.frames_status === 'generated'
}

/** 阶段 D 是否放行（§5.1-1：全部 source=generate 镜头 frames_status=confirmed；无生成镜=true） */
export function isStageDReady(shots: ImitationShot[]): boolean {
  return shots.every((s) => s.source !== 'generate' || s.gen?.frames_status === 'confirmed')
}

/** 逐镜生成徽标文案（§5.3-5：待生成/生成中/完成/失败+原因） */
export function genBadgeText(shot: ImitationShot): string {
  if (shot.source !== 'generate') return '实拍'
  const st = shot.gen?.status ?? 'pending'
  if (st === 'pending') return '待生成'
  if (st === 'submitted') return '生成中'
  if (st === 'done') return '已完成'
  return `失败：${shot.gen?.error || '未知原因'}`
}

/** 分镜帧徽标文案（§5.3-4 HumanGate②：帧待生成/帧待确认/帧已确认） */
export function framesBadgeText(shot: ImitationShot): string {
  if (shot.source !== 'generate') return ''
  const st = shot.gen?.frames_status ?? 'pending'
  if (st === 'pending') return '帧待生成'
  if (st === 'generated') return '帧待确认'
  return '帧已确认'
}

// ── 来源切换（§5.3-2：整镜切换 AI↔实拍，混合比例人工定稿）────────

/**
 * 整镜切换来源（2026-10-02 用户裁决 A1/A2）：
 * · 切实拍（→material）：**保留 gen 块**——gen 是小体积配置数据且携带已确认帧引用
 *   （first/last_frame、frames_status），删除后切回需重跑映射层并重烧 GPU 重生成帧；
 *   "僵尸块"顾虑因体积小不成立。实拍镜上的 gen 为惰性保留（阶段 C/D 只筛
 *   source=generate）；material_id 保留由用户重绑。
 * · 切 AI（→generate）：绑定字段清零（A1：material_id=0/material_path=''，实测
 *   integer default 0 非 nullable，null 会被 422；防旧实拍绑片在生成完成前混入混剪）；
 *   若镜头已有保留的 gen 块则**原样恢复不重建**（保住编辑过的提示词/运镜/帧状态），
 *   无 gen 才初始化全新块（backend=comfygen、唯一名、双状态机归 pending）。
 */
export function switchShotSource(shot: ImitationShot, to: ShotSource, allShots: ImitationShot[] = []): ImitationShot {
  if (to === 'material') {
    return { ...shot, source: 'material' }
  }
  if (shot.gen) {
    return { ...shot, source: 'generate', material_id: 0, material_path: '' }
  }
  return {
    ...shot,
    source: 'generate',
    material_id: 0,
    material_path: '',
    gen: {
      backend: 'comfygen',
      name: nextGenName(allShots.map((s) => s.gen?.name)),
      scene: {},
      camera: 'push_in',
      fidelity: 'balanced',
      first_frame: null,
      last_frame: null,
      frames_status: 'pending',
      status: 'pending',
      job_id: null,
      check: null,
      error: null,
    },
  }
}

// ── gen_spec 客户端镜像（§6：Part 1 出口自检 / PUT 前把关）────────

export interface GenSpecIssue {
  index: number
  field: string
  message: string
}

/**
 * 提交前校验（§4 契约测试口径的客户端镜像）：枚举合法 / scene_en 纯 ASCII /
 * duration 3~15 / name 唯一且 ASCII。scene 四要素枚举全集校验归服务端 gen_spec
 * （/api/enums 代理契约未立，此处只查存在形态）。
 */
export function validateGenShots(shots: ImitationShot[]): GenSpecIssue[] {
  const issues: GenSpecIssue[] = []
  const seenNames = new Map<string, number>()
  shots.forEach((shot, i) => {
    if (shot.source !== 'generate') return
    const gen = shot.gen
    if (!gen) {
      issues.push({ index: i, field: 'gen', message: 'AI 镜头缺 gen 块' })
      return
    }
    if (!gen.name) issues.push({ index: i, field: 'gen.name', message: 'gen.name 必填' })
    else {
      if (!isAscii(gen.name)) issues.push({ index: i, field: 'gen.name', message: `name 含非 ASCII：${gen.name}` })
      if (seenNames.has(gen.name)) {
        issues.push({ index: i, field: 'gen.name', message: `name 重复：${gen.name}（首次出现在第 ${seenNames.get(gen.name)! + 1} 镜）` })
      } else seenNames.set(gen.name, i)
    }
    if (gen.scene_en !== undefined && gen.scene_en !== '' && !isAscii(gen.scene_en)) {
      issues.push({ index: i, field: 'gen.scene_en', message: 'scene_en 含非 ASCII 字符（中文提示词会编码灾难，v4.1 铁律）' })
    }
    if (gen.end_scene_en !== undefined && gen.end_scene_en !== '' && !isAscii(gen.end_scene_en)) {
      issues.push({ index: i, field: 'gen.end_scene_en', message: 'end_scene_en 含非 ASCII 字符' })
    }
    if (gen.camera && !CAMERA_OPTIONS.some((c) => c.value === gen.camera) && gen.camera !== 'follow') {
      issues.push({ index: i, field: 'gen.camera', message: `未知运镜：${gen.camera}` })
    }
    if (gen.fidelity && !FIDELITY_OPTIONS.some((f) => f.value === gen.fidelity)) {
      issues.push({ index: i, field: 'gen.fidelity', message: `未知保真档位：${gen.fidelity}` })
    }
    if (gen.backend && !GEN_BACKENDS.includes(gen.backend)) {
      issues.push({ index: i, field: 'gen.backend', message: `未知生成后端：${gen.backend}` })
    }
    if (gen.frames_status && !FRAMES_STATUS_VALUES.includes(gen.frames_status)) {
      issues.push({ index: i, field: 'gen.frames_status', message: `非法帧状态：${gen.frames_status}` })
    }
    if (gen.status && !GEN_STATUS_VALUES.includes(gen.status)) {
      issues.push({ index: i, field: 'gen.status', message: `非法生成状态：${gen.status}` })
    }
    const dur = Number(shot.duration)
    if (!Number.isFinite(dur) || dur < DURATION_MIN || dur > DURATION_MAX) {
      issues.push({ index: i, field: 'duration', message: `时长 ${shot.duration} 越界（${DURATION_MIN}~${DURATION_MAX}s）` })
    }
  })
  return issues
}

// ── A-roll 对轨（§3：A-roll 轨主权=口播音频；镜头轨主权=脚本 duration）──

/** 镜头轨总时长（Σduration） */
export function shotsTotalDuration(shots: ImitationShot[]): number {
  return shots.reduce((acc, s) => acc + (Number(s.duration) || 0), 0)
}

/**
 * 保存脚本时的节奏 warning（§3：|Σduration − voice_dur_sec| / voice_dur_sec > 15%
 * 仅提示不改数据；voice 时长缺失 → 空串不提示）。voice_dur_sec 字段存在性待服务端
 * 实证（流程规范 §11-12）。
 */
export function arollTimelineWarning(shots: ImitationShot[], voiceDurSec: unknown): string {
  const v = Number(voiceDurSec)
  if (!Number.isFinite(v) || v <= 0) return ''
  const total = shotsTotalDuration(shots)
  const dev = Math.abs(total - v) / v
  if (dev <= AROLL_TIMELINE_TOLERANCE) return ''
  const pct = Math.round(dev * 100)
  return `口播 ${v.toFixed(1)}s 与镜头总时长 ${total.toFixed(1)}s 偏差 ${pct}%（阈值 ±${Math.round(AROLL_TIMELINE_TOLERANCE * 100)}%），建议审视节奏`
}

/** 成片总长 = 两轨较长者（§3 措辞澄清；任一缺失取另一轨） */
export function composedDuration(arollDurSec: unknown, timelineDurSec: unknown): number {
  const a = Number(arollDurSec)
  const t = Number(timelineDurSec)
  const hasA = Number.isFinite(a) && a > 0
  const hasT = Number.isFinite(t) && t > 0
  if (hasA && hasT) return Math.max(a, t)
  if (hasA) return a
  if (hasT) return t
  return 0
}

// ── Part 1 请求体（§4 输入：video = material_id | http url | 上传文件）──

export interface ImitateVideoInput {
  kind: 'material' | 'url' | 'video_path' | 'local_file'
  materialId?: number | string
  url?: string
  videoPath?: string
  localPath?: string
  note: string
}

/**
 * 归一化原视频来源（§4 三形态）。与旧版仿爆款 normalizeSource 不同源：
 * V3.5 明确允许 http url；本地文件 → local_file（调用方经通用上传通道预上传后
 * 以路径重建 body，§4「上传文件」形态）。
 */
export function normalizeImitateVideo(videoRef: unknown): ImitateVideoInput | { kind: 'invalid'; note: string } {
  if (videoRef === null || videoRef === undefined || String(videoRef).trim() === '') {
    return { kind: 'invalid', note: '未提供原视频' }
  }
  if (typeof videoRef === 'number' || isDigits(String(videoRef).trim())) {
    const n = Number(videoRef)
    return { kind: 'material', materialId: Number.isInteger(n) ? n : String(videoRef).trim(), note: `素材库 id=${videoRef}` }
  }
  const s = String(videoRef).trim()
  if (/^https?:\/\//i.test(s)) return { kind: 'url', url: s, note: 'http(s) 链接（服务端下载）' }
  if (/[/\\]output[/\\]/i.test(s) || /(^|[/\\])output[/\\]?$/i.test(s)) {
    return { kind: 'video_path', videoPath: s, note: '服务端已上传路径' }
  }
  if (s.includes('/') || s.includes('\\') || /\.[a-z0-9]{2,5}$/i.test(s)) {
    return { kind: 'local_file', localPath: s, note: '本地视频，需预上传后以路径提交' }
  }
  return { kind: 'material', materialId: s, note: `素材 id=${s}` }
}

export interface ImitateBodyInput {
  video: unknown
  products?: Array<unknown>
  options?: { ratio?: string; fidelity?: string; max_shots?: number }
}

/** POST /storyboard/scripts/imitate body（§4/§9；实测 2026-10-02：video 素材形态
 *  为 `material://{id}` URI 而非裸 id——文档 §4 的 material_id 字面按此 URI 落地） */
export function buildImitateBody(input: ImitateBodyInput): { ok: boolean; body: Record<string, unknown>; needsUpload?: string; note: string } {
  const src = normalizeImitateVideo(input.video)
  if (src.kind === 'invalid') return { ok: false, body: {}, note: src.note }
  if (src.kind === 'local_file') {
    return { ok: false, body: {}, needsUpload: src.localPath, note: src.note }
  }
  const body: Record<string, unknown> = {
    video: src.kind === 'material' ? `material://${src.materialId}` : src.kind === 'url' ? src.url : src.videoPath,
  }
  if (input.products?.length) body.products = input.products
  if (input.options) body.options = input.options
  return { ok: true, body, note: src.note }
}

// ── Part 2 请求体（§5.1 输入 / §9）──────────────────────────────

export interface StoryboardGenerateParams {
  scriptId: string
  /** 显式必填：任务级 stage 缺省值未裁决（§11-9），客户端不依赖服务端缺省 */
  stage: GenerateStage
  onlyShots?: string[]
  fidelityOverride?: Fidelity
  autoMontage?: boolean
}

/** POST /scheduled/tasks body：task_type=storyboard_generate（§5.1；auto_montage 默认 false，§11-2 两段式） */
export function buildStoryboardGenerateBody(p: StoryboardGenerateParams): Record<string, unknown> {
  if (!GENERATE_STAGE_VALUES.includes(p.stage)) {
    throw new Error(`非法 stage：${p.stage}（合法值 ${GENERATE_STAGE_VALUES.join('|')}；与 comfygen stage 同名异值勿混）`)
  }
  const params: Record<string, unknown> = { script_id: p.scriptId, stage: p.stage }
  if (p.onlyShots?.length) params.only_shots = p.onlyShots
  if (p.fidelityOverride) params.fidelity_override = p.fidelityOverride
  params.auto_montage = p.autoMontage ?? false
  return { task_type: 'storyboard_generate', params }
}

/**
 * HumanGate② 帧确认表单值（实测 2026-10-02：PUT frames 为 multipart/form-data，
 * 字段 first/last 文件可选 + confirmed 布尔；本函数返回确认形态的表单值，
 * 由调用方以 multipart 编码发送，无文件）。
 */
export function buildFramesConfirmBody(): Record<string, unknown> {
  return { confirmed: true }
}

/** HumanGate② 手动换帧 multipart 文件组（§9：multipart 上传首/尾帧；
 *  渲染层文件约定 {path}，主进程 multipartUpload 读盘上传，同 SplitRequest 口径） */
export function buildFramesReplaceFiles(firstLocalPath?: string, lastLocalPath?: string): { first?: { path: string }; last?: { path: string } } {
  const files: { first?: { path: string }; last?: { path: string } } = {}
  if (firstLocalPath) files.first = { path: firstLocalPath }
  if (lastLocalPath) files.last = { path: lastLocalPath }
  return files
}
