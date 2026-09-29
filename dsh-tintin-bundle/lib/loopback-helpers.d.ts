export interface LoopbackConfig { port: number; token: string; pid?: number; ts?: number }
export function readLoopbackConfig(): LoopbackConfig | null
export function loopbackCall(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown> | unknown[]>
export function summarizeExtract(res: unknown): { ok: boolean; summary?: string; error?: string }
