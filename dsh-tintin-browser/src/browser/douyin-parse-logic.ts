// ═══════════════════════════════════════════════════════════════
// douyin-parse-logic.ts — 抖音分享链接解析·纯函数层
// （SRC desktop/main/douyin-parse-logic.js 一比一移植，基线 SRC 9ca9050；
//   2026-10-26「下载扩展链复活」工作包，铁律 12 依据②）
// 无 electron 依赖，可单测（铁律 8）。
// 来源：assets/chrom-douyin-v2025.4.7 扩展（Chrome popup 型）核心能力整合：
//   分享文本 → 提取 v.douyin.com 短链 → GET dy.xs25.cn/api/douyinjx →
//   {code:200, data:{video_url, additional_data:[{nickname,signature,desc}]}}
// 用户裁决（2026-09-02）：扩展预装且可用其下载——Electron 无工具栏无法触发
// popup，故把解析通道移入主进程 IPC（browser:douyinParse），UI 进浏览器右栏。
// ═══════════════════════════════════════════════════════════════

/** 抖音解析 API（对齐扩展 popup.js L418 的 endpoint） */
export const DOUYIN_PARSE_API = 'https://dy.xs25.cn/api/douyinjx?url='

/**
 * 从分享文本提取 v.douyin.com 短链（对齐扩展 extractDouyinUrl 正则）
 */
export function extractDouyinShareUrl(text: unknown): string | null {
  const match = String(text || '').match(/https:\/\/v\.douyin\.com\/[\w-]+\/?/)
  return match ? (match[0] ?? null) : null
}

/**
 * 从口令文本提取短链码（2026-11-04 用户报障裁决选 1，超出 SRC 1:1 的扩展：
 * 口令形态 `7.97 Z@j.Cu 09/09 UYz:/ 国行iphone终于能用AI了` 的 `UYz` 即
 * v.douyin.com 短链码，拼回短链走既有 302 探测）。日期锚定（MM/DD 码:/）
 * 优先；无日期退回词边界泛匹配（排除 https:/ 之类 URL 成分）。
 */
export function extractDouyinPasscode(text: unknown): string | null {
  const s = String(text || '')
  const anchored = s.match(/[01]?\d\/[0123]?\d\s+([A-Za-z0-9]{2,12}):\//)
  if (anchored?.[1]) return anchored[1]
  const generic = s.match(/(?<![\w./:@~-])([A-Za-z0-9]{2,12}):\/(?!\/)/)
  return generic?.[1] ?? null
}

/** 短链码拼 v.douyin.com 短链（302 探测入口与 API 兜底共用）；非法码 → null */
export function buildDouyinShortUrl(code: unknown): string | null {
  const c = String(code || '').trim()
  return /^[A-Za-z0-9]{2,12}$/.test(c) ? `https://v.douyin.com/${c}/` : null
}

export interface DouyinParseOk {
  ok: true
  videoUrl: string
  author: string
  desc: string
}
export interface DouyinParseFail {
  ok: false
  reason: string
}

/** 校验解析 API 响应，抽取下载直链与作者信息 */
export function validateDouyinParseResponse(resp: unknown): DouyinParseOk | DouyinParseFail {
  if (!resp || typeof resp !== 'object') {
    return { ok: false, reason: '解析接口响应异常' }
  }
  const r = resp as { code?: unknown; msg?: unknown; data?: unknown }
  if (r.code !== 200) {
    return { ok: false, reason: String(r.msg || '解析失败') }
  }
  if (!r.data) {
    return { ok: false, reason: '解析接口响应异常' }
  }
  const data = r.data as { video_url?: unknown; additional_data?: unknown }
  const videoUrl = String(data.video_url || '').trim()
  if (!videoUrl) {
    return { ok: false, reason: '解析结果缺少视频直链，无法下载' }
  }
  const extra = Array.isArray(data.additional_data)
    ? (data.additional_data[0] as { nickname?: unknown; desc?: unknown } | undefined) ?? null
    : null
  return {
    ok: true,
    videoUrl,
    author: String(extra?.nickname || '').trim(),
    desc: String(extra?.desc || '').trim(),
  }
}

/**
 * 从抖音 URL（视频页 / note 页 / 302 分享页 Location）提取视频 ID
 * 仅认 /video/{id} 与 /note/{id}；短链与用户主页返回 null
 */
export function extractDouyinVideoIdFromUrl(url: unknown): string | null {
  const match = String(url || '').match(/\/(?:video|note)\/(\d{15,})/)
  return match ? (match[1] ?? null) : null
}

/**
 * 由视频 ID 拼出 www.douyin.com 视频页 URL（yt-dlp Douyin extractor 直连用；
 * note 视频同一 aweme id，/video/ 形式同样可解析）
 */
export function buildDouyinVideoPageUrl(id: unknown): string | null {
  const v = String(id || '').trim()
  return /^\d{15,}$/.test(v) ? 'https://www.douyin.com/video/' + v : null
}
