// ═══════════════════════════════════════════════════════════════
// copywritingMontageStep1SplitLogic.ts — 智能混剪 Step1 素材解析纯逻辑
// 自 copywritingMontageLogic.ts 拆分（铁律 10 / 2026-09-18，纯搬迁零行为改动，
// 拆分过程过 SKILL.md IRON-02 五项 checklist）。
// 对照原客户端 studio/gui：
//   · gui/montage/workers/split_workers.py ServerSplitWorker L121-171
//     （POST /montage/split 响应 shots[] 解析与片段行映射）
//   · utils/montage_cache.py + utils_media.safe_source_name（splits 本地缓存口径）
//   · utils_media.py PR#3 景别分类（classify_shot_type / apply_shot_layout_order）
// 本文件不做任何 IPC / DOM 操作（IRON-06/07 分层）

import type { PickerItem } from "./useWorkbenchPickers"
// ═══════════════════════════════════════════════════════════════

// ── Step1 镜头分割（/montage/split 响应解析）──────────────────

export interface SplitShot {
  startSec: number
  endSec: number
  shotIndex: number
  filename: string
  downloadUrl: string
  /** 服务端绝对路径（resolve_asset 白名单内，可直接喂 /montage/concat 的 clip_urls） */
  serverPath: string
  score?: number
  analysis: string
  description: string
  /** 景别（仅服务端 shot_analysis.shot_type；2026-09-09 裁决：景别客户端不自行推断） */
  shotType: string
  /** 服务端位置标注（/montage/split 逐镜 enter/exit 布尔，2026-09-09 实测确认；
   *  出场命名素材亦返回 false——服务端暂未实际标注，false 视同未标注由渲染层兑底） */
  enter?: boolean
  exit?: boolean
  /** 产品（服务端逐镜分析，多数为空） */
  product: string
  /** 型号（同上） */
  model: string
  /** 画幅 WxH（服务端逐镜返回对象 {width,height}，2026-09-11 实测；空则 UI 用
   *  ffprobe 探测源片结果兜底） */
  resolution: string
}

/** /montage/split 响应 shots 归一化（对照 ServerSplitWorker L121-171；clips/segments 兜底）
 *  服务端实际返回：
 *    aesthetic_score: {total: 4.4, clarity: 1.0, composition: 7.5, engine: "laion+opencv"}
 *    shot_analysis:   {shot_type: "空镜", visual_type: "外观", scene_primary: "...", confidence: 0.95}
 *  顶层无 shot_type 字段，需从 shot_analysis.shot_type 取。
 */
export function parseSplitResponse(resp: unknown): SplitShot[] {
  if (!resp || typeof resp !== 'object') return []
  const r = resp as Record<string, unknown>
  const raw = (r.shots || r.clips || r.segments) as unknown
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => {
      // aesthetic_score 可能是数字（旧版）或对象 {total, clarity, ...}
      const rawScore = s.aesthetic_score ?? s.score
      let score: number | undefined
      if (rawScore != null) {
        if (typeof rawScore === 'object' && rawScore !== null) {
          score = Number((rawScore as Record<string, unknown>).total) || undefined
        } else {
          score = Number(rawScore) || undefined
        }
      }
      // shot_type 嵌套在 shot_analysis 对象内，顶层不存在
      const analysis = s.shot_analysis
      const shotType = String(
        (analysis && typeof analysis === 'object' ? (analysis as Record<string, unknown>).shot_type : s.shot_type) || ''
      )
      const analysisText = analysis && typeof analysis === 'object'
        ? String((analysis as Record<string, unknown>).scene_primary || (analysis as Record<string, unknown>).visual_type || '')
        : String(analysis || '')
      return {
        startSec: Number(s.start_sec) || 0,
        endSec: Number(s.end_sec ?? s.start_sec ?? 0) || 0,
        shotIndex: Math.floor(Number(s.shot_index) || 0),
        filename: String(s.filename || ''),
        downloadUrl: String(s.download_url || ''),
        serverPath: String(s.path || ''),
        score,
        analysis: analysisText,
        description: String(s.description || ''),
        shotType,
        enter: !!s.enter,
        exit: !!s.exit,
        product: String((analysis && typeof analysis === 'object' ? (analysis as Record<string, unknown>).product : s.product) || ''),
        model: String((analysis && typeof analysis === 'object' ? (analysis as Record<string, unknown>).model : s.model) || ''),
        // 逐镜画幅：服务端返回对象 {width,height}（2026-09-11 在线实测），
        // 统一归一化为 "WxH"——旧实现 String(对象) 直接渲染成 "[object Object]"
        resolution: normalizeSourceResolution(s.resolution),
      }
    })
}

