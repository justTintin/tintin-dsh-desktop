// 封面制作插件路由(WP-1 收尾;需求文档 docs/cover-generation-requirements.md §五/§九)。
//   GET  /tintin/cover/editor[/<file>]  → 编辑器静态件(插件 dist/editor,vite 构建)
//   GET  /tintin/cover/api/templates    → 模板注册表(图层定义,§9.3)
//   POST /tintin/cover/api/render       → {templateId, props, fileName?} → renderCover
// 引擎与编辑器来自 dsh-tintin-cover-plugin(vendored 形态,同 tintin-resources/openfilm 先例):
//   引擎 = <pluginDir>/dist/engine.mjs(esbuild 预构建 ESM,remotion 外置到插件 node_modules);
//   静态 = <pluginDir>/dist/editor。
// 插件目录解析:TINTIN_COVER_PLUGIN_DIR > <bundle 根>/../dsh-tintin-cover-plugin
// (打包形态的资源布局差异属 WP-1 打包核验项)。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, normalize, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connectControl, launchApp } from './photocraft.js'

const bundleRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultPluginDir = join(bundleRoot, '..', 'dsh-tintin-cover-plugin')
// 打包形态:插件经 extraResources 落 resources/cover-plugin(相对 node_modules 内的
// bundle 为 ../../../cover-plugin);dev 形态为仓库内同级目录。两种候选都探。
const packagedPluginDir = join(bundleRoot, '..', '..', '..', 'cover-plugin')

function resolvePluginDir() {
  for (const dir of [process.env.TINTIN_COVER_PLUGIN_DIR, defaultPluginDir, packagedPluginDir]) {
    if (dir && existsSync(join(dir, 'dist', 'engine.mjs'))) return dir
  }
  return null
}
export { resolvePluginDir }

