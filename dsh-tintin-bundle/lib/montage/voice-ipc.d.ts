// voice-ipc.d.ts — 混剪 Step3「口播配音」域通道（CJS→ESM 纯搬迁，源
// desktop/main/montage-voice-ipc.js）。ipcMain 壳已剥离：工厂注入面保持
// （httpRequest/isExpectedOfflineError/getServerUrl），返回「通道名 → (args, ctx)」表。
type Dict = Record<string, unknown>
export type HttpRequestFn = (method: string, url: string, options?: Dict) => Promise<{ data: unknown; status: number; headers: Dict; raw: Buffer }>
export type NativeChannelEntry = (args: unknown[], ctx?: { emit?: (event: Dict) => void }) => Promise<Dict | null>
export interface MontageApiDeps {
  httpRequest: HttpRequestFn
  isExpectedOfflineError: (err: unknown) => boolean
  getServerUrl: () => string
}
export function createMontageVoiceApi(deps: MontageApiDeps): Record<string, NativeChannelEntry>
// ── 模块级工具（导出名守恒，源 module.exports 对应项）──
export function getFfmpegPath(): string
export function getFfprobePath(): string
export function getMediaDuration(filepath: string): number
export function lookupWindowsFontFile(family: string): string
export function parseSilencedetect(stderr: unknown, totalDur: number): { leadIn: number; tailOut: number; gaps: Array<{ mid: number }> } | null
export function alignTimingToSpeech(timing: Array<{ text: string; start: number; end: number }>, m: { leadIn: number; tailOut: number; gaps?: Array<{ mid: number }> } | null, totalDur: number): Array<{ text: string; start: number; end: number }>
export function writeTimingSidecar(wavPath: string, timing: unknown): void
export function scaleTimingSidecar(wavPath: string, factor: number): void
export function buildRowsFromCues(cues: unknown, words: unknown): Array<{ text: string; start: number; end: number; chars: Array<{ c: string; start: number | null; end: number | null }> }>
