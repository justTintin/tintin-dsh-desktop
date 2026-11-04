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
