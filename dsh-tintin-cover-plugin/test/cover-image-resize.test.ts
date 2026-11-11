// cover-image-resize 用例(2026-11-12 封面参考批方案 3):进模型前的压缩阶梯。
// nativeImage 以桩注入(node/vitest 环境无 electron,真件路径由宿主实机承载);
// 桩只模拟 getSize/resize/toPNG/toJPEG 的形状契约。
import { describe, expect, it } from 'vitest'
import { imageMetaText, shrinkForModelRead } from '../lib/cover-image-resize.js'

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

const OVER = 4 * 1024 * 1024 // > 3.75MB 阈值

describe('cover-image-resize', () => {
  it('无解码器(node/vitest 环境)fail-open: PNG/JPEG 大图返回 null=原字节直通', () => {
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/png')).toBeNull()
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/jpeg')).toBeNull()
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/webp')).toBeNull()
  })

  it('达标小图直通: ≤3.75MB 且长边 ≤2000 不动;webp 恒直通', () => {
    const small = fakeImage(1920, 1080)
    expect(shrinkForModelRead(TINY_PNG, 'image/png', { createNativeImage: () => fakeNative(small) })).toBeNull()
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/webp', { createNativeImage: () => fakeNative(small) })).toBeNull()
  })

  it('小图超分辨率也缩(省 token): 长边>2000 触发 resize 至 2000 等比', () => {
    let resized: { width: number; height: number } | null = null
    const img = fakeImage(4000, 2000, { png: TINY_PNG })
    // 捕获 resize 入参
    const spy = { ...img, resize: (o: { width: number; height: number }) => { resized = o; return fakeImage(o.width, o.height, { png: TINY_PNG }) } }
    const out = shrinkForModelRead(TINY_PNG, 'image/png', { createNativeImage: () => fakeNative(spy as never) })
    expect(out).not.toBeNull()
    expect(resized).toEqual({ width: 2000, height: 1000 })
    expect(out!.original).toEqual({ width: 4000, height: 2000 })
    expect(out!.scaled).toEqual({ width: 2000, height: 1000 })
    expect(out!.mime).toBe('image/png')
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

  it('解码失败(空图)→ fail-open 直通', () => {
    const empty = { createFromBuffer: () => ({ isEmpty: () => true }) }
    expect(shrinkForModelRead(Buffer.alloc(OVER), 'image/png', { createNativeImage: () => empty as never })).toBeNull()
  })

  it('imageMetaText: 缩放时给坐标换算提示;未缩放为空串', () => {
    expect(imageMetaText(null)).toBe('')
    const text = imageMetaText({ bytes: TINY_PNG, mime: 'image/png', original: { width: 4000, height: 2000 }, scaled: { width: 2000, height: 1000 } })
    expect(text).toContain('原始 4000x2000')
    expect(text).toContain('已缩放至 2000x1000')
    expect(text).toContain('2.000')
    expect(text).toContain('box_rel')
  })
})
