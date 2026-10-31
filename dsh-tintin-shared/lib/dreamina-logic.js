// dreamina-logic.js — 即梦 CLI（dreamina）纯函数层：参数组包 / 输出解析 / 状态汇总。(2026-10-31 随 dreamina.js 一同迁入共享叶子包)
// 依据（铁律 9）：dreamina 1.4.21 各子命令 -h 实测（2026-10-25，本机
// %USERPROFILE%\bin\dreamina.exe，--help 全量抓取）；官方安装脚本
// https://jimeng.jianying.com/cli（SKILL.md md5 fc22c326 校验通过）。
// 本文件零 I/O（同 ytdlp-logic 分层口径）；进程封装在 dreamina-cli.js。

/** 生成类子命令白名单（-h 实测的 8 个 Generator Commands） */
export const DREAMINA_GENERATE_COMMANDS = Object.freeze([
  'text2image', 'image2image', 'text2video', 'image2video',
  'frames2video', 'multiframe2video', 'multimodal2video', 'image_upscale',
])

/** 比例字典（-h 实测）：图片/视频支持集不同——3:2、2:3 仅图片端支持 */
export const DREAMINA_IMAGE_RATIOS = Object.freeze(['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'])
export const DREAMINA_VIDEO_RATIOS = Object.freeze(['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'])

export function isImageCommand(command) {
  return command === 'text2image' || command === 'image2image' || command === 'image_upscale'
}

/** 生成任务入参（客户端 payload 形状；字段全可选除 command/prompt） */
/**
 * @param {{
 *   command: string,
 *   prompt: string,
 *   images?: string[],
 *   ratio?: string,
 *   resolutionType?: string,
 *   videoResolution?: string,
 *   modelVersion?: string,
 *   generateNum?: number,
 *   duration?: number,
 *   session?: number,
 *   poll?: number,
 *   width?: number,
 *   height?: number,
 * }} p
 * @returns {string[]} argv（不含程序名）
 */
export function buildGenerateArgs(p) {
  const command = String(p?.command ?? '')
  if (!DREAMINA_GENERATE_COMMANDS.includes(command)) {
    throw new Error(`dreamina: 不支持的生成命令「${command}」`)
  }
  const prompt = String(p?.prompt ?? '').trim()
  if (!prompt) throw new Error('dreamina: prompt 不能为空')
  const argv = [command, `--prompt=${prompt}`]
  const images = Array.isArray(p?.images) ? p.images.map((x) => String(x ?? '').trim()).filter(Boolean) : []
  if (command === 'image2image') {
    if (!images.length) throw new Error('dreamina: image2image 至少需要 1 张本地参考图（--images）')
    if (images.length > 10) throw new Error('dreamina: image2image 一次最多 10 张参考图')
    for (const img of images) argv.push(`--images=${img}`)
  }
  if (command === 'image2video') {
    if (!images.length) throw new Error('dreamina: image2video 需要 1 张本地首帧图（--image）')
    argv.push(`--image=${images[0]}`)
  }
  // 比例：'智能'/空=不传（CLI 自行推断）；显式比例必须在该命令的支持集内
  //（铁律 6：不支持就报错，不静默丢弃改默认）。
  const ratio = String(p?.ratio ?? '').trim()
  if (ratio && ratio !== '智能') {
    const allowed = isImageCommand(command) ? DREAMINA_IMAGE_RATIOS : DREAMINA_VIDEO_RATIOS
    if (!allowed.includes(ratio)) throw new Error(`dreamina: ${command} 不支持比例「${ratio}」（可选：${allowed.join('、')}）`)
    argv.push(`--ratio=${ratio}`)
  }
  const resolutionType = String(p?.resolutionType ?? '').trim()
  if (resolutionType) argv.push(`--resolution_type=${resolutionType}`)
  const videoResolution = String(p?.videoResolution ?? '').trim()
  if (videoResolution) argv.push(`--video_resolution=${videoResolution}`)
  const modelVersion = String(p?.modelVersion ?? '').trim()
  if (modelVersion) argv.push(`--model_version=${modelVersion}`)
  if (p?.generateNum !== undefined && p.generateNum !== null) {
    const n = Number(p.generateNum)
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('dreamina: generate_num 需为 1-10 整数')
    argv.push(`--generate_num=${n}`)
  }
  if (p?.duration !== undefined && p.duration !== null) {
    const d = Number(p.duration)
    if (!Number.isInteger(d) || d < 1) throw new Error('dreamina: duration 需为正整数秒')
    argv.push(`--duration=${d}`)
  }
  if (p?.poll !== undefined && p.poll !== null) {
    const s = Number(p.poll)
    if (!Number.isInteger(s) || s < 0) throw new Error('dreamina: poll 需为非负整数秒')
    argv.push(`--poll=${s}`)
  }
  if (p?.session !== undefined && p.session !== null) {
    const sid = Number(p.session)
    if (!Number.isInteger(sid) || sid < 0) throw new Error('dreamina: session 需为非负整数 id')
    argv.push(`--session=${sid}`)
  }
  const width = Number(p?.width)
  const height = Number(p?.height)
  const hasWidth = p?.width !== undefined && p.width !== null && Number.isFinite(width)
  const hasHeight = p?.height !== undefined && p.height !== null && Number.isFinite(height)
  if (hasWidth !== hasHeight) throw new Error('dreamina: width/height 必须成对提供')
  if (hasWidth && hasHeight) {
    if (width <= 0 || height <= 0) throw new Error('dreamina: width/height 需为正整数')
    argv.push(`--width=${width}`, `--height=${height}`)
  }
  return argv
}

