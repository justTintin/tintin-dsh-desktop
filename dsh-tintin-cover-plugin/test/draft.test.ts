// 图层底稿闭环集成测试(需 vendored photocraft-cli;产物落 D 盘 .tmp 避沙箱)
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildLayeredDraft, exportPngFromDraft } from '../src/engine.ts'

const saved = process.env.TINTIN_COVER_DIR
afterEach(() => { process.env.TINTIN_COVER_DIR = saved })

describe('buildLayeredDraft + exportPngFromDraft', () => {
  const dir = () => {
    const d = join('D:/Project/tintin-dsh-desktop/dsh-tintin-cover-plugin/.tmp', 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    mkdirSync(d, { recursive: true })
    return d
  }

  it('底稿 .pcraft 产出(图层全保留,非 PNG)', async () => {
    process.env.TINTIN_COVER_DIR = dir()
    const r = await buildLayeredDraft({ templateId: 'video', props: { hookLinesText: '冒烟' }, fileName: 't' })
    expect(r.ok).toBe(true)
    expect(r.file).toContain('.pcraft')
  })
  it('exportPngFromDraft 出最终 PNG', async () => {
    process.env.TINTIN_COVER_DIR = dir()
    const draft = await buildLayeredDraft({ templateId: 'cover', props: { title: '冒烟', subtitle: '副题', badge: '角标' }, fileName: 'exp' })
    expect(draft.ok).toBe(true)
    const png = await exportPngFromDraft({ pcraftFile: draft.file!, fileName: 'final' })
    expect(png.ok).toBe(true)
    expect(png.file).toContain('final.png')
  })
})
