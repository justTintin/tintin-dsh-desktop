// 模板注册表对拍(铁律 15:注册表受锚点保护;此处锁行为契约)
import { describe, expect, it } from 'vitest'
import { getTemplate, listTemplates, templateOfOrientation, TEMPLATES, validateProps } from '../src/registry.ts'

describe('模板注册表(2026-10-27 分类学裁决)', () => {
  it('六模板 = 三族 × 横竖;图层词汇 = environment/product/title/subtitle', () => {
    const ids = listTemplates().map((t) => t.id)
    expect(ids).toEqual(['cover', 'cover-portrait', 'product', 'product-portrait', 'video', 'video-portrait'])
    for (const t of Object.values(TEMPLATES)) {
      expect(t.orientation === 'portrait' ? t.height > t.width : t.width > t.height).toBe(true)
      expect(t.layerDefs.length).toBeGreaterThan(0)
    }
    // 每模板都有标准核心层:environment + title(图层 id 词汇)
    for (const t of Object.values(TEMPLATES)) {
      expect(t.layerDefs.some((l) => l.id === 'environment')).toBe(true)
      expect(t.layerDefs.some((l) => l.id === 'title')).toBe(true)
    }
  })
  it('同族换向保内容键', () => {
    expect(templateOfOrientation('video', 'portrait')).toBe('video-portrait')
    expect(templateOfOrientation('video-portrait', 'landscape')).toBe('video')
    expect(templateOfOrientation('cover', 'portrait')).toBe('cover-portrait')
    expect(templateOfOrientation('product', 'portrait')).toBe('product-portrait')
  })
  it('未知模板显式报错(铁律 2:不静默兜底)', () => {
    expect(() => getTemplate('nope')).toThrow(/未知封面模板/)
  })
  it('图层定义均有唯 id 且类型合法', () => {
    for (const tpl of Object.values(TEMPLATES)) {
      const ids = tpl.layerDefs.map((l) => l.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const l of tpl.layerDefs) {
        expect(['environment', 'product', 'text', 'graphic']).toContain(l.type)
      }
    }
  })
})

describe('validateProps(props 树校验)', () => {
  it('缺省字段按空值合并(默认值不含演示内容,2026-11-01 裁决)', () => {
    const r = validateProps('cover', { title: '新标题', subtitle: '副题' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.title).toBe('新标题')
      expect(r.value.badge).toBe('')
    }
  })
  it('六模板默认值全为空(只保留字段清单)', () => {
    for (const tpl of Object.values(TEMPLATES)) {
      for (const [key, value] of Object.entries(tpl.defaultProps as Record<string, unknown>)) {
        expect(Array.isArray(value) ? value.length : value, `${tpl.id}.${key}`).toBe(Array.isArray(value) ? 0 : '')
      }
    }
  })
  it('文本图层空串 → 显式报错', () => {
    const r = validateProps('cover', { title: '   ', subtitle: '副题' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('主标题')
  })
  it('数组文本(卖点/钩子)为空或存在空行 → 显式报错', () => {
    expect(validateProps('video', { hookLines: ['0.2ms', '  '], subtitle: 's' }).ok).toBe(false)
    expect(validateProps('video', { hookLines: [], subtitle: 's' }).ok).toBe(false)
    expect(validateProps('video', { hookLines: ['0.2ms', '光轴'], subtitle: 's' }).ok).toBe(true)
  })
  it('隐藏的文本图层不参与校验(隐藏=不画出来);hiddenLayers 原样透传', () => {
    const blank = validateProps('video', { hiddenLayers: ['title', 'subtitle'] })
    expect(blank.ok).toBe(true)
    if (blank.ok) expect(blank.value.hiddenLayers).toEqual(['title', 'subtitle'])
    const r = validateProps('video', { hiddenLayers: ['title'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('副标题')
  })
})
