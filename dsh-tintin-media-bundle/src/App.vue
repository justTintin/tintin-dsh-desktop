<script setup lang="ts">
// 媒体工具视图根组件（WP-3）：分组卡片网格 + 多 Tab 工作区。
// 2026-09-24 用户裁决：分组对齐原客户端 views/MediaTools.vue（文案脚本模板/图形/
// 音频/视频 四组；智能混剪按 A1 裁决永久不移植故不列卡）；未移植卡以「建设中」
// 角标占位（不可点，恢复一张加一张卡）。已可用：文案混剪、剪映模板、声音克隆、
// 图像抠图、参考视频下载（2026-09-25 用户裁决随产品资料批次移植）；素材库
// （2026-09-29 由「音频生成」卡升级：视频/图片素材库 + 音频页原音频生成）。
// 2026-11-12 多 Tab 工作区落地（docs/tintin-multitab-workspace.md，2026-11-09
// 用户裁决；KeepAlive 单实例缓存语义被 tab 多实例取代——2026-10-20 裁决同步废止）：
// tab 栏替换「返回媒体工具」条；打开卡片=新开 tab；「+」回导航页（无 tab
// 底层视图）；同卡可多开各实例互不干涉；关闭运行中任务 tab 有确认。
import { onMounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import CopywritingMontage from './components/media-tools/copywriting-montage/CopywritingMontage.vue'
// 剪映模板卡启用（2026-09-24 用户裁决：去掉「建设中」，可用）：组/子类目两级浏览 +
// 从剪映同步（预设/文字模板/花字/贴纸/转场/音频）+ 字体（剪映）上传
import JianYingTemplates from './components/media-tools/JianYingTemplates.vue'
// 声音克隆（2026-09-24 用户裁决移植）：样本库/Qwen3 音色/克隆合成/批量克隆
import VoiceClone from './components/media-tools/VoiceClone.vue'
// 图像抠图（2026-09-25 用户裁决移植）：POST /matting 同步抠图，PNG 落盘原图旁
import ImageMatting from './components/media-tools/ImageMatting.vue'
// 素材库（2026-09-29 用户裁决：原「音频生成」卡升级）——三 tab 视频/图片/音频：
// 图视域=服务端素材库检索/预览/多选/下载（形态对齐会话「选择素材」弹窗），
// 音频 tab=原音频生成界面与功能原样内嵌（AudioGen 随本组件挂载）
import MaterialLibrary from './components/media-tools/MaterialLibrary.vue'
// 分镜脚本创作（2026-09-25 P2 恢复）：文案→分镜→引用素材→保存脚本库；消费产品资料卡草案信号
import OtStoryboard from './components/media-tools/OtStoryboard.vue'
// 图片/视频反推提示词（2026-11-09 用户裁决：自运营工具整体迁入——视频反推
// 消费本包既有 useImitationVideo，与仿爆款视频卡同编排同源、state 独立实例）
import ReversePromptVideo from './components/media-tools/ReversePromptVideo.vue'
import ReversePromptImage from './components/media-tools/ReversePromptImage.vue'
// 视频转文字（2026-09-25 P2 恢复）：批量转写队列 + 听悟式字幕工作台 + 洗稿 + 四格式导出
import VideoTranscribe from './components/media-tools/VideoTranscribe.vue'
// 去水印字幕（2026-09-25 P2 恢复）：预览帧四点框选 + /vsr/remove
import SubtitleRemoval from './components/media-tools/SubtitleRemoval.vue'
// 仿视频（V3.5 · PRD-M-5，2026-10-02）：原视频→仿拍脚本→AI 素材→剪映草稿七步向导；
// 取代已退役的旧「仿爆款」卡（裁决 §11-15），整体方案与文案混剪对应（§5.3）
import ImitationVideo from './components/media-tools/ImitationVideo.vue'
// 直播切片（2026-09-25 P2 恢复）：热点发现→切片→封面/字幕（whisper+llmChat+liveclip 文件 I/O）
import LiveClip from './components/media-tools/LiveClip.vue'
// 多 Tab 工作区三件（本包实现；运营包持同构副本）：
import ToolTabBar from './components/ToolTabBar.vue'
import ToolTabPane from './components/ToolTabPane.vue'
import { useToolTabs, TOOL_TAB_MAX, type ToolTab } from './composables/useToolTabs'
// 「前往分镜」跨视图跳转（2026-09-27）：产品资料·文案面板写入 pendingStoryboard
// 信号后自动打开分镜脚本创作卡
import { pendingStoryboard } from './composables/pendingStoryboard'
// 主题跟随宿主（2026-10-18 报障修正：原生信号 body[data-ds-dark-theme]）
import { useHostDark } from './composables/hostTheme'
// 工具内跨卡跳转（2026-10-09）：仿视频第 1 步「视频去字幕」等按钮写入
// 目标卡 id（pendingMediaTool），本视图侦听后切卡（一次性消费）
import { pendingMediaTool } from './composables/pendingMediaTool'

interface ToolCard {
  id: string
  title: string
  desc: string
  emoji: string
  accent: string
  /** 建设中占位：不可点 */
  disabled?: boolean
}

const GROUPS: Array<{ group: string; tools: ToolCard[] }> = [
  {
    group: '文案脚本模板',
    tools: [
      { id: 'storyboard', title: '分镜脚本创作', desc: '文案 → 分镜 → 引用素材 → 保存脚本库', emoji: '🎬', accent: 'linear-gradient(135deg,#F97316 0%,#EC4899 100%)' },
      { id: 'jianying-templates', title: '剪映模板', desc: '从剪映同步的预设/文字模板/花字/贴纸/转场/音频，按分类浏览', emoji: '🎞️', accent: 'linear-gradient(135deg,#0EA5E9 0%,#8B5CF6 100%)' },
      { id: 'video-transcribe', title: '视频转文字', desc: '视频语音自动转写', emoji: '📄', accent: 'linear-gradient(135deg,#6366F1 0%,#A855F7 100%)' },
    ],
  },
  {
    // 封面制作卡已退役（2026-11-09 用户裁决）：封面编辑器独立为侧栏「封面制作」
    // 视图（dsh-tintin-cover-plugin 页内挂载），媒体包旧 workflow 版卡整体删除
    group: '图形',
    tools: [
      { id: 'image-matting', title: '图像抠图', desc: '智能抠图 / 去除背景', emoji: '✂️', accent: 'linear-gradient(135deg,#0EA5E9 0%,#06B6D4 100%)' },
    ],
  },
  {
    group: '音频',
    tools: [
      { id: 'material-library', title: '素材库', desc: '视频 / 图片素材浏览下载，音频页含 AI 生成 BGM / 音效', emoji: '🗂️', accent: 'linear-gradient(135deg,#14B8A6 0%,#0EA5E9 100%)' },
      { id: 'voice-clone', title: '声音克隆', desc: '克隆音色生成配音', emoji: '🎵', accent: 'linear-gradient(135deg,#8B5CF6 0%,#EC4899 100%)' },
    ],
  },
  {
    group: '视频',
    tools: [
      { id: 'copywriting-montage', title: '文案混剪', desc: '按文案自动匹配素材，快速生成混剪成片', emoji: '📝', accent: 'linear-gradient(135deg,#10B981 0%,#0EA5E9 100%)' },
      { id: 'imitation-video', title: '仿爆款视频', desc: '原视频拆解 → 仿拍脚本 → AI 分镜生成 → 剪映草稿', emoji: '🎯', accent: 'linear-gradient(135deg,#F43F5E 0%,#F59E0B 100%)' },
      // 仿爆款旧卡已退役（2026-10-02 用户裁决：旧款未投产，V3.5 仿视频向导链取代；
      // 服务端 /viral/clone/* 契约面与类型保留，客户端 UI/composable/logic 移除）
      { id: 'live-slice', title: '直播切片', desc: '视频分析热点发现→切片与封面生成', emoji: '📡', accent: 'linear-gradient(135deg,#EF4444 0%,#DC2626 100%)' },
      // 视频修复占位卡已删（2026-10-06 用户裁决：卡片及功能移除；从未实现，仅禁用占位）
      { id: 'subtitle-removal', title: '视频去水印字幕', desc: '去除字幕 / 台标水印', emoji: '🔤', accent: 'linear-gradient(135deg,#F59E0B 0%,#EF4444 100%)' },
    ],
  },
  {
    // 提示词组（2026-11-09 用户裁决：自运营工具整体迁入，ops 侧不再有）
    group: '提示词',
    tools: [
      { id: 'reverse-prompt-image', title: '图片反推提示词', desc: '上传图片，AI 生成绘画提示词', emoji: '🖼️', accent: 'linear-gradient(135deg,#10B981 0%,#14B8A6 100%)' },
      { id: 'reverse-prompt-video', title: '视频反推提示词', desc: '拆解视频 → 脚本 + 反推提示词（仿视频拆解接口）', emoji: '🎬', accent: 'linear-gradient(135deg,#3B82F6 0%,#8B5CF6 100%)' },
    ],
  },
]

const ALL_TOOLS = GROUPS.flatMap((g) => g.tools)

// ═══ 多 Tab 工作区（模型层 useToolTabs；实例键控/显隐在 ToolTabPane）═══
const { tabs, activeTabId, discarded, hasTabs, openTab, closeTab, activate, goHome, closeOthers, closeRight } = useToolTabs()

// 卡 id → 工具组件（tab 内容按 toolId 解析渲染）
const TOOL_COMPONENTS: Record<string, Component> = {
  'copywriting-montage': CopywritingMontage,
  'imitation-video': ImitationVideo,
  'jianying-templates': JianYingTemplates,
  'voice-clone': VoiceClone,
  storyboard: OtStoryboard,
  'video-transcribe': VideoTranscribe,
  'subtitle-removal': SubtitleRemoval,
  'live-slice': LiveClip,
  'image-matting': ImageMatting,
  'material-library': MaterialLibrary,
  'reverse-prompt-video': ReversePromptVideo,
  'reverse-prompt-image': ReversePromptImage,
}

/** tab 栏标题解析（toolId → 卡片 emoji/标题） */
function toolMeta(toolId: string): { emoji: string; title: string } | null {
  const t = ALL_TOOLS.find((x) => x.id === toolId)
  return t ? { emoji: t.emoji, title: t.title } : null
}

// 满员提示（软上限 12，模型层拒绝新开时触发）
const capacityNotice = ref(false)
// 关闭确认（一期从宽：仅任务运行中的 tab 拦截，2026-11-12 用户裁决）
const closeAsk = ref<ToolTab | null>(null)

/** 打开卡片 = 新开 tab 并切换（点击卡片/新开类信号走这里） */
function requestOpen(toolId: string): void {
  if (!TOOL_COMPONENTS[toolId]) return // 未知卡 id 拒收（退役卡防御）
  if (openTab(toolId) === null) capacityNotice.value = true
}

/** 直达信号语义（2026-11-09 文档建议）：聚焦已有同工具 tab，无则新开
    （避免直达链路开出重复 tab） */
function focusOrOpen(toolId: string): void {
  const existing = tabs.value.find((t) => t.toolId === toolId)
  if (existing) activate(existing.id)
  else requestOpen(toolId)
}

function openTool(t: ToolCard): void {
  if (t.disabled) return
  requestOpen(t.id)
}

/** 关闭请求（tab 栏 × / 中键 / 右键菜单统一入口）：busy=任务运行中→确认 */
function requestClose(id: string): void {
  const tab = tabs.value.find((t) => t.id === id)
  if (!tab) return
  if (tab.busy > 0) closeAsk.value = tab
  else closeTab(id)
}
function confirmClose(): void {
  if (closeAsk.value) closeTab(closeAsk.value.id)
  closeAsk.value = null
}
function cancelClose(): void {
  closeAsk.value = null
}

// 「前往分镜」跨视图跳转（2026-09-27）：产品资料·文案面板写入 pendingStoryboard
// 信号后自动打开分镜脚本创作卡（信号由 OtStoryboard 挂载/在位时消费）
watch(pendingStoryboard, (v) => { if (v) focusOrOpen('storyboard') })
// 工具内跨卡跳转（2026-10-09）：仿视频第 1 步「视频去字幕」等按钮写入目标卡
// id 后在此切卡；立即清空（一次性消费，防残留重复触发）。
// 未知卡 id 拒收（2026-11-09 封面卡退役防御）：否则落在无组件映射的 id 上
// =空 tab 死胡同；存量外部绑定（创作包 localStorage）可能还带着旧 id。
watch(pendingMediaTool, (id) => {
  pendingMediaTool.value = null
  if (!id || !TOOL_COMPONENTS[id]) return
  focusOrOpen(id)
})
// 跨包直达（2026-10-17 创作模式拆独立插件 dsh-tintin-creation-bundle）：
// 创作包经窗口总线 __tintinBus 请求打开媒体工具卡（同 bundle 写入方仍走
// 上方 pendingMediaTool ref，两条路径同一落点）；未知卡 id 同款拒收
function onBusMediaTool(payload: unknown): void {
  const id = String(payload ?? '')
  if (!id || !TOOL_COMPONENTS[id]) return
  focusOrOpen(id)
}
onMounted(() => {
  window.__tintinBus?.on('tintin:media-tool', onBusMediaTool)
})

// 主题跟随宿主（2026-10-18 报障修正）：原生有效暗色=body[data-ds-dark-theme]
// （应用内偏好可≠系统偏好），旧 html.dark 链原生从不打——判定/监听收进
// composables/hostTheme，与运营/创作同口径。
const isDark = useHostDark()
</script>

<template>
  <!-- tintin-media-scope：搬运的 tokens/global css 的作用域根（见 src/styles/）；
       2026-11-12 多 Tab 工作区：.root 钉 100vh 自建滚动骨架（宿主链全是
       min-height 高度不定，fixed overlay 的 100vh 是合法定锚——同 OpsApp
       2026-11-07 方案 1 口径），导航页与每个 tab pane 各自内滚 -->
  <div class="tintin-media-scope root" :class="{ dark: isDark }">
    <!-- ═══ tab 栏（有 tab 才显示；「+」回导航页） ═══ -->
    <ToolTabBar
      v-if="hasTabs"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :tool-meta="toolMeta"
      @activate="activate"
      @close="requestClose"
      @home="goHome"
      @menu-close-others="closeOthers"
      @menu-close-right="closeRight"
    />

    <!-- ═══ 卡片导航页（无 tab 底层视图；v-show 保 DOM，回导航不丢 tab 状态） ═══ -->
    <!-- 2026-09-25 用户报障「卡片返回后界面空白」：原 <Transition mode="out-in">
         依赖过渡结束检测（transitionend + 双 rAF 换类），高合成器负载（卡片光晕
         无限旋转）或帧饥饿时偶发停在 leave 阶段=整页空白。改为无 Transition 的
         同步 v-show 交换 + 纯 CSS 入场动画（page-in）：结构上无离开阶段，不可能卡死。 -->
    <div v-show="!activeTabId" class="page page-nav">
      <div class="head">
        <div class="title">媒体工具</div>
        <div class="sub">选择需要执行的 AI 生产能力</div>
      </div>
      <div v-for="g in GROUPS" :key="g.group" class="group-block">
        <div class="group-label">{{ g.group }}</div>
        <div class="grid">
          <button
            v-for="t in g.tools"
            :key="t.id"
            type="button"
            class="tool-card"
            :class="{ 'is-disabled': t.disabled }"
            :style="{ '--card-accent': t.accent }"
            :disabled="t.disabled"
            @click="openTool(t)"
          >
          <span v-if="t.disabled" class="badge">即将上线</span>
          <div class="card-top">
            <div class="icon"><span>{{ t.emoji }}</span></div>
            <div class="card-title">{{ t.title }}</div>
          </div>
          <div class="card-desc">{{ t.desc }}</div>
          <div class="card-foot">
            <span class="arrow" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </button>
        </div>
      </div>
    </div>

    <!-- ═══ tab 内容区：每 tab 一个 pane，全部挂载 v-show 切换（状态/滚动/轮询
         保持）；LRU 超限的 pane 卸载实例（切回重建）；关闭 tab 即销毁 ═══ -->
    <div v-show="!!activeTabId" class="tab-panes">
      <ToolTabPane
        v-for="t in tabs"
        :key="t.id"
        :tab="t"
        :component="TOOL_COMPONENTS[t.toolId]"
        :active="t.id === activeTabId"
        :discarded="discarded.has(t.id)"
      />
    </div>

    <!-- ═══ 关闭确认（任务运行中） ═══ -->
    <div v-if="closeAsk" class="modal-mask" @click.self="cancelClose">
      <div class="modal confirm-modal">
        <div class="confirm-title">关闭标签页</div>
        <div class="confirm-text">
          「{{ toolMeta(closeAsk.toolId)?.title ?? closeAsk.toolId }}」正在运行任务，关闭将中断该任务。确定关闭？
        </div>
        <div class="confirm-ops">
          <button type="button" class="confirm-btn" @click="cancelClose">取消</button>
          <button type="button" class="confirm-btn confirm-btn-danger" @click="confirmClose">中断并关闭</button>
        </div>
      </div>
    </div>

    <!-- ═══ 满员提示（软上限 12） ═══ -->
    <div v-if="capacityNotice" class="modal-mask" @click.self="capacityNotice = false">
      <div class="modal confirm-modal">
        <div class="confirm-title">标签页已达上限</div>
        <div class="confirm-text">最多同时打开 {{ TOOL_TAB_MAX }} 个标签页，请先关闭部分标签页后再打开新工具。</div>
        <div class="confirm-ops">
          <button type="button" class="confirm-btn" @click="capacityNotice = false">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 全页视图布局（2026-11-12 多 Tab 工作区）：容器 el 为 100% 宽 × 100% 高的
   视图区（tintin-bundle Tab 栏传入），本组件钉 100vh 铺满、自建滚动骨架
   （宿主链全是 min-height、高度不定，fixed overlay 的 100vh 是合法定锚；
   同 OpsApp 2026-11-07 方案 1 口径）。tab 栏 flex-shrink:0 在顶部，
   导航页与 tab pane 各自内滚。padding 下沉到导航页层（tab 栏通栏）。 */
.root {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 页面入场（2026-09-25 空白修复）：无 Transition 的同步交换 + 纯 CSS
   入场动画——离开零依赖，结构上不存在卡死点（原 out-in Transition 见上方注记） */
.page {
  display: flex;
  flex-direction: column;
  animation: page-in 0.2s var(--easing-out, cubic-bezier(0, 0, 0.2, 1));
}
@keyframes page-in {
  from { opacity: 0; transform: translateY(12px); }
}

/* 导航页（卡片网格）：自滚层（滚动宿主从视图区换到本层，视觉一致） */
.page-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-6);
}

