// 媒体下载器（SRC media-downloader.js 有界移植对拍；2026-10-26 下载扩展链复活工作包）
// 覆盖：URL 清洗纯函数 + downloadMediaStart 单流直链落盘（本地 http server 实测）
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanMediaUrl, createMediaDownloaderIpc } from '../src/browser/media-downloader.ts'

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
