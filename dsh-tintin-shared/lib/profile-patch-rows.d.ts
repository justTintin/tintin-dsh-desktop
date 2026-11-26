/**
 * dsh profile patch 的条目提取(照上游 openfilm 的默认智能体处理方式,2026-11-24)。
 * 见 lib/profile-patch-rows.js 顶注:客户端「设置→模型」持久在主 home 的
 * profiles/desktop/cordis.patch.yml,这里按 id 提取条目原文块供智能体补丁合并。
 */
export declare function extractPatchRows(sourcePath: string, ids: string[]): string[]

/** 客户端对 DeepSeek 官方路由的配置:默认模型 + 自定义过的目录行(无=null)。 */
export declare function readClientDeepseekConfig(
  channelHome: string,
  options?: { dshDefaultModel?: string },
): { defaultModel: string; catalogRow: string | null }
