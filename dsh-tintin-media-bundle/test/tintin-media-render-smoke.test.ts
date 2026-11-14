// test/tintin-media-render-smoke.test.ts — 媒体包组件·SSR 渲染冒烟（2026-11-05）
// 背景（报障排查纪律）：SFC 模板整块丢失/绑定解析错误是 typecheck/build/test 全部
// 静态门禁的盲区（1009 VsrFrameScrubber 事故），模板类改动必须过渲染面验证。
// 本文件用 vue 自带 server-renderer 做 SSR 冒烟（零新依赖、无需 DOM/浏览器），
// 首批钉住 1105 两批改动的渲染面：
//   ① 文案混剪 Step1（gen-block 提示/提示词输入框/AI 按钮移位 + 按钮改名）
//   ② 分镜脚本 tab 行收起/展开（默认收起只留 tab 行；空态引导不受收起影响）
//   ③ 写法挑选弹窗 multiple 多选形态（复选/计数确认钮；单选形态不受影响）
// fake shell 走注入键（与真 composable 返回同名字段），SSR 不执行 onMounted，
// 桥接调用全部不发生——模板不触 window.tintin。

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createSSRApp, ref, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import CopywritingStep1Panel from '../src/components/media-tools/copywriting-montage/CopywritingStep1Panel.vue'
import CopywritingStoryboard from '../src/components/media-tools/copywriting-montage/CopywritingStoryboard.vue'
import VoiceoverPickerDialog from '../src/components/media-tools/VoiceoverPickerDialog.vue'
import { copywritingMontageShellKey } from '../src/components/media-tools/copywriting-montage/copywritingMontageUiContext'
import { storyboardShotsExpanded } from '../src/composables/storyboardShotsState'
import type { StoryboardShot } from '../src/composables/opsStoryboardLogic'

// 产品选择公共弹窗只留壳（SSR 不验证弹窗内部装载面板）
vi.mock('../src/components/workbench/WbPickProductDialog.vue', () => ({
  default: defineComponent({ name: 'WbPickProductDialogStub', render: () => null }),
}))

const shot = (over: Partial<StoryboardShot> = {}): StoryboardShot => ({
  index: 1, shot_type: '特写', visual: '画面', audio: '旁白', sfx: '', duration: 3,
  material_path: '', material_type: '', material_hash: '', material_id: 0, ...over,
})
/** 分镜 tab 最小形态（组件只读 id/name；结构断言不做类型表演） */
const tab = (id: string, name: string, shots: StoryboardShot[] = [], over: Record<string, unknown> = {}) =>
  ({ id, name, shots, narrative: shots.length ? '旁白' : '文案稿', clipGroups: shots.map(() => []), ...over })

function fakeShell() {
  const storyboards = ref<Array<ReturnType<typeof tab>>>([])
  const activeStoryboardId = ref('')
  const shell = {
    step: ref(0),
    go: () => {},
    steps: ['1. 文案编写', '2. 口播配音', '3. 视频素材', '4. 特效包装'],
    s: {
      // Step1 面板消费
      sharedProductInfo: ref({ brand: '', product: '', model: '', extra: '', keywords: [] as string[] }),
      applyScriptProduct: () => {}, clearScriptProduct: () => {},
      copyPrompt: ref(''), manualCopy: ref(''), manualCopyBusy: ref(false),
      activeNarrative: ref(''),
      scriptPlatform: ref('抖音'), platformOptions: ref([{ name: '抖音', guide: '' }]),
      loadPlatforms: async () => {},
      voiceoverCandidates: ref([]), voiceoverFailedFormulas: ref([]),
      voiceoverDlgOpen: ref(false), voiceoverSelectedIdxs: ref([] as number[]),
      closeVoiceoverDlg: () => {}, genVoiceoverCandidates: async () => {},
      confirmVoiceoverCandidates: () => {},
      // 分镜组件消费
      copyShots: ref<StoryboardShot[]>([]),
      copyShotsStale: ref(false),
      genStoryboard: async () => {}, storyboardBusy: ref(false),
      scenes: ref([]), shotClipGroup: ref<number[][]>([]),
      bindShotMaterial: () => {}, removeShotClipAt: () => {}, unbindShotMaterial: () => {},
      toAbsolute: (p: string) => p,
      storyboards,
      activeStoryboardId,
      setActiveStoryboard: (id: string) => { activeStoryboardId.value = id },
      renameStoryboardTab: () => {}, removeStoryboardTab: () => {},
      COPY_STORYBOARD_MAX: 10,
    },
  }
  return { shell, storyboards, activeStoryboardId }
}

