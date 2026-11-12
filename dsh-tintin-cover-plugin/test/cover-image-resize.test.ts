// cover-image-resize 用例(2026-11-12 封面参考批方案 3;1112 修复批:模型侧硬上限+
// ffmpeg 后备)。nativeImage 以桩注入(node/vitest 环境无 electron);ffmpeg 以
// runScale 桩注入(真件路径由宿主实机承载, 见 scripts 手工验证)。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MODEL_SAFE_RAW_BYTES, dimensionsOf, imageMetaText, modelTooLargeText, shrinkForModelRead,
} from '../lib/cover-image-resize.js'

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** 尺寸/编码行为可编排的 nativeImage 桩 */
function fakeImage(width: number, height: number, opts: { png?: Buffer; jpeg?: Record<number, Buffer>; resizedWidth?: number; resizedHeight?: number } = {}) {
  const img = {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: (_o: { width: number; height: number }) => fakeImage(opts.resizedWidth ?? Math.round(width / 2), opts.resizedHeight ?? Math.round(height / 2), opts),
    toPNG: () => opts.png ?? TINY_PNG,
    toJPEG: (quality: number) => opts.jpeg?.[quality] ?? TINY_PNG,
  }
  return img
}
const fakeNative = (img: ReturnType<typeof fakeImage>) => ({ createFromBuffer: () => img })

/** 构造带正确 PNG IHDR 的字节块(尺寸可读, 总长可控) */
function pngBytes(width: number, height: number, size: number): Buffer {
  const b = Buffer.alloc(Math.max(33, size))
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  b[24] = 8
  b[25] = 6
  return b
}

const OVER = 4 * 1024 * 1024 // > 2.5MB 模型安全上限

