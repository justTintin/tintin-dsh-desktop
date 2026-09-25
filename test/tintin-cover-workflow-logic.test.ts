// test/tintin-cover-workflow-logic.test.ts — 封面制作·提交参数编组与 AI 文案解析纯函数单测
// 2026-09-25 自源项目 desktop/tests/cover-workflow-logic.test.mjs 一比一移植
// （node:test → vitest；被测文件随组件移植至 media-tools）。
// 覆盖：buildCoverWorkflow 保持既有结构 + template/title 透传；
//       parseAiCopyJson 对齐原版 _ai_suggest 的 JSON 输出解析（含容错）。
import { describe, expect, it } from 'vitest'
import { buildCoverWorkflow, parseAiCopyJson } from '../packages/tintin-media-bundle/src/components/media-tools/cover-workflow-logic'

function baseParams(overrides: Partial<Parameters<typeof buildCoverWorkflow>[0]> = {}): Parameters<typeof buildCoverWorkflow>[0] {
  return {
    size: '1:1',
    count: 4,
    bgColor: '#161828',
    bgTransparent: false,
    productPath: '',
    textContent: '',
    logoPath: '',
    ...overrides,
  }
}

describe('buildCoverWorkflow', () => {
  it('既有结构保持（type/size/count/layers 完整映射）', () => {
    const body = buildCoverWorkflow(baseParams({
      size: '9:16',
      count: 2,
      bgColor: '#ff0000',
      productPath: 'C:/p.png',
      textContent: '大促',
      logoPath: 'C:/l.png',
    }))
    expect(body.type).toBe('cover')
    expect(body.size).toBe('9:16')
    expect(body.count).toBe(2)
    expect(body.layers).toEqual({
      background: { color: '#ff0000' },
      product: { file: 'C:/p.png' },
      text: { content: '大促' },
      logo: { file: 'C:/l.png' },
    })
    // 未填 template/title → 不产生臆造字段
    expect('template' in body).toBe(false)
    expect('title' in body).toBe(false)
  })

  it('背景透明 → background.transparent 优先', () => {
    const body = buildCoverWorkflow(baseParams({ bgTransparent: true }))
    expect((body.layers as Record<string, unknown>).background).toEqual({ transparent: true })
  })

  it('空图层字段 → null（不丢键）', () => {
    const body = buildCoverWorkflow(baseParams())
    const layers = body.layers as Record<string, unknown>
    expect(layers.product).toBeNull()
    expect(layers.text).toBeNull()
    expect(layers.logo).toBeNull()
  })

  it('template/title 非空时透传（对齐 CoverRequest 字段命名）', () => {
    const body = buildCoverWorkflow(baseParams({ template: '  tpl-01  ', title: '  限时特惠  ' }))
    expect(body.template).toBe('tpl-01')
    expect(body.title).toBe('限时特惠')
  })

  it('template/title 全空白 → 不携带', () => {
    const body = buildCoverWorkflow(baseParams({ template: '   ', title: '' }))
    expect('template' in body).toBe(false)
    expect('title' in body).toBe(false)
  })
})

describe('parseAiCopyJson', () => {
  it('纯 JSON 输出 → title/subtitle 提取并 trim', () => {
    expect(parseAiCopyJson('{"title": " 爆款 ", "subtitle": " 限时秒杀 "}')).toEqual({ title: '爆款', subtitle: '限时秒杀' })
  })

  it('markdown 代码块/前后说明包裹 → 提取首个 JSON 对象', () => {
    expect(parseAiCopyJson('```json\n{"title": "大促", "subtitle": "全场5折"}\n```')).toEqual({ title: '大促', subtitle: '全场5折' })
    expect(parseAiCopyJson('好的，建议如下：\n{"title": "A", "subtitle": "B"}\n请查收')).toEqual({ title: 'A', subtitle: 'B' })
  })

  it('缺字段 → 空串补位', () => {
    expect(parseAiCopyJson('{"title": "只有标题"}')).toEqual({ title: '只有标题', subtitle: '' })
  })

  it('无 JSON / 非法 JSON / 空输入 → null（调用方截断回退）', () => {
    expect(parseAiCopyJson('')).toBeNull()
    expect(parseAiCopyJson('纯文本没有 JSON')).toBeNull()
    expect(parseAiCopyJson('{"title": 未闭合')).toBeNull()
    expect(parseAiCopyJson('[1,2,3]')).toBeNull()
  })
})
