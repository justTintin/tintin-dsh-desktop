// ═══════════════════════════════════════════════════════════════
// platform-meta.ts — 浏览器域平台定义（SRC desktop/main/platform-meta.js
// 一比一移植，搬运基线 SRC 9ca9050；2026-09-25 用户裁决提前移植浏览器域首片）
// 纯函数/纯数据，无 Electron 依赖（host 侧 ytdlp 门后续复用同一份平台表）。
// 分区 persist:tintin-<id> 是登录态载体：内嵌浏览器各平台独立 cookie jar，
// yt-dlp 参考视频下载按平台域导出 Netscape cookies（SRC 用户拍板方案）。
// 差异：youtube/jimeng 的 extractor 指向 SRC 亦未实现的脚本（extractDOM 优雅降级）。
// ═══════════════════════════════════════════════════════════════

export interface PlatformDef {
  name: string
  partition: string
  seedUrl: string
  /** DOM 抽取器脚本路径（SRC extractors/* 一比一；脚本文件在 build/extractors/） */
  extractor: string | null
}

// ── 平台定义 + 网页浏览器：partition（cookie jar 隔离）+ seed URL ──
// C14 接口一致性：平台组 5 个 = 抖音/视频号/快手/小红书/B站；
// 另含 web/youtube/jimeng 扩展位 + fxg 抖店分区（仅自动上架使用，不进平台组）。
export const PLATFORM_DEFS: Record<string, PlatformDef> = {
  // web 起始页（2026-11-04 收藏语义批，用户裁决）：pinterest 国内不可达、首开必白屏，换国内可达起始页
  web: { name: '网页浏览器', partition: 'persist:tintin-web', seedUrl: 'https://www.baidu.com/', extractor: null },
  douyin: { name: '抖音', partition: 'persist:tintin-douyin', seedUrl: 'https://www.douyin.com', extractor: 'extractors/douyin.ts' },
  weixin: { name: '视频号', partition: 'persist:tintin-weixin', seedUrl: 'https://channels.weixin.qq.com', extractor: 'extractors/weixin.ts' },
  kuaishou: { name: '快手', partition: 'persist:tintin-kuaishou', seedUrl: 'https://www.kuaishou.com', extractor: 'extractors/kuaishou.ts' },
  xiaohongshu: { name: '小红书', partition: 'persist:tintin-xhs', seedUrl: 'https://www.xiaohongshu.com', extractor: 'extractors/xiaohongshu.ts' },
  bilibili: { name: 'B站', partition: 'persist:tintin-bili', seedUrl: 'https://www.bilibili.com', extractor: 'extractors/bilibili.ts' },
  youtube: { name: 'YouTube', partition: 'persist:tintin-youtube', seedUrl: 'https://www.youtube.com', extractor: 'extractors/youtube.ts' },
  jimeng: { name: '即梦AI', partition: 'persist:tintin-jimeng', seedUrl: 'https://jimeng.jianying.com', extractor: 'extractors/jimeng.ts' },
  // fxg 抖店工作台：自动上架载体分区（V2 PRD 十四章；无 extractor、无详情页嗅探模式）
  fxg: { name: '抖店', partition: 'persist:tintin-fxg', seedUrl: 'https://fxg.jinritemai.com', extractor: null },
}

export const PLATFORM_IDS: string[] = Object.keys(PLATFORM_DEFS)

// 各平台详情页 URL 模式（只在详情页嗅探，主页/列表页不嗅探）。
// 白名单方式：只有匹配这些模式的 URL 才嗅探；抖音 feed 路径不是详情页
// （预加载相邻视频会产生多条媒体请求，白名单误收曾致列表刷屏——2026-09-02 用户反馈）。
export const PLATFORM_DETAIL_PATTERNS: Record<string, RegExp[]> = {
  douyin: [/\/video\/\d+/, /\/note\/\d+/, /\/user\/[^/]+\/video\/\d+/, /[?&]modal_id=\d+/],
  bilibili: [/\/video\/BV[\w]+/i, /\/video\/av\d+/i, /\/medialist\/\d+/],
  kuaishou: [/\/short-video\/\d+/, /\/f\.ks\.com\/\w+/, /\/video\/\d+/],
  xiaohongshu: [/\/explore\/[a-zA-Z0-9]+/, /\/discovery\/item\/[a-zA-Z0-9]+/, /\/item\/[a-zA-Z0-9]+/],
  weixin: [/\/feed\/[a-zA-Z0-9_-]+/, /\/finder\/[a-zA-Z0-9_-]+/],
  youtube: [/\/watch\?v=[a-zA-Z0-9_-]+/, /\/shorts\/[a-zA-Z0-9_-]+/],
  jimeng: [/\/video\/\d+/, /\/creation\/\w+/, /\/workspace\/\w+/, /\/template\/\d+/],
}

