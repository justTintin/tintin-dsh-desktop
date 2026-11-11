<script setup lang="ts">
// 运营工具视图根组件：分组卡片网格 + 多 Tab 工作区（模式对齐 App.vue 媒体
// 多 Tab 骨架，2026-11-12 落地 docs/tintin-multitab-workspace.md，2026-11-09
// 用户裁决；SRC views/OpsTools.vue 三组结构 1:1，搬运基线 SRC 9ca9050）。
// 2026-09-25 用户裁决：产品资料卡随图像抠图一并移植（提前于 P3 ops-bundle），
// 其余 5 卡保持「建设中」占位（恢复一张加一张卡）；卡片清单位置/描述/配色
// 与 SRC GROUP_TOOLS 逐字对齐。
// tab 栏替换「返回运营工具」条；打开卡片=新开 tab；「+」回导航页；同卡可
// 多开（两包 tab 骨架为副本：useToolTabs/ToolTabBar/ToolTabPane）。
import { ref } from 'vue'
import type { Component } from 'vue'
import { useHostDark } from './composables/hostTheme'
// 多 Tab 工作区三件（本包副本；原件在媒体包，改动须两包同步）
import ToolTabBar from './components/ToolTabBar.vue'
import ToolTabPane from './components/ToolTabPane.vue'
import { useToolTabs, TOOL_TAB_MAX, type ToolTab } from './composables/useToolTabs'
// 产品资料（2026-09-25 用户裁决移植）：仓库同步/树/表单增删改/智能挖掘/全量挖掘
// + 内嵌文案生成面板（OtCopywritingPanel）
import OtProductLibrary from './components/ops-tools/OtProductLibrary.vue'
// 自动上架（2026-09-29 用户裁决：UI 入口=运营工具卡；引擎=壳侧浏览器 fxg 分区）
import OtAutoListingPanel from './components/ops-tools/OtAutoListingPanel.vue'
// 智能问答系统（2026-11-08 用户裁决）：iframe 加载服务端 kb 问答前端（/system/kb/status 定位端口）
import OtKbQaPanel from './components/ops-tools/OtKbQaPanel.vue'

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
    group: '产品知识',
    tools: [
      // 智能问答系统（2026-11-08 用户裁决：我的知识库前新增；进面板加载服务端 kb 问答前端）
      { id: 'kb-qa', title: '智能问答系统', desc: '服务端知识库问答，智能检索应答', emoji: '💬', accent: 'linear-gradient(135deg,#6366F1 0%,#0EA5E9 100%)' },
      { id: 'product-library', title: '产品资料', desc: '品类/品牌/型号树状管理，服务端同步', emoji: '📦', accent: 'linear-gradient(135deg,#8B5CF6 0%,#EC4899 100%)' },
      { id: 'knowledge-base', title: '我的知识库', desc: '风格化画像 + 参考素材蒸馏', emoji: '📚', accent: 'linear-gradient(135deg,#0EA5E9 0%,#06B6D4 100%)', disabled: true },
    ],
  },
  // 提示词组已整体迁入媒体工具（2026-11-09 用户裁决：图片/视频反推提示词
  // 组件与 useImitationVideo/imitationVideoLogic 域拷贝随迁出删除，本包不再有）
  {
    group: '视频运营',
    tools: [
      // 自动上架改建设中（2026-11-08 用户裁决：入口收起；面板组件与 autoListing:* 桥保留，
      // 恢复=去掉 disabled 并保留本分支）
      { id: 'auto-listing', title: '自动上架', desc: '数据包校验 → 抖店工作台自动铺货（引擎在内置浏览器）', emoji: '🛒', accent: 'linear-gradient(135deg,#2563EB 0%,#7C3AED 100%)', disabled: true },
      { id: 'video-score', title: '视频评价预测', desc: '关键帧 → 视觉模型预测视频表现', emoji: '📈', accent: 'linear-gradient(135deg,#F59E0B 0%,#EF4444 100%)', disabled: true },
      { id: 'video-marketing', title: '视频营销检测', desc: '研判是否营销视频 + 品类 + 改进建议', emoji: '🎯', accent: 'linear-gradient(135deg,#10B981 0%,#14B8A6 100%)', disabled: true },
    ],
  },
]

const ALL_TOOLS = GROUPS.flatMap((g) => g.tools)

// ═══ 多 Tab 工作区（模型层 useToolTabs；实例键控/显隐在 ToolTabPane）═══
const { tabs, activeTabId, discarded, hasTabs, openTab, closeTab, activate, goHome, closeOthers, closeRight } = useToolTabs()

// 卡 id → 工具组件（tab 内容按 toolId 解析渲染；自动上架面板组件保留映射，
// 卡恢复可用时零改动）
const TOOL_COMPONENTS: Record<string, Component> = {
  'product-library': OtProductLibrary,
  'kb-qa': OtKbQaPanel,
  'auto-listing': OtAutoListingPanel,
}

