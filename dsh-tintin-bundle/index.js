// TinTin host bridge plugin (Spike A scope).
//
// Ported from tintin-dsh-desktop packages/tintin-bundle/index.js route
// registration pattern (0.1.7-rc.2): ctx.inject(['webServer']) plus
// webServer.register({ kind: 'exact', path, handler }). That API was verified
// identical on 0.2.0-rc.2 against dsh-community-market/src/host/routes.ts
// (docs/tintin-api-diff.md, D0-3).
//
// Spike A proves three things headlessly:
//   1. the plugin loads through a `--patch` overlay on the vendored 0.2.0-rc.2 runtime,
//   2. /tintin/ping answers with the host pid,
//   3. /tintin/spawn-probe can spawn a real child process (ffmpeg-class capability).

import { spawn } from 'node:child_process'

export const name = 'dsh-tintin-bundle'
export const inject = ['webServer']

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function spawnOnce(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), 10_000)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, error: String(error) })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, signal: signal ?? null, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

export function apply(ctx) {
  ctx.logger.info(`tintin bridge loaded, pid=${String(process.pid)}`)

  ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => {
    const disposePing = webCtx.webServer.register({
      kind: 'exact',
      path: '/tintin/ping',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed.' })
          return
        }
        sendJson(res, 200, { ok: true, plugin: name, pid: process.pid, time: Date.now() })
      },
    })

    const disposeSpawnProbe = webCtx.webServer.register({
      kind: 'exact',
      path: '/tintin/spawn-probe',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed.' })
          return
        }
        const result = await spawnOnce(process.execPath, ['--version'])
        if (!result.ok) {
          sendJson(res, 500, { ok: false, stage: 'spawn', result })
          return
        }
        sendJson(res, 200, { ok: true, execPath: process.execPath, stdout: result.stdout })
      },
    })

    return () => {
      disposePing()
      disposeSpawnProbe()
    }
  }, 'tintin spike routes'))
}
