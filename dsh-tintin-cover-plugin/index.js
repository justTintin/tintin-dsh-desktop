// Host-side entry of the cover plugin(2026-10-30 用户裁决:封面制作第三层独立插件)。
// 职责:把封面会话桥/编辑器路由/agent 工具组挂到宿主注入的共享服务上——
//   ctx.inject(['webServer']) = harness 的 loopback web 服务(此前封面路由住在
//   dsh-tintin-bundle 的同名注入里,插件化后由本包自挂,同一实例);
//   ctx.inject(['tools'])     = agent 工具注册表(同上)。
// 依赖注入面=宿主公共设施,不是本包私有:请求信任闸/server-url 解析器/http 工厂/
// 机器码/配置仓/技能落盘管线住 dsh-tintin-shared(2026-10-31 抽共享包裁决,叶子包
// 零依赖,本包在 dependencies 声明它,单向依赖无环)。staging 侧 npm install
// 解析不到 workspace 包——stage.mjs 写 staging package.json 时剥离 workspace 专属
// 依赖,运行时按 app node_modules 同级解析即可。
// payload(编辑器/引擎/chat-shell/浏览器缓存)不进本入口——仍由通道打包链的
// tintin-resources/cover-plugin staging 经 extraResources 分发(与 Remotion 独立
// npm 工具链解耦的既有裁决),lib/cover-plugin-route.js 的目录探测两种形态都认。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isTrustedRequest } from 'dsh-tintin-shared/lib/trusted-request.js'
import { createHttpRequest, createServerUrlResolver } from 'dsh-tintin-shared/lib/server-proxy.js'
import { createMachineIdResolver } from 'dsh-tintin-shared/lib/machine-id-store.js'
import { readTintinConfigStore } from 'dsh-tintin-shared/lib/tintin-config-store.js'
import { loadCoverEngine, registerCoverPluginRoute, resolvePluginDir as resolveCoverPluginDir } from './lib/cover-plugin-route.js'
import { startCoverToolsServer } from './lib/cover-tools-mcp.js'
import { setCoverToolsEndpoint } from './lib/cover-acp-bridge.js'
import { createCoverTools } from './lib/cover-tools.js'

export const name = 'dsh-tintin-cover-plugin'

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
  // server.url 解析链对齐宿主桥口径:config 段留位(本插件无 config schema,恒缺,
  // 由宿主桥的 config.server.url 承担)→ tintin 配置仓(设置页持久化真源)→ aiConfig。
  const getServerUrl = createServerUrlResolver({
    readTintinStore: () => readTintinConfigStore(process.env.DSH_HOME),
  })
  const httpRequest = createHttpRequest({
    getServerUrl,
    getMachineId: createMachineIdResolver(),
    log: (...a) => ctx.logger.info('tintin-cover:', ...a),
    warn: (...a) => ctx.logger.warn('tintin-cover:', ...a),
  })

  // 封面 agent 工具组(WP-7/WP-4,2026-10-27):会话内出封面;与编辑器/路由共用引擎
  // 单例;cover_background 走服务端文生图(WP-3 AI 底图)。注册失败只跳过自身,
  // 不拖垮 tools 注入面(同宿主桥 496 行教训)。
  ctx.inject(['tools'], (toolsCtx) => {
    const registerTool = (def) => {
      try {
        toolsCtx.tools.register(defineTool(def))
      } catch (error) {
        ctx.logger.error('tintin-cover: tool %s skipped: %s', def?.name, error?.message ?? error)
      }
    }
    for (const def of createCoverTools({
      loadEngine: loadCoverEngine,
      generateBackground: (input) => import('./lib/cover-background.js').then((m) => m.generateCoverBackground(input, { httpRequest, getServerUrl, resolveDir: resolveCoverPluginDir })),
      log: (...a) => ctx.logger.info('tintin-cover:', ...a),
      warn: (...a) => ctx.logger.warn('tintin-cover:', ...a),
    })) {
      registerTool(def)
    }
  })

  // 本地工具 MCP 独立回环监听(2026-11-04 感知闭环;2026-11-05 改道):dsh webServer
  // 的 POST 闸对非浏览器客户端 403(会话 cookie/CSRF 层,MCP 子进程无 cookie,
  // Origin 也不够——1105 实测), 所以渲染回看/看图/抠图三个智能体工具用自带随机
  // token 闸的独立回环监听承载(127.0.0.1 随机端口,进程生命周期=应用生命周期,
  // 同 tintin-main startLoopbackService 先例);writePatch 生成 mcp-cover-tools 行
  // 并经 dsh-mcp-client 的 headers 配置带令牌。
  void startCoverToolsServer({ getServerUrl, loadEngine: loadCoverEngine, resolvePluginDir: resolveCoverPluginDir }).then((endpoint) => {
    setCoverToolsEndpoint(endpoint)
    ctx.logger.info('tintin-cover: tools mcp on %s', endpoint.url)
  }).catch((error) => {
    ctx.logger.error('tintin-cover: tools mcp 启动失败(智能体仅有服务端工具): %s', error?.message ?? error)
  })

  // 封面路由族:编辑器/会话页静态件+render/upload/reveal/PhotoCraft/ACP 会话
  // (清单见 lib/cover-plugin-route.js 头注)。
  ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => {
    const disposeCoverPlugin = registerCoverPluginRoute({ webServer: webCtx.webServer, isTrustedRequest, sendJson, httpRequest, getServerUrl })
    return () => disposeCoverPlugin()
  }, 'tintin-cover: routes'))

  ctx.logger.info('tintin-cover host ready')
}
