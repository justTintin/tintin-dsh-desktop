<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ToolTabBar — 工具页多 Tab 工作区·tab 栏（需求规格
// docs/tintin-multitab-workspace.md；本文件为媒体包实现，运营包持
// 同构副本——副本先例同 TButton/OtPickMaterialDialog）。
//
// 形态对齐浏览器 tab（2026-11-09 用户裁决参考图：favicon+标题+右侧×）：
// - 每 tab = 工具卡 emoji + 标题 + 关闭钮 ×（活动常显、非活动 hover 显）
// - 活动态：亮底 + 底边主色指示条（与侧栏选中态风格一致）
// - 状态点：任务运行中=tab 左侧绿点（呼吸闪烁）；后台任务完成=一次性
//   闪烁点（doneAt 变化重放 2.5s 动画后隐没）
// - 中键点击关闭；右键菜单：关闭其他 / 关闭右侧（拖拽重排/pin/hover
//   预览一期不做，2026-11-09 裁决排除清单）
// - 最右「+」= 回导航页（无 tab 底层视图）；tab 溢出横向滚动（软上限
//   由模型层守门，缩窄省略一期不做）
// ═══════════════════════════════════════════════════════════════
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { ToolTab } from '../composables/useToolTabs'

const props = defineProps<{
  /** 全部 tab（模型层响应式数组） */
  tabs: ToolTab[]
  /** 活动实例 id；null=当前处于导航页（无活动 tab） */
  activeTabId: string | null
  /** tab 标题解析：toolId → 卡片展示信息（emoji/标题） */
  toolMeta: (toolId: string) => { emoji: string; title: string } | null
}>()

const emit = defineEmits<{
  (e: 'activate', id: string): void
  (e: 'close', id: string): void
  (e: 'home'): void
  (e: 'menu-close-others', id: string): void
  (e: 'menu-close-right', id: string): void
}>()

// 右键菜单（浏览器标配：关闭其他 / 关闭右侧；点空白/切 tab/滚动即收）
const menu = reactive({ show: false, x: 0, y: 0, tabId: '' })
function openMenu(e: MouseEvent, tab: ToolTab): void {
  menu.show = true
  menu.x = e.clientX
  menu.y = e.clientY
  menu.tabId = tab.id
}
function closeMenu(): void {
  menu.show = false
}
function menuClose(): void {
  if (menu.tabId) emit('close', menu.tabId)
  closeMenu()
}
function menuCloseOthers(): void {
  if (menu.tabId) emit('menu-close-others', menu.tabId)
  closeMenu()
}
function menuCloseRight(): void {
  if (menu.tabId) emit('menu-close-right', menu.tabId)
  closeMenu()
}
onMounted(() => window.addEventListener('click', closeMenu))
onBeforeUnmount(() => window.removeEventListener('click', closeMenu))
// 右键本身会冒泡 click？不会——contextmenu 事件不触发 click。菜单项
// 点击由 window click 监听先于项内 click？菜单项 click 也冒泡到 window
// → closeMenu 在 emit 之后执行（项内 handler 先于 window 捕获?）
// window 监听非 capture，冒泡阶段晚于项内 → 项内先执行 emit 再由
// window 收起，顺序安全（closeMenu 幂等）。

// 完成点观感：doneAt 变化即重放 2.5s 闪烁动画，动画结束自动隐没
// （不用定时器清字段——时间戳保留，观感交给 CSS forwards）
function doneKey(t: ToolTab): number {
  return t.doneAt
}
function isDoneFresh(t: ToolTab): boolean {
  return t.doneAt > 0
}
</script>

