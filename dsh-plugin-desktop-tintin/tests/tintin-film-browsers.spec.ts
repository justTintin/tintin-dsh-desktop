import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { devFilmBrowsersDir, resolveFilmBrowsersDir, runtimeFilmBrowsersDir, stagedFilmBrowsersDir } from '../src/tintin/film-browsers.ts'

const roots: string[] = []

function scenario(): { root: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'tintin-film-browsers-'))
  roots.push(root)
  const home = join(root, 'home')
  mkdirSync(home, { recursive: true })
  return { root, home }
}

/** 在 root 下造一个 dev staging 布局(root/a/b/c/fake.ts → root/tintin-resources/…)。 */
function seedDevStaging(root: string, files: readonly string[] = ['chromium-1228']): void {
  const moduleDir = join(root, 'a', 'b', 'c')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(moduleDir, 'fake.ts'), 'export {}')
  const dir = devFilmBrowsersDir(join(moduleDir, 'fake.ts'))
  mkdirSync(dir, { recursive: true })
  for (const file of files) writeFileSync(join(dir, file), 'x')
  return undefined
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('film browsers directory resolution', () => {
  it('prefers the packaged staging copy while it is non-empty', () => {
    const { root, home } = scenario()
    const staged = stagedFilmBrowsersDir(join(root, 'resources'))
    mkdirSync(staged, { recursive: true })
    writeFileSync(join(staged, 'chromium-1228'), 'x')
    expect(resolveFilmBrowsersDir({ resourcesPath: join(root, 'resources'), moduleUrl: join(root, 'a', 'b', 'c', 'fake.ts'), homeDirectory: home }))
      .toBe(staged)
  })

  it('ignores an empty staging copy and falls back to the dev staging copy', () => {
    const { root, home } = scenario()
    const staged = stagedFilmBrowsersDir(join(root, 'resources'))
    mkdirSync(staged, { recursive: true })
    seedDevStaging(root)
    const resolved = resolveFilmBrowsersDir({ resourcesPath: join(root, 'resources'), moduleUrl: join(root, 'a', 'b', 'c', 'fake.ts'), homeDirectory: home })
    expect(resolved).toBe(devFilmBrowsersDir(join(root, 'a', 'b', 'c', 'fake.ts')))
  })

  it('resolves the channel-home runtime directory when no staging exists anywhere', () => {
    const { root, home } = scenario()
    const resolved = resolveFilmBrowsersDir({ resourcesPath: join(root, 'resources'), moduleUrl: join(root, 'a', 'b', 'c', 'fake.ts'), homeDirectory: home })
    expect(resolved).toBe(runtimeFilmBrowsersDir({ homeDirectory: home }))
    expect(resolved.endsWith('playwright-browsers')).toBe(true)
  })

  it('keeps the runtime download target stable for repeated resolutions', () => {
    const { root, home } = scenario()
    const first = resolveFilmBrowsersDir({ resourcesPath: join(root, 'resources'), moduleUrl: join(root, 'a', 'b', 'c', 'fake.ts'), homeDirectory: home })
    const second = resolveFilmBrowsersDir({ resourcesPath: join(root, 'resources'), moduleUrl: join(root, 'a', 'b', 'c', 'fake.ts'), homeDirectory: home })
    expect(first).toBe(second)
  })
})