async function renderWithShell(
  root: Parameters<typeof createSSRApp>[0],
  shell: object,
  props: Record<string, unknown> = {},
): Promise<string> {
  const app = createSSRApp(defineComponent(() => () => h(root as never, props as never)))
  // 测试脚手架：注入键为严格类型，最小 fake 整体断言（不做逐字段类型表演）
  app.provide(copywritingMontageShellKey, shell as never)
  // SSR 会原样保留 HTML 注释——模板注释文本会撞文本断言，统一剥除
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/g, '')
}

beforeEach(() => { storyboardShotsExpanded.value = false })

describe('CopywritingStep1Panel 渲染冒烟（1105 批一改版）', () => {
  it('两方案显式呈现：方案一=选择产品（纯选择器）、方案二=提示词；平台在生成按钮前（2026-11-05 五改）', async () => {
    const { shell } = fakeShell()
    const html = await renderWithShell(CopywritingStep1Panel, shell)
    expect(html).toContain('方案一')
    expect(html).toContain('方案二')
    expect(html).toContain('>选择产品<')
    // 两方案同构：同款胶囊 + 提示行（方案一提示=选择产品来生成文案；方案二提示红色）
    expect(html).toContain('选择产品来生成文案')
    expect(html).toContain('没有产品？直接输入提示词生成文案')
    expect(html).toContain('scheme-hint--danger')
    // 平台=通用设置：位于生成按钮之前
    expect(html.indexOf('>平台<')).toBeLessThan(html.indexOf('AI生成口播文案'))
    // 占位=按平台动态的详细样本（2026-11-13 用户需求）：默认平台抖音 → 详细范例占位
    expect(html).toContain('的抖音信息流带货文案')
    expect(html).toContain('AI生成口播文案')
    // 输入框=四行（2026-11-13 用户裁决：默认预填按平台的详细提示词样本，rows 扩到 4）；
    // 顺序：样本内容与「平台样本」按钮都在 AI 按钮之前
    expect(html).toContain('gen-textarea')
    expect(html).toContain('rows="4"')
    expect(html).toContain('前 3 秒强钩子开场')
    expect(html).toContain('📝 平台样本')
    expect(html.indexOf('前 3 秒强钩子开场')).toBeLessThan(html.indexOf('AI生成口播文案'))
    // 产品与提示词皆空 → AI 按钮禁用（TButton 透传 disabled 属性）
    expect(html).toContain('disabled')
  })

  it('分镜未生成时下一步禁用、生成后可用（2026-11-05 用户裁定）', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '痛点式')] // 纯文案 tab（无镜头）
    shell.s.activeStoryboardId.value = 't1'
    const html = await renderWithShell(CopywritingStep1Panel, shell)
    expect(html).toContain('尚未生成分镜脚本')
    expect(html).toMatch(/disabled/)
    shell.s.storyboards.value = [tab('t1', '痛点式', [shot()])]
    shell.s.activeStoryboardId.value = 't1'
    shell.s.copyShots.value = shell.s.storyboards.value[0]!.shots
    const html2 = await renderWithShell(CopywritingStep1Panel, shell)
    expect(html2).not.toContain('尚未生成分镜脚本')
  })

  it('已选产品时展示产品 chip 与清除钮', async () => {
    const { shell } = fakeShell()
    ;(shell.s as { sharedProductInfo: { value: { brand: string; product: string; model: string; extra: string } } })
      .sharedProductInfo.value = { brand: '罗技', product: '键盘', model: 'K828', extra: '卖点一\n卖点二' }
    const html = await renderWithShell(CopywritingStep1Panel, shell)
    expect(html).toContain('当前产品：罗技 / 键盘 / K828')
    expect(html).toContain('清除已选产品')
  })
})

