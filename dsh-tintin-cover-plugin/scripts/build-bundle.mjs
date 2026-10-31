// 预构建 remotion bundle(打包链用):模板编译为静态产物 dist/remotion-bundle,
// 运行时 renderStill 直接以它为 serveUrl——免 webpack/bundler 进生产依赖与安装包
// (模板代码变更才需重跑本脚本;props 变化走 inputProps,不影响 bundle)。
import { bundle } from '@remotion/bundler'
import { join } from 'node:path'

const entryPoint = join(import.meta.dirname, '..', 'templates', 'remotion-entry.tsx')
const outDir = join(import.meta.dirname, '..', 'dist', 'remotion-bundle')

console.log('[build:bundle] entry:', entryPoint)
const serveUrl = await bundle({ entryPoint, onProgress: () => {}, webpackOverride: (c) => c })
console.log('[build:bundle] bundle →', serveUrl)
// bundle() 产物目录不确定名,复制/移动到固定路径交给调用方(electron-builder 拷贝)
const { cpSync, rmSync } = await import('node:fs')
rmSync(outDir, { recursive: true, force: true })
cpSync(serveUrl, outDir, { recursive: true })
rmSync(serveUrl, { recursive: true, force: true })
console.log('[build:bundle] done →', outDir)
