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

/**
 * 从口令/分享文本提取视频标题（码:/ 之后到首个链接前的描述段；2026-11-05 用户
 * 裁决：文件名与结果卡按视频标题命名，不再「抖音视频」占位）。无码段不提取
 * （纯链接文本的前缀是分享样板话）；样板话剥离后为空 → null。
 */
export function extractDouyinCaption(text: unknown): string | null {
  const s = String(text || '')
  const anchored = s.match(/[01]?\d\/[0123]?\d\s+[A-Za-z0-9]{2,12}:\//)
  const generic = anchored ? null : s.match(/(?<![\w./:@~-])[A-Za-z0-9]{2,12}:\/(?!\/)/)
  const codeMatch = anchored ?? generic
  if (!codeMatch) return null
  let rest = s.slice((codeMatch.index ?? 0) + codeMatch[0].length)
  rest = rest.split(/https?:\/\//)[0] ?? ''
  rest = rest.replace(/复制此链接.*$/g, '').replace(/复制打开抖音/g, '')
  const title = rest.replace(/^[\s:：,，、.。]+/, '').replace(/[\s,，、.。]+$/, '').trim()
  return title || null
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

// ── 通用粘贴入口路由（2026-11-12 用户裁决「开通用粘贴入口」：链接按域名路由，
//    引擎一套，不为新平台写专属代码；分平台只发生在「获取直链策略」层）──

export type ShareTextRoute =
  | { kind: 'douyin' }
  | { kind: 'bilibili'; url: string }
  | { kind: 'generic'; url: string }
  | { kind: 'none' }

/** 抖音信号判定：短链 / 视频页·note 页 id / 口令码 任一命中即走既有抖音链 */
function looksLikeDouyin(text: string): boolean {
  return !!(extractDouyinShareUrl(text) || extractDouyinVideoIdFromUrl(text) || extractDouyinPasscode(text))
}

/**
 * 分享文本路由（纯函数，单测下沉）：
 * - douyin：分享链接/口令/视频页 URL → 既有抖音链（302 探测→捕获下载）
 * - bilibili：B站链接（含 b23.tv 短链）→ 指回扩展助手区（§16.32 唯一入口裁决，
 *   不在通用卡并行开第二条 B站下载路）
 * - generic：其余 http(s) 链接 → yt-dlp 通用链（youtube 等引擎现成支持）
 * - none：无 URL（纯口令不匹配任何抖音信号时也归 none——既不是抖音也不是链接）
 */
export function routeShareText(text: unknown): ShareTextRoute {
  const s = String(text || '')
  if (looksLikeDouyin(s)) return { kind: 'douyin' }
  const match = s.match(/https?:\/\/[^\s]+/i)
  const url = match ? match[0] : ''
  if (!url) return { kind: 'none' }
  if (/bilibili\.com|b23\.tv/i.test(url)) return { kind: 'bilibili', url }
  return { kind: 'generic', url }
}
