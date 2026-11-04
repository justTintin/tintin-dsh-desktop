/** cover-tools-mcp.js 的类型声明(封面会话本地工具 MCP 端点,2026-11-04 感知闭环批)。 */
export interface CoverToolResult {
  isError?: boolean
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >
}

export interface CoverToolsDeps {
  getServerUrl: () => string
  loadEngine: () => Promise<{
    resolveCoverDir: () => Promise<string>
    renderCover: (input: { templateId: string; props: Record<string, unknown>; fileName?: string; outDir?: string }) => Promise<{ ok: boolean; file?: string; error?: string }>
  }>
  resolvePluginDir: () => string | null | undefined
}

export interface CoverToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export declare function createCoverTools(deps: CoverToolsDeps): {
  tools: CoverToolSpec[]
  callTool: (name: string, args: Record<string, unknown>) => Promise<CoverToolResult>
}

export declare function registerCoverToolsMcp(deps: CoverToolsDeps & {
  webServer: { register: (spec: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }) => () => void }
  isTrustedRequest: (req: unknown, mutation?: boolean) => boolean
  sendJson: (res: unknown, status: number, body: unknown) => void
}): () => void

export declare const MCP_PATH: string
