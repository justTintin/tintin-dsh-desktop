export interface DreaminaStatus {
  available: boolean
  bin: string
  version?: string
  loggedIn?: boolean
  credit?: unknown
  vipLevel?: unknown
  userId?: unknown
  error?: string
}
export interface DreaminaGenerated {
  ok: boolean
  code?: number
  command?: string
  submitId?: string
  genStatus?: string
  failReason?: string
  error?: string
  mediaUrls?: string[]
  localDir?: string
}
export interface DreaminaApi {
  'dreamina:status': () => Promise<DreaminaStatus>
  'dreamina:generate': (args: [Record<string, unknown>]) => Promise<DreaminaGenerated>
  'dreamina:query': (args: [Record<string, unknown>]) => Promise<DreaminaGenerated>
  'dreamina:tasks': (args: [Record<string, unknown>]) => Promise<{ ok: boolean; tasks: unknown[]; stdout?: string; error?: string }>
  'dreamina:credit': () => Promise<{ ok: boolean; credit: unknown; stderr?: string; error?: string }>
  'dreamina:loginHeadless': () => Promise<Record<string, unknown>>
  'dreamina:loginCheck': (args: [Record<string, unknown>]) => Promise<Record<string, unknown>>
  'dreamina:login': () => Promise<Record<string, unknown>>
  'dreamina:logout': () => Promise<Record<string, unknown>>
}
export declare function createDreaminaApi(options?: { log?: (m: string) => void; warn?: (m: string) => void }): DreaminaApi
export declare function ensureDreaminaCli(options?: Record<string, unknown>): Promise<{ ok: boolean; bin?: string; error?: string; downloaded?: string[]; skipped?: boolean }>
export declare function ensureDreaminaCliOnce(options?: Record<string, unknown>): Promise<{ ok: boolean; bin?: string; error?: string; downloaded?: string[]; skipped?: boolean }>
export declare function resolveDreaminaBin(env?: NodeJS.ProcessEnv, platform?: string): string
export declare function dreaminaDownloadRoot(env?: NodeJS.ProcessEnv): string
export declare function parseCliOutput(text: string): { kind: string; value: unknown }
export declare function extractSubmitId(parsed: unknown): string
export declare function extractGenStatus(parsed: unknown): string
export declare function extractMediaUrls(value: unknown): string[]
export declare function summarizeStatus(input: Record<string, unknown>): DreaminaStatus
export declare const DREAMINA_GENERATE_COMMANDS: readonly string[]
