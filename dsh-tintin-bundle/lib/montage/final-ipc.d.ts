// final-ipc.d.ts — 混剪 Step4「特效包装」域通道（CJS→ESM 纯搬迁，源
// desktop/main/montage-final-ipc.js）。ipcMain 壳已剥离：工厂注入面保持
// （httpRequest/isExpectedOfflineError/getServerUrl），返回「通道名 → (args, ctx)」表，
// jyaudio:* 随工厂一并注册（剪映音频自动同步定时任务）。
type Dict = Record<string, unknown>
export type HttpRequestFn = (method: string, url: string, options?: Dict) => Promise<{ data: unknown; status: number; headers: Dict; raw: Buffer }>
export type NativeChannelEntry = (args: unknown[], ctx?: { emit?: (event: Dict) => void }) => Promise<Dict | null>
export interface MontageApiDeps {
  httpRequest: HttpRequestFn
  isExpectedOfflineError: (err: unknown) => boolean
  getServerUrl: () => string
}
export function createMontageFinalApi(deps: MontageApiDeps): Record<string, NativeChannelEntry>
// ── 模块级工具（导出名守恒，源 module.exports 对应项）──
export function getOutMontageDir(dirPath: string): string
export function getOutFinalDir(firstVid: string): string
export function findSrtForVideo(videoPath: string): string
export function buildSrtFromTiming(text: unknown, timing: unknown, videoDur: number): string
export function buildServerFxFields(fx: Dict, srt: string, hits?: unknown[]): Dict
export function buildFxMultipart(fields: Dict, filePath: string, extraFiles?: Array<{ name: string; path: string; ctype: string }>): { body: Buffer; contentType: string }
export function serverComposeOne(args: Dict & { httpRequest: HttpRequestFn }): Promise<{ dur: number; taskId: string }>
export function probeMedia(filepath: string): { durationSec: number; width: number; height: number; fps: number }
export function readProcessedSrtAsset(sub: { srtPath?: string } | null): string
export function subtitleStyleCard(t: Dict): Dict
export function cssColorFromStyle(raw: unknown): string
export function parseJianyingCachePath(iniText: unknown): string
export function getJianyingMediaCacheDir(): string