export interface SplitSceneRow {
  idx: number
  name: string
  sourceName: string
  startSec: number
  endSec: number
  duration: number
  description: string
  analysis: string
  score?: number
  clipUrl: string
  /** 服务端绝对路径（resolve_asset 白名单内，/montage/concat clip_urls 用此字段） */
  serverPath: string
  downloadState: 'pending' | 'ok' | 'failed'
  /** 本地 splits 目录落盘路径（分割后批量下载填充；空=未落盘，预览回退内嵌） */
  clipLocalPath?: string
  checked: boolean
  /** 景别（仅服务端 shot_analysis.shot_type，客户端不自行推断，空则 UI 显 —） */
  shotType?: string
  /** 媒体类型（2026-09-23 用户裁决：素材库图片素材入池时标注，选择池缩略图按类型渲染；
   *  本地分割产物恒 video 缺省） */
  mediaType?: 'video' | 'image'
  /** 位置（2026-09-09 裁决与 /montage/split 对齐：位置≠景别，指入场/出场等叙事位置）：
   *  服务端 enter/exit 布尔优先，否则按源素材文件名/文件夹命名兜底推断（原 classify 口径） */
  position?: string
  /** 位置来源描述：服务端标注 / 文件名「xx」/ 文件夹「xx」；空=未标注 */
  positionSource?: string
  /** PR#4 条目10：本地已裁剪替换（concat 需改走本地 files 上传，服务端 clip 指向未裁剪原件） */
  trimmed?: boolean
  product?: string   // 产品列（服务端逐镜分析，空则 UI 显 —）
  model?: string     // 型号列（同上）
  resolution?: string // 画幅列（服务端返回，空则 UI 用 ffprobe 探测源片结果兜底）
  /** 服务端使用次数（2026-09-30 用户裁决：选择池条目展示热度——素材库条目入池时自
   *  /material/list 携带，口径同工作台选素材弹窗：原素材=usage_count_total（源聚合），
   *  回落 usage_count（自身）；本地分割产物无此字段=不显示 */
  usageCount?: number
}

/** shots → 镜头表格行（checked 默认 true，行号从 1 起；sourcePath 用于「位置」兜底推断——
 *  景别仅认服务端返回；位置服务端 enter/exit 优先、路径命名兜底，2026-09-09 裁决） */
export function shotsToRows(shots: SplitShot[], sourceName: string, sourcePath?: string): SplitSceneRow[] {
  const detail = sourcePath ? classifyShotTypeDetail(sourcePath) : null
  // 位置兑底只认入场/出场（2026-09-09 用户裁决二次纠偏：特写/中景是景别不是位置，
  //  不得因文件名含「特写」就标进位置列；原版消费侧也只挑 entrance/exit 参与出入场
  //  裁剪/加速，medium/closeup 命中仅用于素材列表景别徽章展示）
  const posType = detail && (detail.type === 'entrance' || detail.type === 'exit') ? detail.type : ''
  return shots.map((s, i) => ({
    idx: i + 1,
    name: s.filename || `${sourceName}_shot_${String(s.shotIndex || i + 1).padStart(3, '0')}.mp4`,
    sourceName,
    startSec: s.startSec,
    endSec: s.endSec,
    duration: Math.max(0, s.endSec - s.startSec),
    description: s.description,
    analysis: s.analysis,
    score: s.score,
    clipUrl: s.downloadUrl,
    serverPath: s.serverPath,
    downloadState: 'pending' as const,
    checked: true,
    // 景别：仅服务端 shot_analysis.shot_type，客户端不自行推断（2026-09-09 裁决）
    ...(s.shotType ? { shotType: s.shotType } : {}),
    // 位置：服务端 enter/exit 标注优先；否则按源素材文件名/文件夹命名兑底（仅入场/出场）
    //（2026-09-09 实测：服务端 enter/exit 恒 false——出场命名素材亦然，false 视同未标注回退路径推断）
    ...(s.enter
      ? { position: 'entrance', positionSource: '服务端标注' }
      : s.exit
        ? { position: 'exit', positionSource: '服务端标注' }
        : posType
          ? { position: posType, positionSource: detail!.origin === 'file' ? `文件名「${detail!.seg}」` : `文件夹「${detail!.seg}」` }
          : {}),
    ...(s.product ? { product: s.product } : {}),
    ...(s.model ? { model: s.model } : {}),
    ...(s.resolution ? { resolution: s.resolution } : {}),
  }))
}

