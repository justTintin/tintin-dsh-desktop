// 媒体下载器（SRC media-downloader.js 有界移植对拍；2026-10-26 下载扩展链复活工作包）
// 覆盖：URL 清洗纯函数 + downloadMediaStart 单流直链落盘（本地 http server 实测）
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanMediaUrl, createMediaDownloaderIpc, partitionForPlatform, resolveYtdlpTargetUrl } from '../src/browser/media-downloader.ts'

describe('cleanMediaUrl（SRC _cleanMediaUrl 1:1）', () => {
  it('youtube/googlevideo 分块参数清洗 + range 全量', () => {
    const out = cleanMediaUrl('https://rr1---sn-a.googlevideo.com/videoplayback?rn=5&obuf=1&start=0&end=10&expire=1')
    expect(out).toContain('range=0-99999999999')
    expect(out).not.toContain('rn=')
    expect(out).not.toContain('obuf=')
    expect(out).not.toContain('start=')
    expect(out).not.toContain('end=')
  })
  it('非 googlevideo URL 原样；坏 URL 原样返回', () => {
    expect(cleanMediaUrl('https://example.com/a.mp4?x=1')).toBe('https://example.com/a.mp4?x=1')
    expect(cleanMediaUrl('not a url')).toBe('not a url')
  })
})

describe('partitionForPlatform（2026-11-04 cookie 注入分区修复）', () => {
  it('别名分区解析到真实 jar（bili/xhs），直名平台与缺省原样', () => {
    expect(partitionForPlatform('bilibili')).toBe('persist:tintin-bili')
    expect(partitionForPlatform('xiaohongshu')).toBe('persist:tintin-xhs')
    expect(partitionForPlatform('douyin')).toBe('persist:tintin-douyin')
    expect(partitionForPlatform('web')).toBe('persist:tintin-web')
    expect(partitionForPlatform(undefined)).toBe('persist:tintin-browser')
  })
})

describe('resolveYtdlpTargetUrl（2026-11-05 解析链目标修复）', () => {
  it('解析链：url=视频页优先，不被 referer=站点首页顶掉', () => {
    expect(resolveYtdlpTargetUrl('https://www.douyin.com/video/7412345678901234567', 'https://www.douyin.com/'))
      .toBe('https://www.douyin.com/video/7412345678901234567')
  })
  it('嗅探链：url=媒体直链（非视频页）保持 SRC 口径取 referer 页', () => {
    expect(resolveYtdlpTargetUrl('https://v26-web.douyinvod.com/x/index.m3u8', 'https://www.douyin.com/video/741'))
      .toBe('https://www.douyin.com/video/741')
  })
  it('两者皆非视频页回落 url；无 referer 原样', () => {
    expect(resolveYtdlpTargetUrl('https://cdn.example.com/a.mp4', 'https://x.com/page')).toBe('https://x.com/page')
    expect(resolveYtdlpTargetUrl('https://cdn.example.com/a.mp4', undefined)).toBe('https://cdn.example.com/a.mp4')
  })
})

