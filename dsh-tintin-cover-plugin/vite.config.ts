import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// 编辑器 UI 构建(产物 dist/editor/;由 scripts/serve.mjs 托管)。
// base = bundle 路由前缀(iframe 以 /tintin/cover/editor 挂载,2026-10-27 白屏修复:
// 缺省绝对路径 /assets/* 在前缀下 404,资源引用必须带完整前缀)。
// 2026-11-11 R20:'remotion' 与 client.js(esbuild 构建)同口径 alias 到本地 shim——
// 调试页此前漏接,真 remotion 的 Img 在无 Composition 上下文里抛
// 「No video config found」,任何图片层都会把整块画布打成错误态(夹具实证)。
export default defineConfig({
  plugins: [react()],
  base: '/tintin/cover/editor/',
  resolve: { alias: { remotion: fileURLToPath(new URL('./src/editor/remotion-shim.tsx', import.meta.url)) } },
  build: { outDir: 'dist/editor', rollupOptions: { input: 'editor.html' } },
})
