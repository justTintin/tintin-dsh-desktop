// ffmpeg-gate.d.ts — ffmpeg 探测/剪辑/转码门（CJS→ESM 纯搬迁，源
// desktop/main/ffmpeg-gate.js）。ipcMain 壳已剥离：createFfmpegGateApi 由宿主
// index.js 注入 resolveBinary('ffmpeg'/'ffprobe') 解析出的二进制路径。
export type NativeChannelEntry = (args: unknown[], ctx?: { emit?: (event: Dict) => void }) => Promise<unknown> | unknown
type Dict = Record<string, unknown>
export interface FfmpegProbeInfo {
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  audio_bitrate: number
  via?: string
}
export interface FfmpegParsedInfo {
  duration: number
  width: number
  height: number
  fps: number
  video: string
  audio: string
}
export function createFfmpegGateApi(deps: { ffmpegPath: string; ffprobePath: string }): Record<string, NativeChannelEntry>
// 纯函数层（导出名守恒；getBinDir/getFfmpegPath/getFfprobePath 保持模块私有，
// 与源 module.exports 一致）
export function getStreamRotationDeg(videoStream: Dict | null | undefined): number
export function applyRotationSize(width: number, height: number, rotationDeg: number): { width: number; height: number }
export function extractFramesBatch(ffmpegPath: string, video: string, times: number[], tag: string, width?: number, quality?: number): Promise<{ frames: Array<{ path: string; timeSec: number; base64: string }>; outDir: string }>
export function parseCodecsViaFfmpeg(ffmpegPath: string, file: string): Promise<{ video: string; pixFmt: string; audio: string } | null>
export function isStreamPlayable(info: { video: string; pixFmt?: string; audio?: string } | null): boolean
export function parseFfmpegInfo(stderr: unknown): FfmpegParsedInfo
export function probeViaFfmpeg(ffmpegPath: string, file: string): Promise<FfmpegParsedInfo | null>
