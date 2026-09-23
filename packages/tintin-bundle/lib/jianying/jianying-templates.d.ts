// jianying-templates.d.ts — 剪映素材模板聚合扫描器（主进程纯逻辑）。
// 扫描产物条目结构随剪映缓存格式演进，以索引签名 unknown 透传，不瞎编具体字段。
export interface TemplateItem {
  [key: string]: unknown
}
export type TemplateScanResult = Record<string, TemplateItem[]>
export const CATEGORIES: string[]
export function scanAll(opts?: { jianyingRoot?: string; transitionMap?: Record<string, unknown>; httpRequest?: unknown }): TemplateScanResult
export function scanAllAsync(opts?: { jianyingRoot?: string; transitionMap?: Record<string, unknown>; httpRequest?: unknown }): Promise<TemplateScanResult>
export function scanTextPresets(presetDir: string): { textItems: TemplateItem[]; tplItems: TemplateItem[]; captionItems: TemplateItem[] }
export function scanEffectCache(cacheDir: string): TemplateItem[]
export function scanAudioCache(musicDir: string): TemplateItem[]
export interface TransitionListItem {
  id: string
  name: string
  durationUs: number
  isOverlap: boolean
}
export function getTransitions(transitionMap?: Record<string, { name: string; duration: number; isOverlap: boolean }>): TransitionListItem[]
export function pngSize(fp: string): { w: number; h: number } | null
export function buildSyncPackage(presetDir: string, rid: string, opts?: { fontFamily?: string } & Record<string, unknown>): { meta: Record<string, unknown>; html: string } | null
export function collectTemplateFonts(presetDir: string, rid: string): Array<{ name: string; path: string }>
export function buildAssetPackage(presetDir: string, rid: string, cacheRoot?: string): {
  files: Array<{ relPath: string; absPath: string }>
  manifest: Record<string, unknown>
} | null
export function buildRawSyncPackage(presetDir: string, rid: string, cacheRoot?: string, opts?: { fontFamily?: string } & Record<string, unknown>): {
  meta: Record<string, unknown>
  html: string
  files: Array<Record<string, unknown>>
} | null
