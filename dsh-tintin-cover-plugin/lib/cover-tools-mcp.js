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
//   imitate_cover   仿封面生成·提交(2026-11-09 服务端核实批): 参考图上传(product-upload
//                   换服务端路径)→/generate/cover 编排(images 路径数组+文案至少其一)
//                   →返回 task_id 立即结束。1106 缺口(本机参考图无通路)由服务端新增
//                   /generate/cover + product-upload 打通, 契约实测。
//                   1110 人物主体批: subject="person"=人物正脸恰 1 张(引擎人脸身份
//                   锚定+ArcFace 相似度门, completed=门已过);1110 风格参考批:
//                   style_image+style_weight 分参数透传(服务端面名,引擎 style_refs
//                   名对服务端无效);prompt 禁写人物外貌(墨镜男事故守规)。
//                   1112 两步拆分(封面参考批, 用户裁决方案 1b): 提交与等待分离——
//                   轮询收进 imitate_cover_wait(可重复调用续等=会话面可见的进度,
//                   超时不丢任务=可重新附身, cancel:true 可取消服务端任务)。
//   imitate_cover_wait 仿封面等待/落盘(2026-11-12 封面参考批): task_id → 统一任务轮询
//                   (默认 420s/上限 540s, 间隔 3s)→ completed 即下载产物双写并回显
//                   face_similarity;未到终态返回 settled:false 可续等;failed/cancelled
//                   错误原文上返;cancel:true 走 /tasks/batch_cancel 显式取消。
//   ocr_image       拆解提字(/material/ocr): 逐行文本+位置框(box/box_rel/置信度,
//                   实测含坐标), 供参考封面版式分析→文字层按位置重打。
//   text_remove     去字(/image/text-remove, 2026-11-10 生产接线): LaMa 质量档抹掉
//                   原字→干净底图; boxes 缺省=自动 OCR 全框, 显式框直通; fast 小字档。
// 协议面: 与 tintin-server 同款 JSON-RPC 2.0(会话经 mcp-session-id 头透传, 本端点无状态);
// 响应 application/json(同 tintin-server 先例, dsh-mcp-client 可解析)。
// 信任面: 仅 loopback(isTrustedRequest(req, true))——模型客户端在本机子进程内。
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve as resolvePath, sep } from 'node:path'
import { MODEL_SAFE_RAW_BYTES, imageMetaText, modelTooLargeText, shrinkForModelRead } from './cover-image-resize.js'

const MCP_PATH = '/tintin/cover/api/tools-mcp'
const MATTING_CHAIN = ['isnet-general-use', 'u2net', 'isnet-anime']
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
/* 仿封面生成编排(2026-11-09 服务端核实批;1112 两步拆分):上传→生图提交(task_id 立即回)
   →imitate_cover_wait 轮询(3s)→产物下载落盘。等待单次默认 420s/上限 540s
   (实测 t2i 6s/cover 编排百秒级;540 < dsh-mcp-client toolCallTimeoutMs 600s,留余量)。 */
const COVER_POLL_INTERVAL_MS = 3000
const IMITATE_WAIT_DEFAULT_S = 420
const IMITATE_WAIT_MAX_S = 540
const COVER_MAX_REF_IMAGES = 4
/* 续等累计僵死线(2026-11-12): 与桥侧看门狗 ASYNC_TASK_BUDGET_MINUTES(30) 同预算。settled:false
   的「仍在服务端执行」对超预算任务是误导——今天实测任务 30 分钟不落终态, 模型无限续等刷满
   聊天面。跨多次续等记账, 到线改发 stale:true + 停手指令(智能体看不见会话面 notice, 这是
   它唯一的止损通道)。 */
const IMITATE_WAIT_STALE_TOTAL_MS = 30 * 60 * 1000
const waitClock = new Map()

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

/** 单次统一任务查询: 返回 body;HTTP 失败抛错。终态裁决与等待循环在调用方。 */
async function fetchUnifiedTask(serverUrl, taskId) {
  const res = await fetch(serverUrl + `/tasks/unified/${encodeURIComponent(taskId)}`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`任务查询失败 HTTP ${res.status}`)
  const d = await res.json().catch(() => null)
  if (!d || typeof d !== 'object') throw new Error('任务查询返回异常')
  return d
}