// URL → 平台 ID 映射（根据域名自动识别）
const URL_TO_PLATFORM: Record<string, RegExp[]> = {
  douyin: [/douyin\.com/i, /iesdouyin\.com/i],
  bilibili: [/bilibili\.com/i],
  kuaishou: [/kuaishou\.com/i, /ks\.com/i],
  xiaohongshu: [/xiaohongshu\.com/i, /xhslink\.com/i],
  weixin: [/channels\.weixin\.qq\.com/i, /weixin\.qq\.com/i, /wx\.qq\.com/i],
  youtube: [/youtube\.com/i, /youtu\.be/i, /music\.youtube\.com/i],
  jimeng: [/jimeng\.jianying\.com/i, /jimeng\.com/i],
}

// 各平台 Cookie 域名映射（yt-dlp Netscape 导出 / 下载器 Cookie 提取）
export const PLATFORM_COOKIE_DOMAINS: Record<string, string[]> = {
  douyin: ['.douyin.com', 'www.douyin.com'],
  bilibili: ['.bilibili.com'],
  xiaohongshu: ['.xiaohongshu.com'],
  kuaishou: ['.kuaishou.com'],
  weixin: ['.weixin.qq.com', 'channels.weixin.qq.com'],
  youtube: ['.youtube.com', '.google.com'],
}

// 登录态判据 cookie（2026-11-08 报障修复：原「分区有该平台任意 cookie」=匿名功能
// cookie（ttwid/设备指纹等）也误报已登录；YouTube/小红书全程未登录仍亮绿）。
// 各平台会话级 cookie 名——在任一条即视为已登录（服务端会话凭证，匿名 jar 不含）。
export const LOGIN_COOKIE_NAMES: Record<string, string[]> = {
  douyin: ['sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard'],
  bilibili: ['SESSDATA', 'DedeUserID'],
  kuaishou: ['kuaishou.server.webday7_st', 'kuaishou.server.web_st', 'passToken'],
  xiaohongshu: ['web_session', 'a1'],
  weixin: ['sessionid', 'wap_sid2'],
  youtube: ['SID', 'HSID', 'SSID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID'],
}

/** 会话 cookie 判定：平台会话 cookie 任一在 jar 中即已登录 */
export function hasLoginCookie(names: string[], platform: string): boolean {
  const wanted = LOGIN_COOKIE_NAMES[platform]
  if (!wanted?.length) return false
  return names.some((n) => wanted.includes(n))
}

export function detectPlatformFromUrl(url: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const hostname = u.hostname.toLowerCase()
    for (const [id, patterns] of Object.entries(URL_TO_PLATFORM)) {
      if (patterns.some((p) => p.test(hostname))) return id
    }
  } catch {
    for (const [id, patterns] of Object.entries(URL_TO_PLATFORM)) {
      if (patterns.some((p) => p.test(url))) return id
    }
  }
  return null
}

export function isDetailPage(url: string, platformId: string | null): boolean {
  if (!url) return false
  // 网页浏览器（platformId='web'）：不做 URL 平台过滤，所有平台详情页都可嗅探
  if (platformId === 'web') {
    const urlPlatform = detectPlatformFromUrl(url)
    if (!urlPlatform) return false
    const patterns = PLATFORM_DETAIL_PATTERNS[urlPlatform]
    if (!patterns) return false
    return patterns.some((p) => p.test(url))
  }
  const urlPlatform = detectPlatformFromUrl(url)
  // 不在当前平台分区里嗅探其他平台的内容
  if (urlPlatform && platformId && urlPlatform !== platformId) return false
  const patterns = platformId ? PLATFORM_DETAIL_PATTERNS[platformId] : undefined
  if (!patterns) return false
  return patterns.some((p) => p.test(url))
}

// ── 内嵌浏览器吞掉的 App 深链协议（2026-11-04 用户裁决「按推荐处理」）──
// 命中即拦截/空响应，不转交系统：防 Windows「获取打开此'xxx'链接的应用」弹窗与
// 甩出产品唤起本机 App。名单=各平台域的已知唤起协议（广告位深链重灾区=字节系）；
// 新平台出现新协议时在此补行。bytedance=字节通用唤起协议（B站广告实测）；
// snssdk<number>=字节各 App id（1128 抖音 / 1233 抖音极速版·TikTok / 13 今日头条）。
export const PLATFORM_DEEP_LINK_SCHEMES: readonly string[] = [
  'bytedance', 'snssdk1128', 'snssdk1233', 'snssdk13', 'douyin', 'douyinlite', 'toutiao', 'ixigua',
  'bilibili', 'biliintl', 'xhsdiscover', 'kuaishou', 'kwai', 'ksnebula', 'weixin',
]

/** 协议名（不带冒号，大小写不敏感）是否为会被吞掉的 App 深链 */
export function isDeepLinkScheme(scheme: string): boolean {
  return PLATFORM_DEEP_LINK_SCHEMES.includes(scheme.toLowerCase())
}
