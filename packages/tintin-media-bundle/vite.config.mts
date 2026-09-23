// tintin-media-bundle client build (vite, IIFE single file → dist/client.js).
// Vue is a build-time dependency bundled INTO the chunk; the host only forces
// react/@deepseek-ai singletons, which the entry requires from the module
// system at runtime. Rebuild: npm run tintin:media (wired into root scripts).
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Anchor root to this package dir so `vite build -c <config>` works from
  // anywhere (the CLI resolves the entry against cwd otherwise).
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  // lib 模式默认不替换 process.env.NODE_ENV（假定宿主处理），而 vue 的
  // esm-bundler 构建在求值期读它——浏览器无 process 直接 ReferenceError，
  // 并打断 combo 里后续脚本的注册（实测：process is not defined）。
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'src/client-entry.ts',
      formats: ['iife'],
      name: 'TintinMediaBundle',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'client.js',
        // SFC styles emit as a css asset next to the chunk; the runtime loads
        // CSS via JS injection in the WP-3 continuation — App.vue keeps inline
        // styles until then, so any emitted css asset is unused residue.
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