/** 服务端任务显式取消(/tasks/batch_cancel,creation 域同款契约): 返回取消数;失败抛错原文。 */
async function cancelUnifiedTasks(serverUrl, taskIds) {
  const res = await fetch(serverUrl + '/tasks/batch_cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task_ids: [...taskIds] }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`任务取消失败 HTTP ${res.status}`)
  const body = await res.json().catch(() => null)
  return Number(body?.cancelled ?? 0)
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

/** 工具实现: read_image → [{image}] / matting → 落盘+文本 / render_preview → [{image}]。
 *  pollIntervalMs(测试注入口): imitate_cover_wait 的轮询间隔,缺省 3s。 */
export function createCoverTools({ getServerUrl, loadEngine, resolvePluginDir, pollIntervalMs = COVER_POLL_INTERVAL_MS, resize = shrinkForModelRead, renderCover: renderCoverInjected }) {
  const assetTargets = () => {
    const dir = resolvePluginDir()
    return dir ? [join(dir, 'public'), join(dir, 'dist', 'editor'), join(dir, 'dist', 'remotion-bundle', 'public')] : []
  }

  const readImage = async (args) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const path = resolveImagePath(args?.path, coverDir, resolvePluginDir())
    const size = statSync(path).size
    /* 8MB 是读盘上限(不是模型上限);超限不再抛裸错——给可转述的处置提示 */
    if (size > MAX_IMAGE_BYTES) {
      return {
        content: [{
          type: 'text',
          text: `无法查看该图：${path}（${(size / 1024 / 1024).toFixed(1)} MB，超过 read_image 的 8MB 读取上限）。`
            + '处理方式：①请用户把图片缩到长边 ≤2000px 且 ≤2.5MB 后再试；②或直接把该路径传给 matting / imitate_cover（这两个工具用原图，不需要模型看图）。'
            + '请把这段提示转述给用户，不要静默继续。',
        }],
      }
    }
    const bytes = readFileSync(path)
    const mime = magicMime(bytes)
    if (!mime) throw new Error('不是可识别的图片(PNG/JPEG/WebP 魔数校验失败)')
    /* 进模型前压缩阶梯(2026-11-12 1112 修复批): nativeImage 不可用 → ffmpeg 后备;
       仍超模型安全上限(2.5MB)时**不返回 image 块**, 改文字提示——超限图进 MCP 会在
       dsh-mcp-client 的 base64 正则处栈溢出, 模型只会收到一段不可读的 unavailable。 */
    let shrunk = null
    try { shrunk = resize(bytes, mime, { sourcePath: path }) } catch (e) { throw new Error(e instanceof Error ? e.message : String(e)) }
    const dataBytes = shrunk?.bytes ?? bytes
    const dataMime = shrunk?.mime ?? mime
    if (dataBytes.length > MODEL_SAFE_RAW_BYTES) {
      return { content: [{ type: 'text', text: modelTooLargeText(path, size, MODEL_SAFE_RAW_BYTES, dataBytes.length) }] }
    }
    return {
      content: [
        { type: 'image', data: dataBytes.toString('base64'), mimeType: dataMime },
        { type: 'text', text: `${path}(${size} bytes,${mime})${imageMetaText(shrunk)}` },
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
   *  (多张服务端 400 拒);任务 completed=人脸相似度门已过,失败 partial_failed 带分值(错误原文上返);
   *  prompt 禁写人物外貌——身份由引擎锚定模板负责,外貌描述=画陌生人(1110 晚墨镜男事故)。
   *  1110 风格参考(探针实测): 服务端面参数名=style_image(单张,服务端路径)+style_weight(数值,
   *  0.4/0.6/0.8 映引擎五档;引擎侧字段名 style_refs 对服务端无效会被丢弃)——与 images/subject
   *  分参数同传,任务日志"风格参考: … weight=",结果 style_mode 回显。
   *  1111 验收回显(2026-11-11 API 文档+双单实跑实证): person 模式完成态 result 另附 subject+
   *  face_similarity{score,threshold,pass}+face_similarity_mode(实测 score 0.761/0.78 @0.65 门,
   *  person+style 组合门也过);引擎侧历史形态=shots_done[0].face_similarity,两处都接。 */
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
      throw new Error('subject=person 要求 images 恰 1 张人物正脸图(人物参考与风格参考分参数:参考封面传 style_image,不要塞进 images)')
    }
    const styleImage = typeof args?.style_image === 'string' ? args.style_image.trim() : ''
    const hasWeight = args?.style_weight !== undefined && args?.style_weight !== null
    const styleWeight = hasWeight ? Number(args.style_weight) : null
    if (hasWeight && (!Number.isFinite(styleWeight) || styleWeight <= 0)) throw new Error('style_weight 须为正数(建议 0.4/0.6/0.8,引擎映五档)')
    if (!styleImage && hasWeight) throw new Error('style_weight 需与 style_image 同传')
    const title = typeof args?.title === 'string' ? args.title.trim() : ''
    const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
    const sellingPoints = Array.isArray(args?.selling_points) ? args.selling_points.map((s) => String(s).trim()).filter(Boolean) : []
    if (!title && !prompt && !sellingPoints.length) throw new Error('文案至少其一:title / prompt / selling_points')
    const refPaths = inputs.map((input) => resolveImagePath(input, coverDir, resolvePluginDir()))
    const stylePath = styleImage ? resolveImagePath(styleImage, coverDir, resolvePluginDir()) : ''
    const serverPaths = await uploadRefImages(serverUrl, stylePath ? [...refPaths, stylePath] : refPaths)
    const payload = { images: serverPaths.slice(0, refPaths.length) }
    if (subject) payload.subject = subject
    if (stylePath) {
      payload.style_image = serverPaths[refPaths.length]
      if (hasWeight) payload.style_weight = styleWeight
    }
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
    /* 1112 两步拆分: 提交到此结束——轮询/落盘/回显在 imitate_cover_wait(可续等可取消) */
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, taskId, phase: 'submitted', ...(subject ? { subject } : {}), note: '任务已提交,参考图已上传(分钟级生成)。下一步立即调用 mcp__cover-tools__imitate_cover_wait(task_id=本 id) 等待终态并落盘;单次等待未到终态会返回 settled:false,重复调用即续等;用户改主意时对该 task_id 传 cancel:true 取消服务端任务。' }, null, 1) }],
    }
  }

  /** 等待终态后的产物回显(1111 验收回显批字段全保留;subjectArg=提交档位,缺省用结果回显)。 */
  const imitateResultEcho = (taskId, outName, filePath, result, subjectArg) => {
    const resultSubject = String(result.subject ?? result.subject_type ?? '')
    const resultStyleMode = String(result.style_mode ?? '')
    // 验收回显(2026-11-11 API 文档契约+实跑双单实证):person 模式完成态 result 另附
    // subject+face_similarity{score,threshold,pass}+face_similarity_mode;引擎侧历史形态=
    // shots_done[0].face_similarity,两处都接;字段缺省=引擎未回传,不虚构。
    const shotsDone = Array.isArray(result.shots_done) ? result.shots_done : []
    const rawFace = result.face_similarity && typeof result.face_similarity === 'object'
      ? result.face_similarity
      : (shotsDone[0]?.face_similarity && typeof shotsDone[0].face_similarity === 'object' ? shotsDone[0].face_similarity : null)
    const faceSimilarity = rawFace
      ? { score: rawFace.score, threshold: rawFace.threshold, pass: rawFace.pass }
      : null
    const faceSimMode = String(result.face_similarity_mode ?? '')
    const faceNote = faceSimilarity
      ? (faceSimilarity.pass === false
        ? `注意:人脸相似度门分值未过(score=${faceSimilarity.score} < threshold=${faceSimilarity.threshold})——先 read_image 验人,疑似非本人即弃用。`
        : `人脸相似度门:score=${faceSimilarity.score} ≥ threshold=${faceSimilarity.threshold} 已过。`)
      : ''
    const personNote = subjectArg === 'person' || resultSubject === 'person'
      ? '人物档:任务 completed=引擎人脸相似度门已过(失败会 partial_failed 带分值);人物身份由参考图锚定,prompt 里的外貌描述不参与身份。'
      : ''
    return { ok: true, name: outName, file: filePath, asset: '素材区(三写位)', taskId, ...(resultSubject ? { subject: resultSubject } : {}), ...(resultStyleMode ? { styleMode: resultStyleMode } : {}), ...(faceSimilarity ? { face_similarity: faceSimilarity } : {}), ...(faceSimMode ? { face_similarity_mode: faceSimMode } : {}), note: `这是服务端仿封面产物(无分层)。要按项目版式组装:用 read_image 看它→取其中元素(可再 matting 抠主体)作为图层素材,再写 cover.props.json→render_preview 回看。${personNote}${faceNote}` }
  }

  /** 仿封面等待/落盘(1112 两步拆分): task_id → 轮询(默认 420s,可重复调用续等=重附身)
   *  → completed 下载产物双写并回显;failed/cancelled 错误原文;cancel:true 显式取消。 */
  const imitateCoverWait = async (args, { pollIntervalMs = COVER_POLL_INTERVAL_MS } = {}) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const serverUrl = String(getServerUrl() ?? '').replace(/\/+$/, '')
    if (!serverUrl) throw new Error('服务端地址未配置(先在服务设置里保存并获取 MCP 服务)')
    const taskId = typeof args?.task_id === 'string' ? args.task_id.trim() : ''
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(taskId)) throw new Error('缺少/非法 task_id(传 imitate_cover 返回的 taskId)')
    if (args?.cancel === true) {
      const cancelledCount = await cancelUnifiedTasks(serverUrl, [taskId])
      waitClock.delete(taskId)
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, taskId, cancelled: cancelledCount > 0, cancelledCount, note: cancelledCount > 0 ? '服务端任务已取消,不再继续等待。' : '服务端未取消该任务(可能已到终态)——用 task_status_unified 查确认状态。' }, null, 1) }],
      }
    }
    const subjectArg = args?.subject === 'person' ? 'person' : args?.subject === 'product' ? 'product' : ''
    /* 单次等待下限 1s=「只查一次」的合法用法;上限 540s < dsh-mcp-client 600s 超时 */
    const timeoutS = Math.min(Math.max(Number(args?.timeout_s) || IMITATE_WAIT_DEFAULT_S, 1), IMITATE_WAIT_MAX_S)
    const deadline = Date.now() + timeoutS * 1000
    let last = null
    for (;;) {
      last = await fetchUnifiedTask(serverUrl, taskId)
      const status = String(last?.status ?? '')
      if (status === 'completed') { waitClock.delete(taskId); break }
      if (status === 'failed' || status === 'cancelled') {
        waitClock.delete(taskId)
        throw new Error(`生成失败(${status}):${String(last?.error ?? last?.last_message ?? '无错误详情').slice(0, 400)}`)
      }
      if (Date.now() > deadline) {
        const totalMs = (waitClock.get(taskId)?.totalMs ?? 0) + timeoutS * 1000
        waitClock.set(taskId, { totalMs })
        const stale = totalMs >= IMITATE_WAIT_STALE_TOTAL_MS
        const progress = Number(last?.progress)
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ok: true, settled: false, ...(stale ? { stale: true } : {}),
            taskId, status: status || 'unknown', waitedS: timeoutS, waitedTotalS: Math.round(totalMs / 1000),
            ...(Number.isFinite(progress) ? { progress } : {}),
            note: stale
              ? `已累计等待 ${Math.round(totalMs / 60000)} 分钟仍未到终态——疑似服务端任务僵死。停止续等:把这一情况如实转述给用户,不要再调用本工具等这个 task_id;用户不要该结果时可对该 task_id 传 cancel:true 取消服务端任务。`
              : `${timeoutS}s 未到终态,任务仍在服务端执行(不丢失,已累计等待 ${Math.round(totalMs / 60000)} 分钟)。再次调用 imitate_cover_wait(task_id=本 id) 续等;确定不要了传 cancel:true 取消服务端任务。`,
          }, null, 1) }],
        }
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs))
    }
    const result = last?.result ?? {}
    const outputUrl = String(result.output_url ?? '')
    if (!outputUrl) throw new Error(`生成完成但无产物地址:${JSON.stringify(result).slice(0, 200)}`)
    const outName = `imitate-${Date.now()}.png`
    const filePath = await saveGeneratedImage(serverUrl, outputUrl, outName, coverDir, resolvePluginDir())
    return {
      content: [{ type: 'text', text: JSON.stringify(imitateResultEcho(taskId, outName, filePath, result, subjectArg), null, 1) }],
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

  /** 渲染子进程(2026-11-12 用户报障「选保人方案后卡死」根治): 之前 renderCover 在**主进程内**
   *  import('@remotion/renderer')+渲染, 该链路在应用进程里会永挂(实证: 同一 engine.mjs 裸
   *  Electron 1.5s 渲完, 应用内 render_preview 三连挂且挂起期间主进程事件循环仍存活(其它
   *  RPC 3-6ms 即答)——挂点在引擎的 90s 竞速 armed 之前的动态 import 里, 竞速永远没机会
   *  触发; 智能体侧只能等 undici 300s headers 超时报 `fetch failed` 再无限重试=卡死观感)。
   *  改为独立 node 子进程跑引擎既有 CLI(dist/engine.mjs <templateId> @propsFile fileName,
   *  输出 JSON)——主进程零 Remotion import, 挂不回去; 异步 spawn 不阻塞事件循环,
   *  超时 taskkill 杀树(Windows spawnSync 杀不掉孙进程的教训)。 */
  const runEngineRender = ({ engineCliPath, templateId, propsFile, fileName, coverDir, timeoutMs = 180_000 }) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [engineCliPath, templateId, '@' + propsFile, fileName], {
      cwd: coverDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TINTIN_COVER_DIR: coverDir },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', () => { /* chromium/Remotion 噪音:不入结果 */ })
    const timer = setTimeout(() => {
      try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 尽力杀 */ }
      reject(new Error(`渲染超时(${Math.round(timeoutMs / 1000)}s,子进程已终止)——可重试;反复出现请反馈`))
    }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`渲染子进程启动失败:${e.message}`)) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop()
      let parsed = null
      try { parsed = JSON.parse(line ?? 'null') } catch { /* 非法输出按退出码处理 */ }
      if (code !== 0) reject(new Error(parsed?.error ? `渲染失败:${parsed.error}` : `渲染子进程退出码 ${code}`))
      else if (!parsed || typeof parsed !== 'object') reject(new Error(`渲染子进程输出无法解析:${out.slice(-200)}`))
      else resolve(parsed)
    })
  })

  const renderPreview = async (args) => {
    const engine = await loadEngine()
    const coverDir = await engine.resolveCoverDir()
    const propsPath = join(coverDir, 'cover.props.json')
    if (!existsSync(propsPath)) throw new Error('项目尚无 cover.props.json——先按用户需求写 props 再渲染预览')
    const doc = JSON.parse(readFileSync(propsPath, 'utf8'))
    const props = { ...(doc.props && typeof doc.props === 'object' ? doc.props : {}) }
    if (Array.isArray(doc.hiddenLayers)) props.hiddenLayers = doc.hiddenLayers
    const fileName = typeof args?.fileName === 'string' && args.fileName.trim() ? args.fileName.trim() : `preview-${Date.now()}.png`
    /* 子进程渲染:合并后的 props 落临时文件走引擎 CLI(@文件形态=纯 props 对象), 用完即清。
       注入的 renderCover(测试缝)=跳过子进程, 语义同引擎 renderCover({templateId,props,fileName,outDir})。 */
    const pluginDir = resolvePluginDir()
    let result
    if (typeof renderCoverInjected === 'function') {
      result = await renderCoverInjected({ templateId: String(doc.templateId || ''), props, fileName, outDir: coverDir })
    } else {
      if (!pluginDir) throw new Error('封面插件目录不存在')
      const propsFile = join(coverDir, `.render-props-${Date.now()}.json`)
      writeFileSync(propsFile, JSON.stringify(props, null, 1))
      try {
        result = await runEngineRender({
          engineCliPath: join(pluginDir, 'dist', 'engine.mjs'),
          templateId: String(doc.templateId || ''),
          propsFile,
          fileName,
          coverDir,
        })
      } finally {
        try { rmSync(propsFile, { force: true }) } catch { /* 清理失败不阻断 */ }
      }
    }
    if (!result?.ok || !result.file || !existsSync(result.file)) {
      throw new Error(`渲染失败:${result?.error ?? '未知错误'}`)
    }
    const bytes = readFileSync(result.file)
    /* 预览同样过模型侧上限(1112 修复批): 大画布/复杂底图可能超 2.5MB, 超限不返回 image
       块(否则 harness base64 正则栈溢出), 改文字提示且明确"不得声称已完成"。 */
    let shrunk = null
    try { shrunk = resize(bytes, magicMime(bytes) ?? 'image/png', { sourcePath: result.file }) } catch { /* 压缩失败按原图判断 */ }
    const dataBytes = shrunk?.bytes ?? bytes
    if (dataBytes.length > MODEL_SAFE_RAW_BYTES) {
      return {
        content: [{
          type: 'text',
          text: `预览已渲染但无法送入模型查看：${result.file}（原图 ${(bytes.length / 1024 / 1024).toFixed(1)} MB，压缩后 ${(dataBytes.length / 1024 / 1024).toFixed(1)} MB，模型可读上限 ${(MODEL_SAFE_RAW_BYTES / 1024 / 1024).toFixed(1)} MB）。`
            + '不要声称已完成：请让用户在画布上确认文字不溢出、图层位置正确；或缩小画布/底图后再 render_preview 回看。',
        }],
      }
    }
    return {
      content: [
        { type: 'image', data: dataBytes.toString('base64'), mimeType: shrunk?.mime ?? 'image/png' },
        { type: 'text', text: `预览:${result.file}(${bytes.length} bytes,templateId=${doc.templateId})${imageMetaText(shrunk)}。完成判据:确认文字不溢出、图层位置符合用户要求、画面成立后才能向用户报告完成;不合格继续修,修完再渲染回看。` },
      ],
    }
  }

  const tools = [
    {
      name: 'read_image',
      description: '查看项目目录或素材位里的图片(生成结果/素材/导出图), 返回图片本体。凡要对图片下结论, 先用本工具看图, 不要用 pwsh 读像素。大图会自动压缩到模型可读尺寸(长边≤2000、≤2.5MB);仍超限时返回文字提示(不附图), 按提示请用户缩小或改用 matting / imitate_cover。',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: '图片绝对路径, 或项目目录/素材位内的文件名' } }, required: ['path'] },
    },
    {
      name: 'matting',
      description: '抠图/去背景(服务端 /matting)。内置健康模型链 isnet-general-use→u2net→isnet-anime(1104 实测 bria/silueta 服务端崩溃), 自动换备选; 带落盘校验(状态+PNG 魔数), 失败返回错误原文。产物=透明底 PNG, 落素材区+项目目录; 是否上图由用户决定。',
      inputSchema: { type: 'object', properties: { image: { type: 'string', description: '源图绝对路径(项目目录内)或素材文件名' }, model: { type: 'string', description: '可选, 指定单一模型(不指定=自动链)' } }, required: ['image'] },
    },
    {
      name: 'render_preview',
      description: '渲染当前 cover.props.json 为预览图并返回图片本体;fileName 可指定即=导出。完成判据: 凡改动 props/落位图片后必须调用本工具查看, 确认无误才能向用户报告完成。超大预览会自动压缩;压缩后仍超模型上限时返回文字提示(不附图), 此时不得声称已完成。',
      inputSchema: { type: 'object', properties: { fileName: { type: 'string', description: '可选, 输出文件名(缺省 preview-<时间戳>.png, 落项目目录)' } } },
    },
    {
      name: 'imitate_cover',
      description: '仿封面生成·提交(服务端 /generate/cover 编排):上传参考图→按文案提交生成任务→立即返回 task_id(不等待)。普通档(缺省):images 1..4 张(第一张建议参考封面,其余产品/人物图)。人物档(subject="person"):images 恰 1 张人物正脸图,引擎人脸身份锚定+相似度门(换人=任务失败,完成态结果回显 face_similarity 分值)。风格迁移:style_image=风格参考封面(+style_weight 0.4/0.6/0.8),与 images/subject 分参数同传——不要把风格封面塞进 images。prompt 禁写人物外貌(外貌描述=画陌生人)。参数:images(必填)+文案至少其一(title/prompt/selling_points)。提交后立即用 imitate_cover_wait 等待终态落盘。分钟级耗时。',
      inputSchema: { type: 'object', properties: {
        images: { type: 'array', items: { type: 'string' }, description: '参考图路径(项目目录/素材位文件名或绝对路径);普通档 1..4 张,人物档(subject=person)恰 1 张人物正脸图' },
        subject: { type: 'string', enum: ['person', 'product'], description: '可选,人物档传 "person"(人物身份锚定,恰 1 张人物正脸图);缺省=普通档' },
        style_image: { type: 'string', description: '可选,风格参考封面路径(与 images 分参数;风格迁移由服务端引擎注入,勿塞进 images)' },
        style_weight: { type: 'number', description: '可选,风格权重 0..1(建议 0.4/0.6/0.8,引擎映五档);需与 style_image 同传' },
        title: { type: 'string', description: '主标题文案(与 prompt/selling_points 至少其一)' },
        prompt: { type: 'string', description: '画面/动作/构图描述;人物档下禁写人物外貌(脸/发型/服装/配饰)' },
        selling_points: { type: 'array', items: { type: 'string' }, description: '卖点短语数组(角标文案)' },
      }, required: ['images'] },
    },
    {
      name: 'imitate_cover_wait',
      description: '仿封面等待/落盘(与 imitate_cover 配对):task_id → 服务端统一任务轮询 → completed 即下载产物落素材区+项目目录并回显(含 face_similarity)。单次默认等 420s,未到终态返回 settled:false——再次调用本工具(同 task_id)即续等,任务不丢失;failed/cancelled 返回服务端错误原文。cancel=true 显式取消服务端任务(用户改主意时用)。可选 subject 透传提交档位(person 档回显人物门文案),timeout_s 30..540。',
      inputSchema: { type: 'object', properties: {
        task_id: { type: 'string', description: 'imitate_cover 返回的 taskId' },
        subject: { type: 'string', enum: ['person', 'product'], description: '可选,回显提交时的档位(person 档结果附人物门说明)' },
        timeout_s: { type: 'number', description: '可选,本次最长等待秒数(默认 420,上限 540);到点未终态返回 settled:false 可续等' },
        cancel: { type: 'boolean', description: '可选,true=取消该服务端任务(batch_cancel),不再等待' },
      }, required: ['task_id'] },
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
    if (name === 'imitate_cover_wait') return imitateCoverWait(args, { pollIntervalMs })
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
export function registerCoverToolsMcp({ webServer, isTrustedRequest, sendJson, getServerUrl, loadEngine, resolvePluginDir, resize, renderCover }) {
  const handleRpc = createCoverToolsRpc({ getServerUrl, loadEngine, resolvePluginDir, ...(resize ? { resize } : {}), ...(renderCover ? { renderCover } : {}) })
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
export function startCoverToolsServer({ getServerUrl, loadEngine, resolvePluginDir, resize, renderCover, port = 0 }) {
  const token = randomUUID().replaceAll('-', '')
  const handleRpc = createCoverToolsRpc({ getServerUrl, loadEngine, resolvePluginDir, ...(resize ? { resize } : {}), ...(renderCover ? { renderCover } : {}) })
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
