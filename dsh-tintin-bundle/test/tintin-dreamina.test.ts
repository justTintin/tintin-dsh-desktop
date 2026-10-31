// test/tintin-dreamina.test.ts — 即梦 CLI 宿主门回归（2026-10-25）
// 覆盖：dreamina-logic.js 纯函数（参数组包白名单/比例支持集/输出解析三态/
// 媒体 URL 深收集/状态汇总）+ dreamina-cli.js 通道行为（缺二进制 error 包装、
// generate 参数校验短路——不 spawn、不耗积分）。真实 CLI 端到端走真实启动验收。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DREAMINA_GENERATE_COMMANDS,
  buildGenerateArgs,
  extractGenStatus,
  extractMediaUrls,
  extractSubmitId,
  parseCliOutput,
  summarizeStatus,
} from 'dsh-tintin-shared/lib/dreamina-logic.js'
import { createDreaminaApi, dreaminaDownloadRoot, resolveDreaminaBin } from 'dsh-tintin-shared/lib/dreamina.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('dreamina-logic 参数组包（-h 实测口径）', () => {
  it('命令白名单=8 个 Generator Commands，非法命令报错', () => {
    expect(DREAMINA_GENERATE_COMMANDS).toEqual([
      'text2image', 'image2image', 'text2video', 'image2video',
      'frames2video', 'multiframe2video', 'multimodal2video', 'image_upscale',
    ])
    expect(() => buildGenerateArgs({ command: 'dream', prompt: 'x' })).toThrow(/不支持的生成命令/)
  })

  it('text2image：prompt 必填、比例合法直传、resolution_type 透传', () => {
    expect(buildGenerateArgs({ command: 'text2image', prompt: 'a cat', ratio: '1:1', resolutionType: '2k' }))
      .toEqual(['text2image', '--prompt=a cat', '--ratio=1:1', '--resolution_type=2k'])
  })

  it('「智能」比例=不传（CLI 自行推断）；不支持比例报错不静默（铁律 6）', () => {
    expect(buildGenerateArgs({ command: 'text2image', prompt: 'x', ratio: '智能' }))
      .toEqual(['text2image', '--prompt=x'])
    expect(() => buildGenerateArgs({ command: 'text2video', prompt: 'x', ratio: '2:3' })).toThrow(/不支持比例「2:3」/)
    expect(() => buildGenerateArgs({ command: 'text2video', prompt: 'x', ratio: '3:2' })).toThrow(/不支持比例/)
    expect(() => buildGenerateArgs({ command: 'text2image', prompt: 'x', ratio: '2:3' })).not.toThrow()
  })

  it('image2image：--images 逐张重复、1-10 张边界；image2video：--image 取首张', () => {
    const two = buildGenerateArgs({ command: 'image2image', prompt: 'x', images: ['C:/a.png', 'C:/b.jpg'] })
    expect(two).toContain('--images=C:/a.png')
    expect(two).toContain('--images=C:/b.jpg')
    expect(() => buildGenerateArgs({ command: 'image2image', prompt: 'x', images: [] })).toThrow(/至少需要 1 张/)
    expect(() => buildGenerateArgs({ command: 'image2image', prompt: 'x', images: Array.from({ length: 11 }, (_, i) => `${i}.png`) })).toThrow(/最多 10 张/)
    expect(buildGenerateArgs({ command: 'image2video', prompt: 'x', images: ['C:/a.png', 'C:/b.png'] }))
      .toEqual(['image2video', '--prompt=x', '--image=C:/a.png'])
    expect(() => buildGenerateArgs({ command: 'image2video', prompt: 'x' })).toThrow(/首帧图/)
  })

  it('数值域校验：generate_num 1-10、duration 正整数、poll 非负、width/height 成对', () => {
    expect(() => buildGenerateArgs({ command: 'text2image', prompt: 'x', generateNum: 11 })).toThrow(/1-10/)
    expect(() => buildGenerateArgs({ command: 'text2video', prompt: 'x', duration: 0 })).toThrow(/正整数/)
    expect(() => buildGenerateArgs({ command: 'text2image', prompt: 'x', poll: -1 })).toThrow(/非负/)
    expect(() => buildGenerateArgs({ command: 'text2image', prompt: 'x', width: 1024 })).toThrow(/成对/)
    expect(buildGenerateArgs({ command: 'text2image', prompt: 'x', width: 1024, height: 768 }))
      .toEqual(['text2image', '--prompt=x', '--width=1024', '--height=768'])
  })
})

