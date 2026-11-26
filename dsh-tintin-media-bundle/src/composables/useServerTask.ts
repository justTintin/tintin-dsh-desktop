// ═══════════════════════════════════════════════════════════════
// useServerTask — 服务端异步任务状态机（媒体工具共享 composable）
// 职责：提交前置 reset → 上传进度 → 2s 轮询 /tasks/{task_id} →
//       completed/failed 终态 + 系统通知；组件卸载自动停止轮询
// 来源：自 ImageMatting / SubtitleRemoval / VoiceClone 三处原样
//       收敛（行为统一为带 failed 守卫的完成判定，更安全）
// ═══════════════════════════════════════════════════════════════

import { ref, onBeforeUnmount } from 'vue'
import { clientError } from '../utils/clientLog'

/** 任务终态机（'' 为初始） */
export type TaskStatus = '' | 'queued' | 'processing' | 'done' | 'failed'

/** GET /tasks/{task_id} 返回的进度结构 */
export interface TaskProgressData {
  status?: string
  progress?: number
  result_url?: string
  error_message?: string
  /** 2026-09-07 实测契约：/tasks/{id} 的错误字段是 error（如「模型资源不可用: vsr」），非 error_message */
  error?: string
  /** 结构化结果（如 /vsr/remove 返回 result.output_path，服务端本地路径） */
  result?: { output_path?: string } | null
}

export interface UseServerTaskOptions {
  /** 完成通知标题，如「图像抠图完成」 */
  successTitle: string
  /** 失败通知标题，如「图像抠图失败」 */
  failTitle: string
  /** 成功通知正文 getter（可引用组件侧文件名等）；缺省正文为空串 */
  getSuccessBody?: () => string
  /** 轮询间隔 ms，默认 2000 */
  intervalMs?: number
  /**
   * 完成时从轮询响应提取结果 URL 的钩子（2026-09-07）：
   * 服务端契约不统一——部分域回 result_url，部分域（如 vsr）只回 result.output_path；
   * 提供此钩子的调用方在 result_url 缺失时走自己的提取逻辑。
   */
  extractResultUrl?: (data: TaskProgressData) => string
}