describe('CopywritingStoryboard 渲染冒烟（1105 收起/展开）', () => {
  it('默认收起：有分镜时只渲染 tab 行（含「展开」钮），不渲染任何分镜卡', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '仿拍_1105', [shot(), shot({ index: 2 })])]
    shell.s.activeStoryboardId.value = 't1'
    shell.s.copyShots.value = shell.s.storyboards.value[0]!.shots
    const html = await renderWithShell(CopywritingStoryboard, shell, { mode: 'edit' })
    expect(html).toContain('仿拍_1105')
    expect(html).toContain('>展开分镜脚本<')
    expect(html).toContain('sb-copy-edit') // 文案框不受收起控制（有激活脚本即显示）
    expect(html).not.toContain('seg-card')
    expect(html).not.toContain('画面描述（视频生成提示词）')
    expect(html).not.toContain('＋ 添加镜头')
  })

  it('展开态：渲染分镜卡全字段（镜别/时长/画面/旁白/音效）与加镜钮，钮面文字为「收起」', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '仿拍_1105', [shot(), shot({ index: 2 })])]
    shell.s.activeStoryboardId.value = 't1'
    shell.s.copyShots.value = shell.s.storyboards.value[0]!.shots
    storyboardShotsExpanded.value = true
    const html = await renderWithShell(CopywritingStoryboard, shell, { mode: 'edit' })
    expect(html).toContain('>收起分镜脚本<')
    // 文案绑定脚本：edit 态脚本顶部显示视频文案框（2026-11-05 用户裁定迁入分镜顶部）
    expect(html).toContain('口播文案（可选）')
    expect(html).toContain('sb-copy-edit')
    expect(html).not.toContain('>文案：旁白<') // sb-copy 只读行仅非编辑态
    expect(html).not.toContain('sb-voice-row') // 无克隆产物不显示声音行
    expect(html).toContain('画面描述（视频生成提示词）')
    expect(html).toContain('旁白（该镜覆盖的文案原文片段）')
    expect(html).toContain('＋ 添加镜头')
  })

  it('收起态两个 tab 名都渲染（tab 行常显）且切换钮在行内（sb-collapse）', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '价格冲击式'), tab('t2', '成分背书式')]
    shell.s.activeStoryboardId.value = 't1'
    const html = await renderWithShell(CopywritingStoryboard, shell, { mode: 'edit' })
    expect(html).toContain('价格冲击式')
    expect(html).toContain('成分背书式')
    expect(html).toContain('sb-collapse')
    // 收起/展开钮回到 tab 行尾（tab 行内、AI 按钮之前）
    expect(html.indexOf('sb-tabs')).toBeLessThan(html.indexOf('sb-collapse'))
    expect(html.indexOf('sb-collapse')).toBeLessThan(html.indexOf('sb-actions'))
  })

  it('空态引导不受收起影响：无分镜时收起态仍渲染 EMPTY_HINT，且不显示切换钮', async () => {
    const { shell } = fakeShell()
    const html = await renderWithShell(CopywritingStoryboard, shell, { mode: 'edit' })
    expect(html).not.toContain('sb-collapse') // 无分镜不显示切换钮
    expect(html).not.toContain('视频文案（可选）') // 进默认无脚本：文案框不显示
    expect(html).toContain('还没有分镜')
    expect(html).toContain('✨ AI 生成分镜')
  })

  it('多稿装载态（仅文案 tab）展开时提示批量补全入口；收起时只留 tab 行', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '价格冲击式'), tab('t2', '成分背书式')]
    shell.s.activeStoryboardId.value = 't1'
    const collapsed = await renderWithShell(CopywritingStoryboard, shell, { mode: 'edit' })
    expect(collapsed).toContain('价格冲击式')
    expect(collapsed).not.toContain('已装载')
    storyboardShotsExpanded.value = true
    const expanded = await renderWithShell(CopywritingStoryboard, shell, { mode: 'edit' })
    expect(expanded).toContain('已装载 2 份文案')
    expect(expanded).toContain('将为每份文案各生成一套分镜')
  })

  it('进入模块默认态（分镜存在但未激活）：展开后提示点标签查看，不再误导「还没有分镜」', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', 'A', [shot()])]
    shell.s.activeStoryboardId.value = ''
    storyboardShotsExpanded.value = true
    const html = await renderWithShell(CopywritingStoryboard, shell, { mode: 'edit' })
    expect(html).toContain('已加载 1 个分镜脚本')
    expect(html).not.toContain('还没有分镜')
  })

  it('非编辑态：material/fx 保留只读文案行；voice 态无文案行（口播文案框在面板、tab 上方）', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '痛点式', [shot()])]
    shell.s.activeStoryboardId.value = 't1'
    storyboardShotsExpanded.value = true
    const mat = await renderWithShell(CopywritingStoryboard, shell, { mode: 'material' })
    expect(mat).toContain('文案：旁白') // material/fx 保留只读行
    const voice = await renderWithShell(CopywritingStoryboard, shell, { mode: 'voice' })
    expect(voice).not.toContain('sb-copy"') // voice 态不渲染文案行（面板口播文案框已上移）
    expect(voice).not.toContain('sb-copy-edit')
  })

  it('克隆声音显示在每个 tab 的视频文案下面（2026-11-05 用户裁定，随标签/收起不控制）', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '痛点式', [shot()], { voiceWav: 'D:/x/a.wav', voiceDurSec: 30.2 })]
    shell.s.activeStoryboardId.value = 't1'
    storyboardShotsExpanded.value = true
    const html = await renderWithShell(CopywritingStoryboard, shell, { mode: 'voice' })
    expect(html).toContain('克隆声音')
    expect(html).toContain('sb-voice-row')
    expect(html).toContain('0:30') // fmtDur 口径 m:ss
    // 收起态同显（文案区不受收起控制）
    storyboardShotsExpanded.value = false
    const collapsed = await renderWithShell(CopywritingStoryboard, shell, { mode: 'voice' })
    expect(collapsed).toContain('克隆声音')
  })

  it('「选择分镜脚本」按钮已删除（1105 批一裁决），AI 生成分镜脚本保留', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', 'A', [shot()])]
    shell.s.activeStoryboardId.value = 't1'
    shell.s.copyShots.value = shell.s.storyboards.value[0]!.shots
    storyboardShotsExpanded.value = true
    const html = await renderWithShell(CopywritingStoryboard, shell, { mode: 'edit' })
    expect(html).not.toContain('选择分镜脚本')
    expect(html).toContain('AI 生成分镜脚本')
  })
})