/* tab 内容区：纵向 flex，每 pane flex:1 自滚（ToolTabPane 内部样式） */
.tab-panes {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.head { margin-bottom: var(--space-5); }
.title { margin: 0 0 var(--space-1); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--foreground); }
.sub { margin: 0; font-size: var(--font-size-body); color: var(--muted-foreground); }

/* 分组（2026-09-24 对齐原 MediaTools 分组 Launcher） */
.group-block { margin-bottom: var(--space-6); }
.group-block:last-child { margin-bottom: 0; }
.group-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground); margin-bottom: var(--space-3);
}

/* 全宽自适应列（宽屏两卡铺开，窄屏自动单列） */
.grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, 240px); } /* 卡片 2/3（2026-10-14 列宽 300→200）；2026-10-18 用户裁决：卡片高宽 +1/5，列宽 200→240；2026-10-30 用户裁决：列宽钉死——原 minmax(240px,1fr) 会把剩余宽度摊给列，还原窗列少卡片反而比最大化大 */

/* 卡片视觉对照源 MediaTools.vue（accent 光晕 + hover 毛玻璃），压缩到面板尺寸 */
/* 入场 stagger + 光晕旋转（2026-09-25 用户报障「缺原客户端动画」补齐，
   SRC OtToolCard/MediaTools 口径：stagger-in .35s + 35ms 步进、aurora-spin 8s；
   backwards 填充：延迟期显示 from 态，播完交还 transform 给 hover 抬升） */
