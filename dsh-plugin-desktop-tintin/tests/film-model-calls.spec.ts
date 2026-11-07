// tests/film-model-calls.spec.ts — 模型请求明细(0.3 calls 页签)的数据面: 多帧 zstd 会话
// 日志解压、事件重放、compactCalls 去重、model 日志写/读融合、fileOf 冒号净化。
// 背景(2026-11-07 用户裁决方案 1): 数据从 DSH 子进程自己的会话日志重建(官方对各家 agent
// 的同款做法); 冒号轮次 id 此前写成 NTFS ADS 流, fileOf 净化后 unsaved 恢复首次真正可用。
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { compactCalls, decodeSessionLog, fileOf, findSessionLog, projectSessionKey, reconstructCalls, writeModelLog } from '../src/tintin/film-model-calls.ts'
import { filmChat } from '../src/tintin/film-chat.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tintin-model-calls-'))
  dirs.push(dir)
  return dir
}

describe('decodeSessionLog 多帧 zstd', () => {
  it('两帧拼接的 zstd 全部解出(Node 流式在帧边界停, 须逐帧)', () => {
    const dir = scratch()
    const file = join(dir, 'session.v4.jsonl.zstd')
    const frame1 = zstdCompressSync(Buffer.from('{"type":"session"}\n', 'utf8'))
    const frame2 = zstdCompressSync(Buffer.from('{"type":"user/message"}\n', 'utf8'))
    writeFileSync(file, Buffer.concat([frame1, frame2]))
    expect(decodeSessionLog(file)).toBe('{"type":"session"}\n{"type":"user/message"}\n')
  })
  it('明文 .jsonl 原样回; 损坏文件回 null', () => {
    const dir = scratch()
    const plain = join(dir, 'session.v4.jsonl')
    writeFileSync(plain, 'a\nb\n')
    expect(decodeSessionLog(plain)).toBe('a\nb\n')
    const bad = join(dir, 'bad.jsonl.zstd')
    writeFileSync(bad, Buffer.from([1, 2, 3]))
    expect(decodeSessionLog(bad)).toBeNull()
  })
})

describe('projectSessionKey 对拍实盘', () => {
  it('与 DSH 落盘的项目目录名一致(实机观察值)', () => {
    expect(projectSessionKey('C:\\Users\\Administrator\\Documents\\tintin-workspace\\OpenFilm\\Projects\\one-prompt 2'))
      .toBe('--C-Users-Administrator-Documents-tintin-workspace-OpenFilm-Projects-one-prompt~0020 2--'.replace('~0020 2', '~00202'))
  })
})

describe('reconstructCalls 事件重放', () => {
  const events = [
    { type: 'session', time: null },
    { type: 'system/message', time: 1000, data: { message: { role: 'system', content: [{ type: 'text', text: 'You are a film agent.' }] } } },
    { type: 'request/header', time: 1010, data: { header: { config: { provider: 'tintin-server', model: 'deepseek-v4-flash' }, tools: [{ name: 'create_video', description: 'd' }] } } },
    { type: 'user/message', time: 1020, data: { content: [{ type: 'text', text: '做一段视频' }] } },
    { type: 'assistant/message', time: 1100, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好' }] }, usage: { inputTokens: 500, outputTokens: 7, totalTokens: 900, cacheReadTokens: 400 } } },
    { type: 'tool/call', time: 1110, data: { turn: 1, step: 1, callId: 'call_1', name: 'create_video', arguments: '{"prompt":"x"}' } },
    { type: 'tool/result', time: 1120, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'ok' }], isError: false } } },
    { type: 'assistant/message', time: 1200, data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: '完成' }] }, usage: { inputTokens: 800, outputTokens: 9, cacheReadTokens: 700 } } },
    { type: 'assistant/message', time: 500, data: { message: { role: 'assistant', content: [] }, usage: { inputTokens: 1, outputTokens: 1 } } },
  ]
  it('窗口内的每次带 usage 的 assistant/message 出一次请求; 历史/工具/用量映射对齐官方形状', () => {
    const calls = reconstructCalls(events, 1000, 2000)
    expect(calls).toHaveLength(2)
    const [first, second] = calls as [NonNullable<typeof calls[number]>, NonNullable<typeof calls[number]>]
    expect(first.startedAt).toBe(1100)
    expect(first.systemPrompt).toBe('You are a film agent.')
    expect(first.tools).toEqual([{ name: 'create_video', description: 'd' }])
    expect(first.settings).toMatchObject({ model: 'deepseek-v4-flash', provider: 'tintin-server' })
    expect(first.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '做一段视频' }] }])
    expect(first.answer).toMatchObject({ role: 'assistant', usage: { input: 100, cacheRead: 400, output: 7 } })
    expect(second.answer).toMatchObject({ usage: { input: 100, cacheRead: 700, output: 9 }, responseModel: 'deepseek-v4-flash' })
    /* 第二次请求的历史=第一次的 user+assistant(带合成的 toolCall part)+toolResult */
    expect(second.messages.map((m) => String(m.role))).toEqual(['user', 'assistant', 'toolResult'])
    expect(second.messages[1]?.content).toContainEqual({ type: 'toolCall', id: 'call_1', name: 'create_video', arguments: { prompt: 'x' } })
    expect(second.messages[2]).toMatchObject({ role: 'toolResult', toolCallId: 'call_1', toolName: 'create_video', isError: false })
  })
  it('窗口外的 usage 不出请求; content 里的 image 部分换占位', () => {
    const calls = reconstructCalls(events, 1000, 2000)
    expect(calls.every((c) => c.startedAt >= 1000 && c.startedAt <= 2000)).toBe(true)
    const withImage = reconstructCalls([
      { type: 'user/message', time: 1000, data: { content: [{ type: 'image', inlineData: 'AAAA' }, { type: 'text', text: '看这张' }] } },
      { type: 'assistant/message', time: 1100, data: { message: { content: [] }, usage: { inputTokens: 1 } } },
    ], 1000, 2000)
    expect(withImage[0]?.messages[0]?.content).toEqual([{ type: 'image' }, { type: 'text', text: '看这张' }])
  })
})

