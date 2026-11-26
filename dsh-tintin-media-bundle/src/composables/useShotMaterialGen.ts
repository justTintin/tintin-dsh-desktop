// useShotMaterialGen — 文案混剪分镜「按轨道」素材生产：在线搜索/AI生成/A-Roll 数字人。
// 用户裁决 2026-11-26（四源四轨）：不同视频源=不同轨道各一占位——素材绑定轨=clipGroups
// 既有，本文件生产的 AI生成/在线搜索/A-Roll 三轨产物写 shot.slots（不再塞绑定池）；
// 每镜至少一条轨道有内容才能合成（校验在合成侧 resolveShotTrack）。
// 2026-11-25 用户报障历史：逐镜独立状态（阶段/进度/耗时）——同镜同轨防重入，跨镜跨轨并行。
import { ref, type Ref } from 'vue'
import { API_PATHS } from '../types/server-api'
import { joinPath } from './copywritingMontage/context'
import { readCacheDir } from './useSettingsConfig'
import { extractTaskObj, mapTaskStatus } from './copywritingMontageCommonLogic'
import { onlineKey, onlineSafeName, type OnlineItem } from './useOnlineStock'
import { markedShotIdxs } from './copywritingMontageTrackLogic'
import type { ShotTrackSlots } from './opsStoryboardLogic'
import type { StoryboardShot } from './opsStoryboardLogic'

const POLL_INTERVAL = 3_000
const POLL_BUDGET = 30 * 60_000
/** A-roll per_shot 批量预算：N 镜逐镜生成可达小时级（2026-11-26 一次上传直生成流） */
const AROLL_POLL_BUDGET = 120 * 60_000

export type ShotTrackKey = keyof ShotTrackSlots

/** 单轨任务状态（分镜卡该轨瓦片进度卡数据源） */
export interface ShotGenState {
  /** submitting=提交任务 / generating=服务端生成中 / downloading=下载产物 / done=完成 / failed=失败 */
  phase: 'submitting' | 'generating' | 'downloading' | 'done' | 'failed'
  /** 0-100 服务端任务进度；-1=服务端未报进度（动画条兜底） */
  progress: number
  taskId: string
  msg: string
  startedAt: number
  elapsedSec: number
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e) }

const ACTIVE_PHASES: ReadonlySet<ShotGenState['phase']> = new Set(['submitting', 'generating', 'downloading'])