/** tab 栏标题解析（toolId → 卡片 emoji/标题） */
function toolMeta(toolId: string): { emoji: string; title: string } | null {
  const t = ALL_TOOLS.find((x) => x.id === toolId)
  return t ? { emoji: t.emoji, title: t.title } : null
}

// 满员提示（软上限 12，模型层拒绝新开时触发）
const capacityNotice = ref(false)
// 关闭确认（一期从宽：仅任务运行中的 tab 拦截；ops 卡 busy 接线暂无——
// 各卡运行态接入 useToolTabBusy 后自动生效）
const closeAsk = ref<ToolTab | null>(null)

/** 打开卡片 = 新开 tab 并切换 */
function requestOpen(toolId: string): void {
  if (!TOOL_COMPONENTS[toolId]) return
  if (openTab(toolId) === null) capacityNotice.value = true
}

/** 关闭请求：busy=任务运行中→确认（无 busy 上报的卡直接关） */
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

function openTool(t: ToolCard): void {
  if (t.disabled) return
  requestOpen(t.id)
}

// 主题跟随宿主（2026-10-18 报障修正）：原生有效暗色=body[data-ds-dark-theme]
// （应用内偏好可≠系统偏好），旧 html.dark 链原生从不打——判定/监听收进
// composables/hostTheme，与媒体/创作同口径。
const isDark = useHostDark()
</script>

<template>
  <!-- tintin-media-scope：搬运的 tokens/global css 的作用域根（见 src/styles/）；
       运营视图与媒体视图共用同一套令牌作用域。2026-11-07（产品资料左右联滚
       修复·方案1）的「工具体独立滚动区」骨架在多 Tab 下由 ToolTabPane 滚动层
       继承：每 pane 自滚，产品资料页组件根 height:100% 占满本层 → 左树/右栏
       各自内滚互不牵动；首页工具卡列表自滚（滚动宿主从 .root 换到各层）。 -->
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

    <!-- ═══ 卡片导航页（无 tab 底层视图；v-show 保 DOM） ═══ -->
    <div v-show="!activeTabId" class="page page-nav">
      <div class="head">
        <div class="title">运营工具</div>
        <div class="sub">智能问答系统 · 产品资料 · 我的知识库 · 视频评价预测 · 视频营销检测</div>
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
          <span v-if="t.disabled" class="badge">建设中</span>
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

    <!-- ═══ tab 内容区：每 tab 一个 pane（全部挂载 v-show 切换；LRU 超限卸载
         实例切回重建；关闭 tab 即销毁） ═══ -->
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
/* 全页视图布局（2026-11-12 多 Tab 工作区）：.root 钉 100vh（宿主链全是
   min-height 高度不定，fixed overlay 的 100vh 是合法定锚——2026-11-07
   方案 1 同款锚定），tab 栏 flex-shrink:0 在顶部，导航页与 tab pane 各自
   内滚（.root 不再承担滚动）。 */
.root {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 页面入场（2026-09-25 空白修复）：无 Transition 的同步交换 + 纯 CSS
   入场动画——离开零依赖，结构上不存在卡死点（原 out-in Transition 见 App.vue 注记） */
.page {
  display: flex;
  flex-direction: column;
  animation: page-in 0.2s var(--easing-out, cubic-bezier(0, 0, 0.2, 1));
}
@keyframes page-in {
  from { opacity: 0; transform: translateY(12px); }
}

/* 导航页（卡片网格）：自滚层（滚动宿主从 .root 换到本层，视觉一致；
   顺带修掉旧 .page height:100%+overflow:hidden 对首页超屏内容的理论裁切） */
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

.group-block { margin-bottom: var(--space-6); }
.group-block:last-child { margin-bottom: 0; }
.group-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground); margin-bottom: var(--space-3);
}

.grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, 240px); } /* 卡片 2/3（2026-10-14 列宽 300→200）；2026-10-18 用户裁决：卡片高宽 +1/5，列宽 200→240；2026-10-30 用户裁决：列宽钉死——原 minmax(240px,1fr) 会把剩余宽度摊给列，还原窗列少卡片反而比最大化大 */

/* 入场 stagger + 光晕旋转（2026-09-25 用户报障「缺原客户端动画」补齐，
   SRC OtToolCard/OpsTools 口径：stagger-in .35s + 35ms 步进、aurora-spin 8s；
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
.grid .tool-card:nth-child(n + 5) { animation-delay: 140ms; }
@keyframes card-in {
  from { opacity: 0; transform: translateY(12px); }
}
/* 卡片光晕：偏心径向渐变 + 旋转动画（2026-10-14 报障：blur(40px) 大尺寸模糊
   曾致渲染层假死；无滤镜旋转=合成器零重光栅化；光晕只在 hover/焦点显现 2026-10-15） */
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

/* ═══ 确认弹层（关闭运行中 / 满员提示）：形态对齐媒体 App.vue 同款 ═══ */
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
