// 封面制作插件路由(WP-1 收尾 + 会话移植批;需求文档 docs/cover-generation-requirements.md §五/§九/§十一)。
//   GET  /tintin/cover/editor[/<file>]  → 编辑器静态件(插件 dist/editor,vite 构建)
//   GET  /tintin/cover/chat[/<file>]    → 会话页静态件(openfilm-shell 构建,官方聊天组件)
//   GET  /tintin/cover/api/templates    → 模板注册表(图层定义,§9.3)
//   POST /tintin/cover/api/render       → {templateId, props, fileName?, outDir?} → renderStill PNG(outDir 须已存在目录;方案 1 另存为)
//   POST /tintin/cover/api/upload-image → 三写素材(源/预览/导出;§cover-asset)
//   POST /tintin/cover/api/generate-background|generate-product → AI 生图
//   GET  /tintin/cover/api/reveal       → 打开产物目录
//   /tintin/cover/api/pc/*              → PhotoCraft 控制通道(launch/inspect/screenshot/execute/export)
//   /tintin/cover/api/acp/*             → 会话路由族(cover-acp-routes.js:ACP 会话+事件流+聊天记录+技能+props)
//   GET/POST /tintin/cover/api/server-config → 服务端地址读写(共享 tintin/config.json server.url,2026-10-29 用户裁决)
//   POST /tintin/cover/api/mcp/discover  → MCP 自动发现(initialize+tools/list,返回服务端货架清单)
// 引擎与编辑器来自 dsh-tintin-cover-plugin(vendored 形态,同 tintin-resources/openfilm 先例):
//   引擎 = <pluginDir>/dist/engine.mjs(esbuild 预构建 ESM,remotion 外置到插件 node_modules);
//   静态 = <pluginDir>/dist/editor。
// 插件目录解析:TINTIN_COVER_PLUGIN_DIR > <bundle 根>/../dsh-tintin-cover-plugin
// (打包形态的资源布局差异属 WP-1 打包核验项)。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, normalize, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connectControl, launchApp } from './photocraft.js'
import { registerCoverAcpRoutes } from './cover-acp-routes.js'
// 配置仓/技能落盘管线=宿主公共设施(dsh-tintin-shared 叶子包,2026-10-31 抽共享包
// 裁决);bundle 侧 channel-table/machine-id-store 同用。
import { mergeTintinConfigStore } from 'dsh-tintin-shared/lib/tintin-config-store.js'
// 技能包落盘管线(2026-10-30 封面技能管理裁决):与创作模式技能管理同一条
import { installSkillPackage, migrateCoverSkillsHome } from 'dsh-tintin-shared/lib/skills-install.js'

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

/** 会话页静态件(chat-shell 独立构建:官方聊天组件 + 页面桥;2026-10-28 用户裁决
 *  "源码共享,构建隔离"——双入口实验回退,封面会话页由封面插件自己的 chat-shell 构建,
 *  与视频剪辑 shell 零耦合)。dev = 仓库 dsh-tintin-cover-plugin/chat-shell/dist;
 *  打包 = stage.mjs 把 chat-shell/dist 同步进 staging,extraResources 以
 *  resources/cover-plugin/chat-shell/dist 随包。 */
function resolveChatDist() {
  for (const dir of [
    process.env.TINTIN_COVER_CHAT_DIR,
    process.env.TINTIN_COVER_PLUGIN_DIR && join(process.env.TINTIN_COVER_PLUGIN_DIR, 'chat-shell', 'dist'),
    join(defaultPluginDir, 'chat-shell', 'dist'),
    join(packagedPluginDir, 'chat-shell', 'dist'),
  ]) {
    if (dir && existsSync(join(dir, 'cover-chat.html'))) return dir
  }
  return null
}

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

/** 静态目录伺服(prefix 路由的公共体:路径约束 + MIME + 读盘;`indexFile` 为根缺省页)。
 *  no-store(2026-10-28 事故): 不发缓存头时 WebView 启发式缓存整页——编辑器/会话页
 *  更新后运行中实例仍从缓存出旧界面(「旧会话框删不掉」的直因),本地 loopback 小文件
 *  无性能顾虑,直接禁存。 */
