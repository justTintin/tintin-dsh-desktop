// 行为校验:解析层+可读文本+消费函数(2026-11-15 参数统一 JSON 批) — vitest 跑
import { describe, expect, it } from 'vitest'
import {
  parseFeaturesJson,
  parseSellingPointsJson,
  productFeaturesText,
  productSellingPointsText,
  firstMarkdownLine,
  markdownListLines,
} from '../src/composables/opsProductLibraryLogic'
import { buildProductSection } from '../src/composables/opsCopywritingLogic'

const fj = '[{"key":"品牌","value":"千问"},{"key":"型号","value":"千问S1"},{"key":"镜片类型","value":"AI 眼镜"}]'
const sj = '["千问 AI 智能加持，依托于千问大模型","续航在家更安心","适合日常出街与办公"]'

describe('parseFeaturesJson / parseSellingPointsJson(统一 JSON 契约)', () => {
  it('JSON 字符串 → 结构化(顺序保留)', () => {
    expect(parseFeaturesJson(fj)).toEqual([
      { key: '品牌', value: '千问' },
      { key: '型号', value: '千问S1' },
      { key: '镜片类型', value: 'AI 眼镜' },
    ])
    expect(parseSellingPointsJson(sj)).toHaveLength(3)
  })
  it('已是数组形态同样接受(服务端直返对象时)', () => {
    expect(parseFeaturesJson([{ key: 'a', value: 'b' }])).toEqual([{ key: 'a', value: 'b' }])
    expect(parseSellingPointsJson(['x'])).toEqual(['x'])
  })
  it('非 JSON(手填/旧 markdown)→ null 回落原文,绝不猜测', () => {
    expect(parseFeaturesJson('- **屏幕**：2.3 英寸')).toBeNull()
    expect(parseFeaturesJson('手填内容')).toBeNull()
    expect(parseFeaturesJson('[{broken')).toBeNull()
    expect(parseSellingPointsJson('手填卖点')).toBeNull()
  })
})

describe('可读文本(显示/prompt/回填统一出口)', () => {
  it('JSON → key：value 逐行 / 卖点逐条一行', () => {
    expect(productFeaturesText(fj)).toBe('品牌：千问\n型号：千问S1\n镜片类型：AI 眼镜')
    expect(productSellingPointsText(sj).split('\n')).toHaveLength(3)
  })
  it('非 JSON 剥 markdown 标记透传(旧数据兼容)', () => {
    expect(productFeaturesText('- **屏幕**：2.3 英寸')).toBe('屏幕：2.3 英寸')
    expect(productSellingPointsText('- 保温 24h')).toBe('保温 24h')
  })
  it('firstMarkdownLine/markdownListLines JSON 感知', () => {
    expect(firstMarkdownLine(fj)).toBe('品牌：千问')
    expect(markdownListLines(sj)).toHaveLength(3)
  })
})

describe('buildProductSection(文案 prompt 消费,2026-11-15 JSON 解析起步)', () => {
  it('JSON 参数 → prompt 内是可读文本而非原始 JSON', () => {
    const section = buildProductSection(null, fj, sj)
    expect(section).toContain('品牌：千问')
    expect(section).not.toContain('"key"')
    expect(section).toContain('【性能参数】')
    expect(section).toContain('【核心卖点】')
  })
  it('未录入 → 占位文案不变', () => {
    expect(buildProductSection(null, '', '')).toContain('（未录入）')
  })
})