// 引擎懒加载(模块级单例;路由与 agent 工具共用同一实例——bundle 缓存/浏览器只初始化一次)
let enginePromise = null
/** 动态加载封面引擎(dist/engine.mjs);不可用时抛错(agent 工具与路由同口径) */
export function loadCoverEngine() {
  const dir = resolvePluginDir()
  if (!dir) return Promise.reject(new Error('封面插件目录不存在(设 TINTIN_COVER_PLUGIN_DIR 或确认 dsh-tintin-cover-plugin 与 bundle 同级/打包 resources/cover-plugin)'))
  const enginePath = join(dir, 'dist', 'engine.mjs')
  if (!existsSync(enginePath)) {
    return Promise.reject(new Error(`封面引擎未构建:${enginePath}(在插件目录执行 npm run build:engine)`))
  }
  enginePromise ??= import(pathToFileURL(enginePath).href)
  return enginePromise
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

export function registerCoverPluginRoute({ webServer, isTrustedRequest, sendJson, httpRequest, getServerUrl }) {
  const editorRoot = () => {
    const dir = resolvePluginDir()
    return dir ? join(dir, 'dist', 'editor') : null
  }

  const loadEngine = loadCoverEngine

  const disposeEditor = webServer.register({
    kind: 'prefix',
    path: '/tintin/cover/editor',
    handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedRequest(req)) {
        sendJson(res, req.method === 'GET' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      const root = editorRoot()
      if (!root) {
        sendJson(res, 404, { error: '封面插件目录不存在' })
        return
      }
      let rel = req.url.split('?')[0].slice('/tintin/cover/editor'.length) || '/editor.html'
      if (rel === '/' || rel === '') rel = '/editor.html'
      const file = normalize(join(root, rel))
      if (!file.startsWith(normalize(root)) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      res.writeHead(200, { 'content-type': MIME[join(file).replace(/^.*(\.[a-z0-9]+)$/i, '$1')] ?? MIME['.js'] ?? 'application/octet-stream' })
      res.end(readFileSync(file))
    },
  })

  const disposeTemplates = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/templates',
    handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      try {
        const engine = await loadEngine()
        sendJson(res, 200, { ok: true, templates: engine.listTemplates(), coverDir: engine.resolveCoverDir() })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  })

  const disposeRender = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/render',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body || '{}')
          const engine = await loadEngine()
          const result = await engine.renderCover({
            templateId: String(p.templateId || ''),
            props: p.props,
            fileName: p.fileName,
          })
          sendJson(res, result.ok ? 200 : 500, result)
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // 图片上传(产品图/底图):写插件 public/(源)与 dist/remotion-bundle/public/(预构建
  // bundle 的 staticFile 服务根)——上传后立即可选、导出即随图归档
  const disposeUpload = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/upload-image',
    handler: (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      const dir = resolvePluginDir()
      if (!dir) {
        sendJson(res, 404, { ok: false, error: '封面插件目录不存在' })
        return
      }
      const name = String(new URL(req.url, 'http://localhost').searchParams.get('name') || '')
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || !/\.(?:jpe?g|png|webp)$/i.test(name)) {
        sendJson(res, 400, { ok: false, error: '文件名仅限字母数字与 ._- ,扩展名 jpg/png/webp' })
        return
      }
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > 15 * 1024 * 1024) { req.destroy(); return }
        chunks.push(c)
      })
      req.on('end', async () => {
        try {
          const bytes = Buffer.concat(chunks)
          if (bytes.length === 0) { sendJson(res, 400, { ok: false, error: '空文件' }); return }
          for (const target of [join(dir, 'public'), join(dir, 'dist', 'remotion-bundle', 'public')]) {
            mkdirSync(target, { recursive: true })
            writeFileSync(join(target, name), bytes)
          }
          // 来源记录(§七 provenance:上传素材留痕)
          try {
            const { appendAssetProvenance } = await import('./cover-provenance.js')
            appendAssetProvenance(dir, { name, source: 'upload', ts: Date.now() })
          } catch { /* 留痕失败不阻断上传 */ }
          sendJson(res, 200, { ok: true, name })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // AI 底图(编辑器右栏/图层面板触发;agent 侧同能力见 cover-tools cover_background)
  const disposeBackground = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/generate-background',
    handler: (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body || '{}')
          const { generateCoverBackground } = await import('./cover-background.js')
          const result = await generateCoverBackground(
            { prompt: p.prompt, aspect: p.aspect, engine: p.engine === 'jimeng' ? 'jimeng' : 'server', timeoutMs: Number(p.timeout_ms) || 900_000 },
            { httpRequest, getServerUrl, resolveDir: resolvePluginDir },
          )
          sendJson(res, result.ok ? 200 : 500, result)
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // 打开产物目录(资源管理器;仅限封面目录本身,防任意路径打开)
  const disposeReveal = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/reveal',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      try {
        const engine = await loadEngine()
        const dir = engine.resolveCoverDir()
        const { spawn } = await import('node:child_process')
        if (process.platform === 'win32') spawn('explorer', [dir], { detached: true, stdio: 'ignore' }).unref()
        else if (process.platform === 'darwin') spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref()
        else spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref()
        sendJson(res, 200, { ok: true, dir })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  })

  // 会话框回路(批次 B):编辑器右栏聊天 → 服务端 LLM → 回复+图层动作
  const disposeChat = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/chat',
    handler: (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body || '{}')
          const { coverChatTurn } = await import('./cover-chat.js')
          const result = await coverChatTurn(
            { messages: Array.isArray(p.messages) ? p.messages : [], templateBrief: p.templateBrief ?? {}, propsSnapshot: p.propsSnapshot ?? {} },
            { httpRequest },
          )
          sendJson(res, result.ok ? 200 : 500, result)
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // 产品图图生图(即梦 image2image:当前产品图为参考换场景/风格)
  const disposeGenProduct = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/generate-product',
    handler: (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body || '{}')
          const { generateCoverProductImage } = await import('./cover-background.js')
          const result = await generateCoverProductImage(
            { prompt: p.prompt, image: p.image, engine: p.engine === 'server' ? 'server' : 'jimeng', timeoutMs: Number(p.timeout_ms) || 240_000 },
            { resolveDir: resolvePluginDir, httpRequest, getServerUrl },
          )
          sendJson(res, result.ok ? 200 : 500, result)
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // ── PhotoCraft 为主(2026-10-27 15:09 裁决):原生 PS 式编辑器为画布,
  //    会话按图层引用操作;截图轮询即预览;导出走引擎 save。──
  // ── ACP 会话(2026-10-27 裁决:编辑器会话走真实 agent,非自造 JSON 协议)──
  pcRoute('acp-start', 'POST', async (p) => {
    const { startSession } = await import('./cover-acp-bridge.js')
    return startSession(process.env.TINTIN_COVER_CWD || process.cwd())
  })
  pcRoute('acp-prompt', 'POST', async (p) => {
    const { prompt } = await import('./cover-acp-bridge.js')
    return prompt(String(p.text || ''))
  })
  pcRoute('acp-status', 'GET', async () => {
    const { isRunning } = await import('./cover-acp-bridge.js')
    return { ok: true, running: isRunning() }
  })

  const pcDeps = { httpRequest, getServerUrl, resolvePluginDir }
  const pcDisposes = []
  const pcRoute = (sub, method, handler) => pcDisposes.push(webServer.register({
    kind: 'exact', path: `/tintin/cover/api/pc/${sub}`,
    handler: async (req, res) => {
      if (req.method !== method || !isTrustedRequest(req, method !== 'GET')) {
        sendJson(res, req.method === method ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      if (method === 'POST') {
        req.on('data', (c) => { body += c })
        await new Promise((done) => req.on('end', done))
      }
      try {
        const p = body ? JSON.parse(body) : {}
        sendJson(res, 200, await handler(p))
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  }))

  pcRoute('launch', 'POST', async () => launchApp({ port: Number(process.env.TINTIN_PHOTOCRAFT_PORT || 7878) }))
  pcRoute('inspect', 'GET', async () => {
    const conn = await connectControl()
    if (!conn.ok) return conn
    const r = await conn.request('engine.execute', { command: 'document.inspect' })
    return { ok: !!r.ok, doc: r.result ?? null, error: r.error }
  })
  pcRoute('screenshot', 'GET', async () => {
    const conn = await connectControl()
    if (!conn.ok) return conn
    const r = await conn.request('ui.screenshot', {})
    return { ok: !!r.ok, data: r.result?.data ?? null, error: r.error }
  })
  pcRoute('execute', 'POST', async (p) => {
    const conn = await connectControl()
    if (!conn.ok) return conn
    const r = await conn.request('engine.execute', { command: String(p.command || ''), params: p.params ?? {} })
    return { ok: !!r.ok, result: r.result ?? null, error: r.error }
  })
  pcRoute('export', 'POST', async (p) => {
    const conn = await connectControl()
    if (!conn.ok) return conn
    const engine = await loadEngine()
    const file = join(engine.resolveCoverDir(), String(p.fileName || `cover-${Date.now()}.png`))
    const r = await conn.request('engine.execute', { command: 'file.export', params: { path: file, format: 'png' } })
    return { ok: !!r.ok, file, error: r.error }
  })

  const disposesPc = () => { for (const d of pcDisposes) { try { d() } catch { /* ignore */ } } }

  return () => {
    disposeEditor()
    disposeTemplates()
    disposeRender()
    disposeUpload()
    disposeBackground()
    disposeReveal()
    disposeChat()
    disposeGenProduct()
    disposesPc()
  }
}
