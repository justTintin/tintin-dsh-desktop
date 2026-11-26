import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FILM_DREAMINA_CHANNEL,
  filmDreaminaPreferOn,
  filmDreaminaSkillsDir,
  registerFilmDreaminaChannels,
} from '../src/tintin/film-dreamina-channels.ts'

type Handler = (event: unknown, payload: unknown) => Promise<Record<string, unknown>>
const dirs: string[] = []
const fakeHome = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'film-dreamina-'))
  dirs.push(dir)
  return dir
}
const capture = (channelHome: string): Handler => {
  let handler: Handler | null = null
  const ipcMain = { handle: (channel: string, fn: Handler) => {
    if (channel === FILM_DREAMINA_CHANNEL) handler = fn
  } } as unknown as IpcMain
  registerFilmDreaminaChannels({ ipcMain, channelHome })
  if (!handler) throw new Error('dreamina channel not registered')
  return handler
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

describe('film dreamina channels', () => {
  it('开关缺省开,且与封面的 preferInSkills 互不干扰', async () => {
    process.env.DSH_HOME = fakeHome()
    const h = capture(join(process.env.DSH_HOME, 'tintin'))
    expect(await h({}, { action: 'get-pref' })).toMatchObject({ ok: true, preferInFilm: true })
    expect(filmDreaminaPreferOn()).toBe(true)
    expect(await h({}, { action: 'set-pref', preferInFilm: false })).toMatchObject({ ok: true, preferInFilm: false })
    expect(filmDreaminaPreferOn()).toBe(false)
    const doc = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'tintin', 'config.json'), 'utf8'))
    expect(doc.dreamina.preferInFilm).toBe(false)
    expect(doc.dreamina.preferInSkills).toBeUndefined()
  })

  it('capabilities 同时列出图片与视频生成命令', async () => {
    process.env.DSH_HOME = fakeHome()
    const h = capture(join(process.env.DSH_HOME, 'tintin'))
    const result = await h({}, { action: 'capabilities' })
    const commands = (result.commands ?? []) as Array<{ command: string; kind: string }>
    expect(commands.map((c) => c.command)).toContain('text2image')
    expect(commands.map((c) => c.command)).toContain('text2video')
    expect(commands.map((c) => c.command)).toContain('image2video')
    expect(commands.find((c) => c.command === 'text2video')?.kind).toBe('video')
    expect(commands.find((c) => c.command === 'text2image')?.kind).toBe('image')
  })

  it('技能装位在影片侧独立目录,未安装时如实上报', async () => {
    const home = fakeHome()
    process.env.DSH_HOME = home
    expect(filmDreaminaSkillsDir(home)).toBe(join(home, 'film-skills', 'dreamina'))
    const h = capture(home)
    expect(await h({}, { action: 'skill-get' })).toMatchObject({ ok: true, installed: false })
  })
})
