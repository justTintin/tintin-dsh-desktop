// B站扩展下载链接捕获/轮询（SRC thick-shell-viewpool.js console-message + 2s 轮询对拍；
// 2026-10-26 下载扩展链复活工作包）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachBiliDlConsoleCapture,
  parseBiliDlConsoleMessage,
  startBiliExtPolling,
  type BiliDlWebContentsLike,
} from '../src/browser/bili-ext-dl.ts'

describe('parseBiliDlConsoleMessage（SRC console-message 分支 1:1）', () => {
  it('解析 [TINTIN_BILI_DL] 前缀后的 JSON 推送', () => {
    const r = parseBiliDlConsoleMessage('[TINTIN_BILI_DL]{"hostFound":true,"downloads":[{"url":"https://x"}]}')
    expect(r).toEqual({ payload: { hostFound: true, downloads: [{ url: 'https://x' }] } })
  })
  it('非该前缀 / 坏 JSON → null（不抛）', () => {
    expect(parseBiliDlConsoleMessage('普通 console 日志')).toBeNull()
    expect(parseBiliDlConsoleMessage('[TINTIN_BILI_DL]{bad json')).toBeNull()
    expect(parseBiliDlConsoleMessage('')).toBeNull()
    expect(parseBiliDlConsoleMessage(undefined)).toBeNull()
  })
  it('前缀出现在消息中段也能解析（Electron 会在 message 里带来源）', () => {
    const r = parseBiliDlConsoleMessage('info: [TINTIN_BILI_DL]{"a":1}')
    expect(r).toEqual({ payload: { a: 1 } })
  })
})

describe('attachBiliDlConsoleCapture', () => {
  it('console-message 事件命中前缀即推送 payload', () => {
    let listener: ((raw: unknown) => void) | null = null
    const wc = {
      isDestroyed: () => false,
      getURL: () => '',
      executeJavaScript: async () => null,
      on: (_e: 'console-message', l: (raw: unknown) => void) => { listener = l },
    }
    const pushed: unknown[] = []
    attachBiliDlConsoleCapture(wc, (p) => pushed.push(p))
    expect(listener).not.toBeNull()
    listener!('[TINTIN_BILI_DL]{"downloads":[1,2]}')
    expect(pushed).toEqual([{ downloads: [1, 2] }])
    listener!('无关消息')
    expect(pushed.length).toBe(1)
  })
  it('无 on 能力的 wc 静默跳过（防御）', () => {
    const wc: BiliDlWebContentsLike = { isDestroyed: () => false, getURL: () => '', executeJavaScript: async () => null }
    expect(() => attachBiliDlConsoleCapture(wc, () => {})).not.toThrow()
  })
})

describe('startBiliExtPolling（SRC L371-396 轮询语义）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function makeWc(url: string, destroyed = false): BiliDlWebContentsLike & { executeCalls: string[] } {
    const wc = {
      executeCalls: [] as string[],
      isDestroyed: () => destroyed,
      getURL: () => url,
      executeJavaScript: async (script: string) => {
        wc.executeCalls.push(script)
        return { hostFound: true, downloads: [{ url: 'https://upos.example/x.m4s' }] }
      },
    }
    return wc
  }

  it('B站页面上执行注入脚本并把结果推给 push', async () => {
    const wc = makeWc('https://www.bilibili.com/video/BV1xx411c7mD')
    const pushed: unknown[] = []
    startBiliExtPolling({
      getWebContents: () => wc,
      push: (p) => pushed.push(p),
      script: 'FAKE_SCRIPT',
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(wc.executeCalls).toEqual(['FAKE_SCRIPT'])
    expect(pushed).toEqual([{ hostFound: true, downloads: [{ url: 'https://upos.example/x.m4s' }] }])
  })

  it('非 B站域名跳过本轮；downloads 为空不推送', async () => {
    const wc = makeWc('https://www.douyin.com/video/7412345678901234567')
    const pushed: unknown[] = []
    startBiliExtPolling({ getWebContents: () => wc, push: (p) => pushed.push(p), script: 'S' })
    await vi.advanceTimersByTimeAsync(6000)
    expect(wc.executeCalls.length).toBe(0)
    expect(pushed.length).toBe(0)

    const emptyWc = makeWc('https://www.bilibili.com/video/BV1xx')
    emptyWc.executeJavaScript = async () => ({ hostFound: true, downloads: [] })
    const pushed2: unknown[] = []
    startBiliExtPolling({ getWebContents: () => emptyWc, push: (p) => pushed2.push(p), script: 'S' })
    await vi.advanceTimersByTimeAsync(6000)
    expect(pushed2.length).toBe(0)
  })

  it('webContents 销毁 → 自动停表（SRC 语义：销毁后不再 executeJavaScript）', async () => {
    let destroyed = false
    const wc = makeWc('https://www.bilibili.com/video/BV1xx')
    wc.isDestroyed = () => destroyed
    const execute = vi.fn(async () => ({ downloads: [] }))
    const stop = startBiliExtPolling({ getWebContents: () => (destroyed ? null : wc), push: () => {}, execute, script: 'S' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(execute).toHaveBeenCalledTimes(1)
    destroyed = true
    await vi.advanceTimersByTimeAsync(8000)
    expect(execute).toHaveBeenCalledTimes(1)
    stop()
  })

  it('executeJavaScript 拒绝（页面跳转中）不炸轮询', async () => {
    const wc = makeWc('https://www.bilibili.com/video/BV1xx')
    wc.executeJavaScript = async () => { throw new Error('navigating') }
    const stop = startBiliExtPolling({ getWebContents: () => wc, push: () => {}, script: 'S' })
    await vi.advanceTimersByTimeAsync(6000)
    stop()
  })
})
