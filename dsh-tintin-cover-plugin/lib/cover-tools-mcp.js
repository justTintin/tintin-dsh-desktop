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
//                   实测 bria/silueta 服务端崩溃; HTTP 状态+PNG 魔数双校验,
//                   失败错误原文上返, 换备选最多 2 个=交互纪律)
//   render_preview  渲染当前 cover.props.json 并把预览图回给模型(渲染回看闭环=
//                   完成判据: 不看预览不得宣称完成)
//   imitate_cover   仿封面生成(2026-11-09 服务端核实批): 参考图上传(product-upload
//                   换服务端路径)→/generate/cover 编排(images 路径数组+文案至少其一)
//                   →统一任务轮询→产物下载落盘双写。1106 缺口(本机参考图无通路)
//                   由服务端新增 /generate/cover + product-upload 打通, 契约实测。
//                   1110 人物主体批: subject="person"=人物正脸恰 1 张(引擎人脸身份
//                   锚定+ArcFace 相似度门, completed=门已过; 风格参考 v1 不收, 走 prompt)
//   ocr_image       拆解提字(/material/ocr): 逐行文本+位置框(box/box_rel/置信度,
//                   实测含坐标), 供参考封面版式分析→文字层按位置重打。
//   text_remove     去字(/image/text-remove, 2026-11-10 生产接线): LaMa 质量档抹掉
//                   原字→干净底图; boxes 缺省=自动 OCR 全框, 显式框直通; fast 小字档。
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
/* 仿封面生成编排(2026-11-09 服务端核实批):上传→生图→轮询→取产物。
   轮询节奏 3s、上限 420s(实测 t2i 6s/cover 编排百秒级;cover_background 同为分钟级量级)。 */
const COVER_POLL_INTERVAL_MS = 3000
const COVER_POLL_TIMEOUT_MS = 420_000
const COVER_MAX_REF_IMAGES = 4

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

/** 参考图上传(product-upload): 本机路径 → 服务端路径数组。多文件一个 multipart。 */
async function uploadRefImages(serverUrl, imagePaths) {
  const form = new FormData()
  for (const p of imagePaths) form.append('files', new Blob([readFileSync(p)]), basename(p))
  const res = await fetch(serverUrl + '/api/storyboard/scripts/product-upload', {
    method: 'POST', body: form, signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`参考图上传失败 HTTP ${res.status}${text ? ` ${text}` : ''}`)
  }
  const data = await res.json().catch(() => null)
  const paths = Array.isArray(data?.paths) ? data.paths : null
  if (!paths?.length || !paths.every((p) => typeof p === 'string' && p)) {
    throw new Error(`参考图上传返回异常:${JSON.stringify(data).slice(0, 200)}`)
  }
  return paths
}

/** 统一任务轮询: 终态返回 {status, result, error}; 超时抛错。 */
async function pollUnifiedTask(serverUrl, taskId, { timeoutMs = COVER_POLL_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (Date.now() > deadline) throw new Error(`生成超时(${Math.round(timeoutMs / 1000)}s 未到终态), 任务 ${taskId} 可能在服务端继续执行, 可稍后在服务端输出目录查看`)
    const res = await fetch(serverUrl + `/tasks/unified/${encodeURIComponent(taskId)}`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`任务查询失败 HTTP ${res.status}`)
    const d = await res.json().catch(() => null)
    const status = String(d?.status ?? '')
    if (status === 'completed') return d
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`生成失败(${status}):${String(d?.error ?? d?.last_message ?? '无错误详情').slice(0, 400)}`)
    }
    await new Promise((r) => setTimeout(r, COVER_POLL_INTERVAL_MS))
  }
}

