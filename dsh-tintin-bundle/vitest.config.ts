import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Host-singleton resolution for tests: @deepseek-ai/* packages are provided by
// the host runtime, and the bundle must not carry private copies (see
// docs/tintin-migration-plan.md and the repo AGENTS.md dependency rules).
// The Beta desktop install is the same singleton base the runtime host
// fallback resolves against, so tests alias onto it.
const hostBase = fileURLToPath(new URL('../dsh-plugin-desktop-beta/node_modules/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@deepseek-ai\/(.*)$/u,
        replacement: `${hostBase}@deepseek-ai/$1`,
      },
    ],
  },
})
