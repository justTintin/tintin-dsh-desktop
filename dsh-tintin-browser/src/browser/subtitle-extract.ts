// subtitle-extract.ts — 下载条目「提取字幕」（2026-11-20 用户裁决：下载栏完成行
// 「打开目录」后加「提取字幕」按钮，调用服务端 /whisper/transcribe 语音转文字，
// 输出字幕文件落盘到同目录；B 站 DASH 双流场景=先下载音频流再转写）。
//
// 流程（主进程，页面经 browser:extractSubtitle 触发）：
//   1. 音频来源：入参 audioUrl（B站双流的音频流）优先；否则 filePath（已落盘的
//      合并 mp4/单文件）直接上传。视频单流（无声）转写会得到空字幕——由调用方
//      （右栏助手卡）保证 dual 条目传 audioUrl。
//   2. 下载音频到临时目录（fetch 流式，B站 CDN 需 Referer）。
//   3. POST <media>/whisper/transcribe multipart（file+language=zh+fmt=json）：
//      JSON 含 segments[].words[] → 生成**字级 ASS**（\k 卡拉OK标签）；
//      JSON 仅 segments（句级）→ 细化 SRT；非 JSON（text/plain SRT）→
//      原样落盘（服务端 200 恒回 SRT 纯文本的历史行为兜底）。
//   4. 字幕落盘 <下载目录>/<同名>.srt|.ass；临时文件清理。
// 从 browser-service 拆出（铁律 4：基线文件只减不增）。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const WHISPER_TIMEOUT_MS = 15 * 60 * 1000 // 长音频转写（7 分钟语音约 1-3 分钟）
const DL_TIMEOUT_MS = 5 * 60 * 1000

function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec - Math.floor(sec)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(2, '0')}`
}

function assTime(sec: number): string {
  return `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}.${String(Math.round((sec - Math.floor(sec)) * 100)).padStart(2, '0')}`
}

/** 字级 words[] → ASS 卡拉OK（逐句一条 Dialogue，字间 \k 标签；间隔 >1.2s 断句） */
function wordsToAssKaraoke(words: Array<{ word?: string; text?: string; start?: number; end?: number }>): string {
  const out: string[] = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', '', '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding', 'Style: Default,Microsoft YaHei,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,60,60,40,1', '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
  let seg: Array<{ w: string; start: number; end: number }> = []
  const flush = (): void => {
    if (!seg.length) return
    const first = seg[0]
    const lastW = seg[seg.length - 1]
    if (!first || !lastW) return
    const start = first.start
    const end = lastW.end
    let text = ''
    let prev = start
    for (const w of seg) {
      const cs = Math.max(1, Math.round((w.end - prev) * 100))
      text += `{\\k${cs}}${w.w}`
      prev = w.end
    }
    out.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`)
    seg = []
  }
  for (const w of words) {
    const word = String(w.word ?? w.text ?? '').trim()
    if (!word) continue
    const start = Number(w.start) || 0
    const end = Number(w.end) || start
    const prevW = seg[seg.length - 1]
    if (seg.length && prevW && start - prevW.end > 1.2) flush()
    seg.push({ w: word, start, end })
  }
  flush()
  return out.join('\n')
}

interface WhisperWord { word?: string; text?: string; start?: number; end?: number }
interface WhisperSegment { start?: number; end?: number; text?: string; words?: WhisperWord[] }

/** fmt=json 响应 → 字幕文本（words→字级 ASS；仅 segments→句级 SRT）；null=非 JSON */
function jsonToSubtitle(data: unknown): { text: string; wordLevel: boolean } | null {
  let obj: unknown = data
  if (typeof data === 'string') {
    const t = data.trim()
    if (!t.startsWith('{') && !t.startsWith('[')) return null
    try { obj = JSON.parse(t) } catch { return null }
  }
  const o = obj as { segments?: WhisperSegment[] } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.segments)) return null
  const words: WhisperWord[] = []
  const srt: string[] = []
  let idx = 1
  for (const seg of o.segments) {
    const start = Number(seg.start) || 0
    const end = Number(seg.end) || start
    const text = String(seg.text || '').trim()
    if (Array.isArray(seg.words)) for (const w of seg.words) words.push(w)
    if (text) srt.push(`${idx++}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`)
  }
  if (words.length >= 4) return { text: wordsToAssKaraoke(words), wordLevel: true }
  if (srt.length) return { text: srt.join('\n\n'), wordLevel: false }
  return null
}

