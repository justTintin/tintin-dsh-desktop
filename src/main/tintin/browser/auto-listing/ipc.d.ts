// auto-listing .js ESM 模块的 TS 声明（实现为纯 JS 移植件，见同目录 .js）
declare module '*/auto-listing/ipc.js' {
  export const PROGRESS_CHANNEL: string
  export function createAutoListingIpc(
    ipcMain: Electron.IpcMain,
    ctx: {
      store: { get(key: string): unknown; set(key: string, value: unknown): void }
      app: Electron.App
      getBrowserWindow: () => Electron.BrowserWindow | null
      getOrCreateView: (platformId: string) => Electron.WebContentsView
    },
  ): {
    channel: string
    saveConfig: (patch: Record<string, unknown>) => unknown
    loadConfig: () => Record<string, unknown>
    isRunning: () => boolean
  }
}
