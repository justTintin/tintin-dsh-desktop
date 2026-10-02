// ═══════════════════════════════════════════════════════════════
// useImitationVideo — 仿视频（V3.5 / PRD-M-5）编排层（runner：只做编排+响应式 state）
// 纯逻辑全在 imitationVideoLogic.ts（可单测）；本文件不做 DOM，失败分支全部
// clientError 打点（铁律 7），契约缺失显式报错不兜底（铁律 6）。
// 依据：《仿视频流程规范》v1.0（2026-10-02 合并版）§4/§5.1/§5.3/§11-19；
// 端点与响应形态以 2026-10-02 服务端实测为准（/api/storyboard/scripts/imitate、
// /tasks/unified/{id} result={script_id,version,shot_count}、frames multipart）。
// 已知契约缺口（显式报错，不发明端点）：
//   · imitate 本地视频预上传通道——服务端 openapi 无通用视频 upload 路由
//     （仅 audio/comfyui-image/fonts/runninghub/sfx 专用），待服务端定契约后接入；
//     过渡期用素材库引用（material://{id}）或服务端路径。
//   · multipart 文件字段需真 File/Blob（桥面 server.upload 原样 XHR.send），
//     由 UI 文件选择器供给；本层不读盘。
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
  video: unknown
  products?: Array<unknown>
  options?: { ratio?: string; fidelity?: string; max_shots?: number }
}

export interface GenerateSubmitInput {
  scriptId: string
  stage: GenerateStage
  onlyShots?: string[]
  fidelityOverride?: 'fast' | 'balanced' | 'high'
  autoMontage?: boolean
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

  // ── Part 1：imitate 提交 + unified 轮询（§4/§5.3）────────────
  const part1TaskId = ref('')
  const part1Phase = ref<'' | 'running' | 'done' | 'failed'>('')
  const part1Error = ref('')
  const part1Note = ref('')
  const scriptId = ref('')
  const scriptVersion = ref(0)
  const shotCount = ref(0)

  let part1Timer: ReturnType<typeof setInterval> | null = null
  function stopPart1Polling(): void {
    if (part1Timer) { clearInterval(part1Timer); part1Timer = null }
  }
  onBeforeUnmount(stopPart1Polling)

  async function submitImitate(input: ImitateSubmitInput): Promise<boolean> {
    const built = buildImitateBody(input)
    part1Note.value = built.note
    if (!built.ok) {
      // 本地文件：预上传通道无服务端契约（文件头注登记）——显式报错引导素材库/路径
      const msg = built.needsUpload
        ? '本地视频暂不支持直传：服务端预上传通道未定契约，请改用素材库引用或服务端路径（评审登记）'
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
    part1Timer = setInterval(async () => {
      try {
        const resp = await serverBridge().get(API_PATHS.tasks.unifiedItem(part1TaskId.value))
        const task = extractTaskObj(resp)
        const info = mapTaskStatus(task.status ?? task.state, task)
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
        part1Phase.value = 'done'
        clientInfo(TAG, `Part1 完成 script=${sid} shots=${shotCount.value}`)
      } catch (e) {
        clientError(TAG, `Part1 轮询异常 task=${part1TaskId.value}`, e)
      }
    }, POLL_INTERVAL_MS)
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
      const resp = await serverBridge().upload(API_PATHS.storyboard.shotFrames(id, name), form)
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
  const genPhase = ref<'' | 'running' | 'done' | 'failed'>('')
  const genError = ref('')
  const genResult = ref<Record<string, unknown>>({})

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
      genPhase.value = 'running'
      genError.value = ''
      genResult.value = {}
      clientInfo(TAG, `storyboard_generate 已提交 task=${genTaskId.value} stage=${input.stage}`)
      startGenPolling()
      return true
    } catch (e) {
      genError.value = `生成任务提交失败：${(e as Error).message}`
      clientError(TAG, genError.value, e)
      return false
    }
  }

  function startGenPolling(): void {
    stopGenPolling()
    genTimer = setInterval(async () => {
      try {
        const resp = await serverBridge().get(API_PATHS.scheduled.tasksItem(genTaskId.value))
        const task = extractTaskObj(resp)
        const info = mapTaskStatus(task.status ?? task.state, task)
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
    }, POLL_INTERVAL_MS)
  }

  /** A-roll 对轨 warning（§3：±15% 仅提示；voice 时长由脚本记录提供） */
  function timelineWarning(shots: ImitationShot[], voiceDurSec: unknown): string {
    return arollTimelineWarning(shots, voiceDurSec)
  }

  return {
    // 枚举
    enums, enumsError, loadEnums,
    // Part 1
    part1TaskId, part1Phase, part1Error, part1Note, scriptId, scriptVersion, shotCount,
    submitImitate,
    // 脚本（HumanGate①）
    loadScript, saveScript,
    // HumanGate②
    confirmShotFrames, replaceShotFrames,
    // Part 2
    genTaskId, genPhase, genError, genResult,
    submitGenerate, preflightGenerate, timelineWarning,
  }
}
