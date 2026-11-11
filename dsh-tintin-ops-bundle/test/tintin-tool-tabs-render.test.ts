// test/tintin-tool-tabs-render.test.ts — 多 Tab 工作区·OpsApp.vue SSR 渲染冒烟
// （2026-11-12；副本同款冒烟在媒体包 test/tintin-tool-tabs-render.test.ts，
//  两包 tab 骨架互为副本不互引，各包钉自己的渲染面）
// 背景（报障排查纪律）：SFC 模板整块丢失是全部静态门禁盲区（1009 事故），
// OpsApp.vue 模板大改必须过渲染面验证。SSR 不执行 onMounted（桥接调用不发生），
// hostTheme 有 typeof document 兜底。
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import OpsApp from '../src/OpsApp.vue'

// 3 个工具面板 mock 为空壳（同媒体包冒烟口径；产品资料渲染面由
// tintin-ops-product-library-logic/upload 既有链路覆盖）
vi.mock('../src/components/ops-tools/OtProductLibrary.vue', () => ({ default: defineComponent({ name: 'PlStub', render: () => null }) }))
vi.mock('../src/components/ops-tools/OtKbQaPanel.vue', () => ({ default: defineComponent({ name: 'KbStub', render: () => null }) }))
vi.mock('../src/components/ops-tools/OtAutoListingPanel.vue', () => ({ default: defineComponent({ name: 'AlStub', render: () => null }) }))

async function ssr(comp: unknown, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(defineComponent({ render: () => h(comp as never, props) }))
  return renderToString(app)
}

describe('多 Tab 工作区·OpsApp.vue 渲染面', () => {
  it('无 tab=导航页：运营卡片网格渲染、无 tab 栏、pane 容器隐藏、无确认弹层', async () => {
    const html = await ssr(OpsApp)
    expect(html).toContain('运营工具')
    expect(html).toContain('tool-card')
    expect(html).toContain('产品资料')
    expect(html).toContain('智能问答系统')
    expect(html).not.toContain('tool-tab-bar') // 无 tab 不渲染 tab 栏
    // pane 容器 v-show 常驻（回导航不丢 tab DOM），但无 tab 时隐藏且无子 pane
    expect(html).toContain('tab-panes')
    expect(html).toContain('display:none')
    expect(html).not.toContain('tool-tab-pane')
    expect(html).not.toContain('modal-mask')
  })
})
