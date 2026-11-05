// cover-tools-mcp — 封面会话本地工具 MCP(streamable-http, 2026-11-04 感知闭环+工具收敛立项)
//
// 背景(1103/1104 事故): 智能体对画布与产物零视觉通道——1104 想看抠图结果被逼出
// PowerShell GetPixel 扫描 43 连死循环; 抠图走裸 curl 无校验, 服务端错误 JSON 被
// 存成 227 字节假 PNG 落进素材区。本模块在封面 webServer 上挂一个最小
// streamable-http MCP 端点(initialize/notifications/initialized/tools/list/tools/call),
// 经补丁行 mcp-cover-tools 进会话(cover-acp-bridge.js writePatch, 工具名
// mcp__cover-tools__*):
//   read_image      查看项目/素材位图片(魔数+8MB 上限校验) → image 块回给模型
//   matting         抠图(内置健康模型链 isnet-general-use→u2net→isnet-anime——1104
//                   实测 bria/silueta 服务端 ONNX 崩溃; HTTP 状态+PNG 魔数双校验,
//                   失败错误原文上返, 换备选最多 2 个=交互纪律)
//   render_preview  渲染当前 cover.props.json 并把预览图回给模型(渲染回看闭环=
//                   完成判据: 不看预览不得宣称完成)
// 协议面: 与 tintin-server 同款 JSON-RPC 2.0(会话经 mcp-session-id 头透传, 本端点无状态);
// 响应 application/json(同 tintin-server 先例, dsh-mcp-client 可解析)。
// 信任面: 仅 loopback(isTrustedRequest(req, true))——模型客户端在本机子进程内。
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve as resolvePath, sep } from 'node:path'

const MCP_PATH = '/tintin/cover/api/tools-mcp'
const MATTING_CHAIN = ['isnet-general-use', 'u2net', 'isnet-anime']
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** 文件头魔数 → mime(不认识的返回 null)。 */
function magicMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** 目标路径必须落在允许根内(coverDir 子树或插件素材三写位), 防穿越。 */
function withinRoot(root, target) {
  const r = resolvePath(root)
  const t = resolvePath(target)
  return t === r || t.startsWith(r + sep)
}

/** read_image/matting 的路径解析: 绝对路径须在允许根内; 裸文件名按 coverDir→素材位回退。 */
function resolveImagePath(input, coverDir, pluginDir) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('缺少 image/path 参数')
  const pluginAssets = pluginDir ? [join(pluginDir, 'public'), join(pluginDir, 'dist', 'editor'), join(pluginDir, 'dist', 'remotion-bundle', 'public')] : []
  const candidates = isAbsolute(input)
    ? [input]
    : [join(coverDir, input), ...pluginAssets.map((root) => join(root, input))]
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) throw new Error(`图片不存在:${input}`)
  const allowed = withinRoot(coverDir, hit) || pluginAssets.some((root) => withinRoot(root, hit))
  if (!allowed) throw new Error(`路径越界(仅允许项目目录与素材位):${hit}`)
  return hit
}

/** 单次抠图调用: 成功返回 {bytes, contentType}, 失败抛错误原文(截断)。 */
async function mattingOnce(serverUrl, imagePath, model) {
  const bytes = readFileSync(imagePath)
  const form = new FormData()
  form.append('file', new Blob([bytes]), basename(imagePath))
  form.append('model', model)
  const res = await fetch(serverUrl + '/matting', { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`HTTP ${res.status}${text ? ` ${text}` : ''}`)
  }
  const out = Buffer.from(await res.arrayBuffer())
  if (!out.length) throw new Error('响应为空')
  const mime = magicMime(out)
  if (mime !== 'image/png') {
    const text = out.toString('utf8', 0, 300).replace(/\s+/g, ' ')
    throw new Error(`响应不是 PNG${text ? `:${text}` : ''}`)
  }
  return out
}