describe('cover-image-resize', () => {
  it('模型安全上限口径: 2.5MB 的 base64(≈3.34MB)低于 harness 正则栈上限(~4.25MB)', () => {
    expect(MODEL_SAFE_RAW_BYTES).toBe(2.5 * 1024 * 1024)
    expect(Math.ceil(MODEL_SAFE_RAW_BYTES / 3) * 4).toBeLessThan(4.25 * 1024 * 1024)
  })

  it('无解码器且无 ffmpeg/sourcePath 时 fail-open: 返回 null=原字节(调用方按上限拒)', () => {
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/png', { createNativeImage: () => null })).toBeNull()
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/jpeg', { createNativeImage: () => null })).toBeNull()
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/webp', { createNativeImage: () => null })).toBeNull()
  })

  it('达标小图直通: ≤2.5MB 且长边 ≤2000 不动', () => {
    const small = fakeImage(1920, 1080)
    expect(shrinkForModelRead(TINY_PNG, 'image/png', { createNativeImage: () => fakeNative(small) })).toBeNull()
  })

  it('小图超分辨率也缩(省 token): 长边>2000 先 resize 至 2000 等比', () => {
    let resized: { width: number; height: number } | null = null
    const input = pngBytes(4000, 2000, 64) // 字节很小但尺寸 4000x2000(尺寸来自 PNG 头)
    const img = fakeImage(4000, 2000, { png: TINY_PNG })
    const spy = { ...img, resize: (o: { width: number; height: number }) => { resized = o; return fakeImage(o.width, o.height, { png: TINY_PNG }) } }
    const out = shrinkForModelRead(input, 'image/png', { createNativeImage: () => fakeNative(spy as never) })
    expect(out).not.toBeNull()
    expect(resized).toEqual({ width: 2000, height: 1000 })
    expect(out!.original).toEqual({ width: 4000, height: 2000 })
    expect(out!.scaled).toEqual({ width: 2000, height: 1000 })
    expect(out!.mime).toBe('image/png')
    expect(out!.via).toBe('native')
  })

  it('JPEG 质量阶梯: q80 超阈值 → 降到首个达标档', () => {
    const big = Buffer.alloc(OVER + 1)
    const ok = Buffer.alloc(1024)
    const img = fakeImage(2000, 1500, { jpeg: { 80: big, 60: ok } })
    const out = shrinkForModelRead(Buffer.alloc(OVER), 'image/jpeg', { createNativeImage: () => fakeNative(img) })
    expect(out).not.toBeNull()
    expect(out!.bytes).toBe(ok)
    expect(out!.mime).toBe('image/jpeg')
  })

  it('压缩后仍超 8MB 硬上限 → 抛人话错误', () => {
    const huge = Buffer.alloc(9 * 1024 * 1024)
    const img = fakeImage(2000, 1500, { jpeg: { 80: huge, 60: huge, 40: huge, 20: huge } })
    expect(() => shrinkForModelRead(Buffer.alloc(OVER), 'image/jpeg', { createNativeImage: () => fakeNative(img) }))
      .toThrow(/仍超 8MB 上限/)
  })

  it('解码失败(空图)→ 无 ffmpeg 时 fail-open', () => {
    const empty = { createFromBuffer: () => ({ isEmpty: () => true }) }
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/png', { createNativeImage: () => empty as never })).toBeNull()
  })

  it('ffmpeg 后备: nativeImage 不可用 + 大图 → 阶梯缩放, 首个达标即停(带尺寸换算元信息)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resize-test-'))
    try {
      const src = join(dir, 'big.png')
      writeFileSync(src, pngBytes(3840, 2160, OVER))
      const sides: number[] = []
      const runScale = ({ out, side }: { out: string; side: number }) => {
        sides.push(side)
        writeFileSync(out, pngBytes(2000, 1125, 512 * 1024)) // 512KB 达标
        return { ok: true }
      }
      const out = shrinkForModelRead(pngBytes(3840, 2160, OVER), 'image/png', {
        createNativeImage: () => null, sourcePath: src, ffmpegPath: 'ffmpeg-stub', runScale,
      })
      expect(out).not.toBeNull()
      expect(out!.via).toBe('ffmpeg')
      expect(out!.mime).toBe('image/png')
      expect(out!.original).toEqual({ width: 3840, height: 2160 })
      expect(out!.scaled).toEqual({ width: 2000, height: 1125 })
      expect(sides).toEqual([2000]) // 首个就达标, 不继续降
      expect(imageMetaText(out)).toContain('3840x2160')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ffmpeg 后备: webp 转 PNG 送阅(nativeImage 不解码 webp)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resize-webp-'))
    try {
      const src = join(dir, 'big.webp')
      writeFileSync(src, Buffer.alloc(OVER, 1))
      const runScale = ({ out }: { out: string }) => { writeFileSync(out, pngBytes(1500, 844, 400 * 1024)); return { ok: true } }
      const out = shrinkForModelRead(Buffer.alloc(OVER, 1), 'image/webp', {
        createNativeImage: () => null, sourcePath: src, ffmpegPath: 'ffmpeg-stub', runScale,
      })
      expect(out).not.toBeNull()
      expect(out!.via).toBe('ffmpeg')
      expect(out!.mime).toBe('image/png')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ffmpeg 不在/失败 → null(调用方改文字提示)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resize-nofm-'))
    try {
      const src = join(dir, 'big.png')
      writeFileSync(src, pngBytes(3840, 2160, OVER))
      expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/png', { createNativeImage: () => null, sourcePath: src, ffmpegPath: '' })).toBeNull()
      expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/png', {
        createNativeImage: () => null, sourcePath: src, ffmpegPath: 'ffmpeg-stub', runScale: () => ({ ok: false }),
      })).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('dimensionsOf: PNG IHDR / JPEG SOF 可读;坏头返回 null', () => {
    expect(dimensionsOf(pngBytes(1080, 1440, 64), 'image/png')).toEqual({ width: 1080, height: 1440 })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x01, 0x2c, 0, 0, 0, 0, 0])
    expect(dimensionsOf(jpeg, 'image/jpeg')).toEqual({ width: 300, height: 100 })
    expect(dimensionsOf(Buffer.from([1, 2, 3]), 'image/png')).toBeNull()
  })

  it('imageMetaText: 缩放时给坐标换算提示;未缩放为空串', () => {
    expect(imageMetaText(null)).toBe('')
    const text = imageMetaText({ bytes: TINY_PNG, mime: 'image/png', original: { width: 4000, height: 2000 }, scaled: { width: 2000, height: 1000 } })
    expect(text).toContain('原始 4000x2000')
    expect(text).toContain('已缩放至 2000x1000')
    expect(text).toContain('2.000')
    expect(text).toContain('box_rel')
  })

  it('modelTooLargeText: 说明原图/压缩后/上限与两条处置', () => {
    const text = modelTooLargeText('a.png', 5.5 * 1024 * 1024, MODEL_SAFE_RAW_BYTES, 3 * 1024 * 1024)
    expect(text).toContain('无法查看该图')
    expect(text).toContain('原图 5.5 MB')
    expect(text).toContain('压缩后 3.0 MB')
    expect(text).toContain('2.5 MB')
    expect(text).toContain('matting')
    expect(text).toContain('imitate_cover')
  })
})