describe('dreamina-logic 输出解析（实测形态）', () => {
  it('JSON 文本（user_credit/--version/list_task）→ json', () => {
    const r = parseCliOutput('{"total_credit": 11101, "user_id": "3898217671428343"}')
    expect(r.kind).toBe('json')
    expect(extractSubmitId(r)).toBe('')
  })

  it('key: value 行（login 设备码材料）→ kv', () => {
    const r = parseCliOutput('verification_uri: https://x\nuser_code: abc\ndevice_code: def\nexpires_at: 2026-10-25T16:42:05+08:00')
    expect(r.kind).toBe('kv')
    if (r.kind !== 'kv') return
    expect(r.value.user_code).toBe('abc')
  })

  it('人类可读文本 → raw 原样；空串 → raw 空', () => {
    expect(parseCliOutput('ID              NAME').kind).toBe('raw')
    expect(parseCliOutput('').value).toBe('')
  })

  it('extractMediaUrls 深收集 url 键的 http(s) 字符串并去重', () => {
    const urls = extractMediaUrls({
      data: { video_url: 'https://cdn/x.mp4', cover: { image_url: 'https://cdn/y.jpg', note: 'no-url-key' } },
      list: [{ download_url: 'https://cdn/x.mp4' }, { download_url: 'https://cdn/z.png' }],
    })
    expect(urls).toEqual(['https://cdn/x.mp4', 'https://cdn/y.jpg', 'https://cdn/z.png'])
  })

  it('summarizeStatus：登录/未登录/缺二进制三态', () => {
    const loggedIn = summarizeStatus({
      bin: 'C:/u/bin/dreamina.exe',
      versionParsed: parseCliOutput('{"version":"1.4.21"}'),
      creditParsed: parseCliOutput('{"total_credit":11101,"user_id":"42","vip_level":"maestro"}'),
      creditError: '',
    })
    expect(loggedIn).toMatchObject({ available: true, version: '1.4.21', loggedIn: true, credit: 11101, vipLevel: 'maestro' })
    const loggedOut = summarizeStatus({ bin: 'x', versionParsed: parseCliOutput('{}'), creditParsed: parseCliOutput(''), creditError: '未检测到有效登录态，请先执行 dreamina login' })
    expect(loggedOut.loggedIn).toBe(false)
    expect(loggedOut.error).toBe('未登录')
    const missing = summarizeStatus({ bin: '', versionParsed: parseCliOutput(''), creditParsed: parseCliOutput(''), creditError: '' })
    expect(missing.available).toBe(false)
  })
})

describe('dreamina-cli 通道行为（不 spawn 的短路路径）', () => {
  it('generate：非法 payload 在组包层短路，返回 {ok:false,error}', async () => {
    const api = createDreaminaApi({})
    const entry = api['dreamina:generate'] as (args: unknown[]) => Promise<{ ok?: boolean; error?: string }>
    const res = await entry([{ command: 'nope', prompt: 'x' }])
    expect(res.ok).toBe(false)
    expect(String(res.error)).toContain('不支持的生成命令')
  })

  it('二进制定位：env 显式优先、win 默认 %USERPROFILE%\\bin、linux ~/.local/bin、裸名兜底', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dreamina-bin-'))
    tmpDirs.push(dir)
    // env 显式路径存在即直返（不校验扩展名）
    expect(resolveDreaminaBin({ TINTIN_DREAMINA_BIN: process.execPath, USERPROFILE: dir }, 'win32')).toBe(process.execPath)
    // 默认链：文件真实存在才采用；不存在回退 PATH 裸名
    expect(resolveDreaminaBin({ USERPROFILE: dir }, 'win32')).toBe('dreamina')
    expect(resolveDreaminaBin({ HOME: dir }, 'linux')).toBe('dreamina')
    mkdirSync(join(dir, 'bin'), { recursive: true })
    writeFileSync(join(dir, 'bin', 'dreamina.exe'), '')
    expect(resolveDreaminaBin({ USERPROFILE: dir }, 'win32')).toBe(join(dir, 'bin', 'dreamina.exe'))
    mkdirSync(join(dir, '.local', 'bin'), { recursive: true })
    writeFileSync(join(dir, '.local', 'bin', 'dreamina'), '')
    expect(resolveDreaminaBin({ HOME: dir }, 'linux')).toBe(join(dir, '.local', 'bin', 'dreamina'))
  })

  it('download 根与工作区同源（Documents/tintin-workspace/dreamina）', () => {
    expect(dreaminaDownloadRoot({ USERPROFILE: 'C:/u' }).replace(/\\/g, '/')).toBe('C:/u/Documents/tintin-workspace/dreamina')
  })
})
