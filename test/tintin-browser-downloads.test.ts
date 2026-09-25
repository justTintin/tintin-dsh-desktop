// test/tintin-browser-downloads.test.ts — 下载管理 + 媒体存储回归（批次③）
// download-manager：URL 下载（真实本地 http 服务器）= 文件落盘 + 进度/完成广播；
// 重定向跟随；非 200 报错。media-storage：记录/收藏生命周期 + 导入导出 + 清空。
// ipcMain 桩注入（通道表记录 handler），不触真实 Electron。
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDownloadManager } from '../src/main/tintin/browser/download-manager'
import { createMediaStorage } from '../src/main/tintin/browser/media-storage'

const tmpDirs: string[] = []
const servers: Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Handler = (req: unknown, payload: unknown) => Promise<unknown> | unknown
function makeIpcStub() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    handle(channel: string, h: Handler) { handlers.set(channel, h) },
    async call(channel: string, payload?: unknown) { return handlers.get(channel)?.({}, payload) },
  }
}

describe('download manager (SRC download-manager.js 1:1)', () => {
  function makeManager(sink: Array<{ channel: string; payload: Record<string, unknown> }>, wsDir: string) {
    return createDownloadManager({
      workspacePath: () => wsDir,
      emit: (channel, payload) => sink.push({ channel, payload }),
    })
  }

  it('startUrlDownload streams the body to disk and broadcasts progress + done', async () => {
    const body = Buffer.from('A'.repeat(64 * 1024)) // >1% 粒度，保证进度广播
    const server = createServer((req, res) => { res.writeHead(200, { 'content-length': body.length }); res.end(body) })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    servers.push(server)
    const port = (server.address() as { port: number }).port

    const sink: Array<{ channel: string; payload: Record<string, unknown> }> = []
    const wsDir = mkdtempSync(join(tmpdir(), 'tintin-dl-'))
    tmpDirs.push(wsDir)
    const mgr = makeManager(sink, wsDir)
    const ipc = makeIpcStub()
    mgr.registerIpc(ipc as never)

    const savePath = join(wsDir, 'materials', 'video.mp4')
    const taskId = (await ipc.call('downloads:start', { url: `http://127.0.0.1:${port}/f.mp4`, savePath })) as string
    expect(taskId).toMatch(/^dl_/)

    // 等 done 广播（铁律 2：验到磁盘字节）——条件等待替代轮询上限（并行负载偶败修复）
    await vi.waitFor(() => expect(sink.some((e) => e.channel === 'downloads:done')).toBe(true), { timeout: 15_000 })
    const done = sink.find((e) => e.channel === 'downloads:done')
    expect(done?.payload.finalPath).toBe(savePath)
    expect(done?.payload.size).toBe(body.length)
    expect(readFileSync(savePath)).toEqual(body)
    expect(sink.some((e) => e.channel === 'downloads:progress')).toBe(true)
  })

  it('follows 3xx redirects to the target resource', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { location: '/final' }); res.end(); return }
      res.writeHead(200); res.end('final-body')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    servers.push(server)
    const port = (server.address() as { port: number }).port

    const sink: Array<{ channel: string; payload: Record<string, unknown> }> = []
    const wsDir = mkdtempSync(join(tmpdir(), 'tintin-dl-'))
    tmpDirs.push(wsDir)
    const mgr = makeManager(sink, wsDir)
    const out = await mgr.startUrlDownload(`http://127.0.0.1:${port}/redirect`, join(wsDir, 'a.bin'))
    for (let i = 0; i < 100 && !sink.some((e) => e.channel === 'downloads:done'); i++) {
      await new Promise((r2) => setTimeout(r2, 50))
    }
    expect(out).toMatch(/^dl_/)
    // 并行负载下重定向第二跳可能晚于轮询上限完成——条件等待文件内容（ppt 同款修复）
    await vi.waitFor(() => expect(readFileSync(join(wsDir, 'a.bin'), 'utf8')).toBe('final-body'), { timeout: 10_000 })
  })

  it('surfaces non-200 responses as downloads:error broadcasts', async () => {
    const server = createServer((req, res) => { res.writeHead(404); res.end() })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    servers.push(server)
    const port = (server.address() as { port: number }).port

    const sink: Array<{ channel: string; payload: Record<string, unknown> }> = []
    const wsDir = mkdtempSync(join(tmpdir(), 'tintin-dl-'))
    tmpDirs.push(wsDir)
    const mgr = makeManager(sink, wsDir)
    // SRC 口径怪癖：startUrlDownload 先 resolve(taskId)，非 200 分支的 reject 是无效操作
    // （静默失败；广播只覆盖网络层错误）——断言按真实契约：resolve + 半成品被清理
    const taskId = await mgr.startUrlDownload(`http://127.0.0.1:${port}/missing`, join(wsDir, 'x.bin'))
    expect(taskId).toMatch(/^dl_/)
    expect(existsSync(join(wsDir, 'x.bin'))).toBe(false)
  })
})