/** CLI 输出解析：JSON（user_credit/list_task/生成回执）→ 'json'；
 *  key: value 行（login 设备码材料）→ 'kv'；其余 → 'raw'（原样保留）。 */
export function parseCliOutput(text) {
  const s = String(text ?? '').trim()
  if (!s) return { kind: 'raw', value: '' }
  if (s.startsWith('{') || s.startsWith('[')) {
    try { return { kind: 'json', value: JSON.parse(s) } } catch { /* 落 kv/raw */ }
  }
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const kv = {}
  let kvHits = 0
  for (const line of lines) {
    const m = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(line)
    if (m) { kv[m[1]] = m[2].trim(); kvHits++ }
  }
  if (kvHits > 0 && kvHits >= Math.ceil(lines.length / 2)) return { kind: 'kv', value: kv }
  return { kind: 'raw', value: s }
}

/** 解析结果里取首层字段（json 取对象字段；kv 取键；raw 为空） */
function fieldOf(parsed, key) {
  if (!parsed || parsed.kind === 'raw') return undefined
  const v = parsed.value
  if (parsed.kind === 'kv') return v[key]
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const hit = v[key]
    return hit === undefined || hit === null || typeof hit === 'object' ? undefined : String(hit)
  }
  return undefined
}

export function extractSubmitId(parsed) {
  return fieldOf(parsed, 'submit_id') || fieldOf(parsed, 'submitId') || ''
}

export function extractGenStatus(parsed) {
  return fieldOf(parsed, 'gen_status') || fieldOf(parsed, 'genStatus') || ''
}

export function extractFailReason(parsed) {
  return fieldOf(parsed, 'fail_reason') || fieldOf(parsed, 'message') || fieldOf(parsed, 'error') || ''
}

/** 深走 JSON 收集媒体 URL（键名含 url 的字符串值，http(s) 才收；数组/嵌套对象递归） */
export function extractMediaUrls(value, out = [], seen = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) extractMediaUrls(item, out, seen)
    return out
  }
  if (typeof value !== 'object' || value === null) return out
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      if (/url$/i.test(key) && /^https?:\/\//i.test(v) && !seen.has(v)) { seen.add(v); out.push(v) }
    } else if (typeof v === 'object' && v !== null) {
      extractMediaUrls(v, out, seen)
    }
  }
  return out
}

/** status 汇总：--version JSON + user_credit 结果 → 渲染层状态对象。
 *  creditErr 带「未检测到有效登录态」=未登录（可用但未授权）；其他错误=CLI 异常。 */
export function summarizeStatus({ bin, versionParsed, creditParsed, creditError }) {
  const versionValue = versionParsed && versionParsed.kind === 'json' ? versionParsed.value : null
  const creditValue = creditParsed && creditParsed.kind === 'json' ? creditParsed.value : null
  const creditText = String(creditError ?? '')
  const loggedOut = creditText.includes('未检测到有效登录态') || creditText.includes('login')
  return {
    available: Boolean(bin),
    bin: String(bin ?? ''),
    version: String(versionValue?.version ?? ''),
    loggedIn: Boolean(creditValue?.user_id),
    credit: creditValue && Number.isFinite(Number(creditValue.total_credit)) ? Number(creditValue.total_credit) : undefined,
    vipLevel: String(creditValue?.vip_level ?? '') || undefined,
    userId: String(creditValue?.user_id ?? '') || undefined,
    error: bin ? (creditValue ? undefined : (loggedOut ? '未登录' : creditText || 'CLI 调用失败')) : '未找到 dreamina 可执行文件',
  }
}