/** 工具实现: read_image → [{image}] / matting → 落盘+文本 / render_preview → [{image}]。 */
export function createCoverTools({ getServerUrl, loadEngine, resolvePluginDir }) {
  const assetTargets = () => {
    const dir = resolvePluginDir()
    return dir ? [join(dir, 'public'), join(dir, 'dist', 'editor'), join(dir, 'dist', 'remotion-bundle', 'public')] : []
  }

  const readImage = async (args) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const path = resolveImagePath(args?.path, coverDir, resolvePluginDir())
    const size = statSync(path).size
    if (size > MAX_IMAGE_BYTES) throw new Error(`图片超过 8MB 上限(${size} bytes), 请先缩小再查看`)
    const bytes = readFileSync(path)
    const mime = magicMime(bytes)
    if (!mime) throw new Error('不是可识别的图片(PNG/JPEG/WebP 魔数校验失败)')
    return {
      content: [
        { type: 'image', data: bytes.toString('base64'), mimeType: mime },
        { type: 'text', text: `${path}(${size} bytes,${mime})` },
      ],
    }
  }

  const matting = async (args) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const srcPath = resolveImagePath(args?.image, coverDir, resolvePluginDir())
    const serverUrl = String(getServerUrl() ?? '').replace(/\/+$/, '')
    if (!serverUrl) throw new Error('服务端地址未配置(先在服务设置里保存并获取 MCP 服务)')
    const chain = typeof args?.model === 'string' && args.model.trim() ? [args.model.trim()] : MATTING_CHAIN
    const tried = []
    let bytes = null
    let model = ''
    let lastError = ''
    for (const candidate of chain) {
      tried.push(candidate)
      try {
        bytes = await mattingOnce(serverUrl, srcPath, candidate)
        model = candidate
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
    if (!bytes) {
      return {
        isError: true,
        content: [{ type: 'text', text: `抠图失败(已试 ${tried.join('→')})。最后一次错误原文:${lastError}` }],
      }
    }
    const { writeCoverAsset } = await import('./cover-asset.js')
    const dir = resolvePluginDir()
    const base = basename(srcPath).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 60) || 'subject'
    const outName = `matting-${base}-${model}-${Date.now()}.png`
    writeCoverAsset(dir, outName, bytes)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(coverDir, { recursive: true })
    const filePath = join(coverDir, outName)
    writeFileSync(filePath, bytes)
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, name: outName, file: filePath, asset: '素材区(三写位)', model, tried }, null, 1) }],
    }
  }

  const renderPreview = async (args) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const propsPath = join(coverDir, 'cover.props.json')
    if (!existsSync(propsPath)) throw new Error('项目尚无 cover.props.json——先按用户需求写 props 再渲染预览')
    const doc = JSON.parse(readFileSync(propsPath, 'utf8'))
    const props = { ...(doc.props && typeof doc.props === 'object' ? doc.props : {}) }
    if (Array.isArray(doc.hiddenLayers)) props.hiddenLayers = doc.hiddenLayers
    const fileName = typeof args?.fileName === 'string' && args.fileName.trim() ? args.fileName.trim() : `preview-${Date.now()}.png`
    const result = await engine.renderCover({ templateId: String(doc.templateId || ''), props, fileName, outDir: coverDir })
    if (!result?.ok || !result.file || !existsSync(result.file)) {
      throw new Error(`渲染失败:${result?.error ?? '未知错误'}`)
    }
    const bytes = readFileSync(result.file)
    return {
      content: [
        { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `预览:${result.file}(${bytes.length} bytes,templateId=${doc.templateId})。完成判据:确认文字不溢出、图层位置符合用户要求、画面成立后才能向用户报告完成;不合格继续修,修完再渲染回看。` },
      ],
    }
  }

  const tools = [
    {
      name: 'read_image',
      description: '查看项目目录或素材位里的图片(生成结果/素材/导出图), 返回图片本体。凡要对图片下结论, 先用本工具看图, 不要用 pwsh 读像素。',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: '图片绝对路径, 或项目目录/素材位内的文件名' } }, required: ['path'] },
    },
    {
      name: 'matting',
      description: '抠图/去背景(服务端 /matting)。内置健康模型链 isnet-general-use→u2net→isnet-anime(1104 实测 bria/silueta 服务端崩溃), 自动换备选; 带落盘校验(状态+PNG 魔数), 失败返回错误原文。产物=透明底 PNG, 落素材区+项目目录; 是否上图由用户决定。',
      inputSchema: { type: 'object', properties: { image: { type: 'string', description: '源图绝对路径(项目目录内)或素材文件名' }, model: { type: 'string', description: '可选, 指定单一模型(不指定=自动链)' } }, required: ['image'] },
    },
    {
      name: 'render_preview',
      description: '渲染当前 cover.props.json 为预览图并返回图片本体;fileName 可指定即=导出。完成判据: 凡改动 props/落位图片后必须调用本工具查看, 确认无误才能向用户报告完成。',
      inputSchema: { type: 'object', properties: { fileName: { type: 'string', description: '可选, 输出文件名(缺省 preview-<时间戳>.png, 落项目目录)' } } },
    },
  ]

  const callTool = async (name, args) => {
    if (name === 'read_image') return readImage(args)
    if (name === 'matting') return matting(args)
    if (name === 'render_preview') return renderPreview(args)
    return { isError: true, content: [{ type: 'text', text: `未知工具:${name}` }] }
  }

  return { tools, callTool }
}