/* 工具卡不能用 `.card` 类名：移植兼容层 `.tintin-media-scope .card`（tintin-global.css
   的旧类映射）与本规则特异性相同且更靠后，基础态会被拉回「白底 + 边框 + 阴影」，
   只有 hover/焦点（多一个伪类、特异性更高）才盖得回渐变——这正是 2026-10-16 用户
   报障「只有焦点才有底色、字看不见」的根因。改用独立类名彻底避开旧类映射。 */
.tool-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: calc(var(--space-5) * 4 / 5); /* 卡片 2/3（2026-10-14）；2026-10-18 用户裁决：卡片高宽 +1/5，×4/5 */
  text-align: left;
  font: inherit;
  /* 底色 = 罩层 + accent 渐变两层叠加：罩层把饱和度压下来（2026-10-16 用户裁决：
     底色再浅、饱和度不要这么高）。整卡只有「底色 + 图片」两层，图片不再自带色块。 */
  --tool-card-wash: rgba(255, 255, 255, 0.62);
  background-color: var(--card);
  background-image: linear-gradient(var(--tool-card-wash), var(--tool-card-wash)), var(--card-accent, none);
  border: none;
  border-radius: var(--radius-xl);
  cursor: pointer;
  animation: card-in 0.35s var(--easing-out, cubic-bezier(0, 0, 0.2, 1)) backwards;
  transition:
    transform var(--duration-normal) var(--easing-default),
    box-shadow var(--duration-normal) var(--easing-default),
    background var(--duration-fast);
}
.dark .tool-card { --tool-card-wash: rgba(13, 16, 24, 0.58); } /* 暗色主题用暗罩，保持低饱和又不刺眼 */
.grid .tool-card:nth-child(1) { animation-delay: 0ms; }
.grid .tool-card:nth-child(2) { animation-delay: 35ms; }
.grid .tool-card:nth-child(3) { animation-delay: 70ms; }
.grid .tool-card:nth-child(4) { animation-delay: 105ms; }
.grid .tool-card:nth-child(5) { animation-delay: 140ms; }
.grid .tool-card:nth-child(6) { animation-delay: 175ms; }
.grid .tool-card:nth-child(7) { animation-delay: 210ms; }
.grid .tool-card:nth-child(8) { animation-delay: 245ms; }
.grid .tool-card:nth-child(n + 9) { animation-delay: 280ms; }
@keyframes card-in {
  from { opacity: 0; transform: translateY(12px); }
}
/* 淡染光晕只在 hover/焦点时显现（2026-10-15 用户裁决：焦点时有光晕效果）；无 blur 滤镜旋转
   （2026-10-14 报障：blur(40px)+旋转曾致渲染层假死，故只留无滤镜旋转） */
