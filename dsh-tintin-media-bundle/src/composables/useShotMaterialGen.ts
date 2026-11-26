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
  /** 激活 tab 的服务端身份（A-Roll 数字人：脚本已同步 + 口播音频已克隆） */
  digitalHuman: () => { scriptId: string; voiceAudioId: string }
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
   *  /audio/voice/split-by-shots {script_id} → [{shot_index,audio_id}]，段入音频库）。
   *  返回 {shot_index → audio_id}；端点未部署/失败 → null（调用方拒绝并提示）。 */
  async function splitVoiceByScript(scriptId: string): Promise<Map<number, string> | null> {
    try {
      const res = await window.tintin.server.post<unknown>('/audio/voice/split-by-shots', { script_id: scriptId }, {}, 60_000)
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
    } catch { return null } // 404/网络错误/未部署 → 统一走批量拒绝提示
  }

  /** 单镜 A-Roll（数字人读该镜拆分音频）：提交 scheduled stage=aroll 任务 → 轮询 →
   *  下载 → 写 A-Roll 轨。产物地址双通道：任务 result.material_id/output_url 优先。 */
  async function generateARollOne(idx: number, shot: StoryboardShot, opts: {
    scriptId: string; arollImage: string; audioId: string
  }): Promise<boolean> {
    const k = keyOf(idx, 'aroll')
    if (active(idx, 'aroll')) return false
    const startedAt = Date.now()
    setState(k, { phase: 'submitting', progress: -1, msg: '正在提交数字人任务…', startedAt, elapsedSec: 0 })
    try {
      const submitted = await window.tintin.server.post<Record<string, unknown>>(
        '/scheduled/tasks',
        { task_type: 'storyboard_generate', params: { script_id: opts.scriptId, stage: 'aroll', aroll_image: opts.arollImage, aroll_audio_id: opts.audioId, aroll_shot_index: shot.index, auto_montage: false } },
        {}, 30_000,
      )
      if (!submitted) throw new Error('服务端不可达')
      if (submitted.error) throw new Error(String(submitted.error))
      const taskId = String(submitted.task_id ?? submitted.id ?? '')
      if (!taskId) throw new Error('数字人任务响应缺 id/task_id')
      setState(k, { phase: 'generating', taskId, msg: '数字人生成中…' })
      msg.value = `第 ${idx + 1} 镜数字人已提交（任务 ${taskId}）…`

      const started = Date.now()
      let materialId = 0
      let directUrl = ''
      while (Date.now() - started < POLL_BUDGET) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        const node = await window.tintin.server.get(`/scheduled/tasks/${taskId}`)
        if (node === null || node === undefined) throw new Error('任务通道不可达')
        if (node && typeof node === 'object' && 'error' in node) throw new Error(String((node as { error: unknown }).error))
        const task = extractTaskObj(node)
        const phase = mapTaskStatus(task?.status ?? task?.state, task).phase
        setState(k, {
          phase: 'generating',
          progress: progressOf(task),
          elapsedSec: Math.round((Date.now() - startedAt) / 1000),
          msg: '数字人生成中…',
        })
        if (phase === 'failed') throw new Error(String(task?.error_message ?? task?.error_msg ?? task?.error ?? task?.last_message ?? '数字人生成失败'))
        if (phase === 'done') {
          const result = (task?.result ?? {}) as Record<string, unknown>
          materialId = Number(result.material_id ?? 0)
          directUrl = String(result.output_url ?? result.output_path ?? result.url ?? '')
          if (!materialId && !directUrl) throw new Error('数字人生成完成但缺产物地址')
          break
        }
      }
      if (!materialId && !directUrl) throw new Error('数字人生成超时（30 分钟）')

      setState(k, { phase: 'downloading', progress: -1, msg: '生成完成，正在下载产物…', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      const url = directUrl || `/material/serve?material_id=${materialId}`
      const dir = joinPath(await readCacheDir(), 'montage_cache', deps.splitsJobId.value || 'session', 'generated')
      const local = joinPath(dir, `${taskId}.mp4`)
      const res = await window.tintin.server.downloadResult(url, local)
      if (res === null) throw new Error('产物下载通道不可达')
      if (res && typeof res === 'object' && 'error' in res) throw new Error(String((res as { error: unknown }).error || '产物下载失败'))
      setSlot(idx, 'aroll', { local, taskId, audioId: opts.audioId })
      msg.value = `第 ${idx + 1} 镜数字人已生成。`
      setState(k, { phase: 'done', progress: 100, msg: '数字人已生成', elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      return true
    } catch (e) {
      msg.value = `数字人生成失败：${errMsg(e)}`
      setState(k, { phase: 'failed', msg: `数字人生成失败：${errMsg(e)}`, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      return false
    }
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

  /** 批量 A-Roll（2026-11-26 用户裁决：A-Roll 组共用一个人物图（上传的服务端路径或
   *  素材 ID 均可——数字为素材库 id 走 material:// 形态，路径直接透传）；勾选 aroll 的
   *  分镜批量生成，每镜绑定服务端拆分出的该镜口播音频。拆分端点未部署 → 整批拒绝。 */
  async function batchGenerateARoll(personImageRef: string): Promise<void> {
    const shots = deps.activeShots()
    const idxs = markedShotIdxs(shots, 'aroll')
    if (!idxs.length) { msg.value = '没有勾选「生成A-Roll」的分镜（或勾选分镜已全部有产物）。'; return }
    const { scriptId, voiceAudioId } = deps.digitalHuman()
    if (!scriptId) { msg.value = '该分镜脚本尚未同步到服务端：请先在第 2 步完成口播配音（克隆完成会自动同步）。'; return }
    if (!voiceAudioId) { msg.value = '数字人读的是拆分后的该镜口播音频：请先在第 2 步完成口播配音。'; return }
    const ref = String(personImageRef || '').trim()
    if (!ref) { msg.value = 'A-Roll 组需要先上传人物图。'; return }
    const personImageId = Number(ref)
    // 双形态：纯数字=素材库 id 走 material://；服务器路径/其他形态原样透传
    const arollImage = Number.isInteger(personImageId) && personImageId > 0 ? `material://${personImageId}` : ref
    busy.value = true
    try {
      msg.value = '正在请求服务端按分镜拆分口播音频…'
      const audioMap = await splitVoiceByScript(scriptId)
      if (!audioMap) {
        msg.value = '服务端未部署「声音按镜拆分」能力（/audio/voice/split-by-shots）——请升级服务端后再用 A-Roll 批量。'
        return
      }
      const jobs: Array<{ idx: number; shot: StoryboardShot; audioId: string }> = []
      const missing: number[] = []
      for (const i of idxs) {
        const shot = shots[i]!
        // 服务端 shot_index 为 0-based（2026-11-26 实测：shot_index 0 ↔ 脚本第 1 镜）
        const audioId = audioMap.get((Number(shot.index) || i + 1) - 1)
        if (audioId) {
          // 拆分即绑定并回显（2026-11-26 用户裁决：卡顶「拆分口播」行先于生成落值）
          shot.splitAudioId = audioId
          jobs.push({ idx: i, shot, audioId })
        } else missing.push(i + 1)
      }
      if (missing.length) msg.value = `第 ${missing.join('、')} 镜未拿到拆分音频（该镜将失败，其余照常）。`
      const results = await Promise.all(jobs.map((j) => generateARollOne(j.idx, j.shot, { scriptId, arollImage, audioId: j.audioId })))
      const ok = results.filter(Boolean).length
      msg.value = `A-Roll 批量生成完成：成功 ${ok}/${jobs.length}。`
    } finally { busy.value = false }
  }

  return { busy, msg, states, active, stateOf, batchProgressOf, addOnline, generate, batchGenerateAI, batchGenerateARoll, splitVoiceByScript }
}
