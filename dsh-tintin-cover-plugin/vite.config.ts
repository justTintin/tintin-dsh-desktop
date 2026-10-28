import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 编辑器 UI 构建(产物 dist/editor/;由 scripts/serve.mjs 托管)。
// base = bundle 路由前缀(iframe 以 /tintin/cover/editor 挂载,2026-10-27 白屏修复:
// 缺省绝对路径 /assets/* 在前缀下 404,资源引用必须带完整前缀)。
export default defineConfig({
  plugins: [react()],
  base: '/tintin/cover/editor/',
  build: { outDir: 'dist/editor', rollupOptions: { input: 'editor.html' } },
})
