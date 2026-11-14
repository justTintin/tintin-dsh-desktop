// dsh-tintin-ops-bundle vite config — copied from dsh-tintin-media-bundle
// (2026-10-17 快照；lib IIFE 单文件 + CSS 内联 + @ 别名，独立域同构)。
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync, rmdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

function inlineCssIntoEntry(): Plugin {
  return {
    name: 'tintin-ops-inline-css',
    closeBundle() {
      const distDir = fileURLToPath(new URL('./dist', import.meta.url))
      const entry = `${distDir}/client.js`
      let js: string
      try {
        js = readFileSync(entry, 'utf8')
      } catch {
        return
      }
      if (js.includes("data-from','tintin-ops-bundle")) return
      const cssFiles = readdirSync(distDir, { recursive: true })
        .map((f) => `${distDir}/${String(f).replaceAll('\\', '/')}`)
        .filter((f) => f.endsWith('.css') && statSync(f).isFile())
      if (cssFiles.length === 0) return
      const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
      const injector =
        `;(function(){try{var d=typeof document==='undefined'?null:document;` +
        `if(!d||!d.createElement)return;var s=d.createElement('style');` +
        `s.setAttribute('data-from','tintin-ops-bundle');s.textContent=${JSON.stringify(css)};` +
        `(d.head||d.documentElement).appendChild(s)}catch(e){}})();\n`
      writeFileSync(entry, js + injector)
      for (const f of cssFiles) rmSync(f)
      try { rmdirSync(`${distDir}/assets`) } catch { /* 非空/不存在则保留 */ }
    },
  }
}

// tintinSurfacePlugin — 构建期分面重写（2026-11-14 用户裁决：素材创作/运营/媒体
// 三面服务端地址分面独立）：把 src/ 源码里的 window.tintin / globalThis.tintin
// 全局引用改写为 @/tintinBridge 的 __tintinSurface()（真实 polyfill 在场=分面句柄，
// 请求携带 x-tintin-scope 头、宿主按面解析地址；单测桩/旧 polyfill 惰性回落原语义，
// 见 src/tintinBridge.ts）。只处理本包 src/ 的脚本模块（.vue 取 vue 插件编译后的
// script 虚拟模块）；tintinBridge.ts 自身豁免，test/ 不重写（桩赋值保持原义）。
function tintinSurfacePlugin(surface: string): Plugin {
  const srcDir = fileURLToPath(new URL('./src', import.meta.url)).replaceAll('\\', '/')
  return {
    name: `tintin-surface-${surface}`,
    transform(code, id) {
      const path = id.split('?')[0]!.replaceAll('\\', '/')
      if (!path.startsWith(srcDir) || path.endsWith('tintinBridge.ts')) return null
      if (!/\.(ts|tsx|mts|js|mjs|jsx|vue)$/.test(path)) return null
      if (!code.includes('window.tintin') && !code.includes('globalThis.tintin')) return null
      const rewritten = code
        .replaceAll('globalThis.tintin', '__tintinSurface()')
        .replaceAll('window.tintin', '__tintinSurface()')
      return { code: `import { __tintinSurface } from '@/tintinBridge';\n${rewritten}`, map: null }
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue(), tintinSurfacePlugin('ops'), inlineCssIntoEntry()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    assetsInlineLimit: 64 * 1024,
    lib: {
      entry: 'src/client-entry.ts',
      formats: ['iife'],
      name: 'TintinOpsBundle',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'client.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
