import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
  resolve: {
    alias: [
      // .tsx 模板组件含 JSX,vitest 默认 esbuild 可转译;无需 react 插件(纯 .ts 测试不 import 组件运行时)
      { find: /^remotion$/u, replacement: fileURLToPath(new URL('./test/remotion-stub.ts', import.meta.url)) },
    ],
  },
})
