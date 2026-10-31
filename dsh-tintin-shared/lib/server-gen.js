// server-gen — TinTin 服务端生成契约客户端(纯函数层,2026-10-31 用户裁决自
// openfilm-tools.js 随迁改名:契约属于服务端,不属于任何产品;封面(cover-background)
// 与影片(openfilm-tools)同用一份。零依赖,仅 node 内置(同 dsh-tintin-shared 章程)。
// 契约:POST /generate/{image|video} → 任务体 → 轮询 /tasks/unified/{id} → 下载 output_url。

/** 任意响应体 → 对象(非普通对象返回 null)。 */
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)

/** 服务端相对 URL → 绝对 URL。 */
export function absoluteUrl(baseUrl, url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  const base = String(baseUrl || '').replace(/\/+$/, '')
  return base + (value.startsWith('/') ? value : `/${value}`)
}

/** 从任务响应里取任务 id（兼容 task_id/taskId/id/job_id/jobId，data 包一层也认）。 */
export function taskIdOf(body) {
  const obj = asObj(body)
  if (!obj) return ''
  for (const key of ['task_id', 'taskId', 'id', 'job_id', 'jobId']) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key]
    if (typeof obj[key] === 'number') return String(obj[key])
  }
  const data = asObj(obj.data)
  return data ? taskIdOf(data) : ''
}

/** 从任务响应里取状态（小写）。 */
export function taskStatusOf(body) {
  const obj = asObj(body)
  if (!obj) return ''
  for (const key of ['status', 'state']) {
    if (typeof obj[key] === 'string') return obj[key].toLowerCase()
  }
  const data = asObj(obj.data)
  return data ? taskStatusOf(data) : ''
}
