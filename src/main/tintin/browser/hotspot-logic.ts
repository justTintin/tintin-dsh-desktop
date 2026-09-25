// hotspot-logic.ts — 今日热点采集·纯函数层（SRC desktop/main/hotspot-capture.js
// 纯函数段 1:1 移植，基线 SRC 9ca9050；铁律 8 分层：本文件无 Electron 依赖，全部可单测）
// 解析规则逐行对照 SRC（源头为原版 preload-webview.js 热榜 API 拦截）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ── 采集页清单（对照原版 app.js：zhihu 已注释隐藏）──
export const HOTSPOT_PAGES = [
  { platform: 'douyin', url: 'https://www.douyin.com/hot' },
  // { platform: 'zhihu', url: 'https://www.zhihu.com/hot' },        // 暂时隐藏
  { platform: 'xiaohongshu', url: 'https://www.xiaohongshu.com/explore' },
  { platform: 'bilibili', url: 'https://www.bilibili.com/v/popular/rank/all' },
] as const

export interface HotspotItem {
  platform: string
  title: string
  rank: number
  hot: string | number
  url: string
}

/** 抖音热榜：aweme/v1/web/hot/search/list */
function parseDouyin(payload: Record<string, unknown>): HotspotItem[] {
  const d = payload.data as Record<string, unknown> | undefined
  const wl = ((d && ((d.word_list || d.data) as unknown[])) || (payload.word_list as unknown[]) || []) as Array<Record<string, unknown>>
  return (wl || []).map((w, i) => ({
    platform: 'douyin',
    title: String(w.word || w.sentence || w.title || ''),
    rank: (w.position !== undefined ? Number(w.position) + 1 : i + 1),
    hot: Number(w.hot_value || w.hotValue || w.hot_score || 0),
    url: w.word ? `https://www.douyin.com/search/${encodeURIComponent(String(w.word))}` : '',
  })).filter((x) => x.title)
}

/** 知乎热榜：api/v3/feed/topstory/hot-lists/total（页面已隐藏，解析保留对照） */
function parseZhihu(payload: Record<string, unknown>): HotspotItem[] {
  if (!payload || !Array.isArray(payload.data)) return []
  return (payload.data as Array<Record<string, unknown>>).map((it, i) => {
    const t = (it.target || {}) as Record<string, unknown>
    const titleArea = t.title_area as Record<string, unknown> | undefined
    const metricsArea = t.metrics_area as Record<string, unknown> | undefined
    const question = t.question as Record<string, unknown> | undefined
    return {
      platform: 'zhihu',
      title: String(t.title || (titleArea && titleArea.text) || (question && question.title) || ''),
      rank: i + 1,
      hot: String(it.detail_text || (metricsArea && metricsArea.text) || ''),
      url: t.id ? `https://www.zhihu.com/question/${String(t.id)}` : (it.card_id ? `https://www.zhihu.com/${String(it.card_id)}` : ''),
    }
  }).filter((x) => x.title)
}

/** 小红书热点：api/sns/web/v1/search/hotlist 或 hot_list */
function parseXiaohongshu(payload: Record<string, unknown>): HotspotItem[] {
  if (!payload || !payload.data) return []
  const d = payload.data as Record<string, unknown>
  const arr = ((d.items || d.hot_query || d.list) || []) as Array<Record<string, unknown>>
  return (arr || []).map((it, i) => ({
    platform: 'xiaohongshu',
    title: String(it.title || it.query || it.name || ''),
    rank: i + 1,
    hot: String(it.score || it.hot_value || ''),
    url: (it.title || it.query) ? `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(String(it.title || it.query))}` : '',
  })).filter((x) => x.title)
}

