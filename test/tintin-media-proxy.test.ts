// test/tintin-media-proxy.test.ts — 媒体/音频域原生通道回归（lib/media-proxy.js）
// rembg:submit：POST /matting（multipart: file+model）同步回 PNG 二进制，
// 宿主落盘原图同目录 `{原名}_matting.png` 返 {path, bytes}；离线 → null、
// 其余失败 → {error}（SRC media-proxy-ipc.js:22-45 契约，铁律 6/7）。
// audio:downloadTemp / audio:archiveGen / audio:bgmUpload：音频生成域三通道
// （SRC server-proxy.js:938-1032 契约，2026-09-25 随音频生成卡移植）。
// 需要真实服务端/大图的端到端走真实启动验收，不在单测范围。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAudioArchiveApi,
  createRembgApi,
  mattingOutPath,
} from '../packages/tintin-bundle/lib/media-proxy.js'
import { isExpectedOfflineError } from '../packages/tintin-bundle/lib/server-proxy.js'

type Entry = (args: unknown[]) => Promise<unknown> | unknown
type MultipartPart = { name: string; value?: string; path?: string; contentType?: string }
type MultipartPost = (endpoint: string, parts: MultipartPart[], timeout?: number) => Promise<unknown>

function offlineError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8766'), { code: 'ECONNREFUSED' })
}

/** 音频域注入面桩：httpRequest 返回可配置的 ct/raw，记录调用 URL */
function makeAudioDeps(overrides: { ct?: string; raw?: Buffer; err?: Error } = {}) {
  const urls: string[] = []
  const deps = {
    httpRequest: async (method: string, url: string) => {
      urls.push(`${method} ${url}`)
      if (overrides.err) throw overrides.err
      return {
        data: overrides.raw ?? Buffer.alloc(0),
        status: 200,
        headers: { 'content-type': overrides.ct ?? 'audio/mpeg' },
        raw: overrides.raw ?? Buffer.alloc(0),
      }
    },
    getServerUrl: () => 'http://192.168.111.31:8000',
    multipartPost: async (endpoint: string, parts: MultipartPart[]) => ({ endpoint, parts }),
    isExpectedOfflineError,
    tmpDir: tmpdir(),
  }
  return { deps, urls }
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('rembg matting native channels', () => {
  it('registers exactly the rembg:submit channel', () => {
    const api = createRembgApi({ multipartPost: async () => Buffer.alloc(0), isExpectedOfflineError })
    expect(Object.keys(api).sort()).toEqual(['rembg:submit'])
  })

  it('mattingOutPath strips the extension and appends _matting.png next to the original', () => {
    expect(mattingOutPath('C:\\pics\\商品图.jpg')).toBe('C:\\pics\\商品图_matting.png')
    expect(mattingOutPath('/home/u/a.b/photo.PNG')).toBe('/home/u/a.b/photo_matting.png')
    expect(mattingOutPath('noext')).toBe('noext_matting.png')
  })

  it('rembg:submit posts file+model multipart and saves the returned PNG next to the original', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-rembg-'))
    tmpDirs.push(dir)
    const src = join(dir, 'product.jpg')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const calls: Array<{ endpoint: string; parts: Array<{ name: string; value?: string; path?: string }>; timeout: number }> = []
    const api = createRembgApi({
      multipartPost: async (endpoint: string, parts: MultipartPart[], timeout?: number) => {
        calls.push({ endpoint, parts, timeout: timeout ?? 0 })
        return png
      },
      isExpectedOfflineError,
    })
    const submit = api['rembg:submit'] as Entry
    const out = await submit([{ image: src, model: 'u2net' }]) as { path: string; bytes: number }

    expect(calls).toHaveLength(1)
    expect(calls[0]?.endpoint).toBe('/matting')
    expect(calls[0]?.timeout).toBe(600000)
    const filePart = calls[0]?.parts[0]
    expect(filePart?.name).toBe('file')
    expect(filePart?.path).toBe(src)
    expect(calls[0]?.parts[1]).toEqual({ name: 'model', value: 'u2net' })
    expect(out.path).toBe(join(dir, 'product_matting.png'))
    expect(out.bytes).toBe(png.length)
    // 铁律 2：落盘字节真实可见
    expect(readFileSync(out.path)).toEqual(png)
  })

  it('omits the model field when the caller sends none (server default applies)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-rembg-'))
    tmpDirs.push(dir)
    const src = join(dir, 'a.png')
    const seen: Array<Array<{ name: string }>> = []
    const api = createRembgApi({
      multipartPost: async (_endpoint: string, parts: MultipartPart[]) => {
        seen.push(parts)
        return Buffer.alloc(1)
      },
      isExpectedOfflineError,
    })
    await (api['rembg:submit'] as Entry)([{ image: src }])
    expect(seen[0]?.map((p) => p.name)).toEqual(['file'])
  })

  it('surfaces a non-image (JSON error) response as {error} with a short detail', async () => {
    const api = createRembgApi({
      multipartPost: async () => ({ detail: '模型资源不可用: u2net' }),
      isExpectedOfflineError,
    })
    const out = await (api['rembg:submit'] as Entry)([{ image: 'Z:\\x\\a.png', model: 'u2net' }])
    expect(out).toEqual({ error: '{"detail":"模型资源不可用: u2net"}' })
  })

  it('maps expected offline failures to null (IpcError contract)', async () => {
    const api = createRembgApi({
      multipartPost: async () => { throw offlineError() },
      isExpectedOfflineError,
    })
    const out = await (api['rembg:submit'] as Entry)([{ image: 'Z:\\x\\a.png', model: 'u2net' }])
    expect(out).toBeNull()
  })

  it('rejects a payload without a string image path', async () => {
    const api = createRembgApi({ multipartPost: async () => Buffer.alloc(0), isExpectedOfflineError })
    const out = await (api['rembg:submit'] as Entry)([{ model: 'u2net' }])
    expect(out).toEqual({ error: 'rembg:submit missing `image` 本地路径' })
  })
})

