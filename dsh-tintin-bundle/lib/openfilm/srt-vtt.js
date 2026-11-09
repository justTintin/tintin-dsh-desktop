// srt-vtt.js — SRT → WebVTT 旁挂字幕转换（2026-11-07 用户需求：文案混剪导出
// OpenFilm 项目携带字幕轨）。OpenFilm 的 film.html 严格解析不收文本元素
// （film-doc 只认 iframe/video/img/audio），字幕的正统载体 = 媒体同目录同名
// .vtt（SPEC §Words）。混剪的口播 wav 整段挂 at 不裁剪，SRT cue 走的是 wav
// 自身秒 → 1:1 抄写零时间换算。纯函数便于单测。

const pad = (n, w) => String(n).padStart(w, '0')

/** 单个时间戳 "HH:MM:SS,mmm"（兼容 "." 毫秒、缺位补零）→ "HH:MM:SS.mmm"；非法返回 '' */
function toVttTime(raw) {
  const m = /^\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*$/.exec(String(raw || ''))
  if (!m) return ''
  return `${pad(Number(m[1]), 2)}:${pad(Number(m[2]), 2)}:${pad(Number(m[3]), 2)}.${pad(Number(m[4].padEnd(3, '0')), 3)}`
}

/**
 * SRT 文本 → WebVTT 文本。容错：跳过非 cue 块（纯序号/广告行）、时间行缺失或
 * 不可解析的块、无正文的块；毫秒逗号→点统一。没有任何有效 cue 时返回仅头行的
 * 合法空 VTT（调用方按需判空拒绝写入）。
 */
export function srtToVtt(content) {
  const cues = []
  for (const block of String(content || '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) continue
    const timing = lines.findIndex((l) => l.includes('-->'))
    if (timing < 0) continue
    const [from, to] = lines[timing].split('-->')
    const a = toVttTime(from)
    const b = toVttTime(to)
    if (!a || !b) continue
    const text = lines.slice(timing + 1).join('\n').trim()
    if (!text) continue
    cues.push(`${a} --> ${b}\n${text}`)
  }
  return `WEBVTT\n\n${cues.length ? cues.join('\n\n') + '\n' : ''}`
}