/** B站热门排行：x/web-interface/ranking 或 /popular */
function parseBilibili(payload: Record<string, unknown>): HotspotItem[] {
  const d = payload.data as Record<string, unknown> | undefined
  const arr = ((d && (d.list || d.item)) || []) as Array<Record<string, unknown>>
  return (arr || []).map((it, i) => {
    const stat = it.stat as Record<string, unknown> | undefined
    const view = stat && stat.view !== undefined ? Number(stat.view) : undefined
    return {
      platform: 'bilibili',
      title: String(it.title || ''),
      rank: i + 1,
      hot: view !== undefined ? (view >= 10000 ? (view / 10000).toFixed(1) + '万播放' : view + '播放') : '',
      url: it.bvid ? `https://www.bilibili.com/video/${String(it.bvid)}` : '',
    }
  }).filter((x) => x.title)
}

/** URL → 解析器映射（与原版四个 if 分支的 includes 匹配一致） */
export function hotspotParserForUrl(url: string): ((payload: Record<string, unknown>) => HotspotItem[]) | null {
  const u = String(url || '')
  if (u.includes('aweme/v1/web/hot/search/list')) return parseDouyin
  if (u.includes('feed/topstory/hot-lists')) return parseZhihu
  if (u.includes('sns/web/v1/search/hot')) return parseXiaohongshu
  if (u.includes('x/web-interface/ranking') || u.includes('x/web-interface/popular')) return parseBilibili
  return null
}

/** 解析热榜 API 响应体 → 条目数组（纯函数；异常吞掉返回空，SRC 同口径） */
export function parseHotspotPayload(url: string, payload: Record<string, unknown>): HotspotItem[] {
  const parser = hotspotParserForUrl(url)
  if (!parser) return []
  try { return parser(payload) } catch { return [] }
}

/** 安全 JSON.parse（CDP body 可能带 BOM/空串） */
export function safeJsonParse(text: string): Record<string, unknown> | null {
  try { return JSON.parse(String(text || '')) } catch { return null }
}

// ── DOM 兜底（仅 xiaohongshu 有兜底脚本；douyin/bilibili 靠 API 拦截）──
export function domFallbackScript(platform: string): string {
  if (platform === 'xiaohongshu') {
    return `(() => { const out=[]; const seen=new Set();
      document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result"], .note-item').forEach(el=>{
        const t=el.querySelector('.title')||el.querySelector('span')||el;
        const title=(t.textContent||'').trim();
        const a=el.tagName==='A'?el:el.querySelector('a');
        if(title && title.length>3 && !seen.has(title)){seen.add(title); out.push({title, url:a?a.href:''});}
      });
      return out.slice(0,40); })()`
  }
  return 'null'
}

// ── 清单写入（对照原版 append-hotspot-manifest：追加 + date 字段）──

export function hotspotManifestPath(userDataDir: string): string {
  return join(userDataDir, 'hotspots', 'hotspots_sync.json')
}

export function today(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD（对照原版）
}

/** 追加热榜条目到清单（含日期，供后续趋势合并） */
export function appendHotspotManifest(userDataDir: string, items: HotspotItem[]): { ok: boolean; count: number; date: string; error?: string } {
  const manifestPath = hotspotManifestPath(userDataDir)
  try {
    if (!Array.isArray(items) || items.length === 0) return { ok: true, count: 0, date: today() }
    mkdirSync(join(manifestPath, '..'), { recursive: true })
    let arr: unknown[] = []
    if (existsSync(manifestPath)) {
      try { arr = JSON.parse(readFileSync(manifestPath, 'utf-8')) } catch { arr = [] }
      if (!Array.isArray(arr)) arr = []
    }
    const date = today()
    for (const it of items) arr.push({ ...it, date })
    writeFileSync(manifestPath, JSON.stringify(arr, null, 2), 'utf-8')
    return { ok: true, count: items.length, date }
  } catch (e) {
    return { ok: false, count: 0, date: today(), error: String((e as Error)?.message || e) }
  }
}

/** 去重（对照原版 platform|title 键） */
export function dedupeHotspots(items: HotspotItem[]): HotspotItem[] {
  const out: HotspotItem[] = []
  for (const it of items) {
    const key = it.platform + '|' + it.title
    if (!out.some((x) => (x.platform + '|' + x.title) === key)) out.push(it)
  }
  return out
}