// ── 快速模式分析取件回填（2026-11-05 服务端 fast_mode：GET /montage/split/analysis/
//  {task_id} 按片段文件名补齐逐镜分析；字段形状与同步分割响应同源，对象/扁平双态兼容）──

/** 分割模式选项（2026-11-05 用户裁定：默认快速=服务端 fast_mode 即返片段；正常=原模式同步等分析） */
export const SPLIT_MODE_OPTIONS = [
  { label: '快速模式', value: 'fast' },
  { label: '正常模式', value: 'server' },
]

/** aesthetic_score 数值化（数字直取；对象取 total；缺省 undefined，与 parseSplitResponse 同口径） */
function analysisScoreOf(raw: unknown): number | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'object') return Number((raw as Record<string, unknown>).total) || undefined
  return Number(raw) || undefined
}

/** 逐镜分析取件行回填镜头表格行（mutating）：仅 analyzed 片段且空位才写——
 *  描述空位才回填（不覆盖用户手动改写）；景别/评分/产品/型号仅服务端来源。
 *  返回是否有任何字段实际写入。 */
export function backfillRowsFromAnalysis(rows: SplitSceneRow[], shots: unknown): boolean {
  if (!Array.isArray(shots)) return false
  let applied = 0
  for (const s of shots) {
    if (!s || typeof s !== 'object') continue
    const shot = s as Record<string, unknown>
    if (!shot.analyzed || !shot.filename) continue
    const row = rows.find((r) => r.name === shot.filename)
    if (!row) continue
    const a = shot.shot_analysis
    const aObj = a && typeof a === 'object' ? (a as Record<string, unknown>) : null
    const analysisText = aObj
      ? String(aObj.scene_primary || aObj.visual_type || '')
      : String(a || '')
    if (!row.description && shot.description != null) row.description = String(shot.description)
    if (!row.analysis && analysisText) row.analysis = analysisText
    const shotType = String(aObj?.shot_type || shot.shot_type || '')
    if (!row.shotType && shotType) row.shotType = shotType
    const score = analysisScoreOf(shot.aesthetic_score ?? shot.score)
    if (row.score == null && score != null) row.score = score
    const product = String(aObj?.product || shot.product || '')
    if (!row.product && product) row.product = product
    const model = String(aObj?.model || shot.model || '')
    if (!row.model && model) row.model = model
    applied++
  }
  return applied > 0
}

// ── Step1 splits 本地缓存目录（对齐 utils/montage_cache.py + utils_media.safe_source_name）──

/** 出入场片段时长上限（秒；对照 utils_media.py EDGE_CLIP_MAX_SEC L63） */
export const EDGE_CLIP_MAX_SEC = 4.0

/** 收集出入场超长片段裁剪任务（对照 _maybe_trim_edge_clips L1729-1747 扫描口径：
 *  位置 entrance/exit 且时长 > 阈值；本端位置取行 position（服务端 enter/exit 优先，
 *  路径推断兜底，2026-09-09 裁决），起止秒取行 startSec/endSec（原版从文件名解析） */
export function collectEdgeTrimJobs(rows: SplitSceneRow[]): Array<{
  path: string; startSec: number; endSec: number; idx: number; desc: string; position: string
}> {
  return (rows || [])
    .filter((r) => r.clipLocalPath
      && (r.position === 'entrance' || r.position === 'exit')
      && r.duration > EDGE_CLIP_MAX_SEC + 0.01)
    .map((r) => ({
      path: r.clipLocalPath as string,
      startSec: r.startSec,
      endSec: r.endSec,
      idx: r.idx,
      desc: r.description || '',
      position: r.position || '',
    }))
}

/**
 * 视频文件名 → 统一短源名（splits 目录名/片段文件名共用）。
 * 对照原客户端 gui/montage/utils_media.py safe_source_name(max_len=40)：
 * 替换半角非法字符与控制字符为 _、折叠连续空白、剔除首尾点；
 * 超长截断并附 8 位散列后缀保证唯一（原版 md5 前 8 位；渲染层无 node
 * crypto，用 djb2 32bit hex 等效唯一性——架构差异，目的相同）。
 */
