// ═══════════════════════════════════════════════════════════════
// tintin-browser-page-isolation.test.ts — 浏览器页平台隔离契约
// （2026-11-12 用户裁决：各平台解析/下载逻辑必须按平台隔离——抖音的捕获/
//   下载链改造不得波及 B站与其余平台的下载功能。本测试把隔离矩阵钉成回归线：
//   页面右栏入口矩阵（谁隐藏谁显示）、各平台下载链的通道归属（互不借道）、
//   主进程嗅探下载的分区归属（显式声明优先，cookie/referer 不串台）。）
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registerSniffCapture } from '../src/browser/sniff-capture.ts'

const pageHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../dsh-plugin-desktop-tintin/build/tintin-browser.html'),
  'utf8',
)

describe('页面右栏平台隔离矩阵（2026-11-12 用户裁决）', () => {
  it('嗅探面板仅对 B站/抖音隐藏，其余平台保留诊断展示', () => {
    expect(pageHtml).toContain('var hideSniff = isBili || isDy')
    expect(pageHtml).toContain("document.getElementById('sniffHead').style.display = hideSniff ? 'none' : 'block'")
    expect(pageHtml).toContain("document.getElementById('sniffList').style.display = hideSniff ? 'none' : 'flex'")
    // 轮询跳过口径与显示口径一致（B站+抖音），其余平台照常轮询
    expect(pageHtml).toContain("if (sniffPlatform === 'bilibili' || sniffPlatform === 'douyin') return")
  })

  it('下载入口矩阵：B站=扩展推送区（isBili 驱动）；通用粘贴入口=其余平台可见、B站隐藏（2026-11-12 续裁决：B站已有助手）', () => {
    expect(pageHtml).toContain("document.getElementById('biliExtHead').style.display = isBili ? 'block' : 'none'")
    expect(pageHtml).toContain("document.getElementById('biliExtList').style.display = isBili ? 'flex' : 'none'")
    // 通用卡 B站隐藏（冗余），其余平台恒显示；路由分叉在主进程，卡片本身平台无关
    expect(pageHtml).toContain("document.getElementById('douyinParseSec').style.display = isBili ? 'none' : 'block'")
    expect(pageHtml).not.toContain("douyinParseSec').style.display = isDy")
    expect(pageHtml).not.toContain("douyinParseSec').style.display = 'block'")
  })

  it('通用粘贴入口：generic 结果走 downloadMediaStart+useYtdlp（引擎 yt-dlp 模式），不经抖音捕获链', () => {
    const i = pageHtml.indexOf('if (r.generic) {')
    expect(i).toBeGreaterThan(-1)
    // 边界取抖音分支注释行起点（其后正文才有 videoPageUrl 分支，注释本身提及 sniffDownload）
    const seg = pageHtml.slice(i, pageHtml.indexOf('// 视频页路线', i))
    expect(seg).toContain('bridge.downloadMediaStart({')
    expect(seg).toContain('useYtdlp: true')
    expect(seg).toContain('platformId: r.platformId')
    expect(seg).not.toContain('captureOpen')
    expect(seg).not.toContain('sniffDownload')
    // 无水印徽标仅抖音结果展示
    expect(pageHtml).toContain("document.getElementById('dyBadge').style.display = r.generic ? 'none' : ''")
  })

  it('抖音捕获下载链自带平台声明：platformId=douyin + 显式视频页 referer + 只开抖音捕获窗', () => {
    const i = pageHtml.indexOf('bridge.sniffDownload({')
    expect(i).toBeGreaterThan(-1)
    const seg = pageHtml.slice(i, i + 400)
    expect(seg).toContain("platformId: 'douyin'")
    expect(seg).toContain('referer: r.videoPageUrl')
    expect(pageHtml).toContain("page.captureOpen({ platform: 'douyin'")
  })

  it('B站下载走 downloadMediaStart+bilibili 分区，不经抖音捕获/sniffDownload 通道', () => {
    const biliIdx = pageHtml.indexOf('biliExt.items.forEach')
    const nextDyIdx = pageHtml.indexOf('// 抖音分享链接解析', biliIdx)
    expect(biliIdx).toBeGreaterThan(-1)
    expect(nextDyIdx).toBeGreaterThan(biliIdx)
    const biliBlock = pageHtml.slice(biliIdx, nextDyIdx)
    expect(biliBlock).toContain('bridge.downloadMediaStart(')
    expect(biliBlock).toContain("platformId: 'bilibili'")
    expect(biliBlock).not.toContain('sniffDownload')
    expect(biliBlock).not.toContain('captureOpen')
    // 下载按钮独立成行（2026-11-12 用户裁决：与通用卡「下载视频」同构，全宽不被徽标挤压）
    expect(biliBlock).toContain("btn.style.width = '100%'")
    // 防挤压兜底：徽标与按钮都禁换行禁收缩
    expect(pageHtml).toMatch(/\.sn-badge \{[^}]*white-space: nowrap/)
    expect(pageHtml).toMatch(/\.sn-btn \{[^}]*white-space: nowrap[^}]*flex-shrink: 0/)
  })

  it('flex 列容器显式宽度（2026-11-12 宽度塌缩根治：解析期 display:none 的 none→flex 翻转容器被 Chromium 钉死 auto 宽=0）', () => {
    expect(pageHtml).toMatch(/#sniffList, #biliExtList, #dyStreams \{ width: 100%; \}/)
  })

  it('扩展面板标题模板尾巴「的下载地址：」在展示层剥掉（用户问「怎么来的」的噪音源）', () => {
    expect(pageHtml).toMatch(/replace\(\/\\s\*的下载地址\[:：\]\\s\*\$\/,\s*''\)/)
  })
})