export interface ExtractSubtitleDeps {
  /** 媒体服务端基址（media.serverUrl，三面分面独立口径） */
  serverUrl: () => string
  log: (msg: string) => void
}

export function registerExtractSubtitle(
  ipcMain: { handle(channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>): void },
  deps: ExtractSubtitleDeps,
): void {
  ipcMain.handle('browser:extractSubtitle', async (_e, payload: unknown) => {
    const q = (payload || {}) as { filePath?: unknown; audioUrl?: unknown; referer?: unknown; outDir?: unknown }
    const filePath = String(q.filePath || '')
    const audioUrl = String(q.audioUrl || '')
    const referer = String(q.referer || '')
    const workspaceRoot = process.env.TINTIN_WORKSPACE_DIR || join(process.env.USERPROFILE || process.env.HOME || '.', 'Documents', 'tintin-workspace')
    const rawOut = String(q.outDir || '')
    // 相对 outDir（页面传 materials/bilibili）挂工作区根；绝对路径原样
    const outDir = rawOut && !/^[a-zA-Z]:[\/]/.test(rawOut) && !rawOut.startsWith('/') ? join(workspaceRoot, rawOut) : (rawOut || join(workspaceRoot, 'materials'))
    if (!filePath && !audioUrl) return { success: false, error: '缺少 filePath 或 audioUrl' }
    const server = String(deps.serverUrl() || '').replace(/\/+$/, '')
    if (!server) return { success: false, error: '未配置服务端地址（media.serverUrl）' }

    let uploadPath = filePath
    let tmpFile = ''
    try {
      // 1) 音频流下载到临时（B站双流：audioUrl 优先）
      if (!uploadPath && audioUrl) {
        const ext = /\.m4s$/i.test(audioUrl) ? '.m4a' : '.mp4'
        tmpFile = join(tmpdir(), 'tintin-subtitle-extract', `audio_${Date.now().toString(36)}${ext}`)
        mkdirSync(dirname(tmpFile), { recursive: true })
        const res = await fetch(audioUrl, { headers: referer ? { referer } : {}, signal: AbortSignal.timeout(DL_TIMEOUT_MS) })
        if (!res.ok) throw new Error(`音频流下载失败 HTTP ${res.status}`)
        writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()))
        uploadPath = tmpFile
      }
      if (!uploadPath || !existsSync(uploadPath)) throw new Error('文件不存在')

      // 2) multipart 上传转写（fmt=json 优先：whisper JSON 含 words → 字级 ASS）
      const buf = readFileSync(uploadPath)
      const form = new FormData()
      form.append('file', new File([new Uint8Array(buf)], basename(uploadPath) || 'audio.mp4'))
      form.append('language', 'zh')
      form.append('fmt', 'json')
      deps.log(`subtitle-extract: transcribing ${basename(uploadPath)} (${buf.length}B)`)
      const res = await fetch(`${server}/whisper/transcribe`, { method: 'POST', body: form, signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS) })
      const text = await res.text()
      if (!res.ok) throw new Error(`服务端转写失败 HTTP ${res.status}：${text.slice(0, 200)}`)

      // 3) 字幕文本：JSON words → 字级 ASS；JSON 句级/纯文本 → SRT
      const parsed = jsonToSubtitle(text)
      const body = parsed ? parsed.text : text
      const ext = parsed?.wordLevel ? '.ass' : '.srt'
      const base = basename(uploadPath).replace(/\.[^.\\/]+$/, '')
      const outPath = join(outDir, `${base}${ext}`)
      mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, body, 'utf8')
      deps.log(`subtitle-extract: saved ${outPath} (${parsed?.wordLevel ? 'word-level ASS' : 'SRT'})`)
      return { success: true, srtPath: outPath, wordLevel: parsed?.wordLevel === true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      if (tmpFile) { try { rmSync(tmpFile, { force: true }) } catch { /* ignore */ } }
    }
  })
}
