// Client-side entry of the cover plugin(2026-10-30 用户裁决:封面制作第三层独立插件)。
// 自注册 'cover' 视图提供方进 window 级 __tintinViews 注册表——与 creation/ops/media
// 同一模式;侧栏行清单仍集中列在 dsh-tintin-bundle 的 chrome(行=宿主展示面,提供方
// 才是包的边界)。**必须经 __ModuleLoader__.load 自注册**(2026-10-30 打包实机教训:
// 纯副作用脚本"loaded without registering"→web boot 失败 1 插件→恢复模式;同 creation
// 构建产物与 bundle client.js:866 的契约)。
// 视图本体=三栏编辑器/会话页 iframe,静态件由本包宿主入口(lib/cover-plugin-route.js)
// 经 /tintin/cover/editor 提供。KeepAlive 语义由 chrome 的常驻子元素保证(切走仅
// display:none,图层/会话驻留);高度用 100vh(覆盖层容器链百分比不解析,塌 150px
// ——2026-10-27 兼容模式实测)。
window.__ModuleLoader__.load({
  id: 'dsh-tintin-cover-plugin',
  factory: () => {
    const registry = (window.__tintinViews ??= {
      providers: new Map(),
      register(id, provider) { this.providers.set(id, provider); try { window.__tintinChrome?.onProvider?.(id) } catch { /* 未就绪 */ } },
      unregister(id) { this.providers.delete(id) },
    })
    let coverFrame = null
    registry.register('cover', {
      mount(el) {
        if (coverFrame) return
        el.style.position = 'relative'
        coverFrame = document.createElement('iframe')
        coverFrame.src = '/tintin/cover/editor'
        coverFrame.title = '封面制作'
        coverFrame.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100vh;border:0;display:block;background:#141416'
        el.appendChild(coverFrame)
      },
      unmount() {
        coverFrame?.remove()
        coverFrame = null
      },
    })
    // Loader 契约第二段(2026-10-30 二次实机教训):factory 必须返回插件定义——
    // 函数或带 apply 方法的对象(creation 构建产物回填的 module.exports 同形:
    // exports.inject=[] + exports.apply),返回 undefined → "invalid plugin …
    // received undefined" → boot 失败。纯 client 包 apply 即空实现。
    return { inject: [], apply: () => {} }
  },
})
