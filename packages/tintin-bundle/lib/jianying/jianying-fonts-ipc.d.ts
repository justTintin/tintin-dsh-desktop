// jianying-fonts-ipc.d.ts — 剪映模板页「字体（剪映）」分类域 IPC。
// createJianyingFontsIpc 需要 ipcMain（编排层注入），类型只约束用到的 handle 方法。
export interface ScannedFontFile {
  name: string
  family: string
  path: string
  sizeKb: number
  source: string
}
export function scanFontFiles(fontDir: string, cacheDir: string): ScannedFontFile[]
export function fontMatches(entry: unknown, family: string, fileName: string): boolean
export function matchServerFont(serverName: string, family: string): boolean
export function fetchServerFonts(httpRequest: unknown): Promise<unknown[]>
export function uploadFontFiles(httpRequest: unknown, paths: string[], options?: { timeout?: number }): Promise<Array<Record<string, unknown>>>
export function createJianyingFontsIpc(
  ipcMain: { handle(channel: string, listener: (...args: unknown[]) => unknown): void },
  deps: { httpRequest: unknown; isExpectedOfflineError: (err: unknown) => boolean }
): void
