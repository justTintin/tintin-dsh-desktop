// ═════════════════════════════════════════════════════════════
// useImitationMontage.ts — 仿视频第 5 步 特效包装（草稿链）+ 第 6 步 交付。
// 2026-10-06 用户裁决：特效包装=实体功能（参考文案混剪链），导出拆到第 6 步。
// 链路=POST /scheduled/tasks {task_type:'storyboard_montage', params:{script_id}}
// （规范 §5.3 HumanGate③ 既有任务提交入口；口播 voice_audio_id/A-roll 已绑脚本，
// worker 按脚本数据走 storyboard_montage → 剪映草稿/成片）；交付=导入服务端草稿包
// （editor:exportJianyingPackage 逐任务聚合包→解压校验→落盘剪映，同文案混剪轨 2）。
// ═════════════════════════════════════════════════════════════
import { onBeforeUnmount, ref } from 'vue'
import { clientError, clientInfo } from '@/utils/clientLog'
import { extractTaskObj, mapTaskStatus } from './copywritingMontageCommonLogic'
import type { ImitationShot } from './imitationVideoLogic'
import { errText } from './copywritingMontage/context'

const TAG = 'imitation-montage'
const POLL_INTERVAL_MS = 2000

function serverBridge() {
  const s = (globalThis as unknown as { tintin?: { server?: Record<string, (...a: unknown[]) => Promise<unknown>> } }).tintin?.server
  if (!s) throw new Error('window.tintin.server 桥不可用（宿主未注入）')
  return s
}

export function useImitationMontage() {
  const montageTaskId = ref('')
  const montagePhase = ref<'' | 'running' | 'done' | 'failed'>('')
  const montageProgress = ref(-1)
  const montageElapsedSec = ref(0)
  const montageMessage = ref('')
  const montageError = ref('')
  const montageResult = ref<Record<string, unknown>>({})
  let startedAt = 0
  let timer: ReturnType<typeof setInterval> | null = null

  function stopPolling(): void {
    if (timer) { clearInterval(timer); timer = null }
  }
  onBeforeUnmount(stopPolling)

  /** 触发特效包装草稿链（storyboard_montage）。重复触发：运行中直接忽略。
   *  契约=2026-10-06 实弹验证（task 1683 completed 100%）：
   *  params 必须 {script_id, shots}——只传 script_id 会失败"shots 为空"。 */
  async function trigger(scriptId: string, shots: ImitationShot[]): Promise<boolean> {
    if (!scriptId) { montageError.value = '缺少脚本 id（先完成前面步骤）'; return false }
    if (!shots.length) { montageError.value = '分镜为空（先完成前面步骤）'; return false }
    if (montagePhase.value === 'running') return true
    try {
      const resp = (await serverBridge().post('/scheduled/tasks', {
        task_type: 'storyboard_montage',
        params: { script_id: scriptId, shots },
      })) as Record<string, unknown> | null
      const taskId = resp && (resp.task_id ?? resp.id)
      if (taskId === undefined || taskId === null || taskId === '') {
        const keys = resp ? Object.keys(resp).join(',') : 'null'
        montageError.value = `草稿链提交响应缺 id/task_id（实得字段：${keys}）`
        clientError(TAG, montageError.value, { resp })
        return false
      }
      montageTaskId.value = String(taskId)
      montagePhase.value = 'running'
      montageProgress.value = -1
      montageMessage.value = ''
      montageError.value = ''
      montageResult.value = {}
      startedAt = Date.now()
      montageElapsedSec.value = 0
      clientInfo(TAG, `storyboard_montage 已提交 task=${montageTaskId.value}`)
      startPolling()
      return true
    } catch (e) {
      montageError.value = `草稿链提交失败：${errText(e)}`
      clientError(TAG, montageError.value, e)
      return false
    }
  }

  function startPolling(): void {
    stopPolling()
    const tick = async (): Promise<void> => {
      try {
        const resp = await serverBridge().get(`/scheduled/tasks/${montageTaskId.value}`)
        const task = extractTaskObj(resp)
        const info = mapTaskStatus(task.status ?? task.state, task)
        montageElapsedSec.value = Math.round((Date.now() - startedAt) / 1000)
        const rawProg = Number((task as Record<string, unknown>).progress)
        montageProgress.value = Number.isFinite(rawProg) && rawProg >= 0 ? Math.min(100, Math.round(rawProg)) : -1
        montageMessage.value = String((task as Record<string, unknown>).last_message ?? '')
        if (info.phase === 'running') return
        stopPolling()
        montagePhase.value = info.phase === 'done' ? 'done' : 'failed'
        montageResult.value = (task.result ?? {}) as Record<string, unknown>
        if (info.phase === 'failed') { montageError.value = info.error; clientError(TAG, `storyboard_montage 失败 task=${montageTaskId.value}`, { error: info.error }) }
        else clientInfo(TAG, `storyboard_montage 完成 task=${montageTaskId.value}`)
      } catch (e) {
        clientError(TAG, `草稿链轮询异常 task=${montageTaskId.value}`, e)
      }
    }
    void tick()
    timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  }

  /** 第 6 步 交付：导入服务端草稿包（逐任务聚合 zip → 解压校验 → 落盘剪映草稿目录） */
  const exporting = ref(false)
  const exportStage = ref('')
  const exportNote = ref('')
  async function importDraftPackage(): Promise<void> {
    if (exporting.value) return
    if (!montageTaskId.value) { exportNote.value = '还没有草稿链任务——先在第 5 步触发特效包装'; return }
    const progressChannel = `jy-pkg:progress:${Date.now()}_${Math.floor(Math.random() * 1e8)}`.replace(/-/g, '')
    const off = (window as unknown as {
      tintin?: { server?: { onVoiceProgress?: (ch: string, cb: (d: { stage?: string; value?: number }) => void) => () => void } }
    }).tintin?.server?.onVoiceProgress?.(progressChannel, (d) => {
      if (typeof d?.value === 'number') exportStage.value = `${d.stage || '导入中'} ${Math.round(d.value)}%`
      else if (d?.stage) exportStage.value = String(d.stage)
    })
    exporting.value = true
    exportNote.value = ''
    try {
      const res = (await serverBridge().editorExportJianyingPackage({
        taskIds: [montageTaskId.value],
        progressChannel,
      })) as { success?: boolean; results?: Array<{ taskId: string; draftFolder: string; registered?: boolean }>; launched?: boolean; message?: string } | { success: false; message: string }
      const r = res as { success?: boolean; results?: Array<{ taskId: string; draftFolder: string; registered?: boolean }>; message?: string }
      if (r.success === false) {
        exportNote.value = `导入失败：${r.message || '未知错误'}`
        clientError(TAG, '草稿包导入失败', { res: r })
        return
      }
      const lines = (r.results || []).map((x) => `任务 ${x.taskId} → ${x.draftFolder}${x.registered ? '' : '（首页注册失败，草稿仍可用）'}`)
      exportNote.value = lines.length ? `已导入 ${lines.length} 个草稿：\n${lines.join('\n')}` : '导入完成'
      clientInfo(TAG, `草稿包导入完成 task=${montageTaskId.value}`)
    } catch (e) {
      exportNote.value = `导入失败：${errText(e)}`
      clientError(TAG, '草稿包导入失败', e)
    } finally {
      exporting.value = false
      off?.()
    }
  }

  return {
    montageTaskId, montagePhase, montageProgress, montageElapsedSec, montageMessage, montageError, montageResult,
    trigger, stopPolling,
    exporting, exportStage, exportNote, importDraftPackage,
  }
}
