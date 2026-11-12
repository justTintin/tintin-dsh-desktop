// cover-image-resize — read_image / render_preview 的「进模型前」压缩阶梯
// (2026-11-12 封面参考批方案 3;同日 1112 修复批:模型侧硬上限 + ffmpeg 后备)。
//
// 背景(实机取证):原生路径解码器是 Electron nativeImage, 但封面工具 MCP 跑在 Harness
// 宿主(Node utility process)里, `require('electron')` 拿不到 API → nativeImage 恒 null
// → 旧实现 fail-open 原字节直通。5.5MB/3840×2160 人物照因此原样进了 dsh-mcp-client,
// 其 canonical-base64 正则(`^(?:[A-Za-z0-9+/]{4})*…$`)在 ~4.25MB 串上抛
// "Maximum call stack size exceeded" → 图片对模型不可见(1108 会话事故链一环)。
//
// 现在两层:
//   ① nativeImage(桌面主进程内若可用) —— 原阶梯保留;
//   ② ffmpeg 后备(宿主里真实可用: 打包产物 resources/bin/ffmpeg.exe, 亦认 PATH/env)
//      —— 按 2000→1500→1200→1000→800 长边阶梯缩放并重编码, 取首个 ≤ 目标字节的产物。
// 若两条路都压不到 MODEL_SAFE_RAW_BYTES 以内, 调用方(read_image/render_preview)不再
// 返回 image 块, 改回一段明确的中文提示(让模型能转述用户并换路), 绝不把超限图送进 MCP。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** 模型侧安全上限(原始字节): 2.5MB → base64 ≈3.34MB, 距 harness 正则栈上限(~4.25MB)有裕量。 */
export const MODEL_SAFE_RAW_BYTES = 2.5 * 1024 * 1024
/** 送阅长边上限(超过则缩;省 token 也压字节)。 */
export const MODEL_SAFE_MAX_SIDE = 2000
const READ_HARD_CAP = 8 * 1024 * 1024
/* 内部名沿用旧阶梯(目标字节=模型安全上限) */
const TARGET_RAW_BYTES = MODEL_SAFE_RAW_BYTES
const MAX_SIDE = MODEL_SAFE_MAX_SIDE

let nativeImageCache
/** Electron nativeImage(桌面主进程真件);拿不到返回 null(结果缓存,不反复试)。 */
export function loadNativeImage() {
  if (nativeImageCache !== undefined) return nativeImageCache
  try {
    const mod = createRequire(import.meta.url)('electron')
    nativeImageCache = mod && typeof mod === 'object' && typeof mod.nativeImage?.createFromBuffer === 'function' ? mod.nativeImage : null
  } catch {
    nativeImageCache = null
  }
  return nativeImageCache
}

/** ffmpeg 候选: env → 打包 resources/bin → exe 旁的 resources/bin → PATH。
 *  结果缓存(找不到也缓存,避免每次读图都 stat/spawn)。 */
let ffmpegCache
export function resolveFfmpeg(env = process.env) {
  if (ffmpegCache !== undefined) return ffmpegCache
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates = [
    env.TINTIN_FFMPEG_PATH,
    process.resourcesPath ? join(process.resourcesPath, 'bin', exe) : '',
    join(dirname(process.execPath), 'resources', 'bin', exe),
    join(dirname(process.execPath), 'bin', exe),
  ].filter((p) => typeof p === 'string' && p.length > 0)
  for (const candidate of candidates) {
    if (existsSync(candidate)) { ffmpegCache = candidate; return candidate }
  }
  /* PATH 兜底: 真跑一次 -version(有的机器有同名假文件) */
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-version'], { timeout: 8000, windowsHide: true, encoding: 'utf8' })
  ffmpegCache = probe.status === 0 ? 'ffmpeg' : null
  return ffmpegCache
}

/** 测试注入口: 重置缓存(env/资源路径在用例间变化时用)。 */
export function resetResizeCaches() {
  nativeImageCache = undefined
  ffmpegCache = undefined
}

