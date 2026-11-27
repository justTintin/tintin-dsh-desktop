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

// Montage 链路 setup 期读 localStorage（bgmPath/画幅比例等记忆），node SSR 无——
// 空实现桩（tintin-montage-material-sequence.test.ts 同款口径）
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
  key: () => null, get length() { return 0 },
} as Storage
import { createSSRApp, ref, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import CopywritingStep1Panel from '../src/components/media-tools/copywriting-montage/CopywritingStep1Panel.vue'
import CopywritingMontage from '../src/components/media-tools/copywriting-montage/CopywritingMontage.vue'
import CopywritingStep2Panel from '../src/components/media-tools/copywriting-montage/CopywritingStep2Panel.vue'
import CopywritingStoryboard from '../src/components/media-tools/copywriting-montage/CopywritingStoryboard.vue'
import VoiceoverPickerDialog from '../src/components/media-tools/VoiceoverPickerDialog.vue'
import { copywritingMontageShellKey } from '../src/components/media-tools/copywriting-montage/copywritingMontageUiContext'
import { storyboardShotsExpanded } from '../src/composables/storyboardShotsState'
import { hasAnySplitShots } from '../src/composables/copywritingMontageTrackLogic'
import type { StoryboardShot } from '../src/composables/opsStoryboardLogic'

// 产品选择公共弹窗只留壳（SSR 不验证弹窗内部装载面板）
vi.mock('../src/components/workbench/WbPickProductDialog.vue', () => ({
  default: defineComponent({ name: 'WbPickProductDialogStub', render: () => null }),
}))

// Montage 链路的播放器壳依赖 plyr（import 期触 document，node SSR 无）——只留壳
vi.mock('../src/components/common/VideoPlayer.vue', () => ({
  default: defineComponent({ name: 'VideoPlayerStub', render: () => null }),
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
    steps: ['1. 文案编写', '2. 口播配音', '3. 视频素材', '4. 包装交付'],
    s: {
      // Step1 面板消费
      sharedProductInfo: ref({ brand: '', product: '', model: '', extra: '', keywords: [] as string[] }),
      applyScriptProduct: () => {}, clearScriptProduct: () => {},
      copyPrompt: ref(''), manualCopy: ref(''), manualCopyBusy: ref(false),
      activeNarrative: ref(''),
      scriptPlatform: ref('抖音'), platformOptions: ref([{ name: '抖音' }]),
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
      splitResolution: ref(''),
      bindShotMaterial: () => {}, removeShotClipAt: () => {}, unbindShotMaterial: () => {},
      // 逐镜逐轨生成状态（2026-11-26 四源四轨：fake shell 同步补成员）
      shotMatMsg: ref(''),
      shotGenStates: ref({}), shotGenActiveOf: () => false, shotGenStateOf: () => undefined,
      shotBatchAI: async () => {}, shotBatchARoll: async () => {}, shotBatchProgressOf: () => ({ total: 0, done: 0, failed: 0, active: 0 }),
      toAbsolute: (p: string) => p,
      storyboards,
      activeStoryboardId,
      setActiveStoryboard: (id: string) => { activeStoryboardId.value = id },
      renameStoryboardTab: () => {}, removeStoryboardTab: () => {},
      COPY_STORYBOARD_MAX: 10,
    },
  }
  // Montage/Step2Panel 消费成员远多于上列表（2026-11-26 悬浮导航/左右分栏把冒烟面
  // 扩到容器级）：Proxy 兜底缺失键=缓存 ref([])（数组安全，真值性偏宽——冒烟不校验布尔态）
  const fallback = new Map<string, unknown>()
  shell.s = new Proxy(shell.s, {
    get(t, k) {
      if (typeof k !== 'string' || k in t) return (t as Record<string, unknown>)[k]
      if (!fallback.has(k)) fallback.set(k, ref([]))
      return fallback.get(k)
    },
  })
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

  it('分镜未生成时悬浮导航下一步禁用、生成后可用（2026-11-05 裁定；2026-11-26 移容器悬浮底栏）', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '痛点式')] // 纯文案 tab（无镜头）
    shell.s.activeStoryboardId.value = 't1'
    const html = await renderWithShell(CopywritingMontage, shell)
    // 悬浮导航渲染面：底栏胶囊 + 去序号步骤名（第①步无上一步）；第④步展示名已改包装交付
    expect(html).toContain('step-float-nav')
    expect(html).toContain('下一步：口播配音')
    expect(html).not.toContain('上一步：')
    expect(html).toContain('尚未生成分镜脚本')
    expect(html).toMatch(/disabled/)
    shell.s.storyboards.value = [tab('t1', '痛点式', [shot()])]
    shell.s.activeStoryboardId.value = 't1'
    shell.s.copyShots.value = shell.s.storyboards.value[0]!.shots
    // 门禁解除相：Montage 自持真实 composable（注入 fake 不进入），渲染面只钉禁用相；
    // 解除相在逻辑层钉（helper=门控单一来源）
    shell.s.storyboards.value = [tab('t1', '痛点式', [shot()])]
    expect(hasAnySplitShots(shell.s.storyboards.value)).toBe(true)
    expect(hasAnySplitShots([tab('t2', '纯文案')])).toBe(false)
  })
  it('第三步左右分栏渲染面（2026-11-26 用户裁决）：口播文案及声音/视频素材：A-Roll（组件内）+ 素材库/AI生成（#side 注入），分割线在场，导航行已移除', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '痛点式', [shot()], { narrative: '旁白稿' })]
    shell.s.activeStoryboardId.value = 't1'
    shell.s.copyShots.value = shell.s.storyboards.value[0]!.shots
    const html = await renderWithShell(CopywritingStep2Panel, shell)
    // 右栏组标题（次序=注入序：素材库 → AI生成；文案声音/A-Roll 两组组件内自持在前）
    expect(html).toContain('口播文案及声音')
    expect(html).toContain('视频素材：A-Roll')
    expect(html).toContain('视频素材：素材库')
    expect(html).toContain('视频素材：AI生成')
    expect(html.indexOf('视频素材：A-Roll')).toBeLessThan(html.indexOf('视频素材：素材库'))
    expect(html.indexOf('视频素材：素材库')).toBeLessThan(html.indexOf('视频素材：AI生成'))
    // 分割线可拖（占位元素）+ 组内关键件（选择素材/生成剪辑方案/参数设置随脚本留左栏）
    expect(html).toContain('sb-div')
    expect(html).toContain('选择素材')
    expect(html).toContain('生成剪辑方案')
    expect(html).toContain('当前分镜')
    // 面板内导航行不再渲染（悬浮底栏接管）
    expect(html).not.toContain('上一步：口播配音')
    expect(html).not.toContain('下一步：特效包装')
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
    // 输出画幅在脚本基本信息行（2026-11-27 用户裁决：纯文字只读——生成后改画幅
    // 必然图文不符；画幅唯一修改入口=生成区「画幅比例」选择，在 AI 按钮前）
    expect(html).toContain('输出画幅')
    expect(html).not.toContain('sb-tab-aspect') // tab 胶囊还原纯名称
    expect(html).toContain('9:16（竖屏）') // 比例口径（1127 用户裁决：用比例不用分辨率）
    expect(html).toContain('画幅比例') // 生成区画幅选择（2026-11-27）
    // 按钮前（锚 sb-gen-btn：提示语文本里也含「AI 生成分镜脚本」字样，不能拿它定位）
    expect(html.indexOf('画幅比例')).toBeLessThan(html.indexOf('sb-gen-btn'))
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

  it('输出画幅在基本信息行纯文字（1127 裁决）：全部形态只读回显当前值，不再可改', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '痛点式', [shot()], { layout: 'horizontal' })]
    shell.s.activeStoryboardId.value = 't1'
    shell.s.copyShots.value = shell.s.storyboards.value[0]!.shots
    storyboardShotsExpanded.value = true // 基本信息行在展开态模板内
    const mat = await renderWithShell(CopywritingStoryboard, shell, { mode: 'material' })
    expect(mat).toContain('输出画幅：16:9（横屏）') // 纯文字回显当前值（比例口径）
    expect(mat).not.toContain('素材状态：按各镜时长自动分配已分割素材') // 1127 裁决：基本信息行此文案移除
    expect(mat).not.toContain('本脚本输出画幅') // 旧可改下拉已移除
    const fx = await renderWithShell(CopywritingStoryboard, shell, { mode: 'fx' })
    expect(fx).toContain('输出画幅：16:9（横屏）') // 只读显示当前值（比例口径）
    expect(fx).not.toContain('<select')
    const voice = await renderWithShell(CopywritingStoryboard, shell, { mode: 'voice' })
    expect(voice).toContain('输出画幅：16:9（横屏）') // 纯文字回显当前值（比例口径）
    expect(voice).not.toContain('本脚本输出画幅')
  })

  it('四源四轨：轨道瓦片 + 右列单选/搜索按钮 + A-Roll 组（2026-11-26 用户裁决）', async () => {
    const { shell } = fakeShell()
    shell.s.storyboards.value = [tab('t1', '痛点式', [shot()])]
    shell.s.activeStoryboardId.value = 't1'
    shell.s.copyShots.value = shell.s.storyboards.value[0]!.shots
    storyboardShotsExpanded.value = true
    const idle = await renderWithShell(CopywritingStoryboard, shell, { mode: 'material' })
    // 四轨瓦片 + 右列控制 + A-Roll 组（图1/图2 红框位）
    expect(idle).toContain('seg-tracks')
    // 2026-11-26 用户裁决：右列复选/搜索钮退役——复选上瓦片右上（cell-check，仅
    // material 态）、在线搜索钮入搜索瓦片下半（cell-search）
    expect(idle).toContain('track-cell')
    expect(idle).toContain('cell-check')
    expect(idle).toContain('cell-search-btn')
    expect(idle).toContain('>在线搜索<')
    expect(idle).not.toContain('seg-ctl') // 右列控制列已删
    expect(idle).not.toContain('>在线搜索素材<') // 旧列钮文案随删（title 内文字不算）
    expect(idle).toContain('生成A-Roll') // TrackBatchBar kind=aroll 组按钮
    expect(idle).toContain('A-Roll 数字人') // TrackBatchBar kind=aroll 组标题
    expect(idle).toContain('track-ph') // 未绑定占位图
    expect(idle).toContain('素材状态：未绑定素材') // 素材状态行单行口径（1126 用户裁决）
    expect(idle).toContain('上传人物图')
    expect(idle).toContain('拆分口播') // 卡顶拆分声音绑定回显（1126 用户裁决）
    // 停止按钮显隐（1127 用户裁决 + 1048 实机报障回归：script computed 里 Ref 必须
    // 手动解包，否则停止钮永不渲染）——空闲不显示；跑批本组显示、跨组不显示
    expect(idle).not.toContain('停止等待')
    shell.s.shotMatBusy.value = true
    shell.s.shotMatActiveGroup.value = 'aroll'
    const running = await renderWithShell(CopywritingStoryboard, shell, { mode: 'material' })
    expect(running).toContain('停止等待') // A-Roll 跑批：本组生成按钮旁出现停止
    shell.s.shotMatActiveGroup.value = 'ai'
    const cross = await renderWithShell(CopywritingStoryboard, shell, { mode: 'material' })
    expect(cross).not.toContain('停止等待') // AI 跑批：A-Roll 组不出现停止（归属闸）
    // 素材复选框（2026-11-26 用户裁决：默认全选；「选择素材（追加）」按钮删除——
    // 解绑全部移到素材状态行最右，无绑定镜不渲染）
    expect(idle).toContain('勾选后参与素材匹配/绑定（默认勾选；「解绑全部」清空该镜全部视频源）')
    expect(idle).not.toContain('选择素材（追加）')
    expect(idle).not.toContain('>解绑全部<') // 无绑定镜不渲染解绑钮（title 内文字不算）
    // 生成中：AI 轨瓦片就地进度卡（阶段/进度条/百分数/已用时）
    const states = { '0:gen': { phase: 'generating', progress: 45, taskId: 'j-1', msg: '', startedAt: 0, elapsedSec: 12 } }
    shell.s.shotGenStates = ref(states)
    shell.s.shotGenActiveOf = (i: number, track: string) => i === 0 && track === 'gen'
    shell.s.shotGenStateOf = (i: number, track: string) => (states as Record<string, never>)[`${i}:${track}`]
    const gen = await renderWithShell(CopywritingStoryboard, shell, { mode: 'material' })
    expect(gen).toContain('track-gen')
    expect(gen).toContain('iv-bar')
    expect(gen).toContain('45%')
    expect(gen).toContain('12s')
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

// ── 源码契约（2026-11-27 用户裁决：第三步/包装交付进面板即展开分镜卡——
//    第三步展开曾在连锁改判中被退掉，读源码钉死防再退） ──
import { readFileSync } from 'node:fs'
const step2PanelSrc = readFileSync(new URL('../src/components/media-tools/copywriting-montage/CopywritingStep2Panel.vue', import.meta.url), 'utf8')
const step4PanelSrc = readFileSync(new URL('../src/components/media-tools/copywriting-montage/CopywritingStep4Panel.vue', import.meta.url), 'utf8')
describe('分镜卡展开契约（进面板自动展开）', () => {
  it('第三步（视频素材）面板挂载即置 storyboardShotsExpanded=true', () => {
    expect(step2PanelSrc).toContain("onMounted(() => { storyboardShotsExpanded.value = true })")
  })
  it('第四步（包装交付）面板挂载即置 storyboardShotsExpanded=true（既有先例钉住）', () => {
    expect(step4PanelSrc).toContain("onMounted(() => { storyboardShotsExpanded.value = true })")
  })
})