describe('createMediaDownloaderIpc：单流直链下载（本地 server 实测）', () => {
  let server: Server
  let body = ''
  let url = ''
  let dir = ''

  beforeEach(async () => {
    body = 'hello-media-bytes'
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': String(body.length) })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    url = `http://127.0.0.1:${port}/media.mp4`
    dir = mkdtempSync(join(tmpdir(), 'tintin-media-dl-'))
  })
  afterEach(() => {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function build() {
    const handlers = new Map<string, (e: unknown, payload: unknown) => Promise<unknown>>()
    const ipcMain = { handle: (name: string, fn: (e: unknown, payload: unknown) => Promise<unknown>) => { handlers.set(name, fn) } }
    const events: Array<{ channel: string; payload: Record<string, unknown> }> = []
    const svc = createMediaDownloaderIpc({
      ipcMain,
      appLike: { isPackaged: false, getPath: () => dir },
      sessionFromPartition: () => ({ cookies: { get: async () => [] } }),
      emit: (channel, payload) => { events.push({ channel, payload }) },
      downloadDir: () => dir,
      log: () => {},
    })
    return { svc, handlers, events }
  }

  it('downloadMediaStart 单流：落盘 + 终态广播（downloads:done）', async () => {
    const { handlers, events } = build()
    const r = (await handlers.get('browser:downloadMediaStart')!(null, {
      url,
      filename: 'clip.mp4',
      title: '测试媒体',
      platformId: 'douyin',
      subDir: 'douyin',
      useYtdlp: false,
    })) as { success: boolean; taskId: string; path?: string }
    expect(r.success).toBe(true)
    expect(r.taskId).toMatch(/^mdl_/)
    expect(readFileSync(r.path!, 'utf8')).toBe(body)
    const done = events.find((e) => e.channel === 'downloads:done')
    expect(done).toBeTruthy()
    expect(done!.payload.taskId).toBe(r.taskId)
    expect(done!.payload.file).toBe('测试媒体')
  })

  it('重复文件名去重（file_1.mp4）', async () => {
    const { handlers } = build()
    const first = (await handlers.get('browser:downloadMediaStart')!(null, { url, filename: 'same.mp4' })) as { path: string }
    const second = (await handlers.get('browser:downloadMediaStart')!(null, { url, filename: 'same.mp4' })) as { path: string }
    expect(first.path).not.toBe(second.path)
    expect(second.path.endsWith('same_1.mp4')).toBe(true)
  })

  it('cookie 注入读真实分区（bilibili→persist:tintin-bili），请求带 Cookie/Referer 头', async () => {
    let seenHeaders: Record<string, string | string[] | undefined> = {}
    let seenPartition = ''
    server.close()
    server = createServer((req, res) => {
      seenHeaders = req.headers
      res.writeHead(200, { 'content-length': String(body.length) })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    url = `http://127.0.0.1:${port}/b.mp4`
    const handlers = new Map<string, (e: unknown, payload: unknown) => Promise<unknown>>()
    const svc = createMediaDownloaderIpc({
      ipcMain: { handle: (name: string, fn: (e: unknown, payload: unknown) => Promise<unknown>) => { handlers.set(name, fn) } },
      appLike: { isPackaged: false, getPath: () => dir },
      sessionFromPartition: (partition) => {
        seenPartition = partition
        return { cookies: { get: async () => [{ name: 'SESSDATA', value: 'abc', domain: '.bilibili.com', path: '/' }] } }
      },
      emit: () => {},
      downloadDir: () => dir,
      log: () => {},
    })
    void svc
    const r = (await handlers.get('browser:downloadMediaStart')!(null, {
      url,
      filename: 'b.mp4',
      referer: 'https://www.bilibili.com/video/BV1x',
      platformId: 'bilibili',
      useYtdlp: false,
    })) as { success: boolean }
    expect(r.success).toBe(true)
    expect(seenPartition).toBe('persist:tintin-bili')
    expect(String(seenHeaders.cookie)).toContain('SESSDATA=abc')
    expect(seenHeaders.referer).toBe('https://www.bilibili.com/video/BV1x')
  })

  it('douyinParse 口令兜底：码拼短链 → 302 Location 取 video_id，标题随文本带回（2026-11-04 选 1 / 11-05 标题命名）', async () => {
    const { handlers } = build()
    const realFetch = globalThis.fetch
    const calls: string[] = []
    ;(globalThis as unknown as { fetch: unknown }).fetch = (async (input: unknown) => {
      const u = String(input instanceof URL ? input.href : input)
      calls.push(u)
      return {
        headers: { get: (k: string) => (String(k).toLowerCase() === 'location' ? 'https://www.douyin.com/video/7412345678901234567?x=1' : null) },
        json: async () => ({ code: 500, msg: 'should-not-reach' }),
      } as unknown as Response
    }) as typeof fetch
    try {
      const r = (await handlers.get('browser:douyinParse')!(null, '7.97 Z@j.Cu 09/09 UYz:/国行iphone终于能用AI了')) as { ok: boolean; videoPageUrl?: string; desc?: string }
      expect(r.ok).toBe(true)
      expect(r.videoPageUrl).toBe('https://www.douyin.com/video/7412345678901234567')
      expect(r.desc).toBe('国行iphone终于能用AI了')
      expect(calls[0]).toBe('https://v.douyin.com/UYz/')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('douyinParse 口令 302 失败 → 回落 API（喂构造短链）而非死路（2026-11-04）', async () => {
    const { handlers } = build()
    const realFetch = globalThis.fetch
    const calls: string[] = []
    ;(globalThis as unknown as { fetch: unknown }).fetch = (async (input: unknown) => {
      const u = String(input instanceof URL ? input.href : input)
      calls.push(u)
      if (u.startsWith('https://dy.xs25.cn/')) {
        return {
          headers: { get: () => null },
          json: async () => ({ code: 200, data: { video_url: 'https://v26-web.douyinvod.com/x.mp4', additional_data: [{ nickname: '作者', desc: '描述' }] } }),
        } as unknown as Response
      }
      return { headers: { get: () => null }, json: async () => ({}) } as unknown as Response
    }) as typeof fetch
    try {
      const r = (await handlers.get('browser:douyinParse')!(null, '7.97 Z@j.Cu 09/09 UYz:/国行iphone')) as { ok: boolean; videoUrl?: string }
      expect(r.ok).toBe(true)
      expect(r.videoUrl).toBe('https://v26-web.douyinvod.com/x.mp4')
      expect(calls.some((u) => u.startsWith('https://dy.xs25.cn/') && u.includes('v.douyin.com%2FUYz'))).toBe(true)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('参数缺失 url → 显式报错（铁律 2）', async () => {
    const { handlers } = build()
    const r = (await handlers.get('browser:downloadMediaStart')!(null, {})) as { success: boolean; error?: string }
    expect(r.success).toBe(false)
    expect(r.error).toContain('url')
  })

  it('HTTP 500 → 结构化失败 + downloads:error 广播', async () => {
    server.close()
    body = ''
    server = createServer((_req, res) => { res.writeHead(500); res.end('boom') })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    url = `http://127.0.0.1:${port}/x.mp4`
    const { handlers, events } = build()
    const r = (await handlers.get('browser:downloadMediaStart')!(null, { url, filename: 'x.mp4' })) as { success: boolean }
    expect(r.success).toBe(false)
    const err = events.find((e) => e.channel === 'downloads:error')
    expect(err).toBeTruthy()
    expect(String(err!.payload.error)).toContain('HTTP 500')
  })
})