function serveStatic(root, prefix, indexFile) {
  return async (req, res) => {
    let rel = req.url.split('?')[0].slice(prefix.length)
    if (!rel || rel === '/' || rel === '') rel = `/${indexFile}`
    const file = normalize(join(root, rel))
    if (!file.startsWith(normalize(root)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    const ext = file.replace(/^.*(\.[a-z0-9]+)$/i, '$1').toLowerCase()
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(readFileSync(file))
  }
}

export function registerCoverPluginRoute({ webServer, isTrustedRequest, sendJson, httpRequest, getServerUrl }) {
  const editorRoot = () => {
    const dir = resolvePluginDir()
    return dir ? join(dir, 'dist', 'editor') : null
  }

  const loadEngine = loadCoverEngine
  /** mutation 信任:浏览器 Origin 判定,或 agent 会话令牌头(令牌只进 agent 子进程环境) */
  const mutationAllowed = async (req) => {
    const { agentToken } = await import('./cover-acp-bridge.js')
    return req.headers['x-tintin-cover-agent'] === agentToken || isTrustedRequest(req, true)
  }

  const disposeEditor = webServer.register({
    kind: 'prefix',
    path: '/tintin/cover/editor',
    handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      const root = editorRoot()
      if (!root) {
        sendJson(res, 404, { error: '封面插件目录不存在' })
        return
      }
      await serveStatic(root, '/tintin/cover/editor', 'editor.html')(req, res)
    },
  })

  // 会话页(OpenFilm 官方聊天组件;编辑器右栏 iframe 承载,同源 loopback)
  const disposeChatPage = webServer.register({
    kind: 'prefix',
    path: '/tintin/cover/chat',
    handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      const root = resolveChatDist()
      if (!root) {
        sendJson(res, 404, { error: '会话页未构建(openfilm-shell dist 缺 cover-chat.html;运行 prepare:openfilm-shell)' })
        return
      }
      await serveStatic(root, '/tintin/cover/chat', 'cover-chat.html')(req, res)
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
      if (req.method !== 'POST' || !(await mutationAllowed(req))) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body || '{}')
          const engine = await loadEngine()
          // outDir(2026-10-29 方案 1 用户裁决:导出弹「另存为」逐张选位置):须已存在的目录,
          // 否则回退默认 cover 目录(引擎同口径)。
          const outDir = typeof p.outDir === 'string' && p.outDir && existsSync(p.outDir) && statSync(p.outDir).isDirectory() ? p.outDir : undefined
          const result = await engine.renderCover({
            templateId: String(p.templateId || ''),
            props: p.props,
            fileName: p.fileName,
            outDir,
          })
          sendJson(res, result.ok ? 200 : 500, result)
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // ── 封面技能管理(2026-10-30 用户裁决:会话框 ▦ 打开封面自己的技能管理)──
  // 清单=服务端注册表(GET /skills,经注入的 httpRequest/getServerUrl)+已安装装位
  // (<渠道主目录>/cover-skills 扫描,与 cover-acp-routes 的 / 菜单双目录解析同源——装完菜单
  // 即可引用);安装=宿主桥 skills-install 落盘管线(下载解压 /skills/<id>/,带回 SKILL.md
  // 正文),与创作模式技能管理同一条;删除=按目录 id 整目录移除(守卫:仅装位一层,拒绝
  // 路径分隔符与相对段)。
  // 装位收紧(2026-10-31 用户裁决:在封面安装的技能只有封面用)——专属目录 cover-skills,
  // 不再用历史通用名 skills;旧装位里的既有安装由 migrateCoverSkillsHome 幂等搬入。
  const coverSkillsBase = () => (process.env.TINTIN_COVER_AGENT_HOME || process.env.DSH_HOME || '')
  const coverSkillsRoot = () => join(coverSkillsBase(), 'cover-skills')
  try { migrateCoverSkillsHome(coverSkillsBase()) } catch { /* 迁移失败不阻断注册,旧装位仍是后备 */ }
  const pickSkillFrontmatter = (md, key) => new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1] ?? '')?.[1]?.trim().replace(/^["']|["']$/g, '')
  const readInstalledCoverSkills = () => {
    const root = coverSkillsRoot()
    if (!root || !existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
      let name = e.name
      let version = ''
      let description = ''
      try {
        const doc = JSON.parse(readFileSync(join(root, e.name, 'skill.json'), 'utf8'))
        if (typeof doc.name === 'string' && doc.name.trim()) name = doc.name.trim()
        if (typeof doc.version === 'string' && doc.version.trim()) version = doc.version.trim()
        if (typeof doc.description === 'string' && doc.description.trim()) description = doc.description.trim()
      } catch { /* 无 skill.json:回退 SKILL.md frontmatter */ }
      try {
        const md = readFileSync(join(root, e.name, 'SKILL.md'), 'utf8')
        name = pickSkillFrontmatter(md, 'name') || name
        version = version || pickSkillFrontmatter(md, 'version') || ''
        description = description || pickSkillFrontmatter(md, 'description') || ''
      } catch { /* 无 SKILL.md:保持现状 */ }
      return { id: e.name, name, version, description }
    })
  }
  const disposeCoverSkills = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/skills',
    handler: async (req, res) => {
      if (req.method !== 'GET' || !isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      try {
        const doc = await httpRequest('GET', '/skills')
        const registry = (Array.isArray(doc?.skills) ? doc.skills : [])
          .filter((s) => s && typeof s === 'object' && String(s.id ?? '').trim() && String(s.name ?? '').trim())
          .map((s) => ({ id: String(s.id).trim(), name: String(s.name).trim(), version: String(s.version ?? '').trim(), description: String(s.description ?? '').trim() }))
        sendJson(res, 200, { ok: true, registry, installed: readInstalledCoverSkills() })
      } catch (err) {
        // 服务端不可达时已安装清单照常可管(删除/查看),registry 空并如实带错误
        sendJson(res, 200, { ok: true, registry: [], installed: readInstalledCoverSkills(), error: err instanceof Error ? err.message : String(err) })
      }
    },
  })
  const coverSkillAction = (action) => webServer.register({
    kind: 'exact',
    path: `/tintin/cover/api/skills/${action}`,
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
          const id = String(p.id ?? '').trim()
          if (!id || /[\\/]/.test(id) || id === '.' || id === '..') throw new Error('非法技能 id')
          if (action === 'install') {
            const r = await installSkillPackage(id, getServerUrl(), process.env.DSH_HOME || '', 'cover-skills')
            if (r?.error) throw new Error(r.error)
            sendJson(res, 200, { ok: true, dir: r?.dir || join(coverSkillsRoot(), id) })
          } else {
            const target = join(coverSkillsRoot(), id)
            if (!existsSync(target)) throw new Error('已安装目录不存在')
            rmSync(target, { recursive: true, force: true })
            sendJson(res, 200, { ok: true })
          }
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })
  const disposeCoverSkillsInstall = coverSkillAction('install')
  const disposeCoverSkillsRemove = coverSkillAction('remove')

  // ── 图片生成直连模式已删除(2026-10-30 用户裁决:模式芯片与 prompt 直连旁路移除),
  // bg-apply/ref-save 两个旁路路由一并下线(唯一消费方就是旁路);generate-background
  // 保留(编辑器「AI 生成底图」在用),generate-product 保留(智能体技能的产品图重绘)。

  // 服务设置(2026-10-29 用户裁决:封面工作本内可配服务端地址+MCP 自动发现)。
  // 地址=共享单一事实源 <DSH_HOME>/tintin/config.json server.url(视频剪辑/总助手同源);
  // MCP 挂载本身仍在会话创建时自动完成(film-acp.ts/cover-acp-bridge.js 的 mcpServers 声明),
  // 此处只做可视与验货(改址→新会话即用;发现→列出服务端货架),不引入第二份配置。
  // MCP 发现缓存(2026-10-29 用户裁决:重开设置要回显已保存的地址与服务清单):
  // 发现成功即覆写 <DSH_HOME>/tintin/mcp-discover-cache.json,GET server-config 带回。
  const mcpCacheFile = () => join(process.env.DSH_HOME || '', 'tintin', 'mcp-discover-cache.json')
  const readMcpCache = () => {
    try {
      const doc = JSON.parse(readFileSync(mcpCacheFile(), 'utf8'))
      if (!doc || !Array.isArray(doc.tools) || !doc.tools.length) return null
      return { mcpUrl: String(doc.mcpUrl ?? ''), count: Number(doc.count) || doc.tools.length, tools: doc.tools, ts: Number(doc.ts) || 0 }
    } catch { return null }
  }
  const writeMcpCache = (doc) => {
    try {
      mkdirSync(dirname(mcpCacheFile()), { recursive: true })
      writeFileSync(mcpCacheFile(), JSON.stringify(doc, null, 2), 'utf8')
    } catch { /* 缓存失败不影响发现本身 */ }
  }
  const disposeServerConfig = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/server-config',
    handler: async (req, res) => {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      if (req.method === 'GET') {
        const url = String(getServerUrl() || '')
        sendJson(res, 200, { ok: true, serverUrl: url, mcpUrl: url ? url + '/mcp' : '', mcpCache: readMcpCache() })
        return
      }
      if (req.method !== 'POST' || !(await mutationAllowed(req))) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        let parsed
        try { parsed = JSON.parse(body || '{}') } catch { sendJson(res, 400, { ok: false, error: '请求体不是 JSON' }); return }
        const url = String(parsed.serverUrl ?? '').trim().replace(/\/+$/, '')
        if (!/^https?:\/\//.test(url)) { sendJson(res, 400, { ok: false, error: '地址须以 http(s):// 开头' }); return }
        try {
          mergeTintinConfigStore(process.env.DSH_HOME, { server: { url } })
          sendJson(res, 200, { ok: true, serverUrl: url, mcpUrl: url + '/mcp' })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // MCP 自动发现:对 <地址>/mcp 走 initialize→initialized→tools/list,返回货架清单。
  // body.serverUrl 可选覆盖(未保存前先验新地址);缺省用已配置地址。
  const disposeMcpDiscover = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/mcp/discover',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !(await mutationAllowed(req))) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        let override = ''
        try { override = String(JSON.parse(body || '{}').serverUrl ?? '') } catch { /* 坏体回落已配置地址 */ }
        const base = (override || String(getServerUrl() || '')).trim().replace(/\/+$/, '')
        if (!base) { sendJson(res, 200, { ok: false, error: '服务端地址未配置' }); return }
        const mcpUrl = base + '/mcp'
        const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
        try {
          const init = await fetch(mcpUrl, {
            method: 'POST', headers,
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tintin-cover-settings', version: '0.0.1' } } }),
            signal: AbortSignal.timeout(10_000),
          })
          const sid = init.headers.get('mcp-session-id') ?? ''
          await init.text()
          if (!init.ok) { sendJson(res, 200, { ok: false, mcpUrl, error: `initialize ${init.status}` }); return }
          if (sid) {
            await fetch(mcpUrl, {
              method: 'POST', headers: { ...headers, 'mcp-session-id': sid },
              body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
              signal: AbortSignal.timeout(10_000),
            }).catch(() => {})
          }
          const list = await fetch(mcpUrl, {
            method: 'POST', headers: sid ? { ...headers, 'mcp-session-id': sid } : headers,
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
            signal: AbortSignal.timeout(10_000),
          })
          const text = await list.text()
          const sse = /^data: (.*)$/m.exec(text)
          const json = JSON.parse(sse ? sse[1] : text)
          const tools = Array.isArray(json?.result?.tools) ? json.result.tools : null
          if (!tools) { sendJson(res, 200, { ok: false, mcpUrl, error: '响应无工具清单' }); return }
          const slim = tools.map((t) => ({ name: String(t?.name ?? ''), description: String(t?.description ?? '').slice(0, 120) }))
          writeMcpCache({ serverUrl: base, mcpUrl, count: slim.length, tools: slim, ts: Date.now() })
          sendJson(res, 200, { ok: true, mcpUrl, count: slim.length, tools: slim })
        } catch (err) {
          sendJson(res, 200, { ok: false, mcpUrl, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // 图片上传(产品图/底图):三写(源/编辑器预览/导出 staticFile 根)——见 cover-asset.js
  const disposeUpload = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/upload-image',
    handler: (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      const dir = resolvePluginDir()
      if (!dir) {
        sendJson(res, 404, { ok: false, error: '封面插件目录不存在' })
        return
      }
      const name = String(new URL(req.url, 'http://localhost').searchParams.get('name') || '')
      /* 项目对齐(2026-10-31 用户报障「导入成功却不显示」):素材条/列表跟激活 tab 走,
         上传可带 project(裸目录名,防穿越)显式落进那个项目;落盘失败=如实报错不假成功。 */
      const project = String(new URL(req.url, 'http://localhost').searchParams.get('project') || '').trim()
      if (project && (/[\\/]/.test(project) || project === '.' || project === '..')) {
        sendJson(res, 400, { ok: false, error: '非法项目名' })
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
          const { writeCoverAsset } = await import('./cover-asset.js')
          writeCoverAsset(dir, name, bytes)
          // 项目落盘(素材条列表的来源;失败=如实报错)
          const engine = await loadEngine()
          const coverDir = await engine.resolveCoverDir()
          const projectsRoot = join(coverDir, '..', 'projects')
          const finalDir = project ? join(projectsRoot, project) : coverDir
          if (!finalDir.startsWith(projectsRoot)) throw new Error('非法项目名')
          mkdirSync(finalDir, { recursive: true })
          writeFileSync(join(finalDir, name), bytes)
          // 来源记录(§七 provenance:上传素材留痕)
          try {
            const { appendAssetProvenance } = await import('./cover-provenance.js')
            appendAssetProvenance(dir, { name, source: 'upload', ts: Date.now() })
          } catch { /* 留痕失败不阻断上传 */ }
          sendJson(res, 200, { ok: true, name })
        } catch (err) {
          sendJson(res, err instanceof Error && /素材名|非法项目名/.test(err.message) ? 400 : 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // URL 拖入导入(2026-10-31 用户报障:从浏览器/网页拖图,载荷无 File 只有 URI):
  // 主进程侧 fetch 绕开页面 CORS,落盘与 upload-image 同口径(三写+项目对齐+留痕)。
  const disposeUploadUrl = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/upload-url',
    handler: (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 16_000) req.destroy() })
      req.on('end', async () => {
        try {
          const url = String(JSON.parse(body || '{}').url ?? '').trim()
          if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http(s) 图片地址')
          const dir = resolvePluginDir()
          if (!dir) throw new Error('封面插件目录不存在')
          const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const bytes = Buffer.from(await response.arrayBuffer())
          if (!bytes.length) throw new Error('空文件')
          const type = String(response.headers.get('content-type') ?? '')
          const extFromUrl = (url.split('?')[0].match(/\.(\w{3,4})$/) ?? [])[1]
          let ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : String(extFromUrl ?? '').toLowerCase() || 'jpg'
          if (ext === 'jpeg') ext = 'jpg'
          if (!['png', 'jpg', 'webp', 'gif'].includes(ext)) throw new Error('该地址不是图片')
          const name = `url-${Date.now()}.${ext}`
          const { writeCoverAsset } = await import('./cover-asset.js')
          writeCoverAsset(dir, name, bytes)
          // 项目对齐(2026-10-30 用户裁决:素材跟项目)
          try {
            const engine = await loadEngine()
            const coverDir = await engine.resolveCoverDir()
            mkdirSync(coverDir, { recursive: true })
            writeFileSync(join(coverDir, name), bytes)
          } catch { /* 落项目失败不阻断(三写位已有) */ }
          try {
            const { appendAssetProvenance } = await import('./cover-provenance.js')
            appendAssetProvenance(dir, { name, source: 'url', ts: Date.now() })
          } catch { /* 留痕失败不阻断 */ }
          sendJson(res, 200, { ok: true, name })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // 抠图直达(2026-10-31 §2.5 P1):页面同源代理服务端 /matting(绕 CORS),源图取项目目录
  // (缺省回退插件素材位),透明底 PNG 落三写+项目目录(matting-<ts>.png)。
  // 结果=素材(2026-10-31 用户裁决):不写 props、不自动上图,由用户决定用途。
  const disposeMatting = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/matting',
    handler: (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 16_000) req.destroy() })
      req.on('end', async () => {
        try {
          const p = JSON.parse(body || '{}')
          const name = String(p.name ?? '').trim()
          const project = String(p.project ?? '').trim()
          if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('非法素材名')
          const dir = resolvePluginDir()
          if (!dir) throw new Error('封面插件目录不存在')
          const engine = await loadEngine()
          const coverDir = await engine.resolveCoverDir()
          const projectsRoot = join(coverDir, '..', 'projects')
          const finalDir = project ? join(projectsRoot, project) : coverDir
          if (!finalDir.startsWith(projectsRoot)) throw new Error('非法项目名')
          let srcPath = join(finalDir, name)
          if (!existsSync(srcPath)) srcPath = join(dir, 'public', name)
          if (!existsSync(srcPath)) throw new Error(`素材不存在:${name}`)
          const bytes = readFileSync(srcPath)
          const serverUrl = getServerUrl().replace(/\/+$/, '')
          if (!serverUrl) throw new Error('服务端地址未配置')
          const form = new FormData()
          form.append('file', new Blob([bytes]), name)
          const upstream = await fetch(serverUrl + '/matting', { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
          if (!upstream.ok) throw new Error(`抠图失败 HTTP ${upstream.status}`)
          const out = Buffer.from(await upstream.arrayBuffer())
          if (!out.length) throw new Error('抠图结果为空')
          const outName = `matting-${Date.now()}.png`
          const { writeCoverAsset } = await import('./cover-asset.js')
          writeCoverAsset(dir, outName, out)
          mkdirSync(finalDir, { recursive: true })
          writeFileSync(join(finalDir, outName), out)
          sendJson(res, 200, { ok: true, name: outName })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // AI 底图(编辑器右栏/图层面板触发;agent 侧同能力走令牌头;引擎在 cover-background.js)
  const disposeBackground = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/generate-background',
    handler: (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'Request rejected.' }); return }
      void mutationAllowed(req).then((allowed) => {
        if (!allowed) { sendJson(res, 403, { error: 'Request rejected.' }); return }
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
            if (result.ok && result.bytes && result.name) {
              /* 项目对齐(2026-10-30 用户裁决):生成图同时落入当前项目目录——素材条只列项目文件 */
              try {
                const engine = await loadEngine()
                const dir = await engine.resolveCoverDir()
                mkdirSync(dir, { recursive: true })
                writeFileSync(join(dir, result.name), result.bytes)
              } catch { /* 落项目失败不阻断(三写位已有,画布可用) */ }
            }
            sendJson(res, result.ok ? 200 : 500, result)
          } catch (err) {
            sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
          }
        })
      })
    },
  })

  // 封面项目制(2026-10-30 用户裁决):tab=项目,切换=目录+会话跟随;素材/props/聊天记录随项目目录。
  const projectAction = (path, run) => webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (req.method !== 'POST' || !(await mutationAllowed(req))) {
        sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          let p = {}
          try { p = JSON.parse(body || '{}') } catch { /* 空体=缺省参数 */ }
          const engine = await loadEngine()
          sendJson(res, 200, { ok: true, ...(await run(engine, p)) })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })
  projectAction('/tintin/cover/api/projects', async (engine) => ({ projects: engine.listCoverProjects(), current: basename(await engine.resolveCoverDir()) }))
  projectAction('/tintin/cover/api/projects/create', async (engine, p) => {
    const created = engine.createCoverProject(typeof p.name === 'string' ? p.name : undefined)
    // current 必须回传:前端靠它高亮 tab(缺失=无高亮+切换失灵,2026-10-30 实撞)
    return { ...created, current: created.name, projects: engine.listCoverProjects() }
  })
  projectAction('/tintin/cover/api/projects/switch', async (engine, p) => {
    const switched = engine.switchCoverProject(String(p.name ?? ''))
    return { ...switched, current: switched.name, projects: engine.listCoverProjects() }
  })
  projectAction('/tintin/cover/api/projects/rename', async (engine, p) => {
    const renamed = engine.renameCoverProject(String(p.from ?? ''), String(p.to ?? ''))
    return { ...renamed, current: basename(await engine.resolveCoverDir()), projects: engine.listCoverProjects() }
  })

  // 打开产物目录(资源管理器;body 可带 {dir} 打开指定目录(须存在),缺省封面目录本身,防任意路径打开)
  const disposeReveal = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/reveal',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        try {
          let dir
          let file
          try {
            const q = JSON.parse(body || '{}')
            if (typeof q.dir === 'string' && q.dir && existsSync(q.dir) && statSync(q.dir).isDirectory()) dir = q.dir
            /* 定位单个文件(2026-10-31 素材右键菜单「在文件资源管理器中显示」):仅允许
               封面目录内的裸文件名(防目录穿越),Windows 走 explorer /select 选中它。 */
            if (typeof q.file === 'string' && q.file && !/[\\/]/.test(q.file) && q.file !== '.' && q.file !== '..') file = q.file
          } catch { /* 非法 body 回默认目录 */ }
          const engine = await loadEngine()
          const coverRoot = engine.resolveCoverDir()
          const target = dir ?? coverRoot
          const { spawn } = await import('node:child_process')
          if (file) {
            const abs = join(coverRoot, file)
            if (!existsSync(abs)) throw new Error(`文件不存在:${file}`)
            if (process.platform === 'win32') spawn('explorer', ['/select,', abs], { detached: true, stdio: 'ignore' }).unref()
            else if (process.platform === 'darwin') spawn('open', ['-R', abs], { detached: true, stdio: 'ignore' }).unref()
            else spawn('xdg-open', [coverRoot], { detached: true, stdio: 'ignore' }).unref()
            sendJson(res, 200, { ok: true, file: abs })
            return
          }
          if (process.platform === 'win32') spawn('explorer', [target], { detached: true, stdio: 'ignore' }).unref()
          else if (process.platform === 'darwin') spawn('open', [target], { detached: true, stdio: 'ignore' }).unref()
          else spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref()
          sendJson(res, 200, { ok: true, dir: target })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // 素材删除(2026-10-31 素材右键菜单「删除」):只删封面项目目录内的裸文件名
  // (防穿越);三写位不动——public/ 跨项目共享,同名可能被模板/其它项目引用。
  const disposeDeleteAsset = webServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/delete-asset',
    handler: (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 8_000) req.destroy() })
      req.on('end', async () => {
        try {
          const name = String(JSON.parse(body || '{}').name ?? '').trim()
          if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('非法素材名')
          const engine = await loadEngine()
          const coverDir = await engine.resolveCoverDir()
          const target = join(coverDir, name)
          if (!existsSync(target)) throw new Error(`文件不存在:${name}`)
          const { rmSync } = await import('node:fs')
          rmSync(target, { force: true })
          sendJson(res, 200, { ok: true, name })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
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
        sendJson(res, 403, { error: 'Request rejected.' })
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
          if (result.ok && result.bytes && result.name) {
            /* 项目对齐(2026-10-30 用户裁决):产品图同样落入当前项目目录 */
            try {
              const engine = await loadEngine()
              const dir = await engine.resolveCoverDir()
              mkdirSync(dir, { recursive: true })
              writeFileSync(join(dir, result.name), result.bytes)
            } catch { /* 落项目失败不阻断(三写位已有,画布可用) */ }
          }
          sendJson(res, result.ok ? 200 : 500, result)
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })

  // ── PhotoCraft 为主(2026-10-27 15:09 裁决):原生 PS 式编辑器为画布,
  //    会话按图层引用操作;截图轮询即预览;导出走引擎 save。──
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

  /* 打开精修(2026-10-31 用户报障「打开后是空的」):原实现只裸启动不装内容。
     现在=按当前模板+props 先构建图层底稿(.pcraft,图层全保留),随文档路径启动 GUI
     (实测 GUI 接受文档参数,document.inspect 可见全部图层);构建失败如实报错,不开空窗。 */
  pcRoute('launch', 'POST', async (p) => {
    let docPath
    if (p && p.templateId) {
      const engine = await loadEngine()
      const built = await engine.buildLayeredDraft({
        templateId: String(p.templateId),
        props: p.props && typeof p.props === 'object' ? p.props : undefined,
      })
      if (!built.ok || !built.file) return { ok: false, error: built.error ?? '底稿构建失败' }
      docPath = built.file
    }
    return launchApp({ port: Number(process.env.TINTIN_PHOTOCRAFT_PORT || 7878), docPath })
  })
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

  // ── 会话路由族(/tintin/cover/api/acp/*;CA-2)──
  const disposeAcp = registerCoverAcpRoutes({
    webServer, isTrustedRequest, sendJson, httpRequest, getServerUrl,
    resolveCoverDir: async () => (await loadEngine()).resolveCoverDir(),
    resolvePluginDir,
  })

  return () => {
    disposeEditor()
    disposeChatPage()
    disposeTemplates()
    disposeRender()
    disposeUpload()
    disposeUploadUrl()
    disposeMatting()
    disposeDeleteAsset()
    disposeBackground()
    disposeReveal()
    disposeGenProduct()
    disposeCoverSkills()
    disposeCoverSkillsInstall()
    disposeCoverSkillsRemove()
    for (const d of pcDisposes) { try { d() } catch { /* ignore */ } }
    disposeAcp()
  }
}
