// Workspace ensure route factory (first-boot provisioning, directory half).
//
// The browser cannot mkdir and the public workspace/create RPC refuses a
// missing path, so the host materializes the default directory first —
// src/main/tintin-first-boot.ts ensureDefaultWorkspace 的目录半边;登记半边
// 由客户端 provisioning 走公开幂等 RPC 完成。

export function registerWorkspaceEnsureRoute({ webServer, isTrustedRequest, sendJson, mkdirSync, defaultWorkspaceDir }) {
  return webServer.register({
    kind: 'exact',
    path: '/tintin/workspace/ensure',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      try {
        const dir = defaultWorkspaceDir()
        mkdirSync(dir, { recursive: true })
        sendJson(res, 200, { ok: true, dir })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  })
}