export function safeSourceName(name: string, maxLen = 40): string {
  const base = String(name || '').replace(/\.[^.]+$/, '')
  let cleaned = (base || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '')
  if (!cleaned) cleaned = 'video'
  if (cleaned.length > maxLen) {
    let h = 5381
    for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0
    const digest = (h >>> 0).toString(16).padStart(8, '0')
    cleaned = cleaned.slice(0, maxLen) + '_' + digest
  }
  return cleaned
}

/**
 * 归一化服务端 split 响应的画幅值（原片 source_resolution 与逐镜 resolution 共用）。
 * 对照原版 _detect_and_show_source_resolution L4768-4773（[w,h] 数组 / "WxH" 字符串），
 * 2026-09-11 在线实测补第三形态：**对象 {width,height}**——旧实现落到 String(obj)
 * 分支，表格画幅列直接显示 "[object Object]"（shots[].resolution 实测即为对象）；
 * 无效返回空串，由调用方回退本地探测。
 */
export function normalizeSourceResolution(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    const w = Math.floor(Number(o.width ?? o.w))
    const h = Math.floor(Number(o.height ?? o.h))
    return w > 0 && h > 0 ? `${w}x${h}` : ''
  }
  if (Array.isArray(value) && value.length === 2) {
    const w = Math.floor(Number(value[0]))
    const h = Math.floor(Number(value[1]))
    return w > 0 && h > 0 ? `${w}x${h}` : ''
  }
  const s = String(value || '').trim()
  const m = /^(\d+)x(\d+)$/.exec(s)
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? s : ''
}

/**
 * Step2 画幅基准（2026-09-15 用户裁决：「与原视频一致」的基准=分割片段，非原素材——
 * 服务端分割产物已统一缩放（4K 竖屏素材出 1080x1920），旧实现把 split 响应的
 * source_resolution（原素材 4K）当画幅基准，预合成被撑成 4K/横屏）。
 * 取值链：① 逐镜画幅（服务端 shots[].resolution，分割产物口径，取首个非空）
 *         ② source_resolution 兜底（响应缺逐镜画幅时的降级，仅此一档——
 *            本地探测首个片段由调用方在两者皆缺时执行）。
 * 入参均应为 normalizeSourceResolution 归一化后的 "WxH"；无效返回 ''。
 */
export function resolveSplitBaselineResolution(
  shotResolutions: ReadonlyArray<string | undefined>, serverSourceResolution?: string,
): string {
  for (const r of shotResolutions || []) {
    if (r) return r
  }
  return serverSourceResolution || ''
}

// ── 素材常量与景别分类（对齐原客户端 utils_media.py PR#3）──────────

/** Step1 原始素材支持的视频扩展名（与 VideoMontage.vue 文件选择器共用） */
export const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.webm', '.m4v'] as const

/** 单次导入素材数量上限：防止误选整个媒体库时把上万个文件塞进列表卡死 UI */
export const MAX_SOURCE_VIDEOS = 500

/** 遍历素材文件夹时跳过的子目录名：混剪流程自身产物的派生目录，
 *  避免把上一次生成的镜头片段/配音/成片当成原始素材再喂回流程。 */
export const DERIVED_DIR_NAMES = new Set([
  'splits', 'output', 'outputs', 'final', 'dubbed', 'bgm', 'temp', 'montage_cache',
])

/** 景别分类关键词（大小写不敏感子串匹配）。
 *  与 docs/服务端景别分类与镜头编排需求.md 保持一致。 */
export const SHOT_TYPE_KEYWORDS: Record<string, readonly string[]> = {
  entrance: ['入场', '进场', '开场', 'entrance'],
  exit:     ['出场', '离场', '退场', '收尾', 'exit'],
  medium:   ['中景', 'medium shot', 'medium_shot'],
  closeup:  ['特写', 'closeup', 'close-up', 'close_up'],
}

/** 景别键 → 中文名（UI 展示与文档用） */
export const SHOT_TYPE_LABELS: Record<string, string> = {
  entrance: '入场', exit: '出场', medium: '中景', closeup: '特写',
}

