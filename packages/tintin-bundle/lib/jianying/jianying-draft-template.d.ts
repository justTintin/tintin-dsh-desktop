// jianying-draft-template.d.ts — 剪映草稿骨架（CJS 整对象导出 → ESM default）。
// 仅声明消费者实际依赖的骨架字段，其余顶层键经索引签名以 unknown 暴露，不瞎编。
export interface JianyingDraftTemplate {
  canvas_config: { width: number; height: number; ratio: string }
  fps: number
  duration: number
  id: string
  name: string
  new_version: string
  version: number
  tracks: unknown[]
  keyframes: Record<string, unknown[]>
  materials: Record<string, unknown[]>
  platform: Record<string, unknown>
  last_modified_platform: Record<string, unknown>
  [key: string]: unknown
}
declare const draftTemplate: JianyingDraftTemplate
export default draftTemplate
