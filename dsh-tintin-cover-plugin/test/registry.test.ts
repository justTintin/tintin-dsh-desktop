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
  it('缺省 props 可合并默认值通过', () => {
    const r = validateProps('cover', { title: '新标题' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.title).toBe('新标题')
      expect(r.value.subtitle).toBe(TEMPLATES.cover?.defaultProps.subtitle)
    }
  })
  it('文本图层空串 → 显式报错', () => {
    const r = validateProps('cover', { title: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('主标题')
  })
  it('数组文本(卖点/钩子)存在空行 → 显式报错', () => {
    expect(validateProps('video', { hookLines: ['0.2ms', '  '] }).ok).toBe(false)
    expect(validateProps('video', { hookLines: ['0.2ms', '光轴'] }).ok).toBe(true)
  })
  it('hiddenLayers 透传不受校验影响', () => {
    const r = validateProps('video', { hiddenLayers: ['brand'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.hiddenLayers).toEqual(['brand'])
  })
})
