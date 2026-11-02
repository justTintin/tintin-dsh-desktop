// 构建封面编辑器页内模块(方案 B B1):React/Remotion 应用 → CJS(react/react-dom 外部化)
// → 包装进 client.js 的 factory(require) 闭包。react/react-dom 经 loader 注入的
// require 取宿主单例(绝不能内联——双 React 实例会炸 hooks,媒体包 client-entry 铁律)。
// 产物=包根 client.js(exports './client';Loader 装载的唯一入口)。
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// 本环境 TEMP 偶发拒绝 esbuild 清理临时目录(stage.mjs 同款护栏:统一用工作区本地 TEMP)
const buildTemp = join(pluginRoot, '.tmp')
mkdirSync(buildTemp, { recursive: true })
process.env.TEMP = buildTemp
process.env.TMP = buildTemp

const result = await build({
  entryPoints: [join(pluginRoot, 'src', 'editor', 'bundle-entry.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
  minify: true,
  jsx: 'transform',
  external: ['react', 'react-dom'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})

const bundle = Buffer.from(result.outputFiles[0].contents).toString('utf8')
// factory(require) 闭包:app 代码在闭包内求值(加载脚本时 loader 还没给 require,
// 顶层不得触 React——模块代码必须住在 factory 里,同 harness fixtures 契约)。
// require 兜底:react/jsx-runtime 与 react-dom/client 是子路径说明符,宿主模块表
// 未必解析——失败时用 react/react-dom 主入口构造等价物(React 18 主入口自带
// createRoot;jsx-runtime=createElement 的薄包装,jsx 与 jsxs 仅静态化差异)。
const client = `// 封面制作编辑器页内模块(方案 B B1,2026-11-02 用户裁决):构建产物,勿手改——
// 源=src/editor/bundle-entry.tsx,构建=scripts/build-editor-bundle.mjs。
// 契约=模块代码住在 factory(require) 闭包内,react/react-dom 取宿主单例;视图注册
// 进 window.__tintinViews(必须经 __ModuleLoader__.load 自注册,2026-10-30 打包实机教训)。
window.__ModuleLoader__.load({
  id: 'dsh-tintin-cover-plugin',
  factory(require) {
    ;(function (require) {
      const React = require('react')
      const ReactDOM = require('react-dom')
      const jsxShim = {
        Fragment: React.Fragment,
        jsx(type, props, key) { return key === undefined ? React.createElement(type, props) : React.createElement(type, { ...props, key }) },
        jsxs(type, props, key) { return key === undefined ? React.createElement(type, props) : React.createElement(type, { ...props, key }) },
      }
      const resolve = (id) => {
        if (id === 'react') return React
        if (id === 'react-dom') return ReactDOM
        try { return require(id) } catch { /* 子路径宿主表不解析 */ }
        if (id === 'react-dom/client') return ReactDOM
        if (id === 'react/jsx-runtime') return jsxShim
        throw new Error('dsh-tintin-cover-plugin: 未解析的模块 ' + id)
      }
      ;(function (require) {
${bundle}
      })(resolve)
    })(require)
    // loader 把 factory 返回值当 cordis 插件加载(必须有 apply,2026-11-02 启动事故:
    // 返回 undefined → "invalid plugin" → 恢复模式);视图注册在上方为命令式副作用。
    return { apply() {} }
  },
})
`
writeFileSync(join(pluginRoot, 'client.js'), client)
console.log(`[editor-bundle] client.js ← ${(client.length / 1024).toFixed(0)}KB (bundle ${(bundle.length / 1024).toFixed(0)}KB)`)
