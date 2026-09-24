// tintin-media-bundle client entry — built by vite (IIFE, single file) into
// dist/client.js. 2026-09-23 入口裁决（用户实测反馈）：不再持有 session
// header 的「媒体工具」按钮 + React 弹层面板（已废弃），改为向 tintin-bundle
// client.js 安装的视图注册表 window.__tintinViews 注册 'media' 视图——顶部
// Tab 栏（工作台/运营工具/媒体工具）切换时调用 mount(el)/unmount()，el 为
// 全尺寸容器（100% 宽 × 100% 高，overflow auto）。注册表先于本模块执行
// （组合顺序保证），?. 判空兜底：缺失时本模块正常实例化，仅媒体视图不可达。
//
// App.vue roots the ported TinTin design tokens (src/styles/tintin-tokens.css
// + tintin-global.css, scoped under .tintin-media-scope); importing them here
// gets them bundled and, via vite.config.mts inlineCssIntoEntry, embedded into
// dist/client.js next to the SFC styles.
//
// Built artifact; source of truth is src/. Rebuild: npm run tintin:media.
import { createApp, type App as VueApp } from 'vue'
import App from './App.vue'
import './styles/tintin-tokens.css'
import './styles/tintin-global.css'

declare global {
  interface Window {
    __ModuleLoader__?: {
      load: (def: {
        id: string
        factory: () => {
          name?: string
          inject: string[]
          apply: (ctx: unknown) => void
        }
      }) => void
    }
    /** tintin-bundle 安装的视图注册表（顶部 Tab 栏消费）；防御性可空 */
    __tintinViews?: {
      register: (
        name: string,
        view: {
          mount: (el: HTMLElement) => void
          unmount: () => void
        },
      ) => void
    }
  }
}

window.__ModuleLoader__!.load({
  id: 'tintin-media-bundle',
  factory: () => {
    let app: VueApp | null = null

    // 视图生命周期挂接（2026-09-24 Tab 状态机裁决）：chrome 为每个视图持有
    // 常驻子元素，mount 每视图仅调一次、切走只隐藏不销毁（KeepAlive 语义）——
    // 已打开的工具卡/向导步骤/表单输入切回后原样保留。
    window.__tintinViews?.register('media', {
      mount(el: HTMLElement) {
        if (app) return
        app = createApp(App)
        app.mount(el)
      },
      unmount() {
        app?.unmount()
        app = null
      },
    })

    const module = { exports: {} as Record<string, unknown> }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // 无 slots/locale 注入：视图注册已在实例化时完成，宿主模块系统仅需要
    // 模块具备 activate 兼容形状（apply 空实现）。
    exports.inject = []
    exports.apply = () => { /* 视图注册即本模块全部副作用 */ }
    return module.exports as {
      inject: string[]
      apply: (ctx: unknown) => void
    }
  },
})
