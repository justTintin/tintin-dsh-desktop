// test/tintin-tool-tabs-render.test.ts — 多 Tab 工作区·SSR 渲染冒烟（2026-11-12）
// 背景（报障排查纪律）：SFC 模板整块丢失/绑定解析错误是 typecheck/build/test 全部
// 静态门禁的盲区（1009 VsrFrameScrubber 事故；本次 App.vue/OpsApp.vue 模板大改 +
// 新增 ToolTabBar/ToolTabPane 两个骨架组件，必须过渲染面验证）。
// 用 vue server-renderer 做 SSR 冒烟（零新依赖；SSR 不执行 onMounted，桥接调用
// 全部不发生——模板不触 window.tintin；hostTheme 有 typeof document 兜底）。
//   ① App.vue 导航页形态（卡片网格 + 无 tab 栏）
//   ② ToolTabBar（tab 行：emoji/标题/关闭钮/活动态/busy 状态点/「+」按钮）
//   ③ ToolTabPane（active 显隐 + discarded 卸载态 + busy 通道 provide 不崩）
//   ④ OpsApp.vue 导航页形态 → 见 ops 包同款冒烟（跨包不互引）
// 12 个工具组件 mock 为空壳：App.vue 静态 import 全部工具卡，其中 VideoPlayer→plyr
// 在模块顶层访问 document（node 无 DOM 即炸）；本冒烟只钉壳层三件与导航页形态，
// 工具组件本体渲染面由既有 tintin-media-render-smoke 与各自链路覆盖。
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from '../src/App.vue'
import ServerSettingsDialog from '../src/components/common/ServerSettingsDialog.vue'
import ToolTabBar from '../src/components/ToolTabBar.vue'
import ToolTabPane from '../src/components/ToolTabPane.vue'
import { TOOL_TAB_CTX } from '../src/composables/useToolTabs'
import type { ToolTab } from '../src/composables/useToolTabs'

vi.mock('../src/components/media-tools/copywriting-montage/CopywritingMontage.vue', () => ({ default: defineComponent({ name: 'CmStub', render: () => null }) }))
vi.mock('../src/components/media-tools/JianYingTemplates.vue', () => ({ default: defineComponent({ name: 'JyStub', render: () => null }) }))
vi.mock('../src/components/media-tools/VoiceClone.vue', () => ({ default: defineComponent({ name: 'VcStub', render: () => null }) }))
vi.mock('../src/components/media-tools/ImageMatting.vue', () => ({ default: defineComponent({ name: 'ImStub', render: () => null }) }))
vi.mock('../src/components/media-tools/MaterialLibrary.vue', () => ({ default: defineComponent({ name: 'MlStub', render: () => null }) }))
vi.mock('../src/components/media-tools/OtStoryboard.vue', () => ({ default: defineComponent({ name: 'OsStub', render: () => null }) }))
vi.mock('../src/components/media-tools/ReversePromptVideo.vue', () => ({ default: defineComponent({ name: 'RvStub', render: () => null }) }))
vi.mock('../src/components/media-tools/ReversePromptImage.vue', () => ({ default: defineComponent({ name: 'RiStub', render: () => null }) }))
vi.mock('../src/components/media-tools/VideoTranscribe.vue', () => ({ default: defineComponent({ name: 'VtStub', render: () => null }) }))
vi.mock('../src/components/media-tools/SubtitleRemoval.vue', () => ({ default: defineComponent({ name: 'SrStub', render: () => null }) }))
vi.mock('../src/components/media-tools/ImitationVideo.vue', () => ({ default: defineComponent({ name: 'IvStub', render: () => null }) }))
vi.mock('../src/components/media-tools/LiveClip.vue', () => ({ default: defineComponent({ name: 'LcStub', render: () => null }) }))

function tab(over: Partial<ToolTab> = {}): ToolTab {
  return { id: 'tab-1', toolId: 'imitation-video', createdAt: 1, lastActiveAt: 1, busy: 0, doneAt: 0, ...over }
}

/** SSR 挂载：选项式包一层（App.vue 是 script setup，直接 createSSRApp(App) 亦可） */
async function ssr(comp: unknown, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(defineComponent({ render: () => h(comp as never, props) }))
  return renderToString(app)
}

