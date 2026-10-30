// ═══════════════════════════════════════════════════════════════
// creationDreaminaLogic — 创作模式·即梦 CLI 后端纯函数层（2026-10-25）
//
// 用户裁决（2026-10-25）：创作模式加双后端切换——「TinTin 服务」（原链路，
// 缺省）/「即梦 CLI」（本机 dreamina 可执行文件，真生成）。本模块承载
// 无 vue/IPC 依赖的部分：后端字典、类型→CLI 命令映射、payload 组包、
// 结果摘要。CLI 参数面与支持集=2026-10-25 dreamina 1.4.21 -h 实测
// （镜像于宿主 lib/dreamina-logic.js，包间不互引口径）。
// ═══════════════════════════════════════════════════════════════

/** 创作后端：tintin=服务端 LLM/口播/复制（原链路）；jimeng-cli=本机即梦 CLI 真生成 */
export type CreationBackendId = 'tintin' | 'jimeng-cli'

export const CREATION_BACKENDS: ReadonlyArray<{ id: CreationBackendId; label: string; desc: string }> = Object.freeze([
  { id: 'tintin', label: 'TinTin 服务', desc: 'AI 生成提示词方案 / 口播文案（服务端 DeepSeek）' },
  { id: 'jimeng-cli', label: '即梦 CLI', desc: '图片/视频真生成走本机 dreamina（消耗即梦积分）' },
])

export function backendLabel(id: string): string {
  return CREATION_BACKENDS.find((b) => b.id === id)?.label ?? 'TinTin 服务'
}

/** CLI 比例支持集（-h 实测）：3:2、2:3 仅图片端；视频端无此二者 */
export const DREAMINA_IMAGE_RATIOS: ReadonlyArray<string> = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']
export const DREAMINA_VIDEO_RATIOS: ReadonlyArray<string> = ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9']

/** 图片缺省分辨率档 / 视频缺省分辨率（CLI 必填项；档位对全模型合法——-h 实测） */
export const DREAMINA_DEFAULT_RESOLUTION_TYPE = '2k'
export const DREAMINA_DEFAULT_VIDEO_RESOLUTION = '720p'

/** 即梦 CLI 支持的创作类型（即梦创作类型字典的子集；其余类型 CLI 不提供） */
export function cliSupportedType(typeId: string): boolean {
  return typeId === 'image' || typeId === 'video'
}

/** 类型+参考图 → CLI 命令（image2image 最多 10 张；image2video 只取首张） */
export function dreaminaCommandForType(typeId: string, imageCount: number): 'text2image' | 'image2image' | 'text2video' | 'image2video' {
  if (typeId === 'image') return imageCount > 0 ? 'image2image' : 'text2image'
  if (typeId === 'video') return imageCount > 0 ? 'image2video' : 'text2video'
  throw new Error(`即梦 CLI 不支持创作类型「${typeId}」`)
}

/** dreamina:generate 入参组包（铁律 6：不支持的比例显式注记回落 CLI 推断，不静默） */
export function buildDreaminaPayload(p: {
  typeId: string
  prompt: string
  imagePaths?: readonly string[]
  ratio?: string
}): { command: string; prompt: string; images?: string[]; ratio?: string; resolutionType?: string; videoResolution?: string; note?: string } {
  const images = (p.imagePaths ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)
  const command = dreaminaCommandForType(p.typeId, images.length)
  const allowed = p.typeId === 'image' ? DREAMINA_IMAGE_RATIOS : DREAMINA_VIDEO_RATIOS
  const ratio = String(p.ratio ?? '').trim()
  const out: { command: string; prompt: string; images?: string[]; ratio?: string; resolutionType?: string; videoResolution?: string; note?: string } = {
    command,
    prompt: String(p.prompt ?? '').trim(),
    ...(images.length && command === 'image2image' ? { images: images.slice(0, 10) } : {}),
    ...(images.length && command === 'image2video' ? { images: images.slice(0, 1) } : {}),
  }
  if (ratio && ratio !== '智能') {
    if (allowed.includes(ratio)) out.ratio = ratio
    else out.note = `比例「${ratio}」该类型不支持，已交由即梦按参考/默认推断`
  }
  if (p.typeId === 'image') out.resolutionType = DREAMINA_DEFAULT_RESOLUTION_TYPE
  else out.videoResolution = DREAMINA_DEFAULT_VIDEO_RESOLUTION
  return out
}

/** 生成任务种类（结果条渲染：图片堆叠/视频播放器） */
export type DreaminaTaskKind = 'image' | 'video'

/** 终态归一：CLI 的 gen_status=success 才算成功（SKILL.md 强制口径） */
export function dreaminaTerminal(genStatus: string): 'success' | 'fail' | 'querying' {
  const s = String(genStatus ?? '').toLowerCase()
  if (s === 'success' || s === 'fail' || s === 'failed') return s === 'success' ? 'success' : 'fail'
  return 'querying'
}

/** 轮询预算（毫秒）：图片 4 分钟 / 视频 10 分钟（实测口径经验值，超时交给用户手动查） */
export function dreaminaPollBudget(kind: DreaminaTaskKind): number {
  return kind === 'image' ? 4 * 60 * 1000 : 10 * 60 * 1000
}

/** 结果 → 历史摘要文本（媒体链接逐行列出 + 落盘目录注记） */
export function cliResultSummary(p: { submitId: string; mediaUrls?: readonly string[]; localDir?: string; failReason?: string }): string {
  if (p.failReason) return `生成失败：${p.failReason}`
  const urls = (p.mediaUrls ?? []).filter(Boolean)
  const lines = [`submit_id: ${p.submitId}`]
  if (urls.length) lines.push(...urls)
  if (p.localDir) lines.push(`已保存到：${p.localDir}`)
  if (!urls.length && !p.localDir) lines.push('（任务完成，未取到媒体链接——可用「查询任务」按 submit_id 复查）')
  return lines.join('\n')
}