/** 景别键 → 列表项前景色（素材列表里一眼区分景别；未标注保持默认色） */
export const SHOT_TYPE_COLORS: Record<string, string> = {
  entrance: '#2ecc71',  // 绿：入场
  exit:     '#e67e22',  // 橙：出场
  medium:   '#3498db',  // 蓝：中景
  closeup:  '#9b59b6',  // 紫：特写
}

/**
 * 按「文件夹/文件命名」识别素材景别（入场/出场/中景/特写）。
 * 对照原客户端 utils_media.py classify_shot_type()。
 *
 * 规则：
 * - 关键词为大小写不敏感的子串匹配（见 SHOT_TYPE_KEYWORDS）；
 * - 优先匹配文件名（去扩展名），其次父目录由深到浅逐级匹配，命中即返回；
 * - 均未命中返回 ""（未标注，编排时当中间镜头处理）。
 */
export function classifyShotType(filePath: string): string {
  return classifyShotTypeDetail(filePath).type
}

/** 景别推断详情：type=景别键，seg=命中段文本，origin=命中位置（file=文件名 / dir=父目录）。
 *  供分割表「位置」列兑底（仅取 entrance/exit 两键，特写/中景不进位置列）与
 *  素材列表景别徽章（四键全用，2026-09-09 用户裁决：出场/入场是路径命名推断，
 *  非 AI 分析，需在表里展示它是如何来的）。 */
export function classifyShotTypeDetail(filePath: string): { type: string; seg: string; origin: 'file' | 'dir' } {
  if (!filePath) return { type: '', seg: '', origin: 'file' }
  // 取文件名（去扩展名）+ 父目录由深到浅
  const parts = filePath.replace(/\\/g, '/').split('/')
  const fileName = parts[parts.length - 1] || ''
  const nameNoExt = fileName.replace(/\.[^.]+$/, '')
  const dirs = parts.slice(0, -1).filter(Boolean).reverse()
  const segs = [nameNoExt, ...dirs]
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si]
    if (!seg) continue
    const low = seg.toLowerCase()
    for (const [st, kws] of Object.entries(SHOT_TYPE_KEYWORDS)) {
      if (kws.some((kw) => low.includes(kw))) return { type: st, seg, origin: si === 0 ? 'file' : 'dir' }
    }
  }
  return { type: '', seg: '', origin: 'file' }
}

/**
 * 按景别编排镜头顺序：入场放头部、出场放尾部，其余（含未标注）居中混排。
 * 对照原客户端 utils_media.py apply_shot_layout_order()。
 *
 * - 各分组内保持原相对顺序（稳定排序，不额外洗牌，中景/特写天然交错）；
 * - 没有任何入场/出场标注时原样返回（不影响无景别素材的既有行为）。
 */
export function applyShotLayoutOrder<T>(
  seq: T[],
  shotTypes: Map<T, string> | Record<string, string> | ((item: T) => string),
): T[] {
  const clips = [...seq]
  if (!clips.length) return clips
  const getType = (c: T): string => {
    if (typeof shotTypes === 'function') return (shotTypes as (item: T) => string)(c)
    if (shotTypes instanceof Map) return shotTypes.get(c) || ''
    return (shotTypes as Record<string, string>)[String(c)] || ''
  }
  const heads = clips.filter((c) => getType(c) === 'entrance')
  const tails = clips.filter((c) => getType(c) === 'exit')
  if (!heads.length && !tails.length) return clips
  const middle = clips.filter((c) => {
    const t = getType(c)
    return t !== 'entrance' && t !== 'exit'
  })
  return [...heads, ...middle, ...tails]
}


// ── 素材库条目展示辅助（2026-11-05 自 Step2Panel 迁入，铁律 10 行数付账；纯函数）──

// ── 素材重复度筛选（2026-11-05 用户裁定：导入素材量过大，按分镜脚本景别需求匹配筛选）──

/** 景别关键词（按优先级序：先长词后短词，避免「特写镜头」被「镜头」类误切；用户素材
 *  以文件夹名/文件名标注景别，如「雪豹白 特写\C9372.MP4」） */
export const MATERIAL_SHOT_KEYWORDS = ['特写', '近景', '中景', '全景', '远景'] as const

export type MaterialDupMode = 'low' | 'mid' | 'all'