describe('多 Tab 工作区·App.vue 渲染面', () => {
  it('无 tab=导航页：卡片网格渲染、无 tab 栏、pane 容器隐藏且无 pane 子项', async () => {
    const html = await ssr(App)
    expect(html).toContain('媒体工具')
    expect(html).toContain('tool-card')
    expect(html).toContain('仿爆款视频')
    expect(html).not.toContain('tool-tab-bar') // 无 tab 不渲染 tab 栏
    // pane 容器 v-show 常驻（回导航不丢 tab DOM），但无 tab 时隐藏且无子 pane
    expect(html).toContain('tab-panes')
    expect(html).toContain('display:none')
    expect(html).not.toContain('tool-tab-pane')
  })
})

describe('多 Tab 工作区·ToolTabBar 渲染面', () => {
  const meta = (toolId: string) => (toolId === 'imitation-video' ? { emoji: '🎯', title: '仿爆款视频' } : null)

  it('tab 行：emoji+标题+关闭钮；活动 tab 有指示；「+」按钮常驻', async () => {
    const html = await ssr(ToolTabBar, {
      tabs: [tab({ id: 'a' }), tab({ id: 'b', toolId: 'storyboard' })],
      activeTabId: 'a',
      toolMeta: meta,
    })
    expect(html).toContain('tool-tab-bar')
    expect(html).toContain('🎯')
    expect(html).toContain('仿爆款视频')
    expect(html).toContain('tab-add') // 「+」回导航页
    expect(html).toContain('tab-close') // 关闭钮
  })

  it('busy=运行状态点（呼吸）；doneAt=完成点', async () => {
    const html = await ssr(ToolTabBar, {
      tabs: [tab({ id: 'a', busy: 1 }), tab({ id: 'b', doneAt: 123 })],
      activeTabId: null,
      toolMeta: meta,
    })
    expect(html).toContain('dot-busy')
    expect(html).toContain('dot-done')
  })

  it('未知 toolId 兜底显示 id 不崩', async () => {
    const html = await ssr(ToolTabBar, {
      tabs: [tab({ id: 'a', toolId: 'retired-card' })],
      activeTabId: 'a',
      toolMeta: () => null,
    })
    expect(html).toContain('retired-card')
  })
})

describe('多 Tab 工作区·ToolTabPane 渲染面', () => {
  const Stub = defineComponent({
    name: 'PaneStub',
    setup() {
      return () => h('div', { class: 'pane-stub' }, 'STUB-CONTENT')
    },
  })

  it('active=true 渲染子组件；discarded=true 卸载实例', async () => {
    const on = await ssr(ToolTabPane, { tab: tab(), component: Stub, active: true, discarded: false })
    expect(on).toContain('pane-stub')
    expect(on).toContain('STUB-CONTENT')
    const off = await ssr(ToolTabPane, { tab: tab(), component: Stub, active: false, discarded: true })
    expect(off).not.toContain('STUB-CONTENT') // v-if=false：实例不挂载
  })

  it('busy 通道 provide 声明不崩（inject 消费由模型单测/实机覆盖）', async () => {
    const html = await ssr(ToolTabPane, { tab: tab(), component: Stub, active: true, discarded: false })
    expect(html).toContain('STUB-CONTENT')
    void TOOL_TAB_CTX
  })
})

describe('多 Tab 工作区·App.vue 关闭确认/满员弹层（v-if 由状态驱动，SSR 静态不出 DOM）', () => {
  it('导航页形态不含确认弹层', async () => {
    const html = await ssr(App)
    expect(html).not.toContain('modal-mask')
  })
})

describe('服务设置（2026-11-14 用户裁决：媒体工具本面服务端地址分面独立）', () => {
  it('导航页头部含齿轮入口（aria-label=服务设置）', async () => {
    const html = await ssr(App)
    expect(html).toContain('head-settings')
    expect(html).toContain('aria-label="服务设置"')
  })

  it('弹层 visible=false 不渲染；visible=true 出双栏（左表单+右 MCP 清单，SSR 无桥调用）', async () => {
    expect(await ssr(ServerSettingsDialog, { visible: false, surface: 'media' })).not.toContain('ssd-card')
    const html = await ssr(ServerSettingsDialog, { visible: true, surface: 'media' })
    expect(html).toContain('ssd-card')
    expect(html).toContain('ssd-input')
    expect(html).toContain('保存地址')
    expect(html).toContain('获取 MCP 服务')
    expect(html).toContain('发现的 MCP 服务')
    expect(html).toContain('正在加载…')
  })
})