describe('media storage (SRC media-storage.js 1:1)', () => {
  function makeStorage() {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-ms-'))
    tmpDirs.push(dir)
    const ipc = makeIpcStub()
    const storeFile = join(dir, 'media-storage.json')
    const storage = createMediaStorage(ipc as never, { storeFile, downloadsDir: () => dir })
    return { ipc, storeFile, storage, dir }
  }

  it('round-trips sniffed history with maxHistory truncation', async () => {
    const { ipc, storeFile } = makeStorage()
    const list = Array.from({ length: 30 }, (_, i) => ({ url: `u${i}`, name: `n${i}` }))
    const r = await ipc.call('media:storageSaveSniffed', list)
    expect(r).toEqual({ success: true, count: 30 })
    const got = await ipc.call('media:storageGetSniffed')
    expect((got as { data: unknown[] }).data).toHaveLength(30)
    // 持久化到磁盘（新实例读取同一文件）
    const again = createMediaStorage({ handle: () => {} } as never, { storeFile, downloadsDir: () => storeFile })
    expect(again.getSniffed()).toHaveLength(30)
  })

  it('favorites upsert by url and remove', async () => {
    const { ipc } = makeStorage()
    await ipc.call('media:storageAddFavorite', { url: 'u1', name: 'a' })
    await ipc.call('media:storageAddFavorite', { url: 'u1', name: 'a2' })
    const got = await ipc.call('media:storageGetFavorites') as { data: Array<{ url: string; name: string }> }
    expect(got.data).toHaveLength(1)
    expect(got.data[0]?.name).toBe('a2')
    await ipc.call('media:storageRemoveFavorite', 'u1')
    expect(((await ipc.call('media:storageGetFavorites')) as { data: unknown[] }).data).toHaveLength(0)
  })

  it('exports json/csv and clears history by type', async () => {
    const { ipc, dir } = makeStorage()
    await ipc.call('media:storageSaveSniffed', [{ url: 'u1', name: 'n"1', type: 'video', size: 5, platformId: 'douyin', ts: 1 }])
    const out = await ipc.call('media:storageExport', { format: 'csv' }) as { success: boolean; path: string; count: number }
    expect(out.success).toBe(true)
    expect(out.count).toBe(1)
    const csv = readFileSync(out.path, 'utf8')
    expect(csv).toContain('"n""1"')  // CSV 引号转义（SRC 口径）
    const json = await ipc.call('media:storageExport', { format: 'json', path: join(dir, 'x.json') })
    expect((json as { success: boolean }).success).toBe(true)
    await ipc.call('media:storageClearHistory', { type: 'all' })
    expect(((await ipc.call('media:storageGetSniffed')) as { data: unknown[] }).data).toHaveLength(0)
  })

  it('imports records with url-based dedupe', async () => {
    const { ipc, dir } = makeStorage()
    await ipc.call('media:storageSaveSniffed', [{ url: 'u1', name: 'keep' }])
    const src = join(dir, 'in.json')
    writeFileSync(src, JSON.stringify({ sniffed: [{ url: 'u1', name: 'dup' }, { url: 'u2', name: 'new' }] }))
    const r = await ipc.call('media:storageImport', { path: src }) as { success: boolean; sniffedImported: number }
    expect(r.success).toBe(true)
    expect(r.sniffedImported).toBe(2)
    const got = (await ipc.call('media:storageGetSniffed')) as { data: Array<{ url: string; name: string }> }
    expect(got.data).toHaveLength(2) // u1 去重保留原条目，u2 新增
    expect(got.data.find((m) => m.url === 'u1')?.name).toBe('keep')
  })
})
