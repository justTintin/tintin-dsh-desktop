// tests/film-chat.spec.ts — 影片聊天存档的读档视图:零内容非终态轮次(僵尸记录)丢弃不回显。
// 背景(2026-11-04): 应用被关闭在半路的空轮次每次进聊天都显示一条红字
// 「OpenFilm closed while the agent was working on this.」, 纯噪音。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { filmChat } from '../src/tintin/film-chat.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function projectWithTurns(turns: unknown[]): string {
  const project = mkdtempSync(join(tmpdir(), 'tintin-film-chat-'))
  dirs.push(project)
  mkdirSync(join(project, '.film'), { recursive: true })
  writeFileSync(join(project, '.film', 'chat.json'), `${JSON.stringify({ sessions: [], last: null, turns }, null, 2)}\n`, 'utf8')
  return project
}

const turn = (id: string, status: string) => ({ turn: { id, status, updatedAt: '2026-10-29T03:04:00.000Z' }, items: [] as unknown[] })
const turnWithItems = (id: string, status: string, items: unknown[]) => ({ turn: { id, status, updatedAt: '2026-10-29T03:04:00.000Z' }, items })

describe('filmChat.load 僵尸轮次过滤', () => {
  it('零内容非终态轮次(generating/failing/canceling)读档丢弃', () => {
    const project = projectWithTurns([
      turn('local:r1', 'generating'),
      turn('local:r2', 'failing'),
      turn('local:r3', 'canceling'),
    ])
    expect(filmChat.load(project).turns).toEqual([])
  })

  it('有内容的中断轮次保留(中断说明对用户仍有价值), 已完成轮次保留', () => {
    const project = projectWithTurns([
      turnWithItems('local:done', 'ready', [{ kind: 'prompt', text: '生成 BGM' }]),
      turnWithItems('local:cut', 'generating', [{ kind: 'prompt', text: '生成 BGM' }]),
      turn('local:empty-done', 'ready'),
    ])
    const ids = filmChat.load(project).turns.map((t) => (t.turn as { id: string }).id)
    expect(ids).toEqual(['local:done', 'local:cut', 'local:empty-done'])
  })

  it('不改写磁盘: 僵尸记录留在 chat.json, 只影响读出', () => {
    const project = projectWithTurns([turn('local:r1', 'generating')])
    void filmChat.load(project)
    const raw = JSON.parse(readChatRaw(project)) as { turns: unknown[] }
    expect(raw.turns).toHaveLength(1)
  })

  it('saveTurn 与读档视图兼容: 新轮次照常追加', () => {
    const project = projectWithTurns([turn('local:r1', 'generating')])
    filmChat.saveTurn(project, { id: 'local:new', status: 'generating' }, [{ kind: 'prompt', text: 'hi' }])
    const ids = filmChat.load(project).turns.map((t) => (t.turn as { id: string }).id)
    expect(ids).toEqual(['local:new'])
  })

  function readChatRaw(project: string): string {
    return readFileSync(join(project, '.film', 'chat.json'), 'utf8')
  }
})

describe('filmChat.log 0.3 增量读语义', () => {
  // 背景(2026-11-07): 上游 0.3 起 chat.log 收 since=上次读位次(TurnLogAt), 无 whole 字段时
  // 聊天侧每 1.5s 把整份尾读追加进已显示列表 —— 运行中轮次日志重复翻倍。
  function projectWithLog(body: string): string {
    const project = mkdtempSync(join(tmpdir(), 'tintin-film-log-'))
    dirs.push(project)
    mkdirSync(join(project, '.film', 'logs'), { recursive: true })
    writeFileSync(join(project, '.film', 'logs', 't1.jsonl'), body, 'utf8')
    return project
  }
  const line = (kind: string, n: number) => `${JSON.stringify({ t: n, kind, n })}\n`

  it('整读(无 since): whole=true + at=文件字节长, 尾 200 条截断时 cut=true', () => {
    const project = projectWithLog(line('a', 1) + line('b', 2))
    const whole = filmChat.log(project, 't1')
    expect(whole).toMatchObject({ whole: true, cut: false, callsWhole: true, callsCut: false, at: { events: (line('a', 1) + line('b', 2)).length, calls: 0, callsFile: 0 } })
    expect((whole as { events: unknown[] }).events).toHaveLength(2)
  })

  it('增量读(since): 只回位次之后的新事件, whole=false', () => {
    const head = line('a', 1)
    const project = projectWithLog(head + line('b', 2))
    const fresh = filmChat.log(project, 't1', { events: head.length, calls: 0, callsFile: 0 })
    expect(fresh).toMatchObject({ whole: false, at: { calls: 0 } })
    if (!fresh || !('events' in fresh)) throw new Error('增量读应回事件')
    expect(fresh.events.map((e) => e.kind)).toEqual(['b'])
  })

  it('无新增(since=当前长度)回 {same:true}, 文件回缩(位次越界)回落整读', () => {
    const project = projectWithLog(line('a', 1))
    expect(filmChat.log(project, 't1', { events: line('a', 1).length, calls: 0, callsFile: 0 })).toEqual({ same: true })
    const shrank = filmChat.log(project, 't1', { events: 9999, calls: 0, callsFile: 0 })
    expect(shrank).toMatchObject({ whole: true })
  })
})