export function useServerTask(opts: UseServerTaskOptions) {
  // ── 任务状态 ──
  const taskId = ref('')
  const status = ref<TaskStatus>('')
  const progress = ref(0)
  const errorMsg = ref('')
  const resultUrl = ref('')     // 结果资源地址
  const resultPath = ref('')    // 结果本地路径
  const isProcessing = ref(false)
  const uploadPercent = ref(0)

  let pollTimer: ReturnType<typeof setTimeout> | null = null

  function stopPolling(): void {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  /** 重置结果区（不清 isProcessing） */
  function resetResult(): void {
    taskId.value = ''
    status.value = ''
    progress.value = 0
    errorMsg.value = ''
    resultUrl.value = ''
    resultPath.value = ''
  }

  /** 提交前置：清结果 + 进入排队态 */
  function begin(): void {
    resetResult()
    isProcessing.value = true
    status.value = 'queued'
    errorMsg.value = ''
    uploadPercent.value = 0
  }

  /** 上传进度回调（透传给 server.submit 的 onProgress） */
  function setUpload(p: number): void {
    uploadPercent.value = Math.round(p)
  }

  /** 弹系统通知（无壳环境静默降级） */
  function notify(title: string, body: string): void {
    try { window.tintin?.shell?.showNotification?.(title, body) } catch (_) {}
  }

  /** 统一失败处理：置 failed 态 + 停轮询 + 通知 */
  function failWith(err: unknown): void {
    errorMsg.value = err instanceof Error ? err.message : String(err)
    status.value = 'failed'
    isProcessing.value = false
    stopPolling()
    clientError('server-task', String(opts.failTitle || '任务失败'), err)
    notify(opts.failTitle, errorMsg.value)
  }

  /** 同步完成（无 task_id 的接口直接返回结果时使用） */
  function completeSync(url: string): void {
    resultUrl.value = url || ''
    status.value = 'done'
    isProcessing.value = false
    notify(opts.successTitle, opts.getSuccessBody?.() ?? '')
  }

  function startPolling(id: string): void {
    stopPolling()
    taskId.value = id
    pollFailStreak = 0
    pollUnreachableSince = 0
    pollDelayMs = opts.intervalMs ?? POLL_BASE_INTERVAL_MS
    schedulePoll(id, pollDelayMs)
  }

  // ── 轮询瞬态重试（2026-10-13 用户裁定：轮询遇 5xx/网络错误=瞬态，重试而非停在
  //  旧态——服务端任务本体仍在运行，停刷会把可恢复抖动放大成「没生成/没完成」；
  //  仅连续失败超阈值或服务端终态才升级失败）
  // 2026-11-24 重构（用户质询「服务端不可达时 2s×150 疯狂轰炸 5 分钟就报失败」：
  //  实测事故=去字幕提交后服务端全程无响应，旧实现 2s 定时器不退避不防叠发，
  //  每发在代理层挂 30s 超时→同时堆积 ~15 个并发僵尸请求，150 次注定全败后盖
  //  「失败」且文案断言「任务本体仍在服务端」=瞎猜）：
  //   · setInterval → 自调度 setTimeout：上一发未返回不叠发
  //   · 连续失败按 1.5× 退避（上限 30s）：服务端恢复自动续上，不可达时不再贴脸轰炸
  //   · 放弃线双保险：连续不可达 60 分钟（真实时钟）或硬计数 1500（兜底）
  //   · 升级文案改诚实：服务端长时间无响应时任务状态未知，不再断言任务仍存活
  const POLL_BASE_INTERVAL_MS = 2000
  const POLL_BACKOFF_MAX_MS = 30000
  const POLL_FAIL_STREAK_MAX = 1500
  const POLL_GIVE_UP_MS = 60 * 60 * 1000
  let pollFailStreak = 0
  let pollUnreachableSince = 0
  let pollDelayMs = POLL_BASE_INTERVAL_MS

  /** 自调度下一次轮询：上一发 settle 后才排下一发，天然无叠发 */
  function schedulePoll(id: string, delayMs: number): void {
    stopPolling()
    pollTimer = setTimeout(() => { void pollOnce(id) }, delayMs)
  }

  /** 拉取一次任务进度并推进状态机 */
  async function pollOnce(id: string): Promise<void> {
    try {
      const data = (await window.tintin.server.tasksProgress(id)) as TaskProgressData | null
      if (!data) {
        // 离线 null 同样按瞬态失败计（旧实现此处静默续轮=永不升级失败的暗洞）
        throw new Error('离线：进度查询通道不可用')
      }
      pollFailStreak = 0
      pollUnreachableSince = 0
      pollDelayMs = opts.intervalMs ?? POLL_BASE_INTERVAL_MS
      const st = (data.status ?? '') as TaskStatus
      status.value = st
      // 进度仅在处理态采信（服务端 2026-10-13 已对齐：排队报 0/处理态报真实
      // 进度/编码段 90-100）。本守卫保留为防御层——worker 若回归「排队回 100」
      // 的旧行为（实测事故 c_55435304-7），客户端仍不会被误判成已完成
      if (st === 'processing') progress.value = data.progress ?? 0
      if (
        data.status === 'completed' ||
        (st === 'processing' && data.progress === 100)
      ) {
        resultUrl.value = data.result_url || opts.extractResultUrl?.(data) || ''
        status.value = 'done'
        isProcessing.value = false
        stopPolling()
        notify(opts.successTitle, opts.getSuccessBody?.() ?? '')
        return
      } else if (data.status === 'failed') {
        // 2026-09-07：服务端 /tasks/{id} 错误字段为 error（error_message 不存在，
        // 旧代码只读后者致真实原因被「处理失败」吞掉，如「模型资源不可用: vsr」）
        failWith(data.error_message || data.error || '处理失败')
        return
      } else if (st === 'cancelled') {
        failWith('已被用户终止。')
        return
      }
      schedulePoll(id, pollDelayMs) // queued/processing：按正常节拍续轮
    } catch (err) {
      pollFailStreak += 1
      if (!pollUnreachableSince) pollUnreachableSince = Date.now()
      const transient = !/HTTP\s+4\d\d/.test(String((err as Error)?.message ?? err)) // 4xx=任务确实没了，瞬态豁免不适用
      const unreachableMs = Date.now() - pollUnreachableSince
      if (transient && pollFailStreak < POLL_FAIL_STREAK_MAX && unreachableMs < POLL_GIVE_UP_MS) {
        // 约定：保持轮询不置失败（进度停在最后已知值），退避重试，服务端恢复后自动续上
        pollDelayMs = Math.min(Math.max(Math.round(pollDelayMs * 1.5), POLL_BASE_INTERVAL_MS), POLL_BACKOFF_MAX_MS)
        clientError('server-task', `轮询失败（连续第 ${pollFailStreak} 次，已不可达 ${Math.round(unreachableMs / 1000)}s）——${Math.round(pollDelayMs / 1000)}s 后重试`, err)
        schedulePoll(id, pollDelayMs)
        return
      }
      failWith(transient
        ? `任务进度查询连续失败 ${pollFailStreak} 次（已不可达约 ${Math.max(1, Math.round(unreachableMs / 60000))} 分钟）——服务端长时间无响应；任务状态未知（可能仍在服务端运行，也可能已随服务中断丢失），可稍后重进查看结果`
        : (err instanceof Error ? err.message : String(err)))
    }
  }

  // 组件卸载自动停表
  onBeforeUnmount(stopPolling)

  return {
    // state
    taskId,
    status,
    progress,
    errorMsg,
    resultUrl,
    resultPath,
    isProcessing,
    uploadPercent,
    // methods
    begin,
    setUpload,
    startPolling,
    stopPolling,
    pollOnce,
    failWith,
    completeSync,
    resetResult,
  }
}
