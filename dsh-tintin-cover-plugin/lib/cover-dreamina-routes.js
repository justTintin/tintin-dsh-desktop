// cover-dreamina-routes.js — 即梦创作 CLI 路由族(2026-11-15 封面设置批;门禁触发的
// 拆分优于加基线,同 cover-photocraft-routes.js 先例)。
//   POST /tintin/cover/api/dreamina {action:status|login-headless|login-check|logout}
//     → 共享门 createDreaminaApi 直通(与创作模式「即梦 CLI」卡片同门,共享叶子包
//       单一来源)。用户裁定「设置里有即梦的 CLI 登录;已登录即梦→优先即梦 CLI 生图/
//       图片编辑」——生成路由(cover-background.js)按登录态自动优先即梦,无需选引擎;
//       登录态呈现与登录动作在本路由,编辑器设置弹窗(server-settings.tsx)消费。
import { createDreaminaApi } from 'dsh-tintin-shared/lib/dreamina.js'

export function registerCoverDreaminaRoutes({ registeringWebServer, mutationAllowed, sendJson }) {
  const dreaminaApi = createDreaminaApi({ warn: (msg) => console.warn('[cover-dreamina]', msg) })
  const dispose = registeringWebServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/dreamina',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !(await mutationAllowed(req))) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body || '{}')
          const action = String(p.action || 'status')
          if (action === 'status') return sendJson(res, 200, await dreaminaApi['dreamina:status']())
          if (action === 'login-headless') return sendJson(res, 200, await dreaminaApi['dreamina:loginHeadless']())
          if (action === 'login-check') return sendJson(res, 200, await dreaminaApi['dreamina:loginCheck']({ deviceCode: p.deviceCode, poll: p.poll }))
          if (action === 'logout') return sendJson(res, 200, await dreaminaApi['dreamina:logout']())
          sendJson(res, 400, { error: `未知 action: ${action}` })
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })
  return [dispose]
}
