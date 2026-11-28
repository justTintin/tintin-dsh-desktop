// A-Roll 声波对齐器（2026-11-27 用户裁决「声音的对齐就是声波」）────────────────
// 背景：切窗音频只是生成驱动信号——生成按帧进行，产物口型时序与驱动音频存在帧级
// 偏移，且元数据（切窗/脚本窗/时长估算）都不是实测锚点；槽位若按元数据摆放，误差
// 跨镜累积。唯一可信锚点 = 产物自带音轨的实测波形。
// 用法（宿主侧）：ffmpeg 抽单声道低采样率 PCM（-f s16le pipe 不落盘）→ 峰值包络
// → 归一化互相关（NCC）定位每条 aroll 音轨在整段旁白时间轴上的真实起点。
// 前提 = 服务端把切窗音频 mux 进产物（§16.80 补记④）；产物无音轨时 matched=false，
// 调用方回退估算窗。对齐后：Σ槽位 = 旁白时长（实测恒等），口型与声音零累积漂移。

import { spawn } from 'node:child_process'

/** 相关分 ≥ 此值视为匹配成功（同源波形峰值≈1，无关波形≈0 附近） */
export const MATCH_SCORE_MIN = 0.45

/** s16le 单声道 PCM → 峰值包络（envRate Hz）。纯函数可单测。 */
export function pcmBytesToEnvelope(bytes, srcRate, envRate = 100) {
  const n = Math.floor(bytes.length / 2)
  if (n <= 0 || !(envRate > 0) || !(srcRate > 0)) return new Float64Array(0)
  const step = Math.max(1, Math.round(srcRate / envRate))
  const outLen = Math.max(1, Math.floor(n / step))
  const out = new Float64Array(outLen)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < outLen; i++) {
    let peak = 0
    const j0 = i * step
    const j1 = Math.min(n, j0 + step)
    for (let j = j0; j < j1; j++) {
      const v = Math.abs(view.getInt16(j * 2, true))
      if (v > peak) peak = v
    }
    out[i] = peak / 32768
  }
  return out
}

/** 归一化（去均值/单位方差）：互相关前处理。纯函数可单测。 */
export function normalizeEnvelope(env) {
  const n = env.length
  if (!n) return env
  let mean = 0
  for (let i = 0; i < n; i++) mean += env[i]
  mean /= n
  let varSum = 0
  for (let i = 0; i < n; i++) { const d = env[i] - mean; varSum += d * d }
  const std = Math.sqrt(varSum / n) || 1
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = (env[i] - mean) / std
  return out
}

/** NCC 定位：segEnv 在 narrEnv 中的最佳起点（秒）。[fromSec,toSec) 限定搜索窗
 *  （调用方应传入估算位置 ±2s 防假匹配）。返回 { offsetSec, score }：score=归一化
 *  互相关峰值（同源≈1）；无有效窗/长度非法时 offsetSec=-1。纯函数可单测。 */
export function bestAlignOffset(narrEnv, segEnv, envRate = 100, fromSec = 0, toSec = Infinity) {
  const Nn = narrEnv.length
  const Ns = segEnv.length
  if (!Nn || !Ns || Ns > Nn) return { offsetSec: -1, score: -1 }
  const from = Math.max(0, Math.floor(fromSec * envRate))
  const to = Math.min(Nn - Ns, Math.ceil((Number.isFinite(toSec) ? toSec : Nn / envRate) * envRate))
  if (to < from) return { offsetSec: -1, score: -1 }
  let sm = 0
  for (let i = 0; i < Ns; i++) sm += segEnv[i]
  sm /= Ns
  let sv = 0
  for (let i = 0; i < Ns; i++) { const d = segEnv[i] - sm; sv += d * d }
  const sStd = Math.sqrt(sv) || 1
  let bestScore = -1
  let bestOff = -1
  for (let t = from; t <= to; t++) {
    let am = 0
    for (let i = 0; i < Ns; i++) am += narrEnv[t + i]
    am /= Ns
    let num = 0
    let av = 0
    for (let i = 0; i < Ns; i++) {
      const d = narrEnv[t + i] - am
      num += d * (segEnv[i] - sm)
      av += d * d
    }
    const denom = Math.sqrt(av) * sStd
    const score = denom > 0 ? num / denom : -1
    if (score > bestScore) { bestScore = score; bestOff = t }
  }
  return { offsetSec: bestOff / envRate, score: bestScore }
}

/** ffmpeg 抽单声道 PCM（s16le pipe，不落盘）→ Buffer。 */
function extractPcm(ffmpegPath, file, rate) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1'], { windowsHide: true })
    const chunks = []
    proc.stdout.on('data', (c) => chunks.push(c))
    proc.on('error', () => resolve(null))
    proc.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks) : null))
  })
}

/** 批量对齐编排：整段旁白 + 每条 aroll 产物 → 各镜实测起点窗。
 *  arollProducts: Array<{ path: string, estStartSec?: number, estDurSec?: number }>
 *  （est* 为估算位置 ±2s 限窗防假匹配；缺省=全范围搜索）。
 *  返回 { results: Array<{ path, offsetSec, durSec, score, matched }> }：
 *  matched = score ≥ MATCH_SCORE_MIN 且有实测时长（产物含音轨）。 */
export async function alignArollAudioToNarration({ ffmpegPath, narrationWav, arollProducts, envRate = 100 }) {
  const results = []
  const narrPcm = await extractPcm(ffmpegPath, narrationWav, envRate)
  if (!narrPcm) {
    for (const p of arollProducts || []) results.push({ path: p.path, offsetSec: -1, durSec: 0, score: -1, matched: false })
    return { results }
  }
  const narrEnv = normalizeEnvelope(pcmBytesToEnvelope(narrPcm, envRate, envRate))
  for (const p of arollProducts || []) {
    const pcm = await extractPcm(ffmpegPath, p.path, envRate)
    if (!pcm) { results.push({ path: p.path, offsetSec: -1, durSec: 0, score: -1, matched: false }); continue }
    const segEnv = normalizeEnvelope(pcmBytesToEnvelope(pcm, envRate, envRate))
    const est = Number(p.estStartSec) || 0
    const estDur = Number(p.estDurSec) || 0
    // 生成偏移跨镜累积可达秒级——搜索窗 ±30s 容纳；NCC 同源判别力足够防假匹配
    const { offsetSec, score } = bestAlignOffset(
      narrEnv, segEnv, envRate,
      Math.max(0, est - 30),
      est + estDur + 30,
    )
    const matched = score >= MATCH_SCORE_MIN && offsetSec >= 0
    results.push({ path: p.path, offsetSec, durSec: matched ? segEnv.length / envRate : 0, score, matched })
  }
  return { results }
}
