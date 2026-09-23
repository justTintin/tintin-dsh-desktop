// TinTin bridge host (P0 skeleton). The full seam inventory lives in
// docs/tintin-port-execution-plan.zh.md WP-1: the IPC dispatcher, job
// registry, media range streaming and the FastAPI server proxy grow on
// these same webServer routes. The probe routes below are P0 verification
// (V5 local file write, V6 external process, V7 job channel) and stay minimal
// on purpose; WP-1 replaces them with the real seam handlers.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { resolveMachineIdSync } from './lib/machine-id.js'
import {
  createServerUrlResolver,
  createHttpRequest,
  resolveEndpoint,
  API_ENDPOINTS,
} from './lib/server-proxy.js'

const PING_PATH = '/tintin/ping'
const PROBE_FILE_PATH = '/tintin/probe/file'
const PROBE_SPAWN_PATH = '/tintin/probe/spawn'
const JOBS_PATH = '/tintin/jobs'
const JOB_STATUS_RE = /^\/tintin\/jobs\/([a-z0-9-]+)$/
const IPC_PATH = '/tintin/ipc'
const IPC_RE = /^\/tintin\/ipc\/(.+)$/

// TinTin server.* channel → endpoint. Each maps a client bridge call onto the
// FastAPI service; extend as WP-2 polyfill grows (对照 SRC preload server 域).
const IPC_SERVER_ROUTES = {
  'server:health': { method: 'GET', endpoint: API_ENDPOINTS.health.check },
  'server:llmModels': { method: 'GET', endpoint: API_ENDPOINTS.llm.models },
  'server:materialList': { method: 'POST', endpoint: API_ENDPOINTS.material.list },
  'server:materialSearch': { method: 'POST', endpoint: API_ENDPOINTS.material.search },
}

// TinTin settings namespace schema (server.url 等本地配置), schemastery form
// (settings.register 需要 z schema——image-generation:14 先例). schemastery 无
// optional 修饰（实测 optional 为 undefined）；空对象 schema 全可选，读取处
// 自行判空（server?.url）。字段约束随 WP-5 设置卡细化。
const TintinConfig = z.object({}).default({})

export const name = 'tintin-bundle'
// settings: TinTin config seam (server.url etc.). tools/webServer injected via
// scoped ctx.inject below so the tool half still loads where no web server runs.
export const inject = ['settings']

