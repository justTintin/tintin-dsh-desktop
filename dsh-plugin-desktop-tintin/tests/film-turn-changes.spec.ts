// tests/film-turn-changes.spec.ts — 轮次快照/变更/撤销(0.3 官方语义移植)的核心用例。
// 对齐官方 apps/desktop/src/turn-undo.test.mjs: 删除与改动写回、新增进回收站、
// 原地覆写的二进制如实 missed、无变更不亮撤销、老启动遗留的链被放开。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { changes, createTurnChangesTracker, holdDir, snapshot, undoTurn } from '../src/tintin/film-turn-changes.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const FOOTAGE = Buffer.alloc(64 * 1024, 7)

/** 系统回收站的替身: 项目旁一个文件夹, 收进去的按名可查。 */
function trashBeside(dir: string): { bin: string; trash: (path: string) => Promise<void> } {
  const bin = `${dir}-trash`
  mkdirSync(bin, { recursive: true })
  dirs.push(bin)
  return { bin, trash: async (path) => renameSync(path, join(bin, path.split(/[\\/]/).pop() as string)) }
}

/** 一部有影片、media 素材、声音和一页的影片目录。 */
function filled(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tintin-turn-undo-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'media'))
  writeFileSync(join(dir, 'film.html'), '<section><iframe src="title.html"></iframe></section>')
  writeFileSync(join(dir, 'media', 'shot.mp4'), FOOTAGE)
  writeFileSync(join(dir, 'bed.wav'), FOOTAGE.subarray(0, 1000))
  writeFileSync(join(dir, 'title.html'), '<h1>Title</h1>')
  return dir
}

describe('undoTurn 回滚到开工前', () => {
  it('删除与改动写回, 新增进回收站而非消失', async () => {
    const dir = filled()
    const { bin, trash } = trashBeside(dir)
    const hold = holdDir(dir, 'local:t1') as string
    const before = await snapshot(dir, { hold })
    rmSync(join(dir, 'film.html'))
    rmSync(join(dir, 'media'), { recursive: true })
    writeFileSync(join(dir, 'title.html'), '<h1>Another</h1>')
    writeFileSync(join(dir, 'end.html'), '<h1>End</h1>')
    const done = await undoTurn(dir, before, hold, { trash })
    expect(done).toEqual({ restored: 4, missed: [] })
    expect(readFileSync(join(dir, 'film.html'), 'utf8')).toBe('<section><iframe src="title.html"></iframe></section>')
    expect(readFileSync(join(dir, 'media', 'shot.mp4'))).toEqual(FOOTAGE)
    expect(readFileSync(join(dir, 'title.html'), 'utf8')).toBe('<h1>Title</h1>')
    expect(existsSync(join(dir, 'end.html'))).toBe(false)
    expect(existsSync(join(bin, 'end.html'))).toBe(true)
  })

  it('原地覆写的二进制放不回: 如实列名, 原样留着', async () => {
    const dir = filled()
    const { trash } = trashBeside(dir)
    const hold = holdDir(dir, 't1') as string
    const before = await snapshot(dir, { hold })
    /* 同一个文件再写一遍: 它的链持有的也是新内容 */
    writeFileSync(join(dir, 'bed.wav'), 'the agent\'s own sound')
    expect(await undoTurn(dir, before, hold, { trash })).toEqual({ restored: 0, missed: ['bed.wav'] })
    expect(readFileSync(join(dir, 'bed.wav'), 'utf8')).toBe('the agent\'s own sound')
  })
})

describe('changes 变更清单', () => {
  it('改动给 hunks(上下文 3 行), 文本未变不算变更', async () => {
    const dir = filled()
    const before = await snapshot(dir)
    writeFileSync(join(dir, 'title.html'), '<h1>Another</h1>')
    const found = await changes(dir, before)
    const row = found.files.find((f) => f.path === 'title.html')
    expect(row?.change).toBe('changed')
    expect((row?.added ?? 0) + (row?.removed ?? 0)).toBeGreaterThan(0)
    expect(row?.hunks?.length).toBeGreaterThan(0)
  })
})

describe('TurnChangesTracker 生命周期', () => {
  it('无变更不亮撤销且放开链; 有变更亮撤销、撤销一次、老启动遗留的链被清', async () => {
    const dir = filled()
    const { trash } = trashBeside(dir)
    const tracker = createTurnChangesTracker({ trash })
    /* 上次启动关在一轮半路的遗留链 */
    mkdirSync(join(dir, '.film', 'cache', 'turn-files', 'old'), { recursive: true })
    await tracker.begin(dir, 't1')
    expect(readdirSync(join(dir, '.film', 'cache', 'turn-files'))).toEqual(['t1'])
    const quiet = await tracker.settle(dir, 't1')
    expect(quiet?.undoable).toBeUndefined()
    await new Promise((done) => setTimeout(done, 50))
    expect(existsSync(holdDir(dir, 't1') as string)).toBe(false)

    await tracker.begin(dir, 't2')
    rmSync(join(dir, 'media', 'shot.mp4'))
    const found = await tracker.settle(dir, 't2')
    expect(found?.undoable).toBe(true)
    expect(await tracker.undo(dir, 't2')).toEqual({ ok: true, restored: 1, missed: [] })
    expect(readFileSync(join(dir, 'media', 'shot.mp4'))).toEqual(FOOTAGE)
    /* 撤销是一次性的: 册子里的快照已放出 */
    expect(await tracker.undo(dir, 't2')).toEqual({ ok: false, code: 'gone' })
  })
})
