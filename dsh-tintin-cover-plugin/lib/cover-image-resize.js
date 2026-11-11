// cover-image-resize — read_image 的「进模型前」压缩阶梯(2026-11-12 封面参考批,方案 3)。
// 参照 claude-code-main 的 imageResizer 常量口径: 原图 ≤3.75MB(=base64 5MB 上限×3/4)且
// 长边 ≤2000px 直通;超限先等比缩到 2000,再按格式压——JPEG 走质量阶梯 80→60→40→20,
// PNG 走降采样保格式(nativeImage 无调色板 PNG,透明图转 JPEG 会黑底,不冒进)。
// 解码器=Electron nativeImage(宿主插件运行在桌面主进程内);拿不到(单测 node 环境/
// 异常宿主返回字符串)一律 fail-open 返回 null=维持原字节直通,零新依赖零回归。
// WebP nativeImage 不支持解码 → 同样直通(仍受 read_image 8MB 上限约束)。
import { createRequire } from 'node:module'

const TARGET_RAW_BYTES = 3.75 * 1024 * 1024
const MAX_SIDE = 2000
const READ_HARD_CAP = 8 * 1024 * 1024

let nativeImageCache
/** Electron nativeImage(主进程真件);拿不到返回 null(结果缓存,不反复试)。 */
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

/**
 * 进模型前的缩放/压缩。返回 null=无需或无法处理(调用方用原字节);
 * 返回 { bytes, mime, original, scaled }=用压缩产物替换,并据此生成坐标换算元信息。
 * 超过 READ_HARD_CAP 的最终产物抛错(调用方转人话;原行为=超 8MB 直接拒)。
 */
export function shrinkForModelRead(bytes, mime, { createNativeImage } = {}) {
  if (mime !== 'image/png' && mime !== 'image/jpeg') return null
  const nativeImage = createNativeImage ? createNativeImage() : loadNativeImage()
  if (!nativeImage) return null
  const image = nativeImage.createFromBuffer(bytes)
  if (!image || image.isEmpty()) return null
  const original = image.getSize()
  const longSide = Math.max(original.width, original.height)
  /* 直通条件(claude-code 同款): 原图 ≤3.75MB 且长边 ≤2000;小图但超分辨率也要缩(省 token) */
  if (bytes.length <= TARGET_RAW_BYTES && longSide <= MAX_SIDE) return null

  /* 等比缩到长边 2000(nativeImage 需宽高同给;这里显式成对给) */
  let work = image
  let size = original
  if (longSide > MAX_SIDE) {
    const scale = MAX_SIDE / longSide
    work = image.resize({ width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)) })
    size = work.getSize()
  }

  const serialise = (img) => (mime === 'image/jpeg' ? img.toJPEG(80) : img.toPNG())
  let out = serialise(work)
  /* JPEG: 质量阶梯 60→40→20;PNG: 继续降采样 1500→1200(保透明,不转 JPEG) */
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
  if (out.length > READ_HARD_CAP) {
    throw new Error(`图片压缩后仍超 8MB 上限(${out.length} bytes)——请先在编辑器里缩小该图`)
  }
  if (out.length >= bytes.length && size.width === original.width && size.height === original.height) return null
  return { bytes: out, mime, original: { width: original.width, height: original.height }, scaled: { width: size.width, height: size.height } }
}

/** 缩放元信息(坐标换算提示,供模型把所见像素框换算回原图;claude-code 同款思路)。 */
export function imageMetaText(shrunk) {
  if (!shrunk) return ''
  const factor = shrunk.original.width / shrunk.scaled.width
  return ` [Image: 原始 ${shrunk.original.width}x${shrunk.original.height}, 已缩放至 ${shrunk.scaled.width}x${shrunk.scaled.height} 送阅;按所见图报的像素坐标(如 OCR box)需 ×${factor.toFixed(3)} 换算回原图;box_rel 相对比例不受影响。]`
}