describe('主进程嗅探下载通道平台归属（sniff-capture.ts）', () => {
  /** 挂一个只收 sniffDownload 的壳，记下交给下载引擎的实参 */
  function setup(currentPlatform: string): {
    call: (payload: unknown) => Promise<{ success: boolean }>
    received: Array<Record<string, unknown>>
  } {
    const received: Array<Record<string, unknown>> = []
    const handlers: Record<string, unknown> = {}
    registerSniffCapture({
      ipcMain: { handle: (ch, fn) => { handlers[ch] = fn } },
      sniffer: { items: () => [], clear: () => {} },
      downloader: {
        startMedia: async (p) => {
          received.push(p as Record<string, unknown>)
          return { success: true, taskId: 't1' }
        },
      },
      currentPlatform: () => currentPlatform,
      activeViewUrl: () => 'https://space.bilibili.com/curr',
      hostWindow: () => null,
      log: () => {},
    })
    const call = (payload: unknown): Promise<{ success: boolean }> =>
      (handlers['browser:sniffDownload'] as (_e: unknown, p: unknown) => Promise<{ success: boolean }>)({}, payload)
    return { call, received }
  }

  it('显式 platformId 优先于当前平台（在 B站页面解析抖音链接仍走抖音分区 cookie+抖音 referer）', async () => {
    const { call, received } = setup('bilibili')
    const r = await call({
      url: 'https://v26-web.douyinvod.com/abc/video.mp4?token=1',
      filename: '标题.mp4',
      platformId: 'douyin',
      referer: 'https://www.douyin.com/video/123',
    })
    expect(r.success).toBe(true)
    expect(received[0]).toBeTruthy()
    expect(received[0]!['platformId']).toBe('douyin')
    expect(received[0]!['referer']).toBe('https://www.douyin.com/video/123')
  })

  it('无显式声明时回退当前平台（SRC 口径兜底；页面 B站链路不经本通道，见上组用例）', async () => {
    const { call, received } = setup('bilibili')
    const r = await call({ url: 'https://upos-sz-mirror.bilivideo.com/x.mp4' })
    expect(r.success).toBe(true)
    expect(received[0]!['platformId']).toBe('bilibili')
    expect(received[0]!['referer']).toBe('https://space.bilibili.com/curr')
  })
})
