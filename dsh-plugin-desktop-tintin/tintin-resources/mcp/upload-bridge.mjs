// upload-bridge.mjs — TinTin 本地文件上传桥(stdio MCP server, 零依赖)。
//
// 为什么存在(2026-10-27 用户裁决): MCP tools/call 是纯 JSON, 没有文件通道;
// TinTin 服务端读不到影片智能体机器的本地盘 —— 聊天里引用的图片素材
// (<影片>/assets/chat-uploads/*.png, 见 film-acp materializeChatImage)必须先
// 上传换服务端形态, 编排模型才能把 URL/name 传给下游生成类 MCP 工具。
// 注册表工具归服务端 /mcp(单一事实源); 本桥只补「服务端做不到的本地文件访问」
// 这一件事, 不复制注册表能力。
//
// 接线: film-acp 在 session/new|resume 的 mcpServers 里声明
//   { name: 'tintin-local-upload', type: 'stdio', command: <node>, args: [本脚本, <serverUrl>] }
// 智能体可见工具名: mcp__tintin-local-upload__upload_image。
//
// 上传端点: POST <server>/comfyui/upload_image (multipart `file`[, `name`];
// OpenAPI operationId comfyui_upload_image, "上传图片到 ComfyUI input 目录")。
// 响应原样回传给模型(不猜 URL 形态), 由编排模型按下游工具的参数契约取用。
//
// 协议子集: newline-delimited JSON-RPC(MCP stdio): initialize /
// notifications/initialized(忽略) / ping / tools/list / tools/call;
// 其余带 id 的请求回 -32601。通知(no id)永不回包。
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'

const serverUrl = String(process.argv[2] || process.env.TINTIN_SERVER_URL || '').replace(/\/+$/, '')
const machineId = String(process.env.TINTIN_MACHINE_ID || '')

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
}

const TOOL_DEFINITION = {
  name: 'upload_image',
  description:
    '把本机图片上传到 TinTin 服务端(POST /comfyui/upload_image), 换取服务端可引用的形态。' +
    '本机路径(如聊天素材 [图片素材 N] 给出的 assets/chat-uploads/*.png)服务端读不到 —— ' +
    '要在家图生成/视频生成/数字人等下游工具里引用一张本地图, 必须先用本工具上传, ' +
    '再按本工具返回的服务端字段(name/path/url 等)填下游工具的图片参数。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '本机图片绝对路径(必须已存在)' },
      name: { type: 'string', description: '可选, 上传后的文件名; 缺省用原名' },
    },
    required: ['path'],
  },
}

/** multipart 上传一张本地图; 返回 {ok, status, response} 或 {ok:false, error}。 */
async function uploadImage(args) {
  const path = String(args?.path ?? '').trim()
  if (!path) return { ok: false, error: '缺少 path(本机图片绝对路径)' }
  if (!serverUrl) return { ok: false, error: '服务端地址未配置(桥启动参数缺失)' }
  let buf
  try {
    buf = readFileSync(path)
    if (!statSync(path).isFile()) throw new Error('not a file')
  } catch (err) {
    return { ok: false, error: `本地文件不可读: ${path}(${err?.message ?? err})` }
  }
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
  const name = String(args?.name ?? '').trim() || basename(path)
  const form = new FormData()
  form.append('file', new Blob([buf], { type: mime }), name)
  const headers = {}
  if (machineId) headers['X-Machine-ID'] = machineId
  let res
  try {
    res = await fetch(`${serverUrl}/comfyui/upload_image`, { method: 'POST', body: form, headers })
  } catch (err) {
    return { ok: false, error: `上传请求失败: ${err?.code || err?.message || err}` }
  }
  const text = await res.text()
  let parsed = text
  try { parsed = JSON.parse(text) } catch { /* 非 JSON 原样回传 */ }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${String(text).slice(0, 300)}` }
  return { ok: true, status: res.status, response: parsed }
}

function textResult(payload, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError }
}

async function dispatch(method, params) {
  if (method === 'initialize') {
    return {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'tintin-upload-bridge', version: '1.0.0' },
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: [TOOL_DEFINITION] }
  if (method === 'tools/call') {
    if (params?.name !== 'upload_image') return { content: [{ type: 'text', text: `未知工具 ${params?.name}` }], isError: true }
    const payload = await uploadImage(params?.arguments)
    return textResult(payload, payload?.ok !== true)
  }
  return undefined
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    void handleMessage(msg)
  }
})
process.stdin.on('end', () => process.exit(0))

async function handleMessage(msg) {
  const { id, method, params } = msg ?? {}
  if (id === undefined || id === null) return // 通知(如 notifications/initialized): 不回包
  try {
    const result = await dispatch(method, params)
    if (result === undefined) {
      write({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
      return
    }
    write({ jsonrpc: '2.0', id, result })
  } catch (err) {
    write({ jsonrpc: '2.0', id, error: { code: -32603, message: String(err?.message ?? err) } })
  }
}

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
