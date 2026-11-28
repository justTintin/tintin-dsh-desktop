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
/** 单镜任务等待上限（2026-11-27 用户裁决：数字人≈1 分钟生成 1 秒视频、AI 生成同口径；
 *  **按各自开跑起算**——queued 排队不计入窗口，不设整批预算） */
const SHOT_TASK_TIMEOUT = 15 * 60_000
/** 排队等待兜底帽（防服务端队列僵死导致客户端永挂；正常到不了——串行队列 41 镜
 *  最坏 ≈10 小时内。超帽判该镜失败并取消，可单独重试） */
const QUEUE_WAIT_CAP = 24 * 60 * 60_000

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
   *  服务端契约：stage=aroll 任务按镜包干——切分/对齐/逐镜生成/回写全服务端完成） */
  syncArollPerShot: () => Promise<void>
  /** 该镜素材绑定轨是否有货（A-Roll 跳过镜的判定口径与合成一致） */
  hasMaterial: (idx: number) => boolean
}) {
  const busy = ref(false)
  const msg = ref('')
  /** 分组消息（2026-11-26 用户裁决：每个分组进度/提示单独——A-Roll 组与 AI 生成组
   *  各自显示自己的消息，不再共用一条全局 msg 互相串台） */
  const groupMsgs = ref<{ ai: string; aroll: string }>({ ai: '', aroll: '' })
  /** 停止旗标（2026-11-27 用户裁决：生成按钮旁加停止按钮）——置位后由轮询相就地
   *  收割：AI 镜逐个向 /tasks/batch_cancel 请求取消统一任务；A-Roll 向
   *  /scheduled/tasks/{id}/cancel 取消（探针 2026-11-27 实证两端点均部署），
   *  已落地产物保留。预置回写相（syncArollPerShot，300s 上限）不可中断，旗标在
   *  其返回后的下一相生效。 */
  const stopFlags = ref<{ ai: boolean; aroll: boolean }>({ ai: false, aroll: false })
  /** 正在跑批的分组（2026-11-27 用户裁决：停止按钮只出现在跑批组的生成按钮旁，
   *  AI/A-Roll 两支各管各的——busy 是全组共位，不用它判显隐归属） */
  const activeGroup = ref<'' | 'ai' | 'aroll'>('')
  function stopBatch(kind: 'ai' | 'aroll'): void {
    if (!busy.value || activeGroup.value !== kind) return
    stopFlags.value[kind] = true
    setGroupMsg(kind, '正在停止…（取消未完成任务，已落地产物保留）')
  }
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
    busy.value = true; msg.value = ''; activeGroup.value = '' // 下载无停止语义（2026-11-27）
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
    stopFlags.value.ai = false // 新任务起跑重置停止旗标（批量入口亦然，2026-11-27）
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

      /** 每镜窗口锚点（2026-11-27 用户再裁决：15 分钟按**各自开跑**起算）——queued
       *  阶段随 tick 后移不计时（排队不吃生成窗口，同 A-Roll 口径），running 起锚定；
       *  排队兜底帽 24h（QUEUE_WAIT_CAP）防队列僵死永挂。2026-11-27 实测补：服务端
       *  文生视全局在途闸 cap=1（成功任务日志实证闸前等 610s、真实生成仅 ~3min），
       *  闸前等待期 status 不在 queued 词表 → 排队被计入窗口 → 并发提交成批误判
       *  超时。双保险=①批量改逐镜流水线（见 batchGenerateAI）②统一任务 log 末条
       *  含「在途闸等待」视同排队，窗口同步后移。 */
      let clockStart = Date.now()
      let aiQueuedAt = 0
      let gateWaitedSec = 0
      let lastRawStatus = ''
      let output = ''
      let stopped = false
      while (Date.now() - clockStart < SHOT_TASK_TIMEOUT) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        if (stopFlags.value.ai) { stopped = true; break }
        const node = await window.tintin.server.tasksUnifiedItem(taskId)
        // 2026-11-26 报障「生成失败：null」：统一任务视图恒带 error 键（未失败=null）——
        // 键存在≠失败，必须判空值；否则 String(null)='null' 在首轮轮询就误抛
        const nodeErr = (node && typeof node === 'object' ? (node as { error?: unknown }).error : undefined)
        if (nodeErr !== null && nodeErr !== undefined && nodeErr !== '') throw new Error(String(nodeErr))
        const task = extractTaskObj(node)
        const rawStatus = String(task?.status ?? task?.state ?? '').toLowerCase()
        lastRawStatus = rawStatus
        const phase = mapTaskStatus(task?.status ?? task?.state, task).phase
        // queued 看原始 status（mapTaskStatus 无 queued 映射，同 A-Roll 口径）
        const isQueued = rawStatus === 'queued' || rawStatus === 'pending' || rawStatus === 'waiting'
        // 在途闸等待视同排队（实测兜底：闸前 status 不进 queued 词表；log 契约=服务端
        // 成功任务日志实证「在途闸等待: 引擎在途 1 个 job（cap=1）」）
        const recLog = (node as { log?: unknown } | null)?.log
        const lastLog = Array.isArray(recLog) && recLog.length ? String(recLog[recLog.length - 1]) : ''
        const gateWaiting = !isQueued && phase === 'running' && lastLog.includes('在途闸等待')
        if (isQueued || gateWaiting) {
          clockStart = Date.now() // 排队中：窗口起点随 tick 后移
          if (!aiQueuedAt) aiQueuedAt = Date.now()
          else if (Date.now() - aiQueuedAt >= QUEUE_WAIT_CAP) throw new Error('排队超时（24 小时未开跑，请检查服务端队列）')
          gateWaitedSec = Math.round((Date.now() - aiQueuedAt) / 1000)
          setState(k, { phase: 'generating', progress: -1, elapsedSec: Math.round((Date.now() - startedAt) / 1000), msg: gateWaiting && !isQueued ? '已提交，服务端在途闸排队…' : '已提交，等待服务端队列…' })
          continue
        }
        if (aiQueuedAt) { gateWaitedSec = Math.round((Date.now() - aiQueuedAt) / 1000); aiQueuedAt = 0 }
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
      const cancelNow = async (): Promise<string> => {
        // 2026-11-27 停止/超时裁决：取消该统一任务（契约=task_ids 键，探针实证）。
        // 2026-11-27 可观测性补：等待并回显结果——原先 void 吞掉一切，路由未部署/
        // 契约不符时「客户端已失败、服务端照烧」永不可见（本机 7 镜实况）
        try {
          const cr = await window.tintin.server.post<Record<string, unknown>>('/tasks/batch_cancel', { task_ids: [taskId] }, {}, 30_000)
          return cr && typeof cr === 'object' && cr.error ? `取消失败：${String(cr.error)}` : '已请求取消'
        } catch (e) { return `取消请求失败：${errMsg(e)}` }
      }
      if (stopped) {
        const note = await cancelNow()
        setGroupMsg('ai', `第 ${idx + 1} 镜已停止（${note}）。`)
        setState(k, { phase: 'failed', msg: `已停止（${note}）`, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
        return false
      }
      if (!output) {
        // 客户端判超时必须同时取消服务端统一任务（2026-11-27 用户裁决：不允许
        // 客户端已失败而服务端还在烧小时级）
        const note = await cancelNow()
        const gateNote = gateWaitedSec ? `｜闸前排队约 ${gateWaitedSec}s` : ''
        throw new Error(`生成超时（15 分钟/镜）${gateNote}｜末次观测 status=${lastRawStatus || '无'}；${note}`)
      }

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

  /** 批量 AI 生成（2026-11-26 用户裁决：勾选 AI 生成的分镜逐个提交、进度就地）。
   *  2026-11-27 实测改串行流水线（推翻同日并行口径）：服务端文生视全局在途闸
   *  cap=1（成功任务日志实证闸前等 610s、真实生成仅 ~3min），原 Promise.all
   *  并发提交时后位镜闸前排队被计入 15 分钟窗口→成批误判超时（7 镜实况=1 成
   *  5 超时 1 进行中）；cap=1 下并发不损吞吐（同 A-Roll §8 互斥实测口径），
   *  前一镜终态后再提交下一镜，闸前等待≈0；停止=当前镜取消+不再提交后续
   *  （真·「停止队列里下面的任务」）。 */
  async function batchGenerateAI(): Promise<void> {
    const shots = deps.activeShots()
    const idxs = markedShotIdxs(shots, 'ai')
    if (!idxs.length) { setGroupMsg('ai', '没有勾选「AI生成」的分镜（或勾选分镜已全部有产物）。'); return }
    busy.value = true
    activeGroup.value = 'ai' // 停止按钮归属本组（2026-11-27 用户裁决）
    try {
      let ok = 0
      let stoppedEarly = false
      for (const i of idxs) {
        if (stopFlags.value.ai) { stoppedEarly = true; break }
        if (await generate(i, shots[i]!)) ok += 1
      }
      // 停止收割后的批量结尾报「已停止」而非「完成 0/N」（2026-11-27 停止裁决）
      setGroupMsg('ai', (stoppedEarly || stopFlags.value.ai)
        ? `AI 批量已停止：成功 ${ok}/${idxs.length}。`
        : `AI 批量生成完成：成功 ${ok}/${idxs.length}。`)
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
   *  轨，起跑即标完成。人物图必须先经 product-upload 落到服务端路径。
   *  2026-11-27 用户裁决两改：①**逐镜各提交一个独立任务**（每镜
   *  aroll_shot_indexes=[该镜]）——单任务包干观测不到逐镜起跑，服务端队列串行
   *  （实测 max_concurrent=1）时后位镜排队即被误判超时；②每镜 15 分钟窗口从
   *  **该任务开跑**起算（queued 随 tick 后移不计时），到点判超时并取消该任务；
   *  停止=未完成镜逐个取消，已落地产物保留。 */
  async function batchGenerateARoll(personImagePath: string): Promise<void> {
    const shots = deps.activeShots()
    const idxs = markedShotIdxs(shots, 'aroll')
    if (!idxs.length) { setGroupMsg('aroll', '没有勾选「生成A-Roll」的分镜（或勾选分镜已全部有产物）。'); return }
    const { scriptId } = deps.digitalHuman()
    if (!scriptId) { setGroupMsg('aroll', '该分镜脚本尚未同步到服务端：请先在第 2 步完成口播配音（克隆完成会自动同步）。'); return }
    const imagePath = String(personImagePath || '').trim()
    if (!imagePath) { setGroupMsg('aroll', 'A-Roll 组需要先上传人物图。'); return }
    busy.value = true
    activeGroup.value = 'aroll' // 停止按钮归属本组（2026-11-27 用户裁决）
    stopFlags.value.aroll = false // 新批次重置停止旗标（2026-11-27 停止裁决）
    const startedAt = Date.now()
    /** 尚未回轨的镜 index 集合（回轨/跳过即移出；失败上报以 states 终态为准） */
    const pending = new Set<number>()
    /** 每镜任务号（catch 域也要用——判死必须同步取消服务端任务，2026-11-27） */
    const taskIds = new Map<number, string>()
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
      // ②③客户端逐镜流水线（2026-11-27 实测裁决：服务端 §8 任务级互斥——同脚本
      // 同时只允许一个在飞任务，40 并发提交=1 成功 39×409「已有生成任务在飞」；
      // 服务端队列本就串行 max_concurrent=1，流水线不损吞吐）。前一镜任务终态后
      // 再提交下一镜，每镜独立可观测：
      // ·15 分钟窗口从该任务**开跑**起算（queued 随 tick 后移不计时）
      // ·超时/停止/异常=取消当前任务+不再提交后续（真·「停止队列里下面的任务」）
      // ·2026-11-26 契约 2ef347a0：aroll_shot_indexes=[该镜 0-based 镜号]
      const zeroIdxOf = (i: number): number => {
        const n = Number(shots[i]!.index)
        return Number.isFinite(n) && n > 0 ? n - 1 : i
      }
      const dir = joinPath(await readCacheDir(), 'montage_cache', deps.splitsJobId.value || 'session', 'generated')
      /** 单镜回轨：下载该镜 aroll_material_id 产物→写 A-Roll 轨→瓦片标完成 */
      const fillShot = async (i: number, mid: number): Promise<void> => {
        const k = keyOf(i, 'aroll')
        setState(k, { phase: 'downloading', progress: -1, msg: '生成完成，正在下载产物…' })
        const local = joinPath(dir, `${taskIds.get(i) ?? 'shot'}_${i + 1}.mp4`)
        const res = await window.tintin.server.downloadResult(`/material/serve?material_id=${mid}`, local)
        if (res === null) { setState(k, { phase: 'failed', msg: '产物下载通道不可达' }); return }
        if (res && typeof res === 'object' && 'error' in res) {
          setState(k, { phase: 'failed', msg: `产物下载失败：${errMsg(res)}` }); return
        }
        setSlot(i, 'aroll', { local, taskId: taskIds.get(i) ?? '' })
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
      const cancelShotTask = async (i: number): Promise<boolean> => {
        const tid = taskIds.get(i)
        if (!tid) return false
        const c = await window.tintin.server.post(`/scheduled/tasks/${tid}/cancel`, undefined, {}, 30_000)
        return !(c && typeof c === 'object' && 'error' in c && c.error)
      }
      const doneCount = (): number => idxs.filter((x) => states.value[keyOf(x, 'aroll')]?.phase === 'done').length
      // 预置回写相不可中断（300s 上限）；旗标在此收割——点了停止就不提交任务
      if (stopFlags.value.aroll) { setGroupMsg('aroll', '已停止：未提交任务。'); return }
      const pipeline = [...pending]
      let stopRequested = false
      /** 当前镜窗口锚点（0=未锚定——仍 queued，随 tick 后移；running 起锚定） */
      const windowAt = new Map<number, number>()
      /** 当前镜首见 queued 时刻（排队兜底帽计时；离开 queued 即清） */
      const queuedAt = new Map<number, number>()
      /** 提交单镜任务：409「已有生成任务在飞」=与前一镜收尾的互斥竞态，退避重试；
       *  通道不可达也重试；其余错误（含 409 详情）原样透出——不再吞成「服务端不可达」 */
      const submitShot = async (i: number, seqNo: number): Promise<{ tid?: string; err?: string; stopped?: boolean }> => {
        for (let attempt = 0; attempt < 5; attempt++) {
          if (stopFlags.value.aroll) return { stopped: true }
          if (attempt) await new Promise((r) => setTimeout(r, POLL_INTERVAL))
          setGroupMsg('aroll', `正在提交第 ${seqNo}/${pipeline.length} 镜 A-roll 任务…（已回轨 ${doneCount()}/${idxs.length}）`)
          let res: Record<string, unknown> | null = null
          try {
            res = await window.tintin.server.post<Record<string, unknown>>(
              '/scheduled/tasks',
              { task_type: 'storyboard_generate', params: { script_id: scriptId, stage: 'aroll', aroll_image: imagePath, auto_montage: false, aroll_shot_indexes: [zeroIdxOf(i)] } },
              {}, 30_000,
            )
          } catch { res = null } // 通道异常（非离线判定）→ 与离线同路重试
          if (!res) { if (attempt === 4) return { err: '服务端不可达' }; continue }
          if (res.error) {
            const em = String(res.error)
            if (/409|在飞|已有生成任务/.test(em) && attempt < 4) continue // 互斥竞态退避
            return { err: em }
          }
          const got = String(res.task_id ?? res.id ?? '')
          return got ? { tid: got } : { err: '提交响应缺 id/task_id' }
        }
        return { err: '提交重试次数用尽' }
      }
      for (let pi = 0; pi < pipeline.length; pi++) {
        const i = pipeline[pi]!
        if (!pending.has(i)) continue
        if (stopFlags.value.aroll) { stopRequested = true; break }
        const k = keyOf(i, 'aroll')
        const sub = await submitShot(i, pi + 1)
        if (sub.err) {
          if (sub.stopped) { stopRequested = true; break }
          pending.delete(i)
          setState(k, { phase: 'failed', msg: `提交失败：${sub.err}`, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
          continue
        }
        if (stopFlags.value.aroll) { // 提交成功但停止已按下：取消刚提交的任务再收手
          stopRequested = true
          taskIds.set(i, sub.tid!)
          await cancelShotTask(i)
          break
        }
        taskIds.set(i, sub.tid!)
        setState(k, { phase: 'submitting', taskId: sub.tid, msg: '已提交，等待服务端队列…', startedAt, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
        // ── 单镜轮询到终态：素材判定先于状态（遗留产物立即收割，queued 不拦）；
        // 窗口从开跑起算（queued 随 tick 后移），到点判超时并取消让位串行队列 ──
        windowAt.set(i, 0)
        queuedAt.delete(i)
        let doneTicks = 0
        while (pending.has(i)) {
          if (stopFlags.value.aroll) { stopRequested = true; await cancelShotTask(i); break }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL))
          if (stopFlags.value.aroll) { stopRequested = true; await cancelShotTask(i); break }
          await readScriptShots()
          const mid = midOf(i)
          if (mid) { pending.delete(i); await fillShot(i, mid); break }
          const node = await window.tintin.server.get(`/scheduled/tasks/${taskIds.get(i)}`)
          // 通道抖动跳过本 tick（不可达≠任务失败）
          const nodeErr = (node && typeof node === 'object' ? (node as { error?: unknown }).error : undefined)
          if (node === null || node === undefined || (nodeErr !== null && nodeErr !== undefined && nodeErr !== '')) continue
          const task = extractTaskObj(node)
          const rawStatus = String(task?.status ?? task?.state ?? '').toLowerCase()
          const isQueued = rawStatus === 'queued' || rawStatus === 'pending' || rawStatus === 'waiting'
          const phase = mapTaskStatus(task?.status ?? task?.state, task).phase
          const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
          if (phase === 'failed') {
            pending.delete(i)
            setState(k, { phase: 'failed', msg: `生成失败：${String(task?.error_message ?? task?.error_msg ?? task?.error ?? task?.last_message ?? 'A-roll 生成失败')}`, elapsedSec })
            break
          }
          if (isQueued) {
            windowAt.set(i, 0)
            const q0 = queuedAt.get(i) ?? Date.now()
            queuedAt.set(i, q0)
            if (Date.now() - q0 >= QUEUE_WAIT_CAP) {
              await cancelShotTask(i)
              pending.delete(i)
              setState(k, { phase: 'failed', msg: '排队超时（24 小时未开跑，请检查服务端队列）', elapsedSec })
              break
            }
            setState(k, { phase: 'generating', progress: -1, elapsedSec, msg: '已提交，等待服务端队列…' })
            continue
          }
          queuedAt.delete(i)
          if (!windowAt.get(i)) {
            const srv = Date.parse(String(task?.started_at ?? ''))
            windowAt.set(i, Number.isFinite(srv) ? srv : Date.now())
          }
          const win = windowAt.get(i) ?? Date.now()
          if (phase !== 'done' && Date.now() - win >= SHOT_TASK_TIMEOUT) {
            await cancelShotTask(i) // 超时让位：串行队列下挂死/超慢任务必须取消
            pending.delete(i)
            setState(k, { phase: 'failed', msg: '生成超时（15 分钟/镜）', elapsedSec })
            break
          }
          if (phase === 'done') {
            // 任务 completed 但脚本未回写：短暂竞态等几个 tick，超 30s 判未回写
            doneTicks += 1
            if (doneTicks >= 10) {
              pending.delete(i)
              setState(k, { phase: 'failed', msg: '任务已完成但服务端未回写该镜产物', elapsedSec })
              break
            }
            continue
          }
          setState(k, { phase: 'generating', progress: progressOf(task), elapsedSec, msg: '数字人生成中…' })
        }
        setGroupMsg('aroll', `A-roll 生成中：第 ${pi + 1}/${pipeline.length} 镜（已回轨 ${doneCount()}/${idxs.length}）…`)
      }
      if (stopRequested) {
        // 停止收尾：当前任务已在逐镜相取消；未启动镜不再提交（真正的「停止队列里
        // 下面的任务」）。已落地产物照常收割（扫尾），未回轨镜就地标已停止
        setGroupMsg('aroll', `已停止：已完成 ${doneCount()}/${idxs.length}，未启动镜不再提交。`)
      }
      // ④扫尾：任务终态/停止后仍无产物的镜兜底重读一次再判（完成瞬间回读竞态先例）
      if (pending.size && pending.size < idxs.length) await readScriptShots()
      for (const i of [...pending]) {
        const mid = midOf(i)
        if (mid) { pending.delete(i); await fillShot(i, mid) }
      }
      for (const i of pending) setState(keyOf(i, 'aroll'), { phase: 'failed', msg: stopRequested ? '已停止（未提交或已取消）' : '服务端未回写该镜 A-roll 产物' })
      const okCount = idxs.filter((i) => states.value[keyOf(i, 'aroll')]?.phase === 'done').length
      if (!okCount) {
        if (stopRequested) return // 主动停止不算失败（2026-11-27 用户裁决）
        throw new Error('A-roll 生成完成但无一镜产物落盘')
      }
      setGroupMsg('aroll', `A-roll 批量生成完成：成功 ${okCount}/${idxs.length}。`)
    } catch (e) {
      // 客户端判死必须同步收回服务端资源（2026-11-27 用户裁决：不允许客户端已失败
      // 而服务端还在烧小时级）——未回轨镜的 task 逐个请求取消（火后不理，取消失败
      // 不影响失败上报）
      for (const [i, tid] of taskIds) {
        if (!pending.has(i)) continue // 已回轨/已终态的镜任务不动
        void window.tintin.server.post(`/scheduled/tasks/${tid}/cancel`, undefined, {}, 30_000)
      }
      // 失败只烧未回轨镜——已回轨/已跳过的瓦片保留终态（用户裁决：回轨不回滚）
      const doneN = idxs.filter((i) => states.value[keyOf(i, 'aroll')]?.phase === 'done').length
      const suffix = doneN ? `（已回轨 ${doneN}/${idxs.length}，其余失败）` : ''
      setGroupMsg('aroll', `A-roll 生成失败${suffix}：${errMsg(e)}`)
      for (const i of idxs) {
        const st = states.value[keyOf(i, 'aroll')]
        // 已有终态判定的镜（done/逐镜失败/超时/停止）保留专属文案——批量错误只
        // 兜底 stamp 仍无判定的瓦片（2026-11-27 逐镜任务化后逐镜判定是常态）
        if (st?.phase === 'done' || st?.phase === 'failed') continue
        setState(keyOf(i, 'aroll'), { phase: 'failed', msg: `A-roll 生成失败：${errMsg(e)}`, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
      }
    } finally { busy.value = false }
  }

  return { busy, msg, groupMsgs, states, active, stateOf, batchProgressOf, activeGroup, addOnline, generate, batchGenerateAI, batchGenerateARoll, stopBatch, splitVoiceByScript }
}
