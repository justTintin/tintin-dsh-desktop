// RGBA↔PNG 内置编码/解码回归(2026-11-13 编码 / 2026-11-14 解码:导出 PSD 的像素来源)。
// 编码器=纯内置(zlib deflate+手写 PNG 块);解码器支持 8-bit 0/2/4/6 色型、滤波 0-4,
// 拒绝调色板缺 PLTE/16-bit/隔行(渲染链不产出,报错优于坏图)。
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeRgbaPng, decodeRgbaPng } from '../lib/psd-png.js'

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

describe('decodeRgbaPng', () => {
  it('编码 → 解码回环:RGBA 逐字节一致(含透明像素)', () => {
    const width = 5
    const height = 3
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = (i * 17) % 256
      data[i * 4 + 1] = (i * 53) % 256
      data[i * 4 + 2] = (i * 97) % 256
      data[i * 4 + 3] = i === 7 ? 0 : 255
    }
    const back = decodeRgbaPng(encodeRgbaPng(width, height, data))
    expect(back.width).toBe(width)
    expect(back.height).toBe(height)
    expect(Buffer.from(back.data).equals(Buffer.from(data))).toBe(true)
  })

  /** 手搓 PNG:指定颜色类型/滤波序列,像素流按滤波字节手工生成(解码器唯一真源校验) */
  function handPng(width: number, height: number, colorType: number, truth: Uint8Array, bpp: number): Buffer {
    const stride = width * bpp
    const filtered = Buffer.alloc((stride + 1) * height)
    const prev = new Uint8Array(stride)
    for (let y = 0; y < height; y++) {
      const ft = y % 5 // 逐行轮换 None/Sub/Up/Average/Paeth
      filtered[y * (stride + 1)] = ft
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? truth[y * stride + x - bpp]! : 0
        const up = prev[x]!
        const ul = x >= bpp ? prev[x - bpp]! : 0
        const v = truth[y * stride + x]!
        let b = v
        if (ft === 1) b = v - left
        else if (ft === 2) b = v - up
        else if (ft === 3) b = v - ((left + up) >> 1)
        else if (ft === 4) {
          const p = left + up - ul
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - ul)
          const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul
          b = v - pr
        }
        filtered[y * (stride + 1) + 1 + x] = b & 0xff
      }
      prev.set(truth.subarray(y * stride, (y + 1) * stride))
    }
    const crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 0
      crcTable[n] = c
    }
    const crc32 = (buf: Buffer): number => {
      let x = 0xffffffff
      for (const byte of buf) x = crcTable[(x ^ byte) & 0xff]! ^ (x >>> 8)
      return (x ^ 0xffffffff) >>> 0
    }
    const chunk = (type: string, data: Buffer): Buffer => {
      const out = Buffer.alloc(12 + data.length)
      out.writeUInt32BE(data.length, 0)
      out.write(type, 4, 'ascii')
      data.copy(out, 8)
      out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
      return out
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = colorType
    ihdr[12] = 0
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(filtered)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }

  it('滤波 0-4 逐行轮换(RGBA):手工滤波 fixture 全像素还原', () => {
    const width = 4
    const height = 4
    const truth = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      truth[i * 4] = 10 + i
      truth[i * 4 + 1] = (200 - i * 7) % 256
      truth[i * 4 + 2] = 30 + i * 3
      truth[i * 4 + 3] = 255
    }
    const back = decodeRgbaPng(handPng(width, height, 6, truth, 4))
    expect(Buffer.from(back.data).equals(Buffer.from(truth))).toBe(true)
  })

  it('RGB(色型 2)与灰度(色型 0):扩充成 RGBA', () => {
    const width = 3
    const height = 2
    // RGB:每像素 3 字节
    const rgb = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = 12 * i
      rgb[i * 3 + 1] = 34 + i
      rgb[i * 3 + 2] = 56 * (i + 1) % 256
    }
    const back = decodeRgbaPng(handPng(width, height, 2, rgb, 3))
    expect(back.width).toBe(width)
    for (let i = 0; i < width * height; i++) {
      expect(back.data[i * 4]).toBe(rgb[i * 3])
      expect(back.data[i * 4 + 1]).toBe(rgb[i * 3 + 1])
      expect(back.data[i * 4 + 2]).toBe(rgb[i * 3 + 2])
      expect(back.data[i * 4 + 3]).toBe(255)
    }
    // 灰度:每像素 1 字节 → RGB 相等
    const gray = new Uint8Array(width * height)
    for (let i = 0; i < gray.length; i++) gray[i] = 8 * i + 5
    const backG = decodeRgbaPng(handPng(width, height, 0, gray, 1))
    for (let i = 0; i < width * height; i++) {
      expect(backG.data[i * 4]).toBe(gray[i])
      expect(backG.data[i * 4 + 1]).toBe(gray[i])
      expect(backG.data[i * 4 + 2]).toBe(gray[i])
      expect(backG.data[i * 4 + 3]).toBe(255)
    }
  })

  it('非 RGBA 形态显式拒绝(16-bit/隔行/坏签名),不静默出坏图', () => {
    const width = 2
    const height = 2
    const truth = new Uint8Array(width * height * 4).fill(128)
    // 16-bit:IHDR 位深字节=16(第 4 块数据 byte 8)
    const png16 = handPng(width, height, 6, truth, 4)
    png16[8 + 8 + 8] = 16
    expect(() => decodeRgbaPng(png16)).toThrow(/位深/)
    // 隔行:IHDR 第 12 字节=1
    const pngI = handPng(width, height, 6, truth, 4)
    pngI[8 + 8 + 12] = 1
    expect(() => decodeRgbaPng(pngI)).toThrow(/隔行/)
    // 坏签名
    expect(() => decodeRgbaPng(Buffer.from('not a png at all'))).toThrow(/PNG/)
  })
})
