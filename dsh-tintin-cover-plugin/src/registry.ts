// 模板注册表(纯逻辑,可单测)。
// 2026-10-27 15:09 用户裁决:图层分类学固定 = 环境图/产品图/主标题/副标题(+装饰层),
// 会话按图层 id 引用与操作;设置 = 横竖屏(同族横竖变体,切换保留内容)。
// 图层 id 即会话词汇:environment / product / title / subtitle(装饰层另计)。
import type { ComponentType } from 'react'
import { Cover, type CoverProps } from '../templates/Cover'
import { CoverPortrait } from '../templates/CoverPortrait'
import { ProductCover, type ProductCoverProps } from '../templates/ProductCover'
import { ProductCoverPortrait } from '../templates/ProductCoverPortrait'
import { VideoCover, type VideoCoverProps } from '../templates/VideoCover'
import { VideoCoverPortrait } from '../templates/VideoCoverPortrait'

/** 图层定义:编辑器左栏、会话工具、撤销栈的统一词汇(铁律 15 锚点保护本表) */
export interface LayerDef {
  id: string
  label: string
  type: 'environment' | 'product' | 'text' | 'graphic'
  /** 对应 props 键;缺省=与图层 id 同名 */
  propsKey?: string
  /** 文字层基准字号 px(scale=1 时;PhotoCraft 式面板按此换算绝对字号) */
  fontSize?: number
}

export interface TemplateDef<P = Record<string, unknown>> {
  id: string
  label: string
  /** 模板族(cover/product/video);同族横竖变体可无损切换 */
  family: string
  orientation: 'landscape' | 'portrait'
  width: number
  height: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JS 桥边界(编辑器/会话以非类型化 props 传入)
  component: ComponentType<any>
  defaultProps: P
  layerDefs: LayerDef[]
}

const TEXT_LAYERS_COVER: LayerDef[] = [
  { id: 'title', label: '主标题', type: 'text', fontSize: 88 },
  { id: 'subtitle', label: '副标题', type: 'text', fontSize: 34 },
]
const GRAPHIC_LAYERS_COVER: LayerDef[] = [
  { id: 'brand', label: '品牌条(装饰)', type: 'graphic' },
  { id: 'footer', label: '角标(装饰)', type: 'graphic' },
]

