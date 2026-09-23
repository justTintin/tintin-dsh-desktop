export interface ServerUrlResolverDeps {
  readConfig?: (key: string) => unknown
  readAiConfig?: () => { server_url?: string; server?: { url?: string } } | null
}
export function createServerUrlResolver(deps?: ServerUrlResolverDeps): () => string
export function createFixOutputUrl(getServerUrl: () => string): (u: string) => string
export interface GenUrls {
  url?: string
  audio_url?: string
  file_url?: string
  [key: string]: unknown
}
export function makeFixGenUrls(fixOutputUrl: (u: string) => string): (data: GenUrls) => GenUrls

export type Endpoint = string | ((...args: string[]) => string)
export const API_ENDPOINTS: Record<string, Record<string, Endpoint> & Endpoint>
export function resolveEndpoint(endpoint: Endpoint, params?: Record<string, unknown> & { __args?: string[] }): string

export interface HttpResult {
  data: unknown
  status: number
  headers: Record<string, unknown>
  raw: Buffer
}
export interface HttpRequestDeps {
  getServerUrl?: () => string
  getMachineId?: () => string
  log?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}
export function createHttpRequest(deps?: HttpRequestDeps): (
  method: string,
  fullPath: string,
  options?: { body?: unknown; headers?: Record<string, string>; timeout?: number },
) => Promise<HttpResult>

/** 「外部服务未部署/不可达」的正常错误判定（montage 域离线回退 null 契约共用）。 */
export function isExpectedOfflineError(err: unknown): boolean
