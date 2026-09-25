// ytdlp-logic.d.ts — 参考视频下载纯逻辑层类型（实现见同目录 ytdlp-logic.js）
export interface YtdlpFormat {
  formatId: string
  ext: string
  vcodec: string
  acodec: string
  width: number
  height: number
  fps: number
  filesize: number
  tbr: number
  abr: number
}

export interface YtdlpProbe {
  id: string
  title: string
  uploader: string
  duration: number
  thumbnail: string
  extractorKey: string
  platform: 'bilibili' | 'youtube'
  webpageUrl: string
  resolution: string
  formats: YtdlpFormat[]
}

export interface YtdlpOption {
  id: string
  mediaType: 'video' | 'audio'
  label: string
  detail: string
  videoFormatId?: string
  audioFormatId?: string
  kbps?: number
  estimatedSize?: number
}

export function isSupportedUrl(rawUrl: unknown): boolean
export function platformFor(extractorKey: unknown): 'bilibili' | 'youtube'
export function platformFromUrl(rawUrl: unknown): 'bilibili' | 'youtube' | ''
export function buildProbeArgs(url: string, proxy: string): string[]
export function buildVideoDownloadArgs(input: {
  url: string; formatId: string; audioFormatId?: string; outTemplate: string; ffmpegDir: string; proxy: string
}): string[]
export function buildAudioDownloadArgs(input: {
  url: string; formatId: string; kbps: number; outTemplate: string; ffmpegDir: string; proxy: string
}): string[]
export function parseProgressLine(line: unknown): { phase: string; pct: number } | null
export function parseProbeJson(json: unknown): YtdlpProbe
export function createDownloadOptions(probe: YtdlpProbe): YtdlpOption[]
export function classifyDownloadError(stderr: unknown): { code: string; stderrTail: string }
export function downloadErrorText(code: string, fallback?: string): string
export function isPlaybackCompatible(info: unknown): boolean
export function buildNormalizeArgs(src: string, dst: string, info: unknown): string[]
export function outTemplateFor(dir: string): string
export function formatBytes(n: number): string