describe('audio archive native channels (audio-gen card)', () => {
  it('registers exactly the downloadTemp/archiveGen/bgmUpload channels', () => {
    const { deps } = makeAudioDeps()
    const api = createAudioArchiveApi(deps)
    expect(Object.keys(api).sort()).toEqual([
      'audio:archiveGen', 'audio:bgmUpload', 'audio:downloadTemp',
    ])
  })

  it('downloadTemp resolves relative urls against the server base and picks .wav by content-type', async () => {
    const { deps, urls } = makeAudioDeps({ ct: 'audio/x-wav', raw: Buffer.from('RIFF') })
    const api = createAudioArchiveApi(deps)
    const out = await (api['audio:downloadTemp'] as Entry)([{ url: '/audio/gen/bgm/x', prefix: 'ai_bgm_', defaultExt: '.mp3' }]) as { path: string; contentType: string }
    expect(urls).toEqual(['GET http://192.168.111.31:8000/audio/gen/bgm/x'])
    expect(out.contentType).toBe('audio/x-wav')
    expect(out.path.endsWith('.wav')).toBe(true)
    expect(out.path).toContain(join('tintin_ai_audio', `ai_bgm_${process.pid}.wav`))
    expect(readFileSync(out.path).toString()).toBe('RIFF')
  })

  it('downloadTemp keeps http urls as-is and falls back to defaultExt for unknown content-types', async () => {
    const { deps, urls } = makeAudioDeps({ ct: 'application/octet-stream', raw: Buffer.from('x') })
    const api = createAudioArchiveApi(deps)
    const out = await (api['audio:downloadTemp'] as Entry)([{ url: 'http://other/sfx.aiff', prefix: 'ai_sfx_', defaultExt: '.wav' }]) as { path: string }
    expect(urls).toEqual(['GET http://other/sfx.aiff'])
    expect(out.path.endsWith('.wav')).toBe(true)
  })

  it('archiveGen writes basePath+ext from content-type and reports an empty body as {error}', async () => {
    const { deps, urls } = makeAudioDeps({ ct: 'audio/mpeg', raw: Buffer.from('ID3') })
    const api = createAudioArchiveApi(deps)
    const base = join(mkdtempSync(join(tmpdir(), 'tintin-audio-')), 'outputs', 'ai_audio', 'ai_bgm_20260925_120000')
    tmpDirs.push(dirname(base))
    const out = await (api['audio:archiveGen'] as Entry)([{ url: '/a', basePath: base }]) as { path: string }
    expect(urls).toEqual(['GET http://192.168.111.31:8000/a'])
    expect(out.path).toBe(base + '.mp3')
    expect(readFileSync(out.path).toString()).toBe('ID3')

    // 空响应体：独立的空 raw 桩（上一段桩固定返回 ID3，不复用）
    const emptyApi = createAudioArchiveApi(makeAudioDeps({ raw: Buffer.alloc(0) }).deps)
    const empty = await (emptyApi['audio:archiveGen'] as Entry)([{ url: '/a', basePath: base }])
    expect(empty).toEqual({ error: '服务端返回空内容' })

    const noBase = await (api['audio:archiveGen'] as Entry)([{ url: '/a' }])
    expect(noBase).toEqual({ error: 'audio:archiveGen requires basePath' })
  })

  it('bgmUpload posts file+style/tags/scene/mood multipart; missing file errors', async () => {
    const { deps } = makeAudioDeps()
    const api = createAudioArchiveApi(deps)
    const src = join(mkdtempSync(join(tmpdir(), 'tintin-audio-')), 'bgm.mp3')
    tmpDirs.push(dirname(src))
    writeFileSync(src, 'audio')
    const out = await (api['audio:bgmUpload'] as Entry)([{ filePath: src, style: '轻快', mood: '', scene: '口播' }]) as { endpoint: string; parts: MultipartPart[] }
    expect(out.endpoint).toBe('/audio/bgm/upload')
    expect(out.parts.map((p) => p.name)).toEqual(['file', 'style', 'tags', 'scene', 'mood'])
    expect(out.parts[0]?.path).toBe(src)
    expect(out.parts[1]).toEqual({ name: 'style', value: '轻快' })

    const missing = await (api['audio:bgmUpload'] as Entry)([{}])
    expect(missing).toEqual({ error: 'audio:bgmUpload requires filePath' })
    const gone = await (api['audio:bgmUpload'] as Entry)([{ filePath: 'Z:\\__missing__.mp3' }])
    expect(gone).toEqual({ error: '文件不存在: Z:\\__missing__.mp3' })
  })

  it('maps expected offline failures to null; local file validation errors surface as {error}', async () => {
    const { deps } = makeAudioDeps({ err: offlineError() })
    const api = createAudioArchiveApi(deps)
    await expect((api['audio:downloadTemp'] as Entry)([{ url: '/a' }])).resolves.toBeNull()
    await expect((api['audio:archiveGen'] as Entry)([{ url: '/a', basePath: 'X:\\b' }])).resolves.toBeNull()
    // bgmUpload 的文件存在性校验先于任何网络调用——本地校验错误不是离线，按 {error} 透出
    await expect((api['audio:bgmUpload'] as Entry)([{ filePath: 'Z:\\x.mp3' }]))
      .resolves.toEqual({ error: '文件不存在: Z:\\x.mp3' })
  })
})
