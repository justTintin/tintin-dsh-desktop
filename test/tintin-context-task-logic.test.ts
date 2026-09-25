// test/tintin-context-task-logic.test.ts — 会话上下文注入纯函数回归（WP-5b）
// 摘要函数自源项目 workbenchChatContext.ts 原样复活（2026-09-25 上午随
// /agent/* 退役清理移除），测试口径对齐源项目 desktop/tests 断言；
// task.json 模型为本仓 WP-5b 新增（schema v1 + 防御解析）。
import { describe, expect, it } from 'vitest'
import {
  buildContextText,
  buildTaskContext,
  materialKeyOf,
  mediaTypeLabel,
  productLabel,
  productSummary,
  materialLabel,
  materialSummary,
  sanitizeTaskContext,
  scriptLabel,
  scriptSummary,
  audioSummary,
  TASK_CONTEXT_VERSION,
} from '../packages/tintin-media-bundle/src/composables/contextTaskLogic'

describe('摘要函数（SRC 原样复活口径）', () => {
  it('productSummary：品牌/型号/品类/货号 + 性能 + 卖点，空字段跳过', () => {
    expect(productSummary({
      brand: 'Kehe', model: 'X1', category: '卫衣', goods_no: 'A001',
      features: '透气', selling_points: '限时五折',
    })).toBe('品牌:Kehe\n型号:X1\n品类:卫衣\n货号:A001\n性能:透气\n卖点:限时五折')
    expect(productSummary({ brand: 'Kehe' })).toBe('品牌:Kehe')
  })

  it('materialSummary：ID/文件名/类型/品牌/路径', () => {
    expect(materialSummary({ id: 7, filename: 'a.mp4', media_type: 'video', brand: 'B', path: 'C:/a.mp4' }))
      .toBe('素材ID:7\n文件名:a.mp4\n类型:视频\n品牌:B\n路径:C:/a.mp4')
    expect(materialSummary({ material_id: 'm9' })).toContain('素材ID:m9')
  })

  it('scriptSummary / productLabel / materialLabel / scriptLabel', () => {
    expect(scriptSummary({ id: 's1', topic: '大促', shot_count: 5, ratio: '9:16', saved_at: '2026-09-25' }))
      .toBe('脚本ID:s1\n主题:大促\n镜头数:5\n画幅:9:16\n保存时间:2026-09-25')
    expect(productLabel({ brand: 'A', model: 'B' })).toBe('A / B')
    expect(materialLabel({ id: 1, filename: 'a.png', media_type: 'image' })).toBe('[图片] a.png')
    expect(scriptLabel({ topic: '新品', shot_count: 3 })).toBe('[新品] 3镜')
  })

  it('mediaTypeLabel 未知回退「素材」；audioSummary 字段容错 + 时长取整', () => {
    expect(mediaTypeLabel('whatever')).toBe('素材')
    expect(audioSummary({ filename: 'bgm.mp3', genre: '电子', duration: 61.4 }))
      .toBe('文件名:bgm.mp3\n类型:音频\n风格:电子\n时长:61秒')
  })
})

describe('buildContextText（适配版：段落编组）', () => {
  it('产品/素材/脚本/参考音频逐段拼接，空段落不产生', () => {
    const text = buildContextText({
      product: { brand: 'A', model: 'B' },
      materials: [{ id: 1, filename: 'a.mp4', media_type: 'video' }],
      scripts: [{ id: 's1', topic: '大促' }],
      audios: [{ filename: 'bgm.mp3' }],
    })
    expect(text).toBe([
      '【产品】\n品牌:A\n型号:B',
      '【素材】\n素材ID:1\n文件名:a.mp4\n类型:视频',
      '【脚本】\n脚本ID:s1\n主题:大促\n镜头数:0',
      '【参考音频】\n文件名:bgm.mp3\n类型:音频',
    ].join('\n\n'))
  })

  it('全空输入 → 空串', () => {
    expect(buildContextText({ product: null, materials: [], scripts: [] })).toBe('')
  })
})

describe('task.json 模型', () => {
  it('buildTaskContext：结构化条目 + contextText 自动生成 + ISO 时间', () => {
    const fixed = new Date('2026-09-25T08:00:00Z')
    const task = buildTaskContext({ product: { brand: 'A' }, materials: [{ id: 1 }] }, fixed)
    expect(task.version).toBe(TASK_CONTEXT_VERSION)
    expect(task.updatedAt).toBe('2026-09-25T08:00:00.000Z')
    expect(task.product).toEqual({ brand: 'A' })
    expect(task.materials).toEqual([{ id: 1 }])
    expect(task.scripts).toEqual([])
    expect(task.audios).toEqual([])
    expect(task.contextText).toContain('【产品】')
    expect(task.contextText).toContain('【素材】')
  })

  it('sanitizeTaskContext：非法输入降级为合法空载荷，永不抛出', () => {
    for (const bad of [null, undefined, 'x', 42, [], { materials: 'no', product: 1 }]) {
      const t = sanitizeTaskContext(bad)
      expect(t.version).toBe(TASK_CONTEXT_VERSION)
      expect(t.product).toBeNull()
      expect(t.materials).toEqual([])
      expect(typeof t.updatedAt).toBe('string')
    }
  })

  it('sanitizeTaskContext：非对象条目剔除、超限截断、contextText 重算', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ id: i }))
    const junk = Array.from({ length: 300 }, () => 'junk')
    const t = sanitizeTaskContext({ materials: [...many, ...junk], product: { brand: 'A' } })
    expect(t.materials.length).toBeLessThanOrEqual(200)
    expect(t.materials.every((m) => typeof m === 'object')).toBe(true)
    expect(t.contextText).toContain('品牌:A')
  })

  it('materialKeyOf：id ?? material_id 兜底', () => {
    expect(materialKeyOf({ id: 5 })).toBe('5')
    expect(materialKeyOf({ material_id: 'm1' })).toBe('m1')
    expect(materialKeyOf({})).toBe('')
  })
})
