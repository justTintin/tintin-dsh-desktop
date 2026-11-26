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
  /** 激活 tab 的服务端身份（A-Roll 数字人：脚本已同步 + 本地克隆口播 wav 路径——
   *  一次上传直生成流 multipart 直接传本地文件） */
  digitalHuman: () => { scriptId: string; voiceAudioId: string; voiceWav: string }
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

  /** 服务端声音按镜拆分（2026-11-26 用户裁决：拆分在服务端；契约 POST
   *  /audio/voice/split-by-shots {script_id} → [{shot_index,audio_id}]，段入音频库。
   *  首次拆分走服务端 whisper 词级对齐——服务端要求客户端超时 ≥600s）。
   *  返回 {shot_index(0-based) → audio_id}；**端点未部署(HTTP 404) → null**；
   *  其他失败（超时/网络）原样上抛，调用方显示真实原因——不与「未部署」混谈。 */
  async function splitVoiceByScript(scriptId: string): Promise<Map<number, string> | null> {
    let res: unknown
    try {
      res = await window.tintin.server.post<unknown>('/audio/voice/split-by-shots', { script_id: scriptId }, {}, 600_000)
    } catch (e) {
      if ((e as { status?: number })?.status === 404) return null
      throw e
    }
    if (!res || (typeof res === 'object' && 'error' in res)) return null
    const list = Array.isArray(res) ? res : (res as { items?: unknown[] })?.items
    if (!Array.isArray(list)) return null
    const map = new Map<number, string>()
    for (const row of list as Array<Record<string, unknown>>) {
      // 服务端 shot_index 为 0-based（2026-11-26 实测：首镜 shot_index=0）
      const idx = Number(row.shot_index)
      const audioId = String(row.audio_id ?? row.audioId ?? '')
      if (Number.isInteger(idx) && idx >= 0 && audioId) map.set(idx, audioId)
    }
    return map.size ? map : null
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

  /** 批量 A-Roll（2026-11-26 用户裁决二稿：**一次上传直接生成**——multipart 人物图+
   *  整段克隆口播+script_id 一次收齐（POST /digital-human/aroll mode=per_shot），
   *  服务端内部按镜拆分对齐并逐镜生成（有素材镜自动跳过）、镜级回写脚本；客户端单任务
   *  轮询 → 完成后回读脚本逐镜产物 → 下载 → 写各镜 A-Roll 轨。要求各镜 shot.audio 已
   *  铺旁白（服务端文档：未铺则任务失败暴露）。 */
  async function batchGenerateARoll(personImagePath: string): Promise<void> {
    const shots = deps.activeShots()
    const idxs = markedShotIdxs(shots, 'aroll')
    if (!idxs.length) { msg.value = '没有勾选「生成A-Roll」的分镜（或勾选分镜已全部有产物）。'; return }
    const { scriptId, voiceWav } = deps.digitalHuman()
    if (!scriptId) { msg.value = '该分镜脚本尚未同步到服务端：请先在第 2 步完成口播配音（克隆完成会自动同步）。'; return }
    if (!voiceWav) { msg.value = '数字人读整段克隆口播：请先在第 2 步完成口播配音。'; return }
    const imagePath = String(personImagePath || '').trim()
    if (!imagePath) { msg.value = 'A-Roll 组需要先上传人物图。'; return }
    busy.value = true
    const startedAt = Date.now()
    try {
      for (const i of idxs) setState(keyOf(i, 'aroll'), { phase: 'submitting', progress: -1, msg: '正在上传并提交数字人任务…', startedAt, elapsedSec: 0 })
      msg.value = '正在一次上传人物图与整段口播，提交 A-roll 生成…'
      const submitted = await window.tintin.server.arollGenerate({
        imagePath, audioPath: voiceWav, scriptId, mode: 'per_shot',
      })
      if (!submitted) throw new Error('服务端不可达')
      if (typeof submitted === 'object' && 'error' in submitted) throw new Error(String(submitted.error || '提交失败'))
      const taskId = String(submitted.task_id ?? '')
      if (!taskId) throw new Error('A-roll 提交响应缺 task_id')
      for (const i of idxs) setState(keyOf(i, 'aroll'), { phase: 'generating', taskId, msg: '数字人生成中…' })
      msg.value = `A-roll 已提交（任务 ${taskId}，${idxs.length} 镜逐镜生成）…`

      const started = Date.now()
      let entries: Array<Record<string, unknown>> = []
      while (Date.now() - started < AROLL_POLL_BUDGET) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        const node = await window.tintin.server.tasksUnifiedItem(taskId)
        if (node && typeof node === 'object' && 'error' in node) throw new Error(String((node as { error: unknown }).error))
        const task = extractTaskObj(node)
        const phase = mapTaskStatus(task?.status ?? task?.state, task).phase
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
        for (const i of idxs) {
          setState(keyOf(i, 'aroll'), { phase: 'generating', progress: progressOf(task), elapsedSec, msg: '数字人生成中…' })
        }
        if (phase === 'failed') throw new Error(String(task?.error_message ?? task?.error_msg ?? task?.error ?? task?.last_message ?? 'A-roll 生成失败'))
        if (phase === 'done') {
          // 逐镜产物双通道：任务 result.shots 优先，回落脚本回写 aroll.shots
          const result = (task?.result ?? {}) as Record<string, unknown>
          entries = Array.isArray(result.shots) ? result.shots as Array<Record<string, unknown>> : []
          if (!entries.length) {
            const detail = await window.tintin.server.get<Record<string, unknown>>(`/api/storyboard/scripts/${scriptId}`)
            const s = ((detail && typeof detail === 'object' && 'script' in detail ? (detail as { script?: Record<string, unknown> }).script : detail) ?? {}) as Record<string, unknown>
            const aroll = (s.aroll ?? {}) as Record<string, unknown>
            entries = Array.isArray(aroll.shots) ? aroll.shots as Array<Record<string, unknown>> : []
          }
          break
        }
      }
      if (!entries.length) throw new Error('A-roll 生成超时或未返回逐镜产物')

      // 镜级产物对位：条目 name="shot_N"（N=脚本 1-based 镜 index）；无 name 按 pos 对位
      const productBy = new Map<number, { materialId: number; url: string }>()
      entries.forEach((e, pos) => {
        const mid = Number(e.material_id ?? 0)
        const url = String(e.output_url ?? e.output_path ?? e.url ?? '')
        if (!mid && !url) return
        const named = Number(String(e.name ?? '').replace(/^shot_/i, ''))
        const byName = Number.isInteger(named) && named > 0
          ? idxs.filter((i) => Number(shots[i]!.index) === named || i + 1 === named)
          : []
        const target = byName[0] ?? idxs[pos] ?? idxs[0]
        if (target === undefined) return
        productBy.set(target, { materialId: mid, url })
      })
      const dir = joinPath(await readCacheDir(), 'montage_cache', deps.splitsJobId.value || 'session', 'generated')
      let okCount = 0
      for (const i of idxs) {
        const got = productBy.get(i)
        const k = keyOf(i, 'aroll')
        setState(k, { phase: 'downloading', progress: -1, msg: got ? '生成完成，正在下载产物…' : '未返回该镜产物', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
        if (!got) { setState(k, { phase: 'failed', msg: 'A-roll 未返回该镜产物' }); continue }
        const url = got.url || `/material/serve?material_id=${got.materialId}`
        const local = joinPath(dir, `${taskId}_${i + 1}.mp4`)
        const res = await window.tintin.server.downloadResult(url, local)
        if (res === null || (res && typeof res === 'object' && 'error' in res)) {
          setState(k, { phase: 'failed', msg: `产物下载失败：${errMsg(res)}` }); continue
        }
        setSlot(i, 'aroll', { local, taskId })
        setState(k, { phase: 'done', progress: 100, msg: '数字人已生成', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
        okCount += 1
      }
      if (!okCount) throw new Error('A-roll 生成完成但无一镜产物落盘')
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