/** 生图产物下载+双写(项目目录+素材三写位, 同 matting 语义)。 */
async function saveGeneratedImage(serverUrl, outputUrl, outName, coverDir, pluginDir) {
  const res = await fetch(serverUrl + outputUrl, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`产物下载失败 HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const mime = magicMime(bytes)
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') throw new Error('产物不是可识别图片')
  const { writeCoverAsset } = await import('./cover-asset.js')
  if (pluginDir) writeCoverAsset(pluginDir, outName, bytes)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(coverDir, { recursive: true })
  const filePath = join(coverDir, outName)
  writeFileSync(filePath, bytes)
  return filePath
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

  /** 去字(2026-11-10 服务端 /image/text-remove 生产接线): 参考封面→抹掉原字→干净底图。
   *  boxes 缺省=自动先 /material/ocr 全框;显式给(数组/JSON 串)则直通。fast=纯色/渐变底小字档。 */
  const textRemove = async (args) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const srcPath = resolveImagePath(args?.image, coverDir, resolvePluginDir())
    const serverUrl = String(getServerUrl() ?? '').replace(/\/+$/, '')
    if (!serverUrl) throw new Error('服务端地址未配置(先在服务设置里保存并获取 MCP 服务)')
    /* boxes 归一: 未给→ocr 全框;数组→JSON 串;字符串→按 JSON 解析校验 */
    let boxesText = ''
    let usedOcr = false
    if (args?.boxes === undefined || args?.boxes === null || args?.boxes === '') {
      const ocrForm = new FormData()
      ocrForm.append('file', new Blob([readFileSync(srcPath)]), basename(srcPath))
      const ocrRes = await fetch(serverUrl + '/material/ocr', { method: 'POST', body: ocrForm, signal: AbortSignal.timeout(120_000) })
      if (!ocrRes.ok) {
        const text = (await ocrRes.text().catch(() => '')).slice(0, 300)
        throw new Error(`自动取字框失败(HTTP ${ocrRes.status}${text ? ` ${text}` : ''})——可显式传 boxes 参数绕过`)
      }
      const ocr = await ocrRes.json().catch(() => null)
      const lines = Array.isArray(ocr?.lines) ? ocr.lines : []
      boxesText = JSON.stringify(lines.map((l) => Array.isArray(l.box) ? l.box : null).filter(Boolean))
      usedOcr = lines.length > 0
      if (!lines.length) return { content: [{ type: 'text', text: JSON.stringify({ ok: true, file: srcPath, removed: 0, note: 'OCR 未发现文字——无需去字,原图即干净底图。' }, null, 1) }] }
    } else if (Array.isArray(args.boxes)) {
      boxesText = JSON.stringify(args.boxes)
    } else if (typeof args.boxes === 'string' && args.boxes.trim()) {
      const parsed = JSON.parse(args.boxes)
      if (!Array.isArray(parsed)) throw new Error('boxes 必须是 [[x1,y1,x2,y2],...] 数组(或其 JSON 字符串)')
      boxesText = JSON.stringify(parsed)
    } else {
      throw new Error('boxes 形态不对:给 [[x1,y1,x2,y2],...] 数组或其 JSON 字符串,或省略由工具自动 OCR 取框')
    }
    const form = new FormData()
    form.append('file', new Blob([readFileSync(srcPath)]), basename(srcPath))
    form.append('boxes', boxesText)
    if (args?.fast === true) form.append('fast', 'true')
    const res = await fetch(serverUrl + '/image/text-remove', { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`去字失败 HTTP ${res.status}${text ? ` ${text}` : ''}`)
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    if (magicMime(bytes) !== 'image/png') {
      const text = bytes.toString('utf8', 0, 300).replace(/\s+/g, ' ')
      throw new Error(`去字产物不是 PNG${text ? `:${text}` : ''}`)
    }
    const { writeCoverAsset } = await import('./cover-asset.js')
    const dir = resolvePluginDir()
    const base = basename(srcPath).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 60) || 'cover'
    const outName = `text-remove-${base}-${Date.now()}.png`
    if (dir) writeCoverAsset(dir, outName, bytes)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(coverDir, { recursive: true })
    const filePath = join(coverDir, outName)
    writeFileSync(filePath, bytes)
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, name: outName, file: filePath, asset: '素材区(三写位)', boxes: boxesText, autoOcr: usedOcr, note: '干净底图(原字已抹)。按项目版式组装:read_image 看它→作为 bgImage/自定义图层;原文字用 OCR 行框(box_rel×模板宽高)在排版层重打。' }, null, 1) }],
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

  /** 仿封面生成(2026-11-09 服务端核实批):参考图上传→/generate/cover 编排→轮询→产物落盘。
   *  契约(实测): 参考图三选一 script_id/images/material_ids(封面域只用 images=服务端路径),
   *  文案至少其一 title/prompt/selling_points;上传端点=POST /api/storyboard/scripts/product-upload。
   *  1110 人物档(实测): subject="person"=引擎人脸身份锚定+相似度门, images 须恰 1 张人物正脸图
   *  (多张服务端 400 拒);风格参考 v1 不收(style_refs 参数被服务端丢弃,风格走 prompt 文字);
   *  prompt 禁写人物外貌——身份由引擎锚定模板负责,外貌描述=画陌生人(1110 晚墨镜男事故);
   *  任务 completed=人脸相似度门已过,失败 partial_failed 带分值(错误原文上返)。 */
  const imitateCover = async (args) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const serverUrl = String(getServerUrl() ?? '').replace(/\/+$/, '')
    if (!serverUrl) throw new Error('服务端地址未配置(先在服务设置里保存并获取 MCP 服务)')
    const inputs = Array.isArray(args?.images) ? args.images : args?.images ? [args.images] : []
    if (!inputs.length) throw new Error('缺少参考图:images 至少 1 张(参考封面或参考产品图)')
    if (inputs.length > COVER_MAX_REF_IMAGES) throw new Error(`参考图最多 ${COVER_MAX_REF_IMAGES} 张`)
    const subject = args?.subject === 'person' ? 'person' : args?.subject === 'product' ? 'product' : ''
    if (subject === 'person' && inputs.length !== 1) {
      throw new Error('subject=person 要求 images 恰 1 张人物正脸图(引擎人脸身份锚定 v1 不收多图/风格参考组合);风格用 prompt 文字描述')
    }
    const title = typeof args?.title === 'string' ? args.title.trim() : ''
    const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
    const sellingPoints = Array.isArray(args?.selling_points) ? args.selling_points.map((s) => String(s).trim()).filter(Boolean) : []
    if (!title && !prompt && !sellingPoints.length) throw new Error('文案至少其一:title / prompt / selling_points')
    const refPaths = inputs.map((input) => resolveImagePath(input, coverDir, resolvePluginDir()))
    const serverPaths = await uploadRefImages(serverUrl, refPaths)
    const payload = { images: serverPaths }
    if (subject) payload.subject = subject
    if (title) payload.title = title
    if (prompt) payload.prompt = prompt
    if (sellingPoints.length) payload.selling_points = sellingPoints
    const genRes = await fetch(serverUrl + '/generate/cover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (!genRes.ok) {
      const text = (await genRes.text().catch(() => '')).slice(0, 300)
      throw new Error(`封面生成接单失败 HTTP ${genRes.status}${text ? ` ${text}` : ''}`)
    }
    const gen = await genRes.json().catch(() => null)
    const taskId = String(gen?.task_id ?? '')
    if (!taskId) throw new Error(`封面生成未返回任务 id:${JSON.stringify(gen).slice(0, 200)}`)
    const done = await pollUnifiedTask(serverUrl, taskId)
    const outputUrl = String(done?.result?.output_url ?? '')
    if (!outputUrl) throw new Error(`生成完成但无产物地址:${JSON.stringify(done?.result ?? {}).slice(0, 200)}`)
    const outName = `imitate-${Date.now()}.png`
    const filePath = await saveGeneratedImage(serverUrl, outputUrl, outName, coverDir, resolvePluginDir())
    const resultSubject = String(done?.result?.subject ?? '')
    const resultStyleMode = String(done?.result?.style_mode ?? '')
    const personNote = subject === 'person' || resultSubject === 'person'
      ? '人物档:任务 completed=引擎人脸相似度门已过(失败会 partial_failed 带分值);人物身份由参考图锚定,prompt 里的外貌描述不参与身份。'
      : ''
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, name: outName, file: filePath, asset: '素材区(三写位)', taskId, ...(resultSubject ? { subject: resultSubject } : {}), ...(resultStyleMode ? { styleMode: resultStyleMode } : {}), note: `这是服务端仿封面产物(无分层)。要按项目版式组装:用 read_image 看它→取其中元素(可再 matting 抠主体)作为图层素材,再写 cover.props.json→render_preview 回看。${personNote}` }, null, 1) }],
    }
  }

  /** 拆解提字(服务端 /material/ocr):返回逐行文本+位置框(box 像素/box_rel 相对),供文字层按位置重搭。 */
  const ocrImage = async (args) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const srcPath = resolveImagePath(args?.image, coverDir, resolvePluginDir())
    const serverUrl = String(getServerUrl() ?? '').replace(/\/+$/, '')
    if (!serverUrl) throw new Error('服务端地址未配置(先在服务设置里保存并获取 MCP 服务)')
    const form = new FormData()
    form.append('file', new Blob([readFileSync(srcPath)]), basename(srcPath))
    const res = await fetch(serverUrl + '/material/ocr', { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`OCR 失败 HTTP ${res.status}${text ? ` ${text}` : ''}`)
    }
    const data = await res.json().catch(() => null)
    if (!data || typeof data.total !== 'number') throw new Error('OCR 返回异常')
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, file: srcPath, text: data.text ?? '', total: data.total, lines: Array.isArray(data.lines) ? data.lines : [], note: 'lines[].box=像素[x0,y0,x1,y1]/box_rel=相对比例;按 box_rel×模板宽高换算成文字层位置重打(文字不进生图 prompt)。' }, null, 1) }],
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
    {
      name: 'imitate_cover',
      description: '仿封面生成(服务端 /generate/cover 编排):上传参考图→按文案生成同风格封面→产物落素材区+项目目录。普通档(缺省):images 1..4 张(第一张建议参考封面,其余产品/人物图)。人物档(subject="person"):images 恰 1 张人物正脸图,引擎人脸身份锚定+相似度门(换人=任务失败),风格/场景/动作写进 prompt——prompt 禁写人物外貌(外貌描述=画陌生人)。参数:images(必填)+文案至少其一(title/prompt/selling_points)。产物是整图(无分层)——组装进项目版式请看返回 note。分钟级耗时。',
      inputSchema: { type: 'object', properties: {
        images: { type: 'array', items: { type: 'string' }, description: '参考图路径(项目目录/素材位文件名或绝对路径);普通档 1..4 张,人物档(subject=person)恰 1 张人物正脸图' },
        subject: { type: 'string', enum: ['person', 'product'], description: '可选,人物档传 "person"(人物身份锚定,恰 1 张人物正脸图);缺省=普通档' },
        title: { type: 'string', description: '主标题文案(与 prompt/selling_points 至少其一)' },
        prompt: { type: 'string', description: '画面/风格/动作/构图描述;人物档下禁写人物外貌(脸/发型/服装/配饰)' },
        selling_points: { type: 'array', items: { type: 'string' }, description: '卖点短语数组(角标文案)' },
      }, required: ['images'] },
    },
    {
      name: 'ocr_image',
      description: '拆解提字(服务端 /material/ocr):识别图片里的文字,返回逐行文本+位置框(box 像素[x0,y0,x1,y1]/box_rel 相对比例/置信度)。用途:分析参考封面版式(标题/角标文案与其位置),供文字层按位置重打——文字一律回编辑器排版层,永不进生图 prompt。',
      inputSchema: { type: 'object', properties: { image: { type: 'string', description: '图片绝对路径(项目目录内)或素材文件名' } }, required: ['image'] },
    },
    {
      name: 'text_remove',
      description: '去字(服务端 /image/text-remove,LaMa 质量档约 6s):把参考封面里的原字抹掉,得到干净底图——拆解链第三步(ocr 取框→去字→干净底图+排版层重打)。boxes 缺省=自动先 OCR 取全部字框;显式传 [[x1,y1,x2,y2],...](绝对像素,即 ocr_image 的 lines[].box)只抹指定框;fast=true 仅适合纯色/渐变底小字。产物 PNG 落素材区+项目目录。',
      inputSchema: { type: 'object', properties: {
        image: { type: 'string', description: '源图绝对路径(项目目录内)或素材文件名' },
        boxes: { type: 'string', description: '可选,[[x1,y1,x2,y2],...] 的 JSON 字符串(绝对像素);省略=自动 OCR 全部字框' },
        fast: { type: 'boolean', description: '可选,快速档(仅纯色/渐变背景小字);缺省 LaMa 质量档' },
      }, required: ['image'] },
    },
  ]

  const callTool = async (name, args) => {
    if (name === 'read_image') return readImage(args)
    if (name === 'matting') return matting(args)
    if (name === 'render_preview') return renderPreview(args)
    if (name === 'imitate_cover') return imitateCover(args)
    if (name === 'ocr_image') return ocrImage(args)
    if (name === 'text_remove') return textRemove(args)
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
