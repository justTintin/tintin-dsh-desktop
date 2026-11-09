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

// 设计 token(2026-11-10 用户裁决:与视频剪辑一致)——值=OpenFilm Studio globals.css
// 暗色档逐字拷贝(字体族/色板/圆角/阴影),封面编辑器组件一律引用这些变量,不再自造色。
// 字体栈与 OpenFilm 同款;Inter Variable 需字体文件未随包,西文自然回落 system-ui,
// 中文(PingFang/微软雅黑)一致——阅读面主要在中文。
const tokens = document.createElement('style')
tokens.dataset.plugin = 'dsh-tintin-cover-plugin'
/* 作用域=[data-tintin-cover-scope](mount 的 host + App 根都打标):token 只进封面子树,
   不污染宿主页面(dsh 主窗可能存在同名 CSS 变量)。 */
tokens.textContent = `
[data-tintin-cover-scope] {
  --font-sans: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  --font-mono: ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --radius-lg: 16px;
  --bg-app: #141414;
  --bg-titlebar: #202020;
  --bg-panel: #181818;
  --bg-raised: #202020;
  --bg-field: rgba(255, 255, 255, 0.08);
  --bg-hover: rgba(255, 255, 255, 0.06);
  --bg-pressed: rgba(255, 255, 255, 0.12);
  --bg-selected: rgba(0, 193, 205, 0.16);
  --text: #e6e6e6;
  --text-muted: #a3a3a3;
  --text-faint: #717177;
  --border: rgba(240, 240, 255, 0.075);
  --border-strong: rgba(240, 240, 255, 0.15);
  --primary: #ebebed;
  --primary-hover: #ffffff;
  --on-primary: #0a0a0c;
  --accent: #00c1cd;
  --accent-soft: rgba(0, 193, 205, 0.14);
  --on-accent: #00262a;
  --bg-picked: rgba(0, 193, 205, 0.16);
  --ok: #4cc27a;
  --warn: #f0b03c;
  --err: #f2665f;
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.5), 0 4px 10px rgba(0, 0, 0, 0.3);
}
/* 图标按钮(OpenFilm AppMenu 同款):26×26 圆角 md、默认 muted、hover 提亮;
   编辑器 iconBtn 全部走本类,替代各自的内联底色。 */
.tintin-iconbtn {
  width: 26px; height: 26px; border-radius: 6px; border: 0; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--text-muted); padding: 0;
}
.tintin-iconbtn:hover { background: var(--bg-hover); color: var(--text); }
.tintin-iconbtn:disabled { opacity: 0.4; cursor: default; }
.tintin-iconbtn svg { width: 15px; height: 15px; }
`
document.head.append(tokens)

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
    host.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100vh;overflow:hidden;background:var(--bg-app, #141414)'
    host.setAttribute('data-tintin-cover-scope', '')
    el.appendChild(host)
    mounted = { root: createRoot(host) }
    mounted.root.render(React.createElement(EditorApp))
  },
  unmount() { /* KeepAlive:切走仅隐藏,驻留不销毁 */ },
})