function isLoopback(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function hasForwardedAddress(req) {
  return Boolean(
    req.headers.forwarded ||
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-host']
  )
}

// Same-origin loopback requests only, mirroring dsh-desktop-market-installer's
// gate so the route stays unreachable from LAN pairing tunnels and proxies.
export function isTrustedRequest(req, mutation = false) {
  if (!isLoopback(req.socket.remoteAddress) || hasForwardedAddress(req)) return false
  if (!mutation) return true

  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && parsed.host === host && isLoopback(parsed.hostname)
  } catch {
    return false
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

export async function apply(ctx) {
  // V7 job registry: in-memory for the P0 probe; WP-1 swaps in the durable
  // registry that drives the /tintin/jobs/<id> polling contract.
  const jobs = new Map()

  // V9: minimal tool so the agent can invoke it on its own, proving the
  // bundle -> defineTool -> agent orchestration seam (主方案 §3.5a 机制证明).
  const pingServerTool = defineTool({
    name: 'ping_server',
    description: 'Ping the TinTin bridge host and report liveness (pid and server time). Use to verify the TinTin host plugin is reachable.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true }, pid: { type: 'integer', required: true }, time: { type: 'integer', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', kind: 'execute', title: 'Ping TinTin host', rawInput: {} }),
    async execute() {
      return { ok: true, pid: process.pid, time: Date.now() }
    },
  })

  // ── WP-1 foundation: config seam + server bridge ─────────────────────────
  // Config seam: TinTin's server.url lives in the harness settings namespace
  // 'tintin' (registered below). readConfig reads the committed value; the
  // legacy ai_config.json path is injected by the shell via TINTIN_AI_CONFIG
  // (WP-1 shell hook), absent by default.
  const tintinSettings = ctx.settings.register(name, TintinConfig, { applies: 'live' })
  const aiConfigPath = process.env.TINTIN_AI_CONFIG || null
  const readAiConfig = aiConfigPath
    ? () => { try { return existsSync(aiConfigPath) ? JSON.parse(readFileSync(aiConfigPath, 'utf8')) : null } catch { return null } }
    : null
  const getServerUrl = createServerUrlResolver({
    readConfig: (key) => { const v = tintinSettings.get(); return key === 'server.url' ? v?.server?.url : undefined },
    readAiConfig,
  })
  const getMachineId = () => resolveMachineIdSync()
  const httpRequest = createHttpRequest({
    getServerUrl,
    getMachineId,
    log: (...a) => ctx.logger.info(...a),
    warn: (...a) => ctx.logger.warn(...a),
  })

  // tintinBridge: the host service the media/ops plugins inject (WP-1 契约).
  // Surface: server proxy, machine id, config, jobs registry, media stream.
  const tintinBridge = {
    getServerUrl,
    getMachineId,
    httpRequest,
    jobs,
    // dispatch a server.* bridge call to the FastAPI service.
    async callServer(channel, payload) {
      const route = IPC_SERVER_ROUTES[channel]
      if (!route) {
        const err = new Error(`Unknown TinTin bridge channel: ${channel}`)
        err.code = 'unknown-channel'
        throw err
      }
      const path = resolveEndpoint(route.endpoint, payload?.params ?? payload)
      const result = await httpRequest(route.method, path, { body: route.method === 'GET' ? undefined : payload?.body ?? payload })
      return result.data
    },
  }
  ctx.provide('tintinBridge', tintinBridge)

  ctx.inject(['webServer', 'tools'], (webCtx) => webCtx.effect(() => {
    webCtx.tools.register(pingServerTool)
    const disposePing = webCtx.webServer.register({
      kind: 'exact',
      path: PING_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET' || !isTrustedRequest(req)) {
          sendJson(res, req.method === 'GET' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        sendJson(res, 200, { ok: true, plugin: name, pid: process.pid, time: Date.now() })
      },
    })

    // V5: write a temp file from the host process to prove local fs access.
    const disposeFile = webCtx.webServer.register({
      kind: 'exact',
      path: PROBE_FILE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
          sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        try {
          const dir = join(tmpdir(), 'tintin-p0')
          mkdirSync(dir, { recursive: true })
          const file = join(dir, `probe-${Date.now()}.txt`)
          writeFileSync(file, `tintin host probe ${new Date().toISOString()}`, 'utf8')
          sendJson(res, 200, { ok: true, file, bytes: statSync(file).size })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    // V6: spawn an external binary. Default probe target is node --version so
    // the route is verifiable before ffmpeg lands in resources (WP-1); the
    // same code path carries ffmpeg later.
    const disposeSpawn = webCtx.webServer.register({
      kind: 'exact',
      path: PROBE_SPAWN_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
          sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const target = process.env.TINTIN_PROBE_BINARY ?? process.execPath
        const args = target === process.execPath ? ['--version'] : ['-version']
        const child = spawn(target, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (b) => { stdout += b.toString() })
        child.stderr.on('data', (b) => { stderr += b.toString() })
        child.on('error', (error) => sendJson(res, 500, { ok: false, target, error: error.message }))
        child.on('close', (code) => {
          sendJson(res, 200, { ok: code === 0, code, target, stdout: stdout.slice(0, 300), stderr: stderr.slice(0, 300) })
        })
      },
    })

    // V7: job channel — POST starts a job (202 + jobId), GET status polls it.
    const disposeJobs = webCtx.webServer.register({
      kind: 'exact',
      path: JOBS_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
          sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const job = { id, state: 'running', createdAt: Date.now(), doneAt: null }
        jobs.set(id, job)
        // Probe job completes asynchronously after a beat so polling flips state.
        setTimeout(() => {
          job.state = 'done'
          job.doneAt = Date.now()
        }, 800).unref?.()
        ctx.logger.info('tintin-bundle: job started %s', id)
        sendJson(res, 202, { jobId: id, state: 'running' })
      },
    })

    const disposeJobStatus = webCtx.webServer.register({
      // prefix kind matches pathname.startsWith(`${prefix}/`), so the prefix
      // must not carry a trailing slash.
      kind: 'prefix',
      path: '/tintin/jobs',
      handler: async (req, res) => {
        const match = JOB_STATUS_RE.exec(new URL(req.url, 'http://localhost').pathname)
        if (req.method !== 'GET' || !isTrustedRequest(req) || !match) {
          sendJson(res, !match ? 404 : req.method === 'GET' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const job = jobs.get(match[1])
        if (!job) {
          sendJson(res, 404, { error: 'Unknown job.' })
          return
        }
        sendJson(res, 200, { jobId: job.id, state: job.state, elapsedMs: Date.now() - job.createdAt })
      },
    })

    // WP-1: /tintin/ipc/<channel> dispatch — the host endpoint the WP-2
    // window.tintin polyfill calls. server:* channels forward to the FastAPI
    // service through the bridge; failure keeps status + message (铁律 7).
    const disposeIpc = webCtx.webServer.register({
      kind: 'prefix',
      path: IPC_PATH,
      handler: async (req, res) => {
        const match = IPC_RE.exec(new URL(req.url, 'http://localhost').pathname)
        if (req.method !== 'POST' || !isTrustedRequest(req, true) || !match) {
          sendJson(res, !match ? 404 : req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const channel = match[1]
        let payload
        try {
          const chunks = []
          for await (const c of req) chunks.push(c)
          payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body.' })
          return
        }
        try {
          const result = await tintinBridge.callServer(channel, payload)
          sendJson(res, 200, { result })
        } catch (error) {
          const code = error?.code === 'unknown-channel' ? 404 : (error?.status ?? 502)
          ctx.logger.warn('tintin-bundle: ipc %s failed: %s', channel, error?.message ?? error)
          sendJson(res, code, { error: error?.message ?? String(error) })
        }
      },
    })

    return async () => {
      disposePing()
      disposeFile()
      disposeSpawn()
      disposeJobs()
      disposeJobStatus()
      disposeIpc()
    }
  }, 'tintin-bundle: probe routes'))
  ctx.logger.info('tintin-bundle host ready')
}
