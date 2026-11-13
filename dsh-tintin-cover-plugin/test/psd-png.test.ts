// RGBA→PNG 内置编码回归(2026-11-13):PSD 上传建模板的底图生成不依赖 PhotoCraft——
// 编码器=纯内置(zlib deflate+手写 PNG 块),本测试解回去验证像素与结构。
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeRgbaPng } from '../lib/psd-png.js'

describe('encodeRgbaPng', () => {
  it('产出合法 PNG(签名/IEND)且像素可解回', () => {
    const width = 2
    const height = 2
    // 2×2 RGBA:红、绿、蓝、半透明白
    const data = Buffer.from([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 128,
      255, 255, 255, 64,
    ])
    const png = encodeRgbaPng(width, height, data)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.subarray(png.length - 8, png.length - 4)).toEqual(Buffer.from('IEND', 'ascii'))
    // 手动解 IDAT(跳过 8 字节签名+IHDR 块 25 字节:长度4+类型4+数据13+CRC4)
    const ihdrLen = png.readUInt32BE(8)
    let offset = 8 + 12 + ihdrLen
    const idatChunks: Buffer[] = []
    while (offset < png.length) {
      const len = png.readUInt32BE(offset)
      const type = png.toString('ascii', offset + 4, offset + 8)
      if (type === 'IDAT') idatChunks.push(png.subarray(offset + 8, offset + 8 + len))
      offset += 12 + len
    }
    const { inflateSync } = require('node:zlib') as { inflateSync: typeof import('node:zlib').inflateSync }
    const raw = inflateSync(Buffer.concat(idatChunks))
    expect(raw.length).toBe((width * 4 + 1) * height)
    // 像素逐行还原(每行行首 1 字节滤波 None,跳过)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width * 4; x++) {
        expect(raw[y * (width * 4 + 1) + 1 + x]).toBe(data[y * width * 4 + x])
      }
    }
  })
})