/** 图片尺寸(PNG IHDR / JPEG SOF);不认识返回 null(坐标换算提示随之为空)。 */
export function dimensionsOf(bytes, mime) {
  try {
    if (mime === 'image/png' && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i += 1; continue }
        const marker = bytes[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
        }
        const len = bytes.readUInt16BE(i + 2)
        if (len < 2) return null
        i += 2 + len
      }
    }
  } catch { /* 坏头: 无尺寸 */ }
  return null
}

/** 默认 ffmpeg 缩放执行器(spawnSync;测试注入可替换)。 */
function runFfmpegScale({ ffmpeg, src, out, side, mime }) {
  const vf = `scale='min(${side},iw)':-1:flags=lanczos`
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', vf, '-frames:v', '1']
  if (mime === 'image/jpeg') args.push('-q:v', '3')
  args.push(out)
  const r = spawnSync(ffmpeg, args, { timeout: 60_000, windowsHide: true, encoding: 'utf8' })
  return { ok: r.status === 0 && existsSync(out), stderr: String(r.stderr ?? '').slice(-300) }
}

/**
 * 进模型前的缩放/压缩。
 * @param {Buffer} bytes 原图字节
 * @param {string} mime  magicMime 结果(image/png|image/jpeg|image/webp)
 * @param {object} [options]
 * @param {() => any} [options.createNativeImage] 测试注入
 * @param {string} [options.sourcePath] 原图磁盘路径(ffmpeg 后备必需;调用方都有)
 * @param {string} [options.ffmpegPath] 测试注入
 * @param {(a: any) => {ok: boolean}} [options.runScale] 测试注入
 * @returns {{bytes: Buffer, mime: string, original?: {width:number,height:number}, scaled?: {width:number,height:number}, via: 'native'|'ffmpeg'} | null}
 *          null=无需或无法处理(调用方按原字节判断上限)
 */
export function shrinkForModelRead(bytes, mime, options = {}) {
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return null
  const original = dimensionsOf(bytes, mime)
  const longSide = original ? Math.max(original.width, original.height) : 0
  const needsWork = bytes.length > TARGET_RAW_BYTES || longSide > MAX_SIDE

  /* ① nativeImage(仅 PNG/JPEG;webp nativeImage 不解码)。注意:解码/编码异常要吞掉
     回退 ffmpeg, 但"压缩后仍超 8MB"的硬上限错误不能被吞——所以上限判断放在 try 外。 */
  if (mime !== 'image/webp') {
    const nativeImage = options.createNativeImage ? options.createNativeImage() : loadNativeImage()
    let image = null
    try {
      image = nativeImage ? nativeImage.createFromBuffer(bytes) : null
      if (image && typeof image.isEmpty === 'function' && image.isEmpty()) image = null
    } catch { image = null }
    if (image) {
      if (!needsWork) return null
      let encoded = null
      try { encoded = encodeWithNative(image, mime) } catch { encoded = null }
      if (encoded) {
        if (encoded.bytes.length > READ_HARD_CAP) {
          throw new Error(`图片压缩后仍超 8MB 上限(${encoded.bytes.length} bytes)——请先在编辑器里缩小该图`)
        }
        return { bytes: encoded.bytes, mime, original: encoded.original, scaled: encoded.scaled, via: 'native' }
      }
    }
  }
  if (!needsWork) return null

  /* ② ffmpeg 后备(宿主真实可用路径;webp 顺带转 PNG 以便送阅) */
  const sourcePath = typeof options.sourcePath === 'string' ? options.sourcePath : ''
  if (!sourcePath || !existsSync(sourcePath)) return null
  const ffmpeg = options.ffmpegPath ?? resolveFfmpeg()
  if (!ffmpeg) return null
  const runScale = options.runScale ?? runFfmpegScale
  const outMime = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const ext = outMime === 'image/jpeg' ? 'jpg' : 'png'
  let tmpDir
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'tintin-cover-resize-'))
    let best = null
    for (const side of [2000, 1500, 1200, 1000, 800]) {
      const out = join(tmpDir, `s${side}.${ext}`)
      const r = runScale({ ffmpeg, src: sourcePath, out, side, mime })
      if (!r?.ok || !existsSync(out)) continue
      const outBytes = readFileSync(out)
      if (!best || outBytes.length < best.bytes.length) {
        best = {
          bytes: outBytes,
          mime: outMime,
          original: original ?? undefined,
          scaled: original ? scaledSize(original, side) : undefined,
          via: 'ffmpeg',
        }
      }
      if (outBytes.length <= TARGET_RAW_BYTES) break
    }
    if (!best) return null
    if (best.bytes.length > READ_HARD_CAP) {
      throw new Error(`图片压缩后仍超 8MB 上限(${best.bytes.length} bytes)——请先在编辑器里缩小该图`)
    }
    return best
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 清理失败不阻断 */ } }
  }
}

