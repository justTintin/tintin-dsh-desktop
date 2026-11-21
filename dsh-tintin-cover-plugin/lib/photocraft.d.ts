// photocraft.js 类型声明(lib 纯 JS;测试与编辑器消费)
export declare function configuredDir(env?: NodeJS.ProcessEnv): string | null
export declare function resolvePhotocraftDir(env?: NodeJS.ProcessEnv): string | null
export declare function resolveCli(env?: NodeJS.ProcessEnv): string | null
export declare function resolveApp(env?: NodeJS.ProcessEnv): string | null
export declare function cliRun(opts: { newDoc?: unknown; cmds?: Array<{ command: string; params?: unknown }>; out?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): { ok: boolean; code: number; stdout: string; stderr: string }
export declare function cliConvert(opts: { src: string; out: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): { ok: boolean; code: number; stderr: string }
export declare function launchApp(opts?: { docPath?: string; port?: number; tokenFile?: string; env?: NodeJS.ProcessEnv }): { ok: boolean; port?: number; tokenFile?: string; pid?: number; error?: string }
export declare function controlTarget(env?: NodeJS.ProcessEnv): { port: number; tokenFile: string }
/** 控制通道连接(暖缓存命中时 warm=true;request=帧级调用,逐请求死限) */
export interface ControlConnection {
  ok: boolean
  error?: string
  warm?: boolean
  request: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }>
}
export declare function connectControl(opts?: { port?: number; tokenFile?: string; timeoutMs?: number; warm?: boolean }): Promise<ControlConnection>
export declare function disposeControlCache(): void