.tool-card::before {
  content: '';
  position: absolute;
  inset: -35%;
  z-index: 0;
  background: radial-gradient(circle at 32% 32%, var(--card-accent, #6366f1) 0%, transparent 52%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s;
  animation: card-aurora 9s linear infinite;
  will-change: transform;
}
@keyframes card-aurora {
  to { transform: rotate(360deg); }
}
.tool-card:hover::before, .tool-card:focus-visible::before { opacity: 0.16; } /* 浅底上光晕同步收敛（2026-10-16） */
.tool-card > * { position: relative; z-index: 1; }
.tool-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-3);
  /* hover 保持同一套「罩层 + 渐变」，只再叠一层极淡压暗——不再回到高饱和渐变 */
  background-image: linear-gradient(rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.05)), linear-gradient(var(--tool-card-wash), var(--tool-card-wash)), var(--card-accent, var(--card));
}
.tool-card.is-disabled { cursor: not-allowed; }
.tool-card.is-disabled .icon { filter: grayscale(0.6); opacity: 0.75; }
.tool-card.is-disabled:hover { transform: none; box-shadow: none; }
.badge {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-foreground); /* 浅底中性色（2026-10-16 用户裁决：底色转浅后白字不可读） */
  background: rgba(127, 127, 127, 0.16);
  border: 1px dashed rgba(127, 127, 127, 0.5);
  border-radius: 999px;
  padding: 2px 10px;
  pointer-events: none;
}
.card-top { display: flex; align-items: flex-end; gap: calc(var(--space-2) * 4 / 5); margin-bottom: calc(var(--space-4) * 4 / 5); } /* 标题与图片底部对齐（2026-10-16）；2026-10-18 卡片高宽 +1/5 ×4/5 */
.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 43px; /* 图标放大一倍（2026-10-15：18→36px）；2026-10-18 卡片高宽 +1/5，36→43px */
  line-height: 1;
  /* 图片自身透明：卡片只有「底色 + 图片」两层，图标不再带自己的色块（2026-10-16 用户裁决） */
}
.card-title { font-size: var(--font-size-h4); font-weight: 700; line-height: var(--line-height-tight); color: var(--foreground); } /* 浅底改跟随主题墨色（2026-10-16 用户裁决：底色转浅后白字不可读） */
.card-desc { flex: 1 1 auto; margin: 0; font-size: var(--font-size-body); line-height: var(--line-height-body); color: var(--muted-foreground); } /* 同上（2026-10-16） */
.card-foot { display: flex; justify-content: flex-end; margin-top: -2px; }
.arrow {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--muted-foreground); /* 浅底中性色（2026-10-16 用户裁决） */
  background: rgba(127, 127, 127, 0.16);
  transition: transform var(--duration-fast), background var(--duration-fast);
}
.arrow svg { width: 14px; height: 14px; } /* 卡片 2/3 */
.tool-card:hover:not(.is-disabled) .arrow { transform: translateX(2px); background: var(--primary); color: var(--primary-foreground); }