/** 路径（含父文件夹名+文件名）→ 景别关键词；无命中返回 '' */
export function detectShotKeyword(path: string): string {
  const p = String(path || '')
  for (const kw of MATERIAL_SHOT_KEYWORDS) {
    if (p.includes(kw)) return kw
  }
  return ''
}

export interface MaterialFilterNeeds {
  /** 景别 → 单脚本需求个数（各分镜脚本该景别镜头数的最大值；low 档用） */
  needs: Record<string, number>
  /** 景别 → 跨脚本总需求个数（各分镜脚本该景别镜头数之和；mid 档用） */
  sums: Record<string, number>
  /** 分镜脚本（要生成的视频）个数 */
  scripts: number
}

/** 按重复度三档筛选素材路径（纯函数；保留原导入顺序）：
 *  · all  = 不过滤全部导入
 *  · mid（默认）= 每景别选「跨脚本总需求」个——各脚本独立配齐自己的素材（4 视频 ×
 *    每视频 10+ 镜 = 40+，即用户期望的口径）
 *  · low  = 每景别只选「单脚本最大需求」个（跨脚本复用同一批，量最省）
 *  · 识别不出景别的素材仅 all 档导入；需求里没有的景别仅 all 档导入 */
export function filterMaterialsByDupMode(
  paths: string[],
  nf: MaterialFilterNeeds,
  mode: MaterialDupMode,
): string[] {
  if (mode === 'all') return paths.slice()
  const buckets = new Map<string, string[]>()
  for (const p of paths) {
    const kw = detectShotKeyword(p)
    if (!kw) continue // 无景别：低/中档不导入
    const arr = buckets.get(kw) || []
    arr.push(p)
    buckets.set(kw, arr)
  }
  const kept = new Set<string>()
  for (const [kw, perScript] of Object.entries(nf.needs)) {
    const total = mode === 'mid' ? perScript * Math.max(1, nf.scripts) : perScript
    const arr = buckets.get(kw) || []
    for (const p of arr.slice(0, Math.max(0, total))) kept.add(p)
  }
  return paths.filter((p) => kept.has(p))
}

// ── 素材装载统一语义（2026-11-06 用户裁决：手动选文件夹与拖入文件夹完全同语义，
//  无入口差异——重复度算法输入=该文件夹收集到的全部素材，结果追加；再次操作也是
//  追加，同路径去重不重复入列）──

/** 视频扩展名判定（拖入回退直推用；VIDEO_EXTS 为带点小写集合） */
const VIDEO_EXT_SET = new Set<string>(VIDEO_EXTS)
export function hasVideoExt(p: string): boolean {
  const dot = p.lastIndexOf('.')
  return dot >= 0 && VIDEO_EXT_SET.has(p.slice(dot).toLowerCase())
}

/** 本批素材追加（原地改写 current；路径去重 + 总量上限截断）。
 *  返回 added=实际新增、capBlocked=被上限拦下的个数（两个入口共用，杜绝语义分叉） */
export function appendMaterialBatch(
  current: string[], batch: string[], max: number,
): { added: number; capBlocked: number } {
  const present = new Set(current)
  let added = 0
  let capBlocked = 0
  for (const p of batch) {
    if (!p || present.has(p)) continue
    if (current.length >= max) { capBlocked++; continue }
    current.push(p)
    present.add(p)
    added++
  }
  return { added, capBlocked }
}

/** 装载摘要文案（两个入口共用同一份反馈；明示筛选/上限/去重，禁止静默丢弃）：
 *  · 算法有筛选 → 「已按重复度筛选：素材 N 个 → 匹配 M 个」（匹配≠新增，重复操作新增可为 0）
 *  · 匹配 0 → 给出可操作出路（分镜脚本/景别关键词/「全部选择」档） */
export function materialLoadSummary(
  collected: number, filtered: number, added: number, capBlocked: number, max: number,
): string {
  const parts: string[] = []
  if (filtered < collected) parts.push(`已按重复度筛选：素材 ${collected} 个 → 匹配 ${filtered} 个`)
  if (added > 0) parts.push(`新增 ${added} 个`)
  if (capBlocked > 0) parts.push(`素材已达上限（${max}），${capBlocked} 个未导入`)
  if (!added && !capBlocked && filtered > 0) parts.push('所选素材均已在清单中')
  if (collected > 0 && filtered === 0) parts.push('未匹配到素材：需已加载分镜脚本且素材路径含景别关键词（特写/近景/中景/全景/远景），或把重复度切为「全部选择」')
  return parts.join('；')
}

