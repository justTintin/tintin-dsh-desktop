// cover-tools 对拍(假引擎注入;不触真实渲染)+ film_render 封面联动钩子对拍
import { describe, expect, it } from 'vitest'
import { createCoverTools } from '../lib/cover-tools.js'
import { renderFilmCover } from 'dsh-tintin-bundle/lib/film-tools.js'

function fakeEngine(override = {}) {
  return {
    listTemplates: () => [
      { id: 'video', label: '视频缩略图(点击向)', width: 1280, height: 720, layerDefs: [{ id: 'hook', label: '钩子文案', type: 'text', propsKey: 'hookLines' }] },
    ],
    renderCover: async () => ({ ok: true, file: 'C:/ws/cover/x.png' }),
    ...override,
  }
}

const loadOk = async () => fakeEngine()

describe('createCoverTools', () => {
  it('缺 loadEngine 显式报错(铁律 2)', () => {
    expect(() => createCoverTools({})).toThrow(/loadEngine/)
  })

  it('cover_templates 输出模板摘要(含图层键约定)', async () => {
    const [tpl] = createCoverTools({ loadEngine: loadOk })
    expect(tpl.name).toBe('cover_templates')
    const r = await tpl.execute({}, {})
    expect(r.ok).toBe(true)
    expect(r.templates[0].id).toBe('video')
    expect(r.templates[0].size).toBe('1280x720')
    expect(Array.isArray(r.templates[0].layers)).toBe(true)
  })

  it('cover_generate 透传参数并回传落盘路径', async () => {
    const seen = []
    const engine = fakeEngine({
      renderCover: async (input) => { seen.push(input); return { ok: true, file: 'C:/ws/cover/a.png' } },
    })
    const [, gen] = createCoverTools({ loadEngine: async () => engine })
    expect(gen.name).toBe('cover_generate')
    const r = await gen.execute({ templateId: 'video', props: { hookLines: ['a', 'b'] }, fileName: 'a.png' }, {})
    expect(r).toEqual({ ok: true, file: 'C:/ws/cover/a.png' })
    expect(seen[0]).toEqual({ templateId: 'video', props: { hookLines: ['a', 'b'] }, fileName: 'a.png' })
  })

  it('引擎渲染失败 → ok:false + error(agent 可读自纠)', async () => {
    const engine = fakeEngine({ renderCover: async () => ({ ok: false, error: '文本图层「主标题」(title) 不能为空' }) })
    const [, gen] = createCoverTools({ loadEngine: async () => engine })
    const r = await gen.execute({ templateId: 'cover', props: { title: ' ' } }, {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('主标题')
  })

  it('引擎加载失败 → ok:false 不抛', async () => {
    const [tpl, gen] = createCoverTools({ loadEngine: async () => { throw new Error('封面插件目录不存在') } })
    const t = await tpl.execute({}, {})
    expect(t.ok).toBe(false)
    const g = await gen.execute({ templateId: 'video', props: {} }, {})
    expect(g.ok).toBe(false)
    expect(g.error).toContain('封面插件目录不存在')
  })

  it('缺省入参防线:非对象 props 归一为空对象', async () => {
    const seen = []
    const engine = fakeEngine({ renderCover: async (i) => { seen.push(i); return { ok: true, file: 'f' } } })
    const [, gen] = createCoverTools({ loadEngine: async () => engine })
    await gen.execute({ templateId: 'video', props: 'junk' }, {})
    expect(seen[0].props).toEqual({})
  })
})

describe('renderFilmCover(WP-4 成片配套封面钩子)', () => {
  it('封面与 mp4 同目录同基名;props 取项目名', async () => {
    const seen = []
    const renderCover = async (input) => { seen.push(input); return { ok: true, file: 'D:/ws/films/我的影片/我的影片.png' } }
    const r = await renderFilmCover(renderCover, { project: 'D:/ws/films/我的影片', path: 'D:/ws/films/我的影片/我的影片.mp4' })
    expect(r.ok).toBe(true)
    expect(seen[0]).toMatchObject({
      templateId: 'video',
      fileName: '我的影片.png',
      outDir: 'D:/ws/films/我的影片',
    })
    expect(seen[0].props.hookLines).toEqual(['我的影片'])
    expect(seen[0].props.subTag).toBe('正片')
  })
  it('引擎返回失败 → 原样透出(调用方 warn 不阻断成片)', async () => {
    const renderCover = async () => ({ ok: false, error: '引擎不可用' })
    const r = await renderFilmCover(renderCover, { project: '/p/x', path: '/p/x/x.mp4' })
    expect(r).toEqual({ ok: false, error: '引擎不可用' })
  })
})
