// psd-png.js — RGBA 像素 ↔ PNG 双向(纯 node 内置:zlib deflate/inflate + 手写 PNG 块,
// 零原生依赖)。两个用途:
//   ① 编码:PSD 上传建模板的底图生成(2026-11-13):PSD 是标准格式,合成图像由 ag-psd
//      纯 JS 解析(PhotoCraft 存盘时内嵌的合成位图),此处只负责打包成 PNG——转换不依赖
//      本机是否安装 PhotoCraft。
//   ② 解码(2026-11-14 封面导出批):导出 PSD 时把 renderStill 产的 PNG 还原成 RGBA,
//      喂给 ag-psd writePsd 生成拍平 PSD。只支持本机渲染链会产出的形态:8-bit、
//      颜色类型 0/2/4/6、无隔行;其余(调色板/16-bit/隔行)显式报错,绝不静默出坏图。
import { deflateSync, inflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** RGBA(8bit/像素)→ PNG Buffer。逐行 0 滤波(None)+deflate,标准 RGB+Alpha。 */
export function encodeRgbaPng(width, height, data) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1)
    raw[o] = 0 // 滤波类型 0=None
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = data[y * stride + x]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型 RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ── 解码(PNG → RGBA):导出 PSD 的前置(2026-11-14)── */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** 每种颜色类型的通道数(本解码器支持的 0/2/4/6;3=调色板不支持) */
const CHANNELS_OF = { 0: 1, 2: 3, 4: 2, 6: 4 }

/** Paeth 预测器(PNG 规范 §6.3) */
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** 把一条已按滤波还原的扫描行(灰/灰+α/RGB)扩充成 RGBA 行 */
function toRgbaRow(row, colorType, width, palette) {
  const out = new Uint8Array(width * 4)
  for (let x = 0; x < width; x++) {
    if (colorType === 6) {
      out[x * 4] = row[x * 4]; out[x * 4 + 1] = row[x * 4 + 1]; out[x * 4 + 2] = row[x * 4 + 2]; out[x * 4 + 3] = row[x * 4 + 3]
    } else if (colorType === 2) {
      out[x * 4] = row[x * 3]; out[x * 4 + 1] = row[x * 3 + 1]; out[x * 4 + 2] = row[x * 3 + 2]; out[x * 4 + 3] = 255
    } else if (colorType === 4) {
      out[x * 4] = row[x * 2]; out[x * 4 + 1] = row[x * 2]; out[x * 4 + 2] = row[x * 2]; out[x * 4 + 3] = row[x * 2 + 1]
    } else {
      const g = row[x]
      if (palette) {
        const i = g * 3
        out[x * 4] = palette[i] ?? 0; out[x * 4 + 1] = palette[i + 1] ?? 0; out[x * 4 + 2] = palette[i + 2] ?? 0
      } else {
        out[x * 4] = g; out[x * 4 + 1] = g; out[x * 4 + 2] = g
      }
      out[x * 4 + 3] = 255
    }
  }
  return out
}

/** PNG Buffer → { width, height, data: Uint8Array(RGBA) }。仅支持 8-bit、颜色类型
 *  0/2/4/6、无隔行;调色板(3)仅在没有更优路径时兜底展开(不含 tRNS 视为全不透明)。
 *  本机渲染链(renderStill=Chromium)只产 8-bit RGBA/RGB 无隔行,超集留余量。 */
export function decodeRgbaPng(buf) {
  if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('不是 PNG 数据(签名不符)')
  let width = 0
  let height = 0
  let colorType = -1
  let bitDepth = -1
  let interlace = -1
  let palette = null
  const idat = []
  let pos = 8
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      palette = new Uint8Array(data)
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (width <= 0 || height <= 0) throw new Error('PNG 缺少 IHDR 或尺寸非法')
  if (bitDepth !== 8) throw new Error(`PNG 位深 ${bitDepth} 不受支持(只支持 8-bit)`)
  if (!(colorType in CHANNELS_OF) && colorType !== 3) throw new Error(`PNG 颜色类型 ${colorType} 不受支持`)
  if (colorType === 3 && !palette) throw new Error('调色板 PNG 缺少 PLTE 块')
  if (interlace !== 0) throw new Error('隔行 PNG 不受支持(渲染链不产出)')
  const channels = colorType === 3 ? 1 : CHANNELS_OF[colorType]
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))))
  const stride = width * channels
  const expected = (stride + 1) * height
  if (raw.length < expected) throw new Error(`PNG 像素流不完整(${raw.length}/${expected})`)
  const out = new Uint8Array(width * height * 4)
  const prev = new Uint8Array(stride) // 上一行(滤波 Up/Average/Paeth 需要;首行全 0)
  const row = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1)
    const ft = raw[base]
    const line = raw.subarray(base + 1, base + 1 + stride)
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0
      const up = prev[x]
      const ul = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (ft === 1) v = (v + left) & 0xff // Sub
      else if (ft === 2) v = (v + up) & 0xff // Up
      else if (ft === 3) v = (v + ((left + up) >> 1)) & 0xff // Average
      else if (ft === 4) v = (v + paeth(left, up, ul)) & 0xff // Paeth
      else if (ft !== 0) throw new Error(`PNG 未知滤波类型 ${ft}`)
      row[x] = v
    }
    out.set(toRgbaRow(row, colorType, width, palette), y * width * 4)
    prev.set(row)
  }
  return { width, height, data: out }
}
