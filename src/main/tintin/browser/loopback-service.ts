// loopback-service.ts — 浏览器域回环服务（架构文档 §浏览器域三层形态第2层：
// "门面（host 侧）：tintin-bundle 地基经本机 loopback 服务（token 鉴权，参照
// harness 自身 auth 模式）把引擎能力暴露为 /tintin/browser/* 路由与 agent 工具"）。
//
// 交接：握手文件写 DSH_HOME/tintin/browser/loopback.json（{port, token, pid}）——
// harness 子进程（host 插件）拿不到 Electron API，agent 工具经 HTTP+token 调壳。
// 安全（B1）：仅绑定 127.0.0.1；每请求校验 x-tintin-loopback-token；token 随机 32 字节。
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

export interface LoopbackHandlers {
  /** 打开平台（独立窗口 + 导航 seed URL） */
  open: (platform: string) => Promise<{ ok: boolean; error?: string }>
  /** 运行平台抽取脚本（E3 结构化结果） */
  extract: (platform: string) => Promise<{ ok: boolean; data?: unknown; error?: { type: string; message: string; hint?: string } }>
  /** 各平台登录态 cookie 条数（只读） */
  loginStatus: () => Promise<{ counts: Record<string, number>; cookiesDir: string }>
  /** 导出平台分区 cookies 为 Netscape 文件 */
  exportCookies: () => Promise<Record<string, number>>
  /** 今日热点采集（阻塞 15-25s） */
  captureHotspots: () => Promise<[boolean, number | string]>
}

export interface LoopbackService {
  port: number
  token: string
  handshakePath: string
  close: () => Promise<void>
}

/** 路由表（方法+路径 → handler；路径含 /tintin-browser 前缀） */
export function routeLoopback(handlers: LoopbackHandlers, pathname: string, body: Record<string, unknown>): { status: number; data: unknown } {
  switch (pathname) {
    case '/tintin-browser/open':
      return { status: 200, data: handlers.open(String(body.platform || '')) }
    case '/tintin-browser/extract':
      return { status: 200, data: handlers.extract(String(body.platform || '')) }
    case '/tintin-browser/login/status':
      return { status: 200, data: handlers.loginStatus() }
    case '/tintin-browser/cookies/export':
      return { status: 200, data: handlers.exportCookies() }
    case '/tintin-browser/hotspot/capture':
      return { status: 200, data: handlers.captureHotspots() }
    default:
      return { status: 404, data: { ok: false, error: { type: 'NOT_FOUND', message: '未知回环路由: ' + pathname } } }
  }
}

/**
 * 启动回环服务（127.0.0.1 + 随机端口）并写握手文件。
 * @param opts.handshakeDir 握手文件目录（<userData>/harness/tintin/browser）
 */
export function startLoopbackService(opts: {
  handlers: LoopbackHandlers
  handshakeDir: string
  log?: (msg: string) => void
}): Promise<LoopbackService> {
  const { handlers, handshakeDir, log = () => {} } = opts
  const token = randomBytes(32).toString('hex')

  const server: Server = createServer((req, res) => {
    // B1：仅回环由 listen 地址保证；token 每请求校验
    if (req.headers['x-tintin-loopback-token'] !== token) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { type: 'UNAUTHORIZED', message: '回环 token 校验失败' } }))
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', async () => {
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* 空/坏 body 按空对象 */ }
      try {
        const route = routeLoopback(handlers, req.url || '/', body)
        const data = await route.data
        res.writeHead(route.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      } catch (err) {
        log(`loopback handler failed: ${(err as Error).message}`)
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { type: 'LOOPBACK_ERROR', message: (err as Error).message } }))
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      const port = address.port
      const handshakePath = join(handshakeDir, 'loopback.json')
      try {
        mkdirSync(handshakeDir, { recursive: true })
        writeFileSync(handshakePath, JSON.stringify({ port, token, pid: process.pid, ts: Date.now() }, null, 2), 'utf8')
      } catch (err) {
        log(`handshake write failed: ${(err as Error).message}`)
      }
      log(`loopback service listening on 127.0.0.1:${port}`)
      resolve({
        port,
        token,
        handshakePath,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}
