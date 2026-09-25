export interface AgentToolDeps {
  httpRequest?: (
    method: string,
    fullPath: string,
    options?: { body?: unknown; headers?: Record<string, string>; timeout?: number },
  ) => Promise<{ data?: unknown; status?: number; raw?: Buffer }>
  callNative?: (channel: string, args: unknown[]) => Promise<unknown> | unknown
  readFile?: (path: string) => Promise<Buffer>
  log?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

/** 工具定义对象（index.js 以 defineTool() 包装后注册，形状对齐 @deepseek-ai/dsh-tools） */
export type TintinAgentToolDef = Record<string, unknown>

/** 创建 TinTin 业务能力工具组（plan/识图/镜头分割），返回待注册定义数组 */
export function createTintinAgentTools(deps?: AgentToolDeps): TintinAgentToolDef[]

/** 从模型输出提取首个 JSON 对象（失败返 null） */
export function extractFirstJson(text: unknown): Record<string, unknown> | null

/** /workflow/plan 入参归一化 */
export function normalizePlanInputs(args?: {
  type?: unknown
  inputs?: unknown
  prefer?: unknown
}): { type: string; inputs: string[]; prefer?: string }

/** 识图图片 Buffer → data URL（mime 按扩展名） */
export function visionDataUrl(buffer: Buffer, filePath: string): string

export const PLAN_BUSINESS_SYSTEM_PROMPT: string