export const TEMPLATES: Record<string, TemplateDef> = {
  cover: {
    id: 'cover', label: '节目封面·横屏', family: 'cover', orientation: 'landscape',
    width: 1280, height: 720,
    component: Cover as ComponentType<CoverProps>,
    defaultProps: { title: '下载扩展链复活', subtitle: 'B站下载助手 · 抖音解析 · 媒体下载引擎 · 扩展管理', badge: '2026-10-26 已交付' },
    layerDefs: [
      { id: 'environment', label: '环境图', type: 'environment', propsKey: 'bgImage' },
      { id: 'grid', label: '网格纹理(装饰)', type: 'graphic' },
      ...TEXT_LAYERS_COVER,
      ...GRAPHIC_LAYERS_COVER,
    ],
  },
  'cover-portrait': {
    id: 'cover-portrait', label: '节目封面·竖屏', family: 'cover', orientation: 'portrait',
    width: 1080, height: 1440,
    component: CoverPortrait as ComponentType<CoverProps>,
    defaultProps: { title: '下载扩展链复活', subtitle: 'B站下载助手 · 抖音解析 · 媒体下载引擎', badge: '2026-10-26 已交付' },
    layerDefs: [
      { id: 'environment', label: '环境图', type: 'environment', propsKey: 'bgImage' },
      ...TEXT_LAYERS_COVER,
      ...GRAPHIC_LAYERS_COVER,
    ],
  },
  product: {
    id: 'product', label: '商品封面·横屏', family: 'product', orientation: 'landscape',
    width: 1280, height: 720,
    component: ProductCover as ComponentType<ProductCoverProps>,
    defaultProps: {
      brand: 'LOGITECH G', title: 'PRO X2 SUPERSTRIKE', subtitle: '旗舰电竞鼠标 · 光轴触发', badge: '现已上市',
      features: ['混合光轴 · 0.2ms 触发', 'LIGHTSPEED 2K Hz 无线', '轻量人体工学 · 长续航'], image: 'mouse.jpg',
    },
    layerDefs: [
      { id: 'environment', label: '环境图', type: 'environment' },
      { id: 'product', label: '产品图', type: 'product', propsKey: 'image' },
      { id: 'title', label: '主标题', type: 'text', fontSize: 76 },
      { id: 'subtitle', label: '副标题', type: 'text', fontSize: 28 },
      { id: 'features', label: '卖点清单', type: 'text', fontSize: 24 },
      { id: 'badge', label: '角标(装饰)', type: 'graphic' },
      { id: 'brand', label: '品牌条(装饰)', type: 'graphic' },
    ],
  },
  'product-portrait': {
    id: 'product-portrait', label: '商品封面·竖屏', family: 'product', orientation: 'portrait',
    width: 1080, height: 1440,
    component: ProductCoverPortrait as ComponentType<ProductCoverProps>,
    defaultProps: {
      brand: 'LOGITECH G', title: 'PRO X2 SUPERSTRIKE', subtitle: '旗舰电竞鼠标 · 光轴触发', badge: '现已上市',
      features: ['混合光轴 · 0.2ms 触发', 'LIGHTSPEED 2K Hz 无线'], image: 'mouse.jpg',
    },
    layerDefs: [
      { id: 'environment', label: '环境图', type: 'environment' },
      { id: 'product', label: '产品图', type: 'product', propsKey: 'image' },
      { id: 'title', label: '主标题', type: 'text', fontSize: 84 },
      { id: 'subtitle', label: '副标题', type: 'text', fontSize: 32 },
      { id: 'features', label: '卖点清单', type: 'text', fontSize: 27 },
      { id: 'badge', label: '角标(装饰)', type: 'graphic' },
      { id: 'brand', label: '品牌条(装饰)', type: 'graphic' },
    ],
  },
  video: {
    id: 'video', label: '视频缩略图·横屏', family: 'video', orientation: 'landscape',
    width: 1280, height: 720,
    component: VideoCover as ComponentType<VideoCoverProps>,
    defaultProps: {
      hookLines: ['0.2ms', '光轴鼠标', '能有多快?'], subtitle: '混合光轴 · LIGHTSPEED 2K Hz 无线', subTag: '开箱实测',
      brand: 'LOGITECH G · PRO X2 SUPERSTRIKE', image: 'mouse.jpg',
    },
    layerDefs: [
      { id: 'environment', label: '环境图', type: 'environment' },
      { id: 'title', label: '主标题(钩子)', type: 'text', propsKey: 'hookLines', fontSize: 110 },
      { id: 'subtitle', label: '副标题', type: 'text', fontSize: 34 },
      { id: 'product', label: '产品图', type: 'product', propsKey: 'image' },
      { id: 'subTag', label: '栏目角标(装饰)', type: 'graphic' },
      { id: 'brand', label: '品牌条(装饰)', type: 'graphic' },
    ],
  },
  'video-portrait': {
    id: 'video-portrait', label: '视频缩略图·竖屏', family: 'video', orientation: 'portrait',
    width: 1080, height: 1440,
    component: VideoCoverPortrait as ComponentType<VideoCoverProps>,
    defaultProps: {
      hookLines: ['0.2ms', '光轴鼠标', '能有多快?'], subtitle: '混合光轴 · LIGHTSPEED 2K Hz 无线', subTag: '开箱实测',
      brand: 'LOGITECH G · PRO X2 SUPERSTRIKE', image: 'mouse.jpg',
    },
    layerDefs: [
      { id: 'environment', label: '环境图', type: 'environment' },
      { id: 'title', label: '主标题(钩子)', type: 'text', propsKey: 'hookLines', fontSize: 104 },
      { id: 'subtitle', label: '副标题', type: 'text', fontSize: 38 },
      { id: 'product', label: '产品图', type: 'product', propsKey: 'image' },
      { id: 'subTag', label: '栏目角标(装饰)', type: 'graphic' },
      { id: 'brand', label: '品牌条(装饰)', type: 'graphic' },
    ],
  },
}

export function getTemplate(id: string): TemplateDef {
  const tpl = TEMPLATES[id]
  if (!tpl) throw new Error(`未知封面模板: ${id}(可用: ${Object.keys(TEMPLATES).join(', ')})`)
  return tpl
}

export function listTemplates(): Array<{ id: string; label: string; family: string; orientation: string; width: number; height: number }> {
  return Object.values(TEMPLATES).map(({ id, label, family, orientation, width, height }) => ({ id, label, family, orientation, width, height }))
}

/** 同族换向(2026-10-27 裁决:设置=横竖屏;内容 props 尽量保留) */
export function templateOfOrientation(templateId: string, orientation: 'landscape' | 'portrait'): string {
  const tpl = getTemplate(templateId)
  if (tpl.orientation === orientation) return templateId
  const sibling = Object.values(TEMPLATES).find((t) => t.family === tpl.family && t.orientation === orientation)
  return sibling ? sibling.id : templateId
}

/** props 校验(铁律 2:显式报错,不静默兜底):必含文本键非空 */
export function validateProps(templateId: string, props: Record<string, unknown>): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const tpl = getTemplate(templateId)
  const merged = { ...tpl.defaultProps, ...props }
  for (const [key, value] of Object.entries(merged)) {
    const def = tpl.layerDefs.find((l) => (l.propsKey ?? l.id) === key)
    if (def && def.type === 'text') {
      if (typeof value === 'string' && !value.trim()) return { ok: false, error: `文本图层「${def.label}」(${key}) 不能为空` }
      if (Array.isArray(value) && value.length > 0 && value.some((v) => typeof v === 'string' && !String(v).trim())) {
        return { ok: false, error: `文本图层「${def.label}」(${key}) 存在空行` }
      }
    }
  }
  return { ok: true, value: merged }
}
