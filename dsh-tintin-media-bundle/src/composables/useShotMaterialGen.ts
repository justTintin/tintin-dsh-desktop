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
    if (!visual) { msg.value = '该镜头没有画面描述，无法生成'; return false }
    const k = keyOf(idx, 'gen')
    if (active(idx, 'gen')) return false // 同镜同轨防重入
    msg.value = ''
    const startedAt = Date.now()
    setState(k, { phase: 'submitting', progress: -1, msg: '正在提交生成任务…', startedAt, elapsedSec: 0 })
    try {
      const brief = deps.productBrief.value
      const product = brief && typeof brief === 'object'
        ? [brief, (brief as Record<string, unknown>).brand, (brief as Record<string, unknown>).model].filter(Boolean).join(' ')
        : ''
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
      msg.value = `第 ${idx + 1} 镜已提交生成（${taskId}），等待完成…`

      const started = Date.now()
      let output = ''
      while (Date.now() - started < POLL_BUDGET) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        const node = await window.tintin.server.tasksUnifiedItem(taskId)
        if (node && typeof node === 'object' && 'error' in node) throw new Error(String((node as { error: unknown }).error))
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
      msg.value = `第 ${idx + 1} 镜 AI 生成完成。`
      setState(k, { phase: 'done', progress: 100, msg: '已生成', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      return true
    } catch (e) {
      msg.value = `生成失败：${errMsg(e)}`
      setState(k, { phase: 'failed', msg: `生成失败：${errMsg(e)}`, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      return false
    }
  }

  /** 服务端声音按镜拆分（契约 POST /audio/voice/split-by-shots {script_id} →
   *  [{shot_index(0-based),audio_id,...}]，段入音频库；首次走 whisper 对齐，服务端
   *  要求客户端超时 ≥600s）。返回富结果：**detail 逐字透出服务端返回**（业务 400/404
   *  的 detail——如「脚本不存在」「各镜 shot.audio 全空」）；undeployed 仅裸
   *  「Not Found」（该服务端真没部署此路由）；其他失败原样上抛。 */
  async function splitVoiceByScript(scriptId: string): Promise<{ map: Map<number, string>; detail: string; undeployed: boolean }> {
    const empty = (detail: string, undeployed = false) => ({ map: new Map<number, string>(), detail, undeployed })
    let res: unknown
    try {
      res = await window.tintin.server.post<unknown>('/audio/voice/split-by-shots', { script_id: scriptId }, {}, 600_000)
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
    if (!idxs.length) { msg.value = '没有勾选「AI生成」的分镜（或勾选分镜已全部有产物）。'; return }
    busy.value = true
    try {
      const results = await Promise.all(idxs.map((i) => generate(i, shots[i]!)))
      const ok = results.filter(Boolean).length
      msg.value = `AI 批量生成完成：成功 ${ok}/${idxs.length}。`
    } finally { busy.value = false }
  }

  /** 批量 A-Roll（2026-11-26 用户转述服务端最终契约：切分/对齐/逐镜生成/回写全在
   *  stage=aroll 任务内部自动完成（cut_wav_window），客户端只触发**一次**任务——
   *  ①脚本预置 aroll.mode='per_shot'（syncArollPerShot PUT 回写）②POST /scheduled
   *  /tasks {script_id, stage:'aroll', aroll_image: 人物图服务端路径} ③轮询到 completed
   *  → 每镜脚本回写 aroll_material_id → 逐镜下载 → 写各镜 A-Roll 轨（有素材镜服务端
   *  自动跳过=保留素材轨）。人物图必须先经 product-upload 落到服务端路径。 */
  async function batchGenerateARoll(personImagePath: string): Promise<void> {
    const shots = deps.activeShots()
    const idxs = markedShotIdxs(shots, 'aroll')
    if (!idxs.length) { msg.value = '没有勾选「生成A-Roll」的分镜（或勾选分镜已全部有产物）。'; return }
    const { scriptId } = deps.digitalHuman()
    if (!scriptId) { msg.value = '该分镜脚本尚未同步到服务端：请先在第 2 步完成口播配音（克隆完成会自动同步）。'; return }
    const imagePath = String(personImagePath || '').trim()
    if (!imagePath) { msg.value = 'A-Roll 组需要先上传人物图。'; return }
    busy.value = true
    const startedAt = Date.now()
    try {
      // ①脚本预置 per_shot 模式（失败=中断，缺模式 worker 会走整条旧语义）
      msg.value = '正在把脚本置为 A-roll 按镜生成模式…'
      await deps.syncArollPerShot()
      // ②一次触发 stage=aroll 任务（切分/对齐/逐镜生成/回写全服务端包干）
      for (const i of idxs) setState(keyOf(i, 'aroll'), { phase: 'submitting', progress: -1, msg: '正在提交 A-roll 任务…', startedAt, elapsedSec: 0 })
      msg.value = '正在提交 A-roll 任务…'
      const submitted = await window.tintin.server.post<Record<string, unknown>>(
        '/scheduled/tasks',
        { task_type: 'storyboard_generate', params: { script_id: scriptId, stage: 'aroll', aroll_image: imagePath, auto_montage: false } },
        {}, 30_000,
      )
      if (!submitted) throw new Error('服务端不可达')
      if (submitted.error) throw new Error(String(submitted.error))
      const taskId = String(submitted.task_id ?? submitted.id ?? '')
      if (!taskId) throw new Error('A-roll 提交响应缺 id/task_id')
      for (const i of idxs) setState(keyOf(i, 'aroll'), { phase: 'generating', taskId, msg: '数字人生成中…' })
      msg.value = `A-roll 已提交（任务 ${taskId}，逐镜生成有素材镜自动跳过）…`

      // ③轮询到 completed（逐镜生成可达小时级，预算 120 分钟）
      const started = Date.now()
      while (Date.now() - started < AROLL_POLL_BUDGET) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        const node = await window.tintin.server.get(`/scheduled/tasks/${taskId}`)
        if (node === null || node === undefined) throw new Error('任务通道不可达')
        if (node && typeof node === 'object' && 'error' in node) throw new Error(String((node as { error: unknown }).error))
        const task = extractTaskObj(node)
        const phase = mapTaskStatus(task?.status ?? task?.state, task).phase
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
        for (const i of idxs) {
          setState(keyOf(i, 'aroll'), { phase: 'generating', progress: progressOf(task), elapsedSec, msg: '数字人生成中…' })
        }
        if (phase === 'failed') throw new Error(String(task?.error_message ?? task?.error_msg ?? task?.error ?? task?.last_message ?? 'A-roll 生成失败'))
        if (phase === 'done') break
      }
      // ④逐镜产物=脚本回写 aroll_material_id（2026-11-26 用户转述契约）：回读脚本 detail
      msg.value = 'A-roll 任务完成，正在回读逐镜产物…'
      const detail = await window.tintin.server.get<Record<string, unknown>>(`/api/storyboard/scripts/${scriptId}`)
      const s = ((detail && typeof detail === 'object' && 'script' in detail ? (detail as { script?: Record<string, unknown> }).script : detail) ?? {}) as Record<string, unknown>
      const rawShots = Array.isArray(s.shots) ? s.shots as Array<Record<string, unknown>> : []
      const dir = joinPath(await readCacheDir(), 'montage_cache', deps.splitsJobId.value || 'session', 'generated')
      let okCount = 0
      let skipCount = 0
      for (const i of idxs) {
        const shot = shots[i]!
        const k = keyOf(i, 'aroll')
        // 对位：优先按脚本镜 index 匹配，退回数组位
        const raw = rawShots.find((r) => Number(r.index) === Number(shot.index)) ?? rawShots[i]
        const mid = Number(raw?.aroll_material_id ?? 0)
        const bound = deps.hasMaterial(i)
        if (!mid) {
          if (bound) {
            // 有素材镜服务端自动跳过（保留素材轨）——终态 done 计入
            setState(k, { phase: 'done', progress: 100, msg: '已绑定素材，自动跳过' })
            okCount += 1; skipCount += 1; continue
          }
          setState(k, { phase: 'failed', msg: '服务端未回写该镜 A-roll 产物' }); continue
        }
        setState(k, { phase: 'downloading', progress: -1, msg: '生成完成，正在下载产物…' })
        const local = joinPath(dir, `${taskId}_${i + 1}.mp4`)
        const res = await window.tintin.server.downloadResult(`/material/serve?material_id=${mid}`, local)
        if (res === null) { setState(k, { phase: 'failed', msg: '产物下载通道不可达' }); continue }
        if (res && typeof res === 'object' && 'error' in res) {
          setState(k, { phase: 'failed', msg: `产物下载失败：${errMsg(res)}` }); continue
        }
        setSlot(i, 'aroll', { local, taskId })
        setState(k, { phase: 'done', progress: 100, msg: '数字人已生成', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
        okCount += 1
      }
      if (!okCount && !skipCount) throw new Error('A-roll 生成完成但无一镜产物落盘')
      msg.value = `A-roll 批量生成完成：成功 ${okCount}/${idxs.length}。`
    } catch (e) {
      msg.value = `A-roll 生成失败：${errMsg(e)}`
      for (const i of idxs) {
        setState(keyOf(i, 'aroll'), { phase: 'failed', msg: `A-roll 生成失败：${errMsg(e)}`, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      }
    } finally { busy.value = false }
  }

  return { busy, msg, states, active, stateOf, batchProgressOf, addOnline, generate, batchGenerateAI, batchGenerateARoll, splitVoiceByScript }
}