describe('VoiceoverPickerDialog 渲染冒烟（1105 多选形态）', () => {
  const candidates = [
    { formula: '价格冲击式', text: '两百块出头…', chars: 217, durationS: 36.2 },
    { formula: '成分背书式', text: '键盘打字先串键盘…', chars: 166, durationS: 27.7 },
  ]
  /** 弹窗模板最外层是 teleport——SSR 下内容进 ctx.teleports.body */
  async function renderDlg(props: Record<string, unknown>): Promise<string> {
    const Host = defineComponent(() => () => h(VoiceoverPickerDialog, props as never))
    const ctx: Record<string, unknown> = {}
    await renderToString(createSSRApp(Host), ctx)
    return String((ctx.teleports as Record<string, string> | undefined)?.body ?? '')
  }

  it('multiple=true：卡片带复选样式、已勾选卡高亮、确认钮含勾选计数与多选提示行', async () => {
    const body = await renderDlg({ open: true, candidates, failedFormulas: [], selectedIdxs: [0, 1], multiple: true })
    expect(body).toContain('可勾选多种写法，确认后按勾选个数各装载一份文案')
    expect(body).toContain('voice-check')
    expect(body).toContain('is-selected')
    expect(body).toContain('确定采用选中文案（2）')
  })

  it('multiple 且 0 勾选：确认钮禁用且计数为 0', async () => {
    const body = await renderDlg({ open: true, candidates, failedFormulas: [], selectedIdxs: [], multiple: true })
    expect(body).toContain('确定采用选中文案（0）')
    expect(body).toContain('disabled')
  })

  it('单选形态（仿视频缺省）：无复选样式与计数，按钮维持原文案、圆形单选点保留', async () => {
    const body = await renderDlg({ open: true, candidates, failedFormulas: [], selectedIdx: 0 })
    expect(body).not.toContain('voice-check')
    expect(body).not.toContain('可勾选多种写法')
    expect(body).toContain('>确定采用选中文案<')
    expect(body).toContain('voice-radio')
    expect(body).toContain('is-selected') // 单选选中卡高亮沿用
  })
})
