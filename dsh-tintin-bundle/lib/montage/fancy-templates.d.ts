// fancy-templates.d.ts — 花字模板包加载器（CJS→ESM 纯搬迁，源 desktop/main/fancy-templates.js）。
// 模板 dict 结构见源文件头注（template_id/name/style/jy_effect_id/jy_intro_anim/sound/timing）。
export interface FancyTemplate {
  template_id: string
  name: string
  style?: string
  jy_effect_id?: string
  jy_intro_anim?: string
  sound?: { file?: string; gain_db?: number }
  timing?: string
  _path?: string
  [key: string]: unknown
}
export const PREVIEW_TEXT: string
export function getAssetsFancyDir(): string
export function getTemplateDir(): string
export function listFancyTemplates(forceReload?: boolean): FancyTemplate[]
export function serializeForTask(template: unknown): string
export function getFancySoundPath(template: unknown): string
export function getFancySoundGainDb(template: unknown): number
export function templatePreviewPath(templateId: string): string
export function ensureTemplatePreview(template: unknown, ffmpegPath: string, fontPath: string): string
