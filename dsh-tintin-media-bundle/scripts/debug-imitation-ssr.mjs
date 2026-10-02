// scripts/debug-imitation-ssr.mjs — 白屏取证：SSR 渲染仿爆款视频组件，捕获 setup/render 异常
// （一次性调试脚本；白屏修复后可删。铁律 11 无头安全——纯 node，无 GUI。）
import { createServer } from 'vite'

const vite = await createServer({
  root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
})

// 渲染层全局 stub（SSR 下 onMounted 不执行，但保险起见）
globalThis.window = globalThis
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {} } }),
  documentElement: { classList: { contains: () => false } },
  body: { appendChild() {} },
}
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true })
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.tintin = {
  server: new Proxy({}, { get: () => async () => null }),
  dialog: { openFile: async () => null },
  media: { unlock: () => {} },
}

try {
  const mod = await vite.ssrLoadModule('/src/components/media-tools/ImitationVideo.vue')
  const Comp = mod.default
  console.log('[ssr] 组件模块加载成功，default =', typeof Comp)
  const { renderToString } = await import('vue/server-renderer')
  const { createSSRApp } = await import('vue')
  const app = createSSRApp(Comp)
  app.config.warnHandler = (msg) => console.log('[vue warn]', msg.slice(0, 200))
  app.config.errorHandler = (err) => { console.error('[vue errorHandler]', err) }
  const html = await renderToString(app)
  console.log('[ssr] 渲染成功，HTML 长度 =', html.length)
  console.log('[ssr] 渲染含步骤条:', html.includes('视频拆解'))
} catch (err) {
  console.error('[ssr] ❌ 复现异常：')
  console.error(err && err.stack ? err.stack : err)
  process.exitCode = 1
} finally {
  await vite.close()
}
