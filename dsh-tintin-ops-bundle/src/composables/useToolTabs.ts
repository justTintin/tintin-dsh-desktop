// ═══════════════════════════════════════════════════════════════
// useToolTabs — 工具页多 Tab 工作区·模型层（需求规格
// docs/tintin-multitab-workspace.md，2026-11-09 用户裁决；本文件为
// 运营包副本（原件在 dsh-tintin-media-bundle/src/composables/useToolTabs.ts，
// 改动须两包同步）——两包独立不互依，公共组件各包持副本是既有先例
// （TButton / OtPickMaterialDialog）。
//
// 模型层只管数据与规则，不含 DOM/样式：
// - 打开卡片 = 新开 tab 并切换；同卡可多开，各 tab 一个实例 id
//   （KeepAlive/实例隔离由渲染层按 id 键控，模型层不关心）。
// - 「+」回导航页 = activeTabId 置 null（无 tab 底层视图，tabs 保留，
//   2026-11-12 用户裁决）。
// - 关闭后焦点给相邻 tab（先右后左），不回导航页。
// - tab 软上限 12：满员拒绝新开（返回 null，由 UI 层提示）。
// - 保活上限 8（浏览器 discard 语义，2026-11-12 用户裁决）：最近 8 个
//   实例真正存活，更久未用的进 discarded（渲染层卸载其组件实例，
//   切回时重建=状态重置）；活动 tab 与 busy（任务运行中）tab 不参与
//   淘汰——discard 会中止其任务。
// - busy 通道：任务型卡经渲染层上报运行态（busyInc/busyDec），模型层
//   记 per-tab 计数，供「关闭运行中确认」（一期从宽：仅拦运行中，
//   2026-11-12 用户裁决）与 tab 栏状态点消费；notifyDone 记完成时间戳
//   供「后台任务完成」状态点闪烁。
// - discarded/busyCounts 用 reactive 集合；tab 对象本身响应式
//   （busy/doneAt 直接挂在 tab 上，渲染层零转换）。
// ═══════════════════════════════════════════════════════════════
import { computed, inject, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { InjectionKey, Ref } from 'vue'

/** 单个工具 tab：id=实例 id（渲染层实例键控的唯一依据），toolId=所属功能卡 */
export interface ToolTab {
  id: string
  toolId: string
  createdAt: number
  /** 最近一次激活时间（LRU 保活淘汰依据） */
  lastActiveAt: number
  /** 任务运行中计数（任务型卡经 pane 的 busy 通道维护；>0 时关闭需确认） */
  busy: number
  /** 最近一次任务完成时间戳（tab 栏状态点闪烁；0=无） */
  doneAt: number
}

export const TOOL_TAB_MAX = 12 // 软上限：满员拒绝新开（2026-11-12 用户裁决）
export const TOOL_TAB_KEEP_ALIVE = 8 // 保活上限：超限 LRU discard（2026-11-12 用户裁决）

/** 任务型卡向所属 tab 上报运行态的通道（ToolTabPane provide；
    卡组件 inject 后 inc/dec 成对上报，无 tab 环境 fallback 到 noop） */
export interface ToolTabCtx {
  busyInc(): void
  busyDec(): void
  /** 后台任务完成：tab 状态点闪烁 */
  notifyDone(): void
}
export const TOOL_TAB_CTX: InjectionKey<ToolTabCtx> = Symbol('tintinToolTabCtx')
/** 无 tab 环境兜底（卡组件直接挂载/测试等） */
export const NOOP_TOOL_TAB_CTX: ToolTabCtx = { busyInc() {}, busyDec() {}, notifyDone() {} }

export interface ToolTabsModel {
  tabs: Ref<ToolTab[]>
  activeTabId: Ref<string | null>
  /** 被 LRU 淘汰的 tab id 集合（渲染层卸载其组件实例；切回时自动移除重建） */
  discarded: Set<string>
  hasTabs: Ref<boolean>
  activeTab: Ref<ToolTab | null>
  openTab(toolId: string): ToolTab | null
  closeTab(id: string): void
  activate(id: string): void
  goHome(): void
  isBusy(id: string): boolean
  /** 供「关闭其他/关闭右侧」等批量操作：逐个走 closeTab 语义 */
  closeOthers(id: string): void
  closeRight(id: string): void
}

export function useToolTabs(): ToolTabsModel {
  const tabs = ref<ToolTab[]>([])
  const activeTabId = ref<string | null>(null)
  const discarded = reactive(new Set<string>())
  let seq = 0

  const hasTabs = computed(() => tabs.value.length > 0)
  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)

  /** LRU 保活：存活实例（未 discard）超过上限时淘汰最久未激活者。
      活动 tab 与 busy tab 不淘汰（discard 会销毁实例中止其任务）。 */
  function pruneLru(): void {
    const alive = tabs.value.filter((t) => !discarded.has(t.id))
    if (alive.length <= TOOL_TAB_KEEP_ALIVE) return
    const victim = alive
      .filter((t) => t.id !== activeTabId.value && t.busy === 0)
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0]
    if (!victim) return // 全是活动/busy tab：宁可超限也不中止任务
    discarded.add(victim.id)
    // 完成态点记录淘汰时刻，避免陈旧 doneAt 在重建后误闪（重建时归零）
    victim.doneAt = 0
  }

  function openTab(toolId: string): ToolTab | null {
    if (tabs.value.length >= TOOL_TAB_MAX) return null
    const now = Date.now()
    const tab: ToolTab = { id: `tab-${++seq}-${now}`, toolId, createdAt: now, lastActiveAt: now, busy: 0, doneAt: 0 }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    pruneLru()
    return tab
  }

  /** 关闭后焦点给相邻 tab：先右后左；全关光回导航页 */
  function closeTab(id: string): void {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx < 0) return
    tabs.value.splice(idx, 1)
    discarded.delete(id)
    if (activeTabId.value === id) {
      const right = tabs.value[idx]
      const left = tabs.value[idx - 1]
      activeTabId.value = (right ?? left)?.id ?? null
    }
    pruneLru()
  }

  function activate(id: string): void {
    const tab = tabs.value.find((t) => t.id === id)
    if (!tab) return
    activeTabId.value = id
    tab.lastActiveAt = Date.now()
    if (discarded.delete(id)) {
      // 切回被淘汰的 tab：实例重建（渲染层 v-if 重新挂载），状态重置
      tab.doneAt = 0
    }
    pruneLru()
  }

  /** 「+」回导航页：无 tab 底层视图，tabs 与其状态保留 */
  function goHome(): void {
    activeTabId.value = null
  }

  function isBusy(id: string): boolean {
    return (tabs.value.find((t) => t.id === id)?.busy ?? 0) > 0
  }

  /** 关闭除指定 tab 外的全部（右键菜单）；指定 tab 保留并激活 */
  function closeOthers(id: string): void {
    for (const t of [...tabs.value]) if (t.id !== id) closeTab(t.id)
  }

  /** 关闭指定 tab 右侧的全部（右键菜单） */
  function closeRight(id: string): void {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx < 0) return
    for (const t of [...tabs.value].slice(idx + 1)) closeTab(t.id)
  }

  return {
    tabs, activeTabId, discarded, hasTabs, activeTab,
    openTab, closeTab, activate, goHome, isBusy, closeOthers, closeRight,
  }
}

/** ═══ 任务型卡 busy 上报接线（一行接入） ═══
 * 卡根组件调用：source 返回「任务运行中」聚合布尔（任一任务运行即 true）。
 * - 上升沿 busyInc（进入运行态：关闭确认生效 + tab 状态点呼吸）
 * - 下降沿 busyDec + notifyDone（任务结束：后台 tab 状态点闪烁提示）
 * - 组件卸载（tab 关闭/LRU discard）时若仍处于上报态则补偿 busyDec——
 *   否则关闭后的 tab 残留 busy>0，会永远命中关闭确认。
 * - 无 tab 环境（旧单实例挂载/测试）fallback noop，零侵入。
 */
export function useToolTabBusy(isBusy: () => boolean): void {
  const ctx = inject(TOOL_TAB_CTX, NOOP_TOOL_TAB_CTX)
  let reported = false
  watch(isBusy, (now) => {
    if (now && !reported) {
      ctx.busyInc()
      reported = true
    } else if (!now && reported) {
      ctx.busyDec()
      ctx.notifyDone()
      reported = false
    }
  }, { immediate: true })
  onBeforeUnmount(() => {
    if (reported) {
      ctx.busyDec()
      reported = false
    }
  })
}
