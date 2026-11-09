// OpenFilm provider seeding (server-driven media, 2026-10-18 用户裁决 A):
// OpenFilm's own media layer (`openfilm get`) is fed by providers that need the
// person's paid keys. TinTin's requirement is the opposite: the TinTin server
// provides the models and the media capabilities. OpenFilm's documented
// extension point for that is a "custom service" kept in ~/.openfilm/providers.json
// (`custom[]`), called by the agent as `openfilm get call --service tintin ...`.
// This module upserts that one entry, preserving everything else in the file —
// keys, provider choices and other services belong to the person and to any
// other OpenFilm on the machine.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const TINTIN_SERVICE_ID = 'tintin'
export const TINTIN_SERVICE_NAME = 'TinTin 服务端'

/** What `openfilm get` shows the agent about the service: which kinds it makes and how they are called.
 * One capability per line — Studio's custom-service page renders the note with `whitespace-pre-line`
 * (ui CustomServices.tsx), so '\n' shows each service on its own row instead of one wrapped blob. */
export const TINTIN_SERVICE_NOTE = [
  'TinTin AI service platform (no key).',
  'Generation (preferred): MCP tools at /mcp - create_image (mode=t2i text-to-image | mode=cover), create_video (comfygen t2v, async task), create_music (MusicGen BGM, sync), create_audio (kind=sfx | kind=tts voice clone), create_digital_human (image|lipsync), upload_file, task_status_unified (polling), server_health.',
  'tts: POST /indextts/tts {text, resp:"json", sample_id} -> {audio_url} (relative; call again with --path <audio_url> --out <name>);',
  'voices: GET /voice/samples, GET /indextts/qwen3/voices;',
  'asr: POST /whisper/transcribe multipart file=<wav|mp4> + fmt=json + mode=raw -> {segments:[{text,start,end,words:[{word,start,end}]}]} (word timings);',
  'matting: POST /matting multipart file=<image> -> PNG bytes (binary image body, no JSON wrapper);',
  'music: POST /audio/gen/bgm {prompt, style, duration} -> {url, duration} (absolute; first call may take minutes while the model loads);',
  'sfx: POST /audio/gen/sfx {prompt} -> {url} (BROKEN 2026-11-09: 500 KeyError path, trace tt_bc0775a9a7b1 / tt_586738f76833; MCP create_audio kind=sfx returns the same - server-side fix pending);',
  'stock images: POST /material/stock_search {query, kind:"image"} -> {items:[{url}]}.',
].join('\n')

const plain = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})

/**
 * The providers document with the TinTin service upserted. Everything the file
 * already held is kept: `keys`, `use`, `model`, unknown top-level fields, the
 * service's own key when a person set one, and every other custom service.
 * @param {unknown} raw the parsed providers.json
 * @param {string} serverUrl TinTin server base URL
 * @returns {Record<string, unknown>}
 */
export function mergeTinTinService(raw, serverUrl) {
  const doc = { ...plain(raw) }
  const current = Array.isArray(doc.custom) ? doc.custom.filter((s) => s && typeof s === 'object') : []
  const existing = /** @type {Record<string, unknown> | undefined} */ (current.find((s) => s.id === TINTIN_SERVICE_ID))
  const url = String(serverUrl || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('server.url 未配置：无法注册 OpenFilm 的 TinTin 服务')
  const service = {
    ...(existing ?? {}),
    id: TINTIN_SERVICE_ID,
    name: TINTIN_SERVICE_NAME,
    url,
    auth: typeof existing?.auth === 'string' && existing.auth.includes('{key}')
      ? existing.auth
      : 'Authorization: Bearer {key}',
    note: TINTIN_SERVICE_NOTE,
  }
  doc.custom = [...current.filter((s) => s.id !== TINTIN_SERVICE_ID), service]
  return doc
}

/**
 * Verbs the TinTin provider serves for Studio's built-in features (Settings → Services 的
 * 动词矩阵)。Everything the server serves itself — the fake-OpenAI facade (2026-10-22 的
 * OPENFILM_OPENAI_URL 注入) is retired 2026-11-09 用户裁决: TinTin 服务=一等连接服务。
 */
export const TINTIN_PROVIDER_VERBS = ['tts', 'asr', 'music', 'sfx', 'cutout', 'image', 'image-search', 'video']

/**
 * The providers document with `use` pointed at the TinTin provider: unset kinds default to it,
 * and choices still naming the retired OpenAI facade migrate over — but only while the person
 * has no real OpenAI key (their own choices are never overwritten).
 * @param {unknown} raw the parsed providers.json
 */
export function mergeTinTinProvider(doc) {
  const next = { ...plain(doc) }
  const use = { ...plain(next.use) }
  const hasRealOpenai = Boolean(plain(next.keys).openai)
  for (const verb of TINTIN_PROVIDER_VERBS) {
    const current = String(use[verb] || '').trim()
    if (!current || (current === 'openai' && !hasRealOpenai)) use[verb] = 'tintin'
  }
  next.use = use
  return next
}

/** The providers file path for a home directory: ~/.openfilm/providers.json. */
export const providersFilePath = (homeDir) => join(String(homeDir || ''), '.openfilm', 'providers.json')

/** Read a providers file by path; {} when absent or unreadable (a broken file must not block seeding). */
export function readProvidersAt(filePath) {
  try {
    return plain(JSON.parse(readFileSync(filePath, 'utf8')))
  } catch {
    return {}
  }
}

/** Read the providers file; {} when absent or unreadable (a broken file must not block seeding). */
export function readProvidersDocument(homeDir) {
  return readProvidersAt(providersFilePath(homeDir))
}

/**
 * Upsert the TinTin service into one providers file. Returns `{ path, changed }`;
 * a no-op when the service is already current. The file is written whole and
 * atomically (0600), as OpenFilm itself writes it. `openaiCompat` additionally
 * defaults `use` to the compat provider for the verbs the server's OpenAI /v1
 * surface serves — meant for the isolated Studio home only.
 * @param {{ filePath: string, serverUrl: string, openaiCompat?: boolean }} options
 */
export function syncProvidersAt({ filePath, serverUrl, openaiCompat = false }) {
  const path = filePath
  const before = readProvidersAt(path)
  let after = mergeTinTinService(before, serverUrl)
  if (openaiCompat) after = mergeTinTinProvider(after)
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  if (!changed && existsSync(path)) return { path, changed: false }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
  try { chmodSync(path, 0o600) } catch { /* Windows 无 POSIX 位：忽略 */ }
  return { path, changed: true }
}

/**
 * Upsert the TinTin service into ~/.openfilm/providers.json (the shared home the
 * OpenFilm app and the `openfilm` CLI on PATH read).
 * @param {{ homeDir: string, serverUrl: string }} options
 */
export function syncProvidersFile({ homeDir, serverUrl }) {
  return syncProvidersAt({ filePath: providersFilePath(homeDir), serverUrl })
}