// ── 混剪项目标识（2026-11-06 用户裁决：一次完整的文案混剪=一个项目——相同提示词
//  或相同产品在同一轮混剪里是同一项目；项目目录必须带时间戳，可辨识可排序。
//  原 randomUUID 目录名无时间语义、且每次「开始分割」都换目录，停止续分时
//  已完成素材的片段滞留旧目录，一个批次被拆散到多个目录）──

/** 项目目录标识：`yyyyMMdd-HHmmss-<4hex>`（时间戳可排序可辨识，短随机防同秒碰撞） */
export function montageProjectIdNow(now?: Date): string {
  const t = now ?? new Date()
  const p = (n: number, w: number): string => String(n).padStart(w, '0')
  const ts = `${t.getFullYear()}${p(t.getMonth() + 1, 2)}${p(t.getDate(), 2)}-${p(t.getHours(), 2)}${p(t.getMinutes(), 2)}${p(t.getSeconds(), 2)}`
  const rnd = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')
  return `${ts}-${rnd}`
}

/** 项目身份签名=本轮生成口径的 product_desc（有产品按产品、无产品按提示词，与
 *  genVoiceoverCandidates 同口径）；签名变化=换项目（下次分割开新时间戳目录） */
export function projectIdentityOf(prompt: string, productDesc: string): string {
  return (productDesc || '').trim() || (prompt || '').trim()
}

// ── 项目素材批次持久化（2026-11-06 用户裁决：恢复必须按项目身份校验——记录携带
//  项目身份签名，启动恢复前先比对：本项目的批次才恢复；异项目/旧格式（HEAD 旧构建
//  无项目概念，裸数组记录）一律视为异项目，丢弃且就地清除，不得复活到清单里）──

export interface MaterialBatchRecord {
  sig: string
  src: string[]
  pool: SplitSceneRow[]
}

export function serializeMaterialBatch(rec: MaterialBatchRecord): string {
  return JSON.stringify(rec)
}

/** 解析持久化批次：签名缺失/不匹配、旧格式裸数组、JSON 损坏 → null（调用方丢弃记录）。
 *  素材池行过滤无效行（同 HEAD 恢复口径：idx 有值且三种定位至少其一） */
export function parseMaterialBatch(raw: string, currentSig: string): MaterialBatchRecord | null {
  let rec: unknown = null
  try { rec = JSON.parse(String(raw || '')) } catch { return null }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
  const o = rec as Record<string, unknown>
  if (typeof o.sig !== 'string' || !o.sig || o.sig !== currentSig) return null
  const src = (Array.isArray(o.src) ? o.src : []).filter((p): p is string => typeof p === 'string' && !!p)
  const poolOk = (r: unknown): r is SplitSceneRow => {
    if (!r || typeof r !== 'object') return false
    const row = r as SplitSceneRow
    return row.idx != null && !!(row.serverPath || row.clipUrl || row.clipLocalPath)
  }
  const pool = (Array.isArray(o.pool) ? o.pool : []).filter(poolOk)
  return { sig: o.sig, src, pool }
}

/** 已选素材摘要（2026-11-05 自 Step2Panel 迁入，铁律 10 行数付账；纯函数） */
export function srcSummaryOf(srcCount: number, sceneCount: number): string {
  const parts: string[] = []
  if (srcCount) parts.push(`本地视频 ${srcCount} 个`)
  if (sceneCount) parts.push(`素材池 ${sceneCount} 条片段`)
  return parts.length ? `已选素材：${parts.join('，')}` : '尚未选择素材：点下方「选择素材」开始'
}

/** 素材库条目 material_id（material_id 优先，回落 id） */
export function libMid(it: PickerItem): string {
  return String(it?.material_id ?? it?.id ?? '').trim()
}

/** 素材库条目名（filename 优先；无名回落「素材 <id>」/「未命名素材」） */
export function libName(it: PickerItem): string {
  return String(it?.filename || '') || (libMid(it) ? `素材 ${libMid(it)}` : '未命名素材')
}

/** 素材库条目副行（品牌/型号/产品（share_name 兜底）「 / 」拼接） */
export function libSub(it: PickerItem): string {
  return [String(it?.brand || ''), String(it?.model || ''), String(it?.product || it?.share_name || '')].filter(Boolean).join(' / ')
}