/* ═══ 确认弹层（关闭运行中 / 满员提示）：形态对齐包内 modal-mask 惯例
   （VideoTranscribe 等：fixed 全屏 z 1002 在覆盖层堆叠上下文内） ═══ */
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 1002;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.confirm-modal {
  width: min(420px, calc(100vw - 48px));
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-3);
}
.confirm-title { font-size: var(--font-size-h5); font-weight: 700; color: var(--foreground); }
.confirm-text { font-size: var(--font-size-body); line-height: var(--line-height-body); color: var(--muted-foreground); }
.confirm-ops { display: flex; justify-content: flex-end; gap: var(--space-2); }
.confirm-btn {
  height: 32px;
  padding: 0 var(--space-4);
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.confirm-btn:hover { border-color: var(--primary); color: var(--primary); }
.confirm-btn-danger { color: #fff; background: var(--danger, #ef4444); border-color: var(--danger, #ef4444); }
.confirm-btn-danger:hover { color: #fff; background: #dc2626; border-color: #dc2626; }
</style>

<style>
/* 弹层定位说明（2026-09-24 二次修正）：向导弹层（高级脚本设置/选择分镜脚本/
   素材选择/删除确认等）teleport 到 `.tintin-media-scope` 根元素——不再用 body。
   原因：teleport 到 body 会脱离 .tintin-media-scope 令牌作用域，var(--card) 等
   全部解析为空 → 弹窗背景透明（第一版 body>modal-mask z-index 覆盖还曾因
   特异度低于 scoped 规则而失效，弹窗被覆盖层压住不可见）。改挂到 scope 根后
   令牌/暗色/全局样式自动继承；弹层 fixed 全屏、z 1002 在覆盖层堆叠上下文内
   高于向导内容。已知取舍：顶部 Tab 栏（9999）仍高于弹层蒙层，弹窗打开时
   Tab 栏不被蒙住（原版为全窗变暗，此处为作用域化的必要让步）；
   本视图内联确认弹层（关闭确认/满员提示）同样 fixed z 1002。 */
</style>
