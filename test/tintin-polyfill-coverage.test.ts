// Contract audit for the window.tintin polyfill: every named server.<method>
// the media bundle calls must exist as an explicit mapping in
// packages/tintin-bundle/client.js. The Proxy auto-forwards unmapped names to
// /tintin/ipc/server:<method>, which the host answers with 404 unknown-channel
// — the renderer then degrades to an empty list and the user sees e.g. Step2
// "no voice samples" (2026-09-24 incident: ttsVoicesSamples was unmapped).
// HTTP verbs (get/post/put/delete/upload) are generic and always allowed.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const bundleRoot = join(import.meta.dirname, '..', 'packages')
const clientJs = readFileSync(join(bundleRoot, 'tintin-bundle', 'client.js'), 'utf8')
const mediaSrcRoot = join(bundleRoot, 'tintin-media-bundle', 'src')

/** Every source file below a directory (media src: ts/vue; host lib: js). */
function listSourceFiles(dir: string, ext = /\.(ts|vue|tsx)$/): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full, ext))
    else if (ext.test(name)) out.push(full)
  }
  return out
}

const GENERIC_METHODS = new Set(['get', 'post', 'put', 'delete', 'upload'])

// Named methods still unmapped ON PURPOSE: the local-montage family (ffmpeg
// edge trim / concat-clips / final validation) and the remaining audio
// download family are scheduled with the WP-3 Step2-4 on-machine integration
// work package (docs/tintin-port-execution-plan.zh.md) — before those steps
// ship, each entry here must gain a real mapping and leave this set.
// Everything else must map immediately; this audit exists because an unmapped
// name 404s silently (2026-09-24 incident: ttsVoicesSamples → Step2 no
// samples). downloadResult/audioLibraryUpload left the list when the
// voice-clone port landed (they are mapped via host channels now).
const PENDING_METHODS = new Set([
  'trimEdgeClips', 'clearMontageCache', 'montageConcatClips', 'montageValidateFinal', 'montageDeleteBadFinal',
  'audioArchiveGen', 'audioBgmUpload', 'audioDownloadTemp',
])

/** Named methods referenced as .server.<name>(...) across media sources. */
function collectUsedMethods(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  const pattern = /\.server\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g
  for (const file of listSourceFiles(mediaSrcRoot)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(pattern)) {
      const name = match[1]
      if (name === undefined || GENERIC_METHODS.has(name)) continue
      const where = used.get(name) ?? []
      where.push(file.replace(mediaSrcRoot, ''))
      used.set(name, where)
    }
  }
  return used
}

/** Keys explicitly mapped inside the polyfill's `const server = namespaced(...)` object. */
function collectMappedMethods(): Set<string> {
  const start = clientJs.indexOf('const server = namespaced')
  const end = clientJs.indexOf('})()', start)
  expect(start, 'polyfill server namespace block not found').toBeGreaterThan(0)
  expect(end, 'polyfill server namespace block not terminated').toBeGreaterThan(start)
  const block = clientJs.slice(start, end)
  const mapped = new Set<string>()
  for (const match of block.matchAll(/^\s{8}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)) {
    const key = match[1]
    if (key !== undefined) mapped.add(key)
  }
  // Upload helpers built inside the IIFE spread (montageSplit & co.) sit at a
  // deeper indent; catch them too (both uploadNamed(...) and direct call(...)
  // arrow forms).
  for (const match of block.matchAll(/^\s{10,}([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:\([^)]*\)\s*=>\s*(?:uploadNamed|call)|uploadNamed)/gm)) {
    const key = match[1]
    if (key !== undefined) mapped.add(key)
  }
  return mapped
}

describe('tintin polyfill server-method coverage', () => {
  it('every named server.<method> used by the media bundle is mapped in the polyfill', () => {
    const used = collectUsedMethods()
    const mapped = collectMappedMethods()
    const missing = [...used.entries()].filter(([name]) => !mapped.has(name) && !PENDING_METHODS.has(name))
    expect(
      missing.map(([name, where]) => `${name} (used in ${where.join(', ')})`),
      'unmapped server methods fall through to /tintin/ipc/server:<name> and 404',
    ).toEqual([])
  })

  it('the pending allowlist only names methods that are still genuinely used', () => {
    const used = collectUsedMethods()
    const stale = [...PENDING_METHODS].filter((name) => !used.has(name))
    expect(stale, 'stale allowlist entries must be removed once their call sites are gone').toEqual([])
  })

  it('the 2026-09-24 incident methods are covered (ttsVoicesSamples family)', () => {
    const mapped = collectMappedMethods()
    for (const name of ['ttsVoicesSamples', 'ttsQwen3Voices', 'ttsUploadSample', 'asrTranscribe']) {
      expect(mapped.has(name), `${name} must stay mapped`).toBe(true)
    }
  })

  it('host native channels exist for every channel the polyfill dispatches', async () => {
    // Static double-check of the channel table: polyfill may only name
    // channels the host actually registers (nativeChannels ∪ server routes).
    const channels = new Set<string>()
    for (const match of clientJs.matchAll(/call\('([^']+)'/g)) {
      const channel = match[1]
      if (channel !== undefined) channels.add(channel)
    }
    const hostIndex = readFileSync(join(bundleRoot, 'tintin-bundle', 'index.js'), 'utf8')
    const registered = new Set<string>()
    for (const match of hostIndex.matchAll(/'([a-z-]+:[a-zA-Z]+)'\s*:/g)) {
      const key = match[1]
      if (key !== undefined) registered.add(key)
    }
    const dispatchable = [...channels].filter((channel) => {
      // server:<verb> generic routes always exist; everything else must be
      // named verbatim by the host index or one of the ported lib modules
      // (montage/ffmpeg gate, jianying audio sync, …) that the index mounts.
      if (channel.startsWith('server:')) return true
      if (registered.has(channel)) return true
      const libRoot = join(bundleRoot, 'tintin-bundle', 'lib')
      const libText = listSourceFiles(libRoot, /\.js$/)
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n')
      return libText.includes(`'${channel}'`) || libText.includes(`"${channel}"`)
    })
    expect(dispatchable, 'polyfill channels without a host handler 404 at runtime').toEqual([...channels])
  })
})
