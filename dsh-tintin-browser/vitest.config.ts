import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const electronStub = fileURLToPath(new URL('./test/electron-stub.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // Browser-domain modules import Electron at module top; pure-logic tests
      // run outside Electron (see test/electron-stub.ts).
      { find: /^electron$/u, replacement: electronStub },
    ],
  },
})