describe('compactCalls 去重(官方语义)', () => {
  it('相同消息前缀折叠成 prefix; systemPrompt/tools 变了才重复出现', () => {
    const calls = [
      { startedAt: 1, ms: null, messages: [{ role: 'user', content: 'a' }], answer: { role: 'assistant' }, systemPrompt: 'S', tools: [{ name: 't' }], settings: { model: 'm' } },
      { startedAt: 2, ms: null, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'x' }, { role: 'user', content: 'b' }], answer: { role: 'assistant' }, systemPrompt: 'S', tools: [{ name: 't' }], settings: { model: 'm' } },
      { startedAt: 3, ms: null, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'x' }, { role: 'user', content: 'b' }], answer: { role: 'assistant' }, systemPrompt: 'S2', tools: [{ name: 't' }], settings: { model: 'm' } },
    ]
    const lines = compactCalls(calls as never)
    expect(lines[0]).toMatchObject({ prefix: 0, systemPrompt: 'S', tools: [{ name: 't' }] })
    expect(lines[1]).toMatchObject({ prefix: 1, messages: [{ role: 'assistant', content: 'x' }, { role: 'user', content: 'b' }] })
    expect('systemPrompt' in (lines[1] ?? {})).toBe(false)
    expect(lines[2]).toMatchObject({ prefix: 3, systemPrompt: 'S2' })
    expect('tools' in (lines[2] ?? {})).toBe(false)
  })
})

describe('model 日志写/读融合(fileOf 净化 + filmChat.log)', () => {
  function projectWithTurn(): string {
    const project = scratch()
    mkdirSync(join(project, '.film', 'logs'), { recursive: true })
    writeFileSync(join(project, '.film', 'logs', 'local-t1.jsonl'), `${JSON.stringify({ t: 1, kind: 'prompt', meta: { turnId: 'local:t1' }, text: 'hi' })}\n${JSON.stringify({ t: 2, kind: 'done', ok: true })}\n`, 'utf8')
    return project
  }
  it('写侧落到净化文件名; 读侧融合 calls, 增量与 same 语义齐', () => {
    const project = projectWithTurn()
    writeModelLog(project, 'local:t1', [{ startedAt: 1, ms: null, prefix: 0, messages: [{ role: 'user', content: 'a' }], answer: { role: 'assistant' } }])
    expect(existsSync(join(project, '.film', 'logs', 'local-t1.model.jsonl'))).toBe(true)

    const whole = filmChat.log(project, 'local:t1')
    expect(whole && !('same' in whole) ? whole.whole : false).toBe(true)
    const w = whole as { calls: unknown[]; callsWhole: boolean; at: { events: number; calls: number; callsFile: number } }
    expect(w.calls).toHaveLength(1)
    expect(w.callsWhole).toBe(true)
    expect(w.at.calls).toBeGreaterThan(0)
    expect(w.at.callsFile).not.toBe(0)

    const same = filmChat.log(project, 'local:t1', w.at)
    expect(same).toEqual({ same: true })

    /* 明细文件被整写(身份变化) → 明细回 whole, 事件照常增量 */
    writeModelLog(project, 'local:t1', [{ startedAt: 1, ms: null, prefix: 0, messages: [{ role: 'user', content: 'a' }], answer: { role: 'assistant' } }, { startedAt: 2, ms: null, prefix: 1, messages: [{ role: 'assistant', content: 'x' }], answer: { role: 'assistant' } }])
    const after = filmChat.log(project, 'local:t1', w.at)
    const a = after as { events: unknown[]; calls: unknown[]; callsWhole: boolean }
    expect(a.events).toEqual([])
    expect(a.calls).toHaveLength(2)
    expect(a.callsWhole).toBe(true)
  })
  it('cut 行 → callsCut; unsavedTurns 从 prompt.meta.turnId 反解真 id', () => {
    const project = projectWithTurn()
    const modelFile = join(project, '.film', 'logs', 'local-t1.model.jsonl')
    writeFileSync(modelFile, `${JSON.stringify({ startedAt: 1, prefix: 0, messages: [], answer: null })}\n${JSON.stringify({ t: 3, kind: 'cut', max: 1, dropped: 2 })}\n`, 'utf8')
    const read = filmChat.log(project, 'local:t1') as { callsCut: boolean } | { same: true } | null
    expect(read && !('same' in read) ? read.callsCut : false).toBe(true)

    expect(filmChat.unsavedTurns(project, []).map((t) => t.turnId)).toEqual(['local:t1'])
    expect(filmChat.unsavedTurns(project, ['local:t1'])).toEqual([])
  })
})

describe('findSessionLog/fileOf', () => {
  it('会话日志定位与轮次 id 净化', () => {
    const home = scratch()
    const key = projectSessionKey('D:\\Proj\\A B')
    mkdirSync(join(home, 'sessions', key, 'session-abc'), { recursive: true })
    writeFileSync(join(home, 'sessions', key, 'session-abc', 'session.v4.jsonl.zstd'), 'x')
    expect(findSessionLog(home, 'D:\\Proj\\A B', 'abc')).toBe(join(home, 'sessions', key, 'session-abc', 'session.v4.jsonl.zstd'))
    expect(findSessionLog(home, 'D:\\Proj\\A B', '../evil')).toBeNull()
    expect(fileOf('local:r1')).toBe('local-r1')
  })
})
