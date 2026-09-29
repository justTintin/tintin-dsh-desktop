// jianying-audio-sync.d.ts — 剪映音频素材自动同步（内置定时任务）。
// initJianyingAudioSync/startJianyingAudioSyncTimer 需要 ipcMain/electron（编排层注入，
// electron 在实现内惰性 require），类型只约束用到的表面。
export const DEFAULT_INTERVAL_MIN: number
export interface JianyingAudioCacheFile {
  file: string
  id: string
  ext: string
  bytes: number
}
export function listAudioCacheFiles(jianyingRoot: string): JianyingAudioCacheFile[]
export function buildDraftAudioNameMap(jianyingRoot: string): Map<string, string>
export interface NewAudioItem {
  id: string
  file: string
  filename: string
  name: string
  category: string
  durSec: number
}
export function collectNewAudioItems(opts?: {
  files?: Array<{ file: string; id: string; ext: string; duration?: number; [key: string]: unknown }>
  nameByPath?: Map<string, string>
  excludeNames?: Set<string>
}): NewAudioItem[]
export function initJianyingAudioSync(deps: {
  ipcMain: { handle(channel: string, listener: (...args: unknown[]) => unknown): void }
  httpRequest: (method: string, url: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>
  getServerUrl: () => string
  probeMedia: (fp: string) => { durationSec?: number }
}): {
  startTimer(): void
  stopTimer(): void
  syncNow(trigger?: string): Promise<Record<string, unknown>>
}
export function startJianyingAudioSyncTimer(ctrl: {
  startTimer(): void
  syncNow(trigger?: string): Promise<Record<string, unknown>>
}): void