<template>
  <div class="tool-tab-bar" role="tablist">
    <div class="tab-scroll">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="tool-tab"
        role="tab"
        :class="{ 'is-active': t.id === activeTabId, 'is-busy': t.busy > 0 }"
        :aria-selected="t.id === activeTabId"
        :title="toolMeta(t.toolId)?.title ?? t.toolId"
        @click="emit('activate', t.id)"
        @auxclick.middle.prevent="emit('close', t.id)"
        @contextmenu.prevent="openMenu($event, t)"
      >
        <!-- 状态点：运行中（绿，呼吸）优先；完成闪烁点仅在非运行中显示 -->
        <span v-if="t.busy > 0" class="dot dot-busy" />
        <span v-else-if="isDoneFresh(t)" :key="doneKey(t)" class="dot dot-done" />
        <span class="tab-emoji">{{ toolMeta(t.toolId)?.emoji }}</span>
        <span class="tab-title">{{ toolMeta(t.toolId)?.title ?? t.toolId }}</span>
        <span
          class="tab-close"
          role="button"
          aria-label="关闭标签页"
          @click.stop="emit('close', t.id)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </span>
      </button>
      <!-- 「+」：回导航页（卡片首页）。常驻最右，不随 tab 滚动条滚出 -->
      <button type="button" class="tab-add" title="返回工具首页" aria-label="返回工具首页" @click="emit('home')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>
    </div>

    <!-- 右键菜单：不 teleport（teleport 到 body 会脱离 .tintin-media-scope
         令牌作用域，var(--card) 等解析为空=透明底——App.vue 弹层既有教训）；
         fixed 定位相对视口（祖先链无 transform/filter），z 局部足够 -->
    <div v-if="menu.show" class="tab-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
      <button type="button" class="tab-menu-item" @click="menuClose">关闭标签页</button>
      <button type="button" class="tab-menu-item" @click="menuCloseOthers">关闭其他标签页</button>
      <button type="button" class="tab-menu-item" @click="menuCloseRight">关闭右侧标签页</button>
    </div>
  </div>
</template>

<style scoped>
.tool-tab-bar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface-container);
}

/* 溢出横向滚动（软上限 12 由模型守门；tab 缩窄省略一期不做） */
.tab-scroll {
  display: flex;
  align-items: stretch;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none; /* tab 条不显示滚动条，滚轮/拖拽滚 */
  padding: 0 var(--space-2);
}
.tab-scroll::-webkit-scrollbar { display: none; }

.tool-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  height: 34px;
  padding: 0 var(--space-2);
  font: inherit;
  font-size: 12.5px;
  color: var(--muted-foreground);
  background: transparent;
  border: none;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
  white-space: nowrap;
}
.tool-tab:hover { background: var(--card); color: var(--foreground); }
.tool-tab.is-active {
  background: var(--card);
  color: var(--foreground);
  font-weight: 600;
}
/* 活动指示条：底边主色（与侧栏选中态风格一致） */
.tool-tab.is-active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--primary);
}
.tab-emoji { font-size: 14px; line-height: 1; flex-shrink: 0; }
.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 4px;
  color: inherit;
  opacity: 0;
  transition: opacity var(--duration-fast), background var(--duration-fast);
}
.tool-tab:hover .tab-close,
.tool-tab.is-active .tab-close { opacity: 0.7; }
.tab-close:hover { opacity: 1; background: rgba(127, 127, 127, 0.2); }

/* 状态点：运行中绿点呼吸 / 完成点一次性闪烁 */
.dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 999px;
}
.dot-busy {
  background: var(--success, #10b981);
  animation: dot-breathe 1.2s ease-in-out infinite;
}
@keyframes dot-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.dot-done {
  background: var(--primary);
  animation: dot-done-flash 2.5s var(--easing-out, cubic-bezier(0, 0, 0.2, 1)) forwards;
}
@keyframes dot-done-flash {
  0%, 60% { opacity: 1; }
  100% { opacity: 0; }
}

/* 「+」回导航页 */
.tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin: auto 4px;
  flex-shrink: 0;
  font-size: 14px;
  color: var(--muted-foreground);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}
.tab-add:hover { background: var(--card); color: var(--foreground); }

/* 右键菜单：teleport 到 body（tab 栏在 flex 骨架内，fixed 定位不受限），
   坐标用客户端坐标，z 高于 tab 栏与 pane 内容 */
.tab-menu {
  position: fixed;
  z-index: 2100;
  min-width: 140px;
  padding: 4px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-3);
}
.tab-menu-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  color: var(--foreground);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
}
.tab-menu-item:hover { background: var(--surface-container); }
</style>
