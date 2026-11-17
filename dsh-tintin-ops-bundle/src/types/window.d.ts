/** Window 全局桥声明(2026-11-18): ops typecheck 接入根 check 门禁后补的运行时契约。
 *  __ModuleLoader__/__tintinViews 由宿主 client 注入(媒体包同款装配);
 *  tintin 桥构建期被 tintinSurfacePlugin 改写为 __tintinSurface() 分面句柄
 *  (见 src/tintinBridge.ts),此处仅描述运行时面——成员与媒体包 global.d.ts
 *  的 TintinBridge 同源不同面(ops 只消费 dialog/media)。 */
declare global {
  interface Window {
    __ModuleLoader__: {
      load(spec: { id: string; factory: () => void }): void
    }
    __tintinViews?: {
      register(name: string, view: { mount(el: HTMLElement): void; unmount(): void }): void
    }
    tintin: {
      dialog: {
        openFile(options: { title?: string; filters?: unknown }): Promise<string>
      }
      media?: {
        unlock?(path: string): unknown
      }
    }
  }
}

export {}