/** nativeImage 编码:先等比缩到长边 ≤2000(nativeImage 需宽高同给),再按格式压
 *  (JPEG 质量阶梯 80→60→40→20;PNG 降采样 1500→1200 保透明)。返回 {bytes, original, scaled}。 */
function encodeWithNative(image, mime) {
  const original = image.getSize()
  const long = Math.max(original.width, original.height)
  let work = image
  let size = original
  if (long > MAX_SIDE) {
    const scale = MAX_SIDE / long
    work = image.resize({ width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)) })
    size = work.getSize()
  }
  let out = mime === 'image/jpeg' ? work.toJPEG(80) : work.toPNG()
  if (out.length > TARGET_RAW_BYTES) {
    if (mime === 'image/jpeg') {
      for (const quality of [60, 40, 20]) {
        out = work.toJPEG(quality)
        if (out.length <= TARGET_RAW_BYTES) break
      }
    } else {
      for (const side of [1500, 1200]) {
        const scale = side / Math.max(size.width, size.height)
        if (scale >= 1) break
        work = work.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
        size = work.getSize()
        out = work.toPNG()
        if (out.length <= TARGET_RAW_BYTES) break
      }
    }
  }
  return { bytes: out, original, scaled: size }
}

function scaledSize(size, side) {
  const long = Math.max(size.width, size.height)
  if (!long) return size
  const scale = side / long
  if (scale >= 1) return size
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

/** 缩放元信息(坐标换算提示,供模型把所见像素框换算回原图;claude-code 同款思路)。 */
export function imageMetaText(shrunk) {
  if (!shrunk?.original || !shrunk?.scaled) return ''
  const factor = shrunk.original.width / shrunk.scaled.width
  return ` [Image: 原始 ${shrunk.original.width}x${shrunk.original.height}, 已缩放至 ${shrunk.scaled.width}x${shrunk.scaled.height} 送阅;按所见图报的像素坐标(如 OCR box)需 ×${factor.toFixed(3)} 换算回原图;box_rel 相对比例不受影响。]`
}

/** 送阅后仍超模型安全上限时的统一人话提示(模型可直接转述用户)。
 *  afterBytes=压缩后的字节数(有则说明"压了但仍超",避免用户以为工具没动作)。 */
export function modelTooLargeText(path, rawBytes, limitBytes = MODEL_SAFE_RAW_BYTES, afterBytes) {
  const mb = (n) => (n / 1024 / 1024).toFixed(1)
  const detail = Number.isFinite(afterBytes) && afterBytes > 0 && afterBytes < rawBytes
    ? `原图 ${mb(rawBytes)} MB，压缩后 ${mb(afterBytes)} MB，仍高于模型可读上限 ${mb(limitBytes)} MB`
    : `${mb(rawBytes)} MB，模型可读上限 ${mb(limitBytes)} MB`
  return `无法查看该图（已尝试自动压缩仍超限）：${path}（${detail}）。`
    + '处理方式：①请用户把图片缩到长边 ≤2000px 且 ≤2.5MB 后再试；②或直接把该路径传给 matting / imitate_cover（这两个工具用原图，不需要模型看图）。'
    + '请把这段提示转述给用户，不要静默继续。'
}