/** JSON-RPC 分发(initialize/notifications/tools/*), 供 webServer 路由与独立监听共用。 */
export function createCoverToolsRpc(deps) {
  const { tools, callTool } = createCoverTools(deps)
  return async function handleRpc(body) {
    const { method, id } = body ?? {}
    try {
      if (method === 'initialize') {
        return { status: 200, sessionId: randomUUID(), payload: { jsonrpc: '2.0', id: id ?? null, result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'cover-tools', version: '1.1.0' } } } }
      }
      if (typeof method === 'string' && method.startsWith('notifications/')) return { status: 202, payload: null }
      if (method === 'tools/list') return { status: 200, payload: { jsonrpc: '2.0', id: id ?? null, result: { tools } } }
      if (method === 'tools/call') {
        const result = await callTool(String(body.params?.name ?? ''), body.params?.arguments ?? {})
        return { status: 200, payload: { jsonrpc: '2.0', id: id ?? null, result } }
      }
      return { status: 200, payload: { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found:${method}` } } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { status: 200, payload: { jsonrpc: '2.0', id: id ?? null, result: { isError: true, content: [{ type: 'text', text: message }] } } }
    }
  }
}

/** 在封面 webServer 上注册 tools-mcp 端点(页面侧可达面); 返回 dispose。 */
export function registerCoverToolsMcp({ webServer, isTrustedRequest, sendJson, getServerUrl, loadEngine, resolvePluginDir }) {
  const handleRpc = createCoverToolsRpc({ getServerUrl, loadEngine, resolvePluginDir })
  const dispose = webServer.register({
    kind: 'exact',
    path: MCP_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy() })
      req.on('end', async () => {
        let rpc = null
        try { rpc = JSON.parse(body || '{}') } catch { sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return }
        const out = await handleRpc(rpc)
        if (out.sessionId) { try { res.setHeader?.('mcp-session-id', out.sessionId) } catch { /* 桩 res 无 setHeader */ } }
        if (out.status === 202) { res.statusCode = 202; res.end(); return }
        sendJson(res, out.status, out.payload)
      })
    },
  })
  return dispose
}

/** 独立回环监听(2026-11-04 改道):dsh webServer 的 POST 闸对非浏览器客户端 403
 *  (会话 cookie/CSRF 层,MCP 子进程无 cookie,Origin 也救不了——1105 实测),
 *  所以工具端点自带随机 token 闸独立监听 127.0.0.1:随机端口;补丁行 mcp-cover-tools
 *  经 dsh-mcp-client 的 headers 配置带令牌(cover-acp-bridge.js writePatch)。
 *  返回 { url, token, dispose }。 */
export function startCoverToolsServer({ getServerUrl, loadEngine, resolvePluginDir, port = 0 }) {
  const token = randomUUID().replaceAll('-', '')
  const handleRpc = createCoverToolsRpc({ getServerUrl, loadEngine, resolvePluginDir })
  const server = createServer((req, res) => {
    if (req.headers['x-tintin-cover-tools-token'] !== token) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { type: 'UNAUTHORIZED', message: 'cover-tools token 校验失败' } }))
      return
    }
    if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false })); return }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      let rpc = null
      try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })); return }
      const out = await handleRpc(rpc)
      const headers = { 'content-type': 'application/json' }
      if (out.sessionId) headers['mcp-session-id'] = out.sessionId
      res.writeHead(out.status, headers)
      res.end(out.payload === null ? '' : JSON.stringify(out.payload))
    })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const url = `http://127.0.0.1:${address.port}/mcp`
      resolve({
        url,
        token,
        dispose: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}