export function useShotMaterialGen(deps: {
  imageDuration: Ref<number>
  splitsJobId: Ref<string>
  activeLayout: Ref<string>
  productBrief: Ref<unknown>
  /** 激活 tab 的分镜数组（轨道产物写 shot.slots；批量按 markARoll/markAI 复选过滤） */
  activeShots: () => StoryboardShot[]
  /** 激活 tab 的服务端身份（A-Roll 数字人：脚本已同步即可） */
  digitalHuman: () => { scriptId: string; voiceAudioId: string; voiceWav: string }
  /** A-roll per_shot 预置：把脚本 PUT 回写 aroll.mode='per_shot'（2026-11-26 用户转述
   *  服务端契约：stage=aroll 一次触发，切分/对齐/逐镜生成/回写全服务端包干） */
  syncArollPerShot: () => Promise<void>
  /** 该镜素材绑定轨是否有货（A-Roll 跳过镜的判定口径与合成一致） */
  hasMaterial: (idx: number) => boolean
}) {
  const busy = ref(false)
  const msg = ref('')
  /** 分组消息（2026-11-26 用户裁决：每个分组进度/提示单独——A-Roll 组与 AI 生成组
   *  各自显示自己的消息，不再共用一条全局 msg 互相串台） */
  const groupMsgs = ref<{ ai: string; aroll: string }>({ ai: '', aroll: '' })
  function setGroupMsg(kind: 'ai' | 'aroll', text: string): void {
    groupMsgs.value[kind] = text
    msg.value = text // 全局状态行（分镜脚本信息行）仍镜像最新一条
  }
  /** 逐镜逐轨状态表（key=`${shotIdx}:${track}`；done/failed 终态保留供瓦片回显） */
  const states = ref<Record<string, ShotGenState>>({})

  const keyOf = (idx: number, track: ShotTrackKey): string => `${idx}:${track}`

  function setState(k: string, patch: Partial<ShotGenState>): void {
    const prev = states.value[k]
    states.value[k] = {
      phase: patch.phase ?? prev?.phase ?? 'submitting',
      progress: patch.progress ?? prev?.progress ?? -1,
      taskId: patch.taskId ?? prev?.taskId ?? '',
      msg: patch.msg ?? prev?.msg ?? '',
      startedAt: patch.startedAt ?? prev?.startedAt ?? Date.now(),
      elapsedSec: patch.elapsedSec ?? prev?.elapsedSec ?? 0,
    }
  }
  /** 该镜该轨是否有进行中任务（瓦片按钮/进度卡的唯一判据） */
  function active(idx: number, track: ShotTrackKey): boolean {
    const s = states.value[keyOf(idx, track)]
    return !!s && ACTIVE_PHASES.has(s.phase)
  }
  function stateOf(idx: number, track: ShotTrackKey): ShotGenState | undefined { return states.value[keyOf(idx, track)] }
  /** 进度口径对齐 pollPhaseText：≤1 视为小数 ×100；>1 直接当百分数；缺失=-1 */
  function progressOf(task: Record<string, unknown> | undefined): number {
    const p = Number(task?.progress)
    if (!Number.isFinite(p) || p < 0) return -1
    return Math.min(100, Math.round(p <= 1 ? p * 100 : p))
  }

  /** 轨道产物写入（slots 按轨覆盖；undefined=清除该轨） */
  function setSlot(idx: number, track: ShotTrackKey, data: ShotTrackSlots[ShotTrackKey] | undefined): void {
    const shot = deps.activeShots()[idx]
    if (!shot) return
    const slots: ShotTrackSlots = { ...(shot.slots || {}) }
    if (data === undefined) delete slots[track]
    else (slots as Record<string, unknown>)[track] = data
    shot.slots = slots
  }

  /** 批量进度汇总（组进度行数据源）：total=标记数，done=已有轨产物或终态 done；
   *  markAI 对应 slots.gen 键、markARoll 对应 slots.aroll */
  function batchProgressOf(mode: 'ai' | 'aroll'): { total: number; done: number; failed: number; active: number } {
    const slotKey = (mode === 'ai' ? 'gen' : mode) as ShotTrackKey
    const marked = mode === 'ai' ? 'markAI' : 'markARoll'
    const shots = deps.activeShots()
    let total = 0, done = 0, failed = 0, activeN = 0
    shots.forEach((s, i) => {
      if (!s[marked]) return
      total += 1
      if (s.slots?.[slotKey]?.local) { done += 1; return }
      const st = states.value[keyOf(i, slotKey)]
      if (st?.phase === 'done') done += 1
      else if (st?.phase === 'failed') failed += 1
      else if (st && ACTIVE_PHASES.has(st.phase)) activeN += 1
    })
    return { total, done, failed, active: activeN }
  }

  /** 在线搜索命中 → 下载到缓存 → 写搜索轨占位（2026-11-26 轨道裁决：不再入绑定池）。 */
  async function addOnline(idx: number, item: OnlineItem): Promise<boolean> {
    const url = String(item.url || '')
    if (!url) { msg.value = '素材地址缺失'; return false }
    const k = keyOf(idx, 'stock')
    if (active(idx, 'stock')) return false
    busy.value = true; msg.value = ''
    setState(k, { phase: 'downloading', progress: -1, msg: '正在下载在线素材…' })
    try {
      const dir = joinPath(await readCacheDir(), 'montage_cache', deps.splitsJobId.value || 'session', 'stock')
      const ext = item.type === 'image' ? '.jpg' : '.mp4'
      const local = joinPath(dir, `${onlineSafeName(item)}${ext}`)
      const res = await window.tintin.server.downloadResult(url, local)
      if (res === null) throw new Error('下载通道不可达')
      if (res && typeof res === 'object' && 'error' in res) throw new Error(String((res as { error: unknown }).error || '下载失败'))
      setSlot(idx, 'stock', { url, local })
      msg.value = `已下载到第 ${idx + 1} 镜搜索轨。`
      setState(k, { phase: 'done', msg: '已下载' })
      return true
    } catch (e) {
      msg.value = `在线素材下载失败：${errMsg(e)}`
      setState(k, { phase: 'failed', msg: `下载失败：${errMsg(e)}` })
      return false
    } finally { busy.value = false }
  }

  /** AI 生成轨（2026-11-26 轨道裁决：产物写 slots.gen，不再入绑定池）：分析镜头画面 →
   *  服务端生成视频 → 统一任务轮询 → 下载 → 写轨。 */
  async function generate(idx: number, shot: StoryboardShot): Promise<boolean> {
    const visual = String(shot.visual || '').trim()
    if (!visual) { setGroupMsg('ai', '该镜头没有画面描述，无法生成'); return false }
    const k = keyOf(idx, 'gen')
    if (active(idx, 'gen')) return false // 同镜同轨防重入
    setGroupMsg('ai', '')
    const startedAt = Date.now()
    setState(k, { phase: 'submitting', progress: -1, msg: '正在提交生成任务…', startedAt, elapsedSec: 0 })
    try {
      // 产品简介只取字符串字段（2026-11-26 报障：[brief,...].join 把对象整体字符串化
      // 成「[object Object]」混进 prompt——字段口径对齐 productBriefOf）
      const brief = (deps.productBrief.value && typeof deps.productBrief.value === 'object'
        ? deps.productBrief.value : {}) as Record<string, unknown>
      const product = [brief.brand, brief.product || brief.category, brief.model]
        .map((x) => String(x ?? '').trim()).filter(Boolean).join(' / ')
      const prompt = [visual, product].filter(Boolean).join('；').slice(0, 2000)
      const duration = Math.max(1, Math.round(Number(shot.duration) || 3))
      const aspect = deps.activeLayout.value === 'horizontal' ? '16:9' : deps.activeLayout.value === 'vertical' ? '9:16' : '9:16'
      const submitted = await window.tintin.server.post<Record<string, unknown>>(
        API_PATHS.generate.video,
        { prompt, aspect, resolution: '720p', duration },
        {}, 30_000,
      )
      if (!submitted) throw new Error('服务端不可达')
      if (submitted.error) throw new Error(String(submitted.error))
      const taskId = String(submitted.task_id ?? submitted.id ?? '')
      if (!taskId) throw new Error('生成响应缺 task_id')
      setState(k, { phase: 'generating', taskId, msg: 'AI 生成中…' })
      setGroupMsg('ai', `第 ${idx + 1} 镜已提交生成（${taskId}），等待完成…`)

      const started = Date.now()
      let output = ''
      while (Date.now() - started < POLL_BUDGET) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        const node = await window.tintin.server.tasksUnifiedItem(taskId)
        // 2026-11-26 报障「生成失败：null」：统一任务视图恒带 error 键（未失败=null）——
        // 键存在≠失败，必须判空值；否则 String(null)='null' 在首轮轮询就误抛
        const nodeErr = (node && typeof node === 'object' ? (node as { error?: unknown }).error : undefined)
        if (nodeErr !== null && nodeErr !== undefined && nodeErr !== '') throw new Error(String(nodeErr))
        const task = extractTaskObj(node)
        const phase = mapTaskStatus(task?.status ?? task?.state, task).phase
        setState(k, {
          phase: 'generating',
          progress: progressOf(task),
          elapsedSec: Math.round((Date.now() - startedAt) / 1000),
          msg: 'AI 生成中…',
        })
        if (phase === 'failed') throw new Error(String(task?.error_message ?? task?.error ?? task?.last_message ?? '生成失败'))
        if (phase === 'done') {
          const result = (task?.result ?? {}) as Record<string, unknown>
          output = String(result.output_url ?? result.output_path ?? result.url ?? '')
          if (!output) throw new Error('生成完成但缺产物地址')
          break
        }
      }
      if (!output) throw new Error('生成超时（30 分钟）')

      setState(k, { phase: 'downloading', progress: -1, msg: '生成完成，正在下载产物…', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      const dir = joinPath(await readCacheDir(), 'montage_cache', deps.splitsJobId.value || 'session', 'generated')
      const local = joinPath(dir, `${taskId}.mp4`)
      const res = await window.tintin.server.downloadResult(output, local)
      if (res === null) throw new Error('产物下载通道不可达')
      if (res && typeof res === 'object' && 'error' in res) throw new Error(String((res as { error: unknown }).error || '产物下载失败'))
      setSlot(idx, 'gen', { local, taskId })
      setGroupMsg('ai', `第 ${idx + 1} 镜 AI 生成完成。`)
      setState(k, { phase: 'done', progress: 100, msg: '已生成', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      return true
    } catch (e) {
      setGroupMsg('ai', `生成失败：${errMsg(e)}`)
      setState(k, { phase: 'failed', msg: `生成失败：${errMsg(e)}`, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      return false
    }
  }

  /** 服务端声音按镜拆分（契约 POST /audio/voice/split-by-shots {script_id,
   *  source_audio_id?} → [{shot_index(0-based),audio_id,...}]，段入音频库；首次走
   *  whisper 对齐，服务端要求客户端超时 ≥600s）。2026-11-26 服务端会话实证
   *  （script_cadfc488ba3e/5280 案例）：克隆音频已上传（tab.voiceAudioId 有值）但
   *  脚本绑定回写晚于 split 调用=404「未绑定口播音频」——body 直带 source_audio_id
   *  （上传响应的音频库 id），不依赖脚本绑定状态。返回富结果：**detail 逐字透出
   *  服务端返回**（业务 400/404 的 detail——如「脚本不存在」「各镜 shot.audio 全空」）；
   *  undeployed 仅裸「Not Found」（该服务端真没部署此路由）；其他失败原样上抛。 */
  async function splitVoiceByScript(scriptId: string, sourceAudioId?: string): Promise<{ map: Map<number, string>; detail: string; undeployed: boolean }> {
    const empty = (detail: string, undeployed = false) => ({ map: new Map<number, string>(), detail, undeployed })
    const body: Record<string, unknown> = { script_id: scriptId }
    const src = String(sourceAudioId ?? '').trim()
    if (src) body.source_audio_id = src
    let res: unknown
    try {
      res = await window.tintin.server.post<unknown>('/audio/voice/split-by-shots', body, {}, 600_000)
    } catch (e) {
      const status = (e as { status?: number })?.status
      const body = String((e as { message?: string })?.message || '').replace(/^HTTP \d+：/, '')
      if (status === 404) {
        // 服务端对存在路由的业务 404 带 JSON detail（「脚本不存在: xxx」）；
        // 裸 Not Found 才是路由未部署（FastAPI 缺路由缺省体）
        if (/Not Found/.test(body) && !/脚本|各镜|audio/.test(body)) return empty('HTTP 404（该服务端未部署声音按镜拆分接口）', true)
        return empty(body || 'HTTP 404', false)
      }
      throw e
    }
    if (!res) return empty('服务端响应为空')
    if (typeof res === 'object' && 'error' in (res as Record<string, unknown>)) {
      return empty(String((res as Record<string, unknown>).error || '服务端返回错误'))
    }
    if (typeof res === 'object' && 'detail' in (res as Record<string, unknown>)) {
      return empty(String((res as Record<string, unknown>).detail)) // 服务端业务 400/404 明细（如「各镜 shot.audio 全空」）
    }
    const list = Array.isArray(res) ? res : (res as { items?: unknown[] })?.items
    if (!Array.isArray(list)) return empty(`响应非数组：${String(res).slice(0, 120)}`)
    const map = new Map<number, string>()
    for (const row of list as Array<Record<string, unknown>>) {
      // 服务端 shot_index 为 0-based（2026-11-26 实测：首镜 shot_index=0）
      const idx = Number(row.shot_index)
      const audioId = String(row.audio_id ?? row.audioId ?? '')
      if (Number.isInteger(idx) && idx >= 0 && audioId) map.set(idx, audioId)
    }
    if (!map.size) return empty(`返回 ${list.length} 行但无一含 audio_id（首行：${JSON.stringify(list[0]).slice(0, 120)}）`)
    return { map, detail: `${map.size}/${list.length} 行有效`, undeployed: false }
  }

  /** 批量 AI 生成（2026-11-26 用户裁决：所有勾选 AI生成的分镜并行提交，进度就地）。 */
  async function batchGenerateAI(): Promise<void> {
    const shots = deps.activeShots()
    const idxs = markedShotIdxs(shots, 'ai')
    if (!idxs.length) { setGroupMsg('ai', '没有勾选「AI生成」的分镜（或勾选分镜已全部有产物）。'); return }
    busy.value = true
    try {
      const results = await Promise.all(idxs.map((i) => generate(i, shots[i]!)))
      const ok = results.filter(Boolean).length
      setGroupMsg('ai', `AI 批量生成完成：成功 ${ok}/${idxs.length}。`)
    } finally { busy.value = false }
  }

  /** 批量 A-Roll（2026-11-26 用户裁决两条：①进度显示到对应分镜的 A-Roll 瓦片，
   *  不再全组同文案；②生成一个回轨一个——轮询中每 tick 并读脚本 detail，逐镜
   *  aroll_material_id 一出现立即下载写该镜 A-Roll 轨，不等全部完成。
   *  契约：切分/对齐/逐镜生成/回写全在 stage=aroll 任务内部自动完成
   *  （cut_wav_window），客户端只触发**一次**任务——①脚本预置 aroll.mode=
   *  'per_shot'+aroll.audio_id（syncArollPerShot，audio_id 缺失=worker 拒任务）
   *  2026-11-26 契约 2ef347a0 选镜制：params 必须带 aroll_shot_indexes（0-based
   *  列表=pending 镜的 0-based 镜号），不给→任务失败明确报错
   *  ②POST /scheduled/tasks {script_id, stage:'aroll', aroll_image: 人物图服务端
   *  路径} ③轮询+逐镜回轨 ④任务终态兜底扫尾。有素材镜服务端自动跳过=保留素材
   *  轨，起跑即标完成。人物图必须先经 product-upload 落到服务端路径。 */
  async function batchGenerateARoll(personImagePath: string): Promise<void> {
    const shots = deps.activeShots()
    const idxs = markedShotIdxs(shots, 'aroll')
    if (!idxs.length) { setGroupMsg('aroll', '没有勾选「生成A-Roll」的分镜（或勾选分镜已全部有产物）。'); return }
    const { scriptId } = deps.digitalHuman()
    if (!scriptId) { setGroupMsg('aroll', '该分镜脚本尚未同步到服务端：请先在第 2 步完成口播配音（克隆完成会自动同步）。'); return }
    const imagePath = String(personImagePath || '').trim()
    if (!imagePath) { setGroupMsg('aroll', 'A-Roll 组需要先上传人物图。'); return }
    busy.value = true
    const startedAt = Date.now()
    /** 尚未回轨的镜 index 集合（回轨/跳过即移出；失败上报以 states 终态为准） */
    const pending = new Set<number>()
    try {
      // ①脚本预置 per_shot 模式（含 aroll.audio_id；失败=中断，缺模式 worker 会走整条旧语义）
      setGroupMsg('aroll', '正在把脚本置为 A-roll 按镜生成模式…')
      await deps.syncArollPerShot()
      // 有素材镜不进生成范围（保留素材轨）——起跑即标完成，不占回轨等待
      for (const i of idxs) {
        const k = keyOf(i, 'aroll')
        if (deps.hasMaterial(i)) setState(k, { phase: 'done', progress: 100, msg: '已绑定素材，自动跳过' })
        else { pending.add(i); setState(k, { phase: 'submitting', progress: -1, msg: '正在提交 A-roll 任务…', startedAt, elapsedSec: 0 }) }
      }
      // 全部勾选镜都已绑素材：无生成范围，不提交任务（2026-11-26 选镜制契约下空列表会被拒）
      if (!pending.size) {
        setGroupMsg('aroll', '勾选「生成A-Roll」的镜均已绑定素材，无需生成。')
        msg.value = 'A-Roll：勾选镜均已绑定素材，无需生成。'
        return
      }
      // ②一次触发 stage=aroll 任务（切分/对齐/逐镜生成/回写全服务端包干）。
      // 2026-11-26 契约 2ef347a0（选镜制）：per_shot 必须显式传 params.aroll_shot_indexes
      // （0-based 列表）=pending 镜的 0-based 镜号，不给→任务失败明确报错
      const arollShotIndexes = [...pending].map((i) => {
        const n = Number(shots[i]!.index)
        return Number.isFinite(n) && n > 0 ? n - 1 : i
      })
      setGroupMsg('aroll', '正在提交 A-roll 任务…')
      const submitted = await window.tintin.server.post<Record<string, unknown>>(
        '/scheduled/tasks',
        { task_type: 'storyboard_generate', params: { script_id: scriptId, stage: 'aroll', aroll_image: imagePath, auto_montage: false, aroll_shot_indexes: arollShotIndexes } },
        {}, 30_000,
      )
      if (!submitted) throw new Error('服务端不可达')
      if (submitted.error) throw new Error(String(submitted.error))
      const taskId = String(submitted.task_id ?? submitted.id ?? '')
      if (!taskId) throw new Error('A-roll 提交响应缺 id/task_id')
      const tickMsg = (verb: string): string => `${verb}（已回轨 ${idxs.length - pending.size}/${idxs.length}）…`
      for (const i of pending) setState(keyOf(i, 'aroll'), { phase: 'generating', taskId, msg: '数字人生成中…' })
      setGroupMsg('aroll', tickMsg('A-roll 已提交'))
      const dir = joinPath(await readCacheDir(), 'montage_cache', deps.splitsJobId.value || 'session', 'generated')

      /** 单镜回轨：下载该镜 aroll_material_id 产物→写 A-Roll 轨→瓦片标完成 */
      const fillShot = async (i: number, mid: number): Promise<void> => {
        const k = keyOf(i, 'aroll')
        setState(k, { phase: 'downloading', progress: -1, msg: '生成完成，正在下载产物…' })
        const local = joinPath(dir, `${taskId}_${i + 1}.mp4`)
        const res = await window.tintin.server.downloadResult(`/material/serve?material_id=${mid}`, local)
        if (res === null) { setState(k, { phase: 'failed', msg: '产物下载通道不可达' }); return }
        if (res && typeof res === 'object' && 'error' in res) {
          setState(k, { phase: 'failed', msg: `产物下载失败：${errMsg(res)}` }); return
        }
        setSlot(i, 'aroll', { local, taskId })
        setState(k, { phase: 'done', progress: 100, msg: '数字人已生成', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      }

      /** 回读脚本 detail 取逐镜产物映射（对位：优先脚本镜 index，退回数组位） */
      let scriptShots: Array<Record<string, unknown>> = []
      const readScriptShots = async (): Promise<void> => {
        const detail = await window.tintin.server.get<Record<string, unknown>>(`/api/storyboard/scripts/${scriptId}`)
        const s = ((detail && typeof detail === 'object' && 'script' in detail ? (detail as { script?: Record<string, unknown> }).script : detail) ?? {}) as Record<string, unknown>
        scriptShots = Array.isArray(s.shots) ? s.shots as Array<Record<string, unknown>> : []
      }
      const midOf = (i: number): number => {
        const shot = shots[i]!
        const raw = scriptShots.find((r) => Number(r.index) === Number(shot.index)) ?? scriptShots[i]
        return Number(raw?.aroll_material_id ?? 0)
      }

      // ③轮询到 completed；每 tick 并读脚本——生成一个回轨一个
      const started = Date.now()
      while (Date.now() - started < AROLL_POLL_BUDGET && pending.size) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        const node = await window.tintin.server.get(`/scheduled/tasks/${taskId}`)
        if (node === null || node === undefined) throw new Error('任务通道不可达')
        // 同款判空防御：error 键存在但值为空≠失败
        const nodeErr = (node && typeof node === 'object' ? (node as { error?: unknown }).error : undefined)
        if (nodeErr !== null && nodeErr !== undefined && nodeErr !== '') throw new Error(String(nodeErr))
        const task = extractTaskObj(node)
        const phase = mapTaskStatus(task?.status ?? task?.state, task).phase
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
        await readScriptShots()
        for (const i of [...pending]) {
          const mid = midOf(i)
          if (!mid) {
            setState(keyOf(i, 'aroll'), { phase: 'generating', progress: progressOf(task), elapsedSec, msg: '数字人生成中…' })
            continue
          }
          pending.delete(i)
          await fillShot(i, mid)
        }
        setGroupMsg('aroll', phase === 'done' ? 'A-roll 任务完成，正在核对逐镜产物…' : tickMsg('A-roll 生成中'))
        if (phase === 'failed') throw new Error(String(task?.error_message ?? task?.error_msg ?? task?.error ?? task?.last_message ?? 'A-roll 生成失败'))
        if (phase === 'done') break
      }
      // ④扫尾：任务终态后仍无产物的镜兜底重读一次再判失败（完成瞬间回读竞态先例）
      if (pending.size && pending.size < idxs.length) await readScriptShots()
      for (const i of [...pending]) {
        const mid = midOf(i)
        if (mid) { pending.delete(i); await fillShot(i, mid) }
      }
      for (const i of pending) setState(keyOf(i, 'aroll'), { phase: 'failed', msg: '服务端未回写该镜 A-roll 产物' })
      const okCount = idxs.filter((i) => states.value[keyOf(i, 'aroll')]?.phase === 'done').length
      if (!okCount) throw new Error('A-roll 生成完成但无一镜产物落盘')
      setGroupMsg('aroll', `A-roll 批量生成完成：成功 ${okCount}/${idxs.length}。`)
    } catch (e) {
      // 失败只烧未回轨镜——已回轨/已跳过的瓦片保留终态（用户裁决：回轨不回滚）
      const doneN = idxs.filter((i) => states.value[keyOf(i, 'aroll')]?.phase === 'done').length
      const suffix = doneN ? `（已回轨 ${doneN}/${idxs.length}，其余失败）` : ''
      setGroupMsg('aroll', `A-roll 生成失败${suffix}：${errMsg(e)}`)
      for (const i of idxs) {
        if (states.value[keyOf(i, 'aroll')]?.phase === 'done') continue
        setState(keyOf(i, 'aroll'), { phase: 'failed', msg: `A-roll 生成失败：${errMsg(e)}`, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      }
    } finally { busy.value = false }
  }

  return { busy, msg, groupMsgs, states, active, stateOf, batchProgressOf, addOnline, generate, batchGenerateAI, batchGenerateARoll, splitVoiceByScript }
}
