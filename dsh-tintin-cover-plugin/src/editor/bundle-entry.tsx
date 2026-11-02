// 封面编辑器页内模块入口(2026-11-02 方案 B B1:对齐媒体包形态——编辑器不再是
// 自伺服 iframe 页面,而是经模块接缝挂进主窗口的 React 岛)。本文件经 esbuild
// 以 CJS+外部 react/react-dom 构建,由构建脚本包装进 client.js 的 factory(require)
// 闭包——react/react-dom 取宿主单例(双 React 实例会炸 hooks,媒体包 client-entry
// 的 HOST_SINGLETON 铁律),应用本体与 Remotion Player 内联。
import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditorApp } from './App'

// Remotion 的 staticFile 缺省产出根绝对路径(/<name>);运行期素材在上游
// /tintin/cover/editor 三写位——渲染前声明静态基址(2026-10-28 探针实测)。
declare global {
  interface Window {
    remotion_staticBase: string
    __tintinChrome?: { onProvider?: (id: string) => void }
    __tintinViews?: {
      providers: Map<string, { mount(el: HTMLElement): void; unmount(): void }>
      register(id: string, provider: { mount(el: HTMLElement): void; unmount(): void }): void
      unregister(id: string): void
    }
  }
}
window.remotion_staticBase = '/tintin/cover/editor'

// 组合根带 pointer-events:none(Remotion Studio 嵌入语义);编辑器需要画布内图层
// 可点选拖拽。全局注入安全:该属性只在封面 DOM 存在。
const style = document.createElement('style')
style.dataset.plugin = 'dsh-tintin-cover-plugin'
style.textContent = '[data-cover-layer] { pointer-events: auto !important; }'
document.head.append(style)

const registry = (window.__tintinViews ??= {
  providers: new Map<string, { mount(el: HTMLElement): void; unmount(): void }>(),
  register(id: string, provider: { mount(el: HTMLElement): void; unmount(): void }) {
    this.providers.set(id, provider)
    try { window.__tintinChrome?.onProvider?.(id) } catch { /* chrome 未就绪 */ }
  },
  unregister(id: string) { this.providers.delete(id) },
})

// KeepAlive 语义(与旧 iframe 形态一致):mount 每视图仅一次,切走=chrome 隐藏容器,
// 图层/会话/撤销栈驻留;unmount 留空即不销毁。
let mounted: { root: ReturnType<typeof createRoot> } | null = null

registry.register('cover', {
  mount(el: HTMLElement) {
    if (mounted) return
    el.style.position = 'relative'
    const host = document.createElement('div')
    // 100vh:视图容器链百分比不解析(2026-10-27 实测塌 150px);宽随容器(100vw 会
    // 溢出侧栏——页内化后 App 根已改 100%)。
    host.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100vh;overflow:hidden;background:#141416'
    el.appendChild(host)
    mounted = { root: createRoot(host) }
    mounted.root.render(React.createElement(EditorApp))
  },
  unmount() { /* KeepAlive:切走仅隐藏,驻留不销毁 */ },
})
