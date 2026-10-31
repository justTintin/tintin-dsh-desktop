// tinIcons.ts — 创作包统一线性图标（2026-10-30 用户裁决：图标复用不自造）
// 词汇与 client.js 侧栏 glyph 同源：creation=侧栏「创作模式」星芒原样、
// skills=原侧栏「技能管理」层叠菱形原样（入口移除后图标语言在此延续）；
// 其余为补齐生成参数所需的最小集（六边形=后端、方框=比例、显示器=分辨率、
// 时钟=时长、齿辐=偏好），全部 16 viewBox / stroke 1.5 / round。
import { h, type FunctionalComponent } from 'vue'

export const TIN_ICONS: Record<string, string> = {
  creation: '<path d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5z"/><path d="M12.3 11.6v3.2M10.7 13.2h3.2"/>',
  skills: '<path d="M8 2.2 13.6 4.8 8 7.4 2.4 4.8z"/><path d="M2.4 8 8 10.6 13.6 8"/><path d="M2.4 11.2 8 13.8l5.6-2.6"/>',
  gear: '<circle cx="8" cy="8" r="2.4"/><path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2M3.5 3.5l1.6 1.6M10.9 10.9l1.6 1.6M12.5 3.5l-1.6 1.6M5.1 10.9l-1.6 1.6"/>',
  backend: '<path d="M8 2 13 4.9v6.2L8 14 3 11.1V4.9Z"/><path d="M8 8.2 13 4.9M8 8.2 3 4.9M8 8.2V14"/>',
  frame: '<rect x="2.8" y="3.6" width="10.4" height="8.8" rx="1.6"/>',
  display: '<rect x="2.4" y="3.2" width="11.2" height="7.6" rx="1.6"/><path d="M5.5 13.2h5"/>',
  clock: '<circle cx="8" cy="8" r="5.4"/><path d="M8 5.4V8l1.9 1.4"/>',
  spark: '<path d="M8 2.2 9.3 6.7 13.8 8 9.3 9.3 8 13.8 6.7 9.3 2.2 8l4.5-1.3Z"/>',
}

/** 14px 线性图标（class=ti，颜色随 currentColor；宿主可覆盖尺寸） */
export const TinIcon: FunctionalComponent<{ icon: string }> = (props) => h('svg', {
  viewBox: '0 0 16 16',
  class: 'ti',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  innerHTML: TIN_ICONS[props.icon] ?? '',
})

TinIcon.props = { icon: { type: String, required: true } }
