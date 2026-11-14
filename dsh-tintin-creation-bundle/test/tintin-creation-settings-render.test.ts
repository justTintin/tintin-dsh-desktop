// test/tintin-creation-settings-render.test.ts — 服务设置弹层 SSR 渲染冒烟
// （2026-11-14 用户裁决：素材创作本面服务端地址分面独立）。本包无 App 级渲染
// 冒烟基建，弹窗为自包含 SFC（不依赖本包其他组件），组件级 SSR 即可钉住模板
// 丢失盲区；齿轮入口在 App.vue（TinIcon+studio-settings），随实机与构建面覆盖。
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ServerSettingsDialog from '../src/components/ServerSettingsDialog.vue'

async function ssr(comp: unknown, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(defineComponent({ render: () => h(comp as never, props) }))
  return renderToString(app)
}

describe('服务设置（2026-11-14 用户裁决：素材创作本面服务端地址分面独立）', () => {
  it('弹层 visible=false 不渲染；visible=true 出双栏（左表单+右 MCP 清单，SSR 无桥调用）', async () => {
    expect(await ssr(ServerSettingsDialog, { visible: false, surface: 'creation' })).not.toContain('ssd-card')
    const html = await ssr(ServerSettingsDialog, { visible: true, surface: 'creation' })
    expect(html).toContain('ssd-card')
    expect(html).toContain('ssd-input')
    expect(html).toContain('保存地址')
    expect(html).toContain('获取 MCP 服务')
    expect(html).toContain('发现的 MCP 服务')
    expect(html).toContain('正在加载…')
  })
})
