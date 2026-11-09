// ═══════════════════════════════════════════════════════════════
// tab-model.ts — 浏览器标签池纯逻辑（2026-11-08 第二批 P0 #2）。
// 模型：tab = { id, platform, title, url }；每平台一个 WebContentsView 分区不变
// （登录态常驻），同平台多标签 = 复用同一分区视图 + 视图内导航历史分叉？
// 否 —— 同平台多标签共用同一 view 会串历史；本模型**每标签一个 WebContentsView**，
// 同平台标签共享同一 partition（cookie/登录态分区隔离语义不变）。
// 纯逻辑无 Electron 依赖（铁律 8，单测下沉）：建/关/激活/序重排/上限裁剪。
// ═══════════════════════════════════════════════════════════════

export interface TabInfo {
  id: string
  /** 分区平台（fxg 等特殊平台不进标签，沿用平台行单视图语义） */
  platform: string
  title: string
  url: string
}

export interface TabPoolState {
  tabs: TabInfo[]
  activeId: string | null
}

export const MAX_TABS = 12

let seq = 0

/** 新建标签并激活（超上限返回 null，由调用方 toast） */
export function openTab(state: TabPoolState, platform: string, seedTitle = '新标签页'): TabPoolState | null {
  if (state.tabs.length >= MAX_TABS) return null
  seq += 1
  const id = `tab_${Date.now().toString(36)}_${seq}`
  const tab: TabInfo = { id, platform, title: seedTitle, url: '' }
  return { tabs: [...state.tabs, tab], activeId: id }
}

/** 关闭标签：返回后继激活标签（右邻优先，左邻兜底）；关最后一个=回工作台（activeId=null，池可空） */
export function closeTab(state: TabPoolState, id: string): TabPoolState {
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return state
  const tabs = state.tabs.filter((t) => t.id !== id)
  if (!tabs.length) return { tabs, activeId: null }
  if (state.activeId !== id) return { tabs, activeId: state.activeId }
  const next = tabs[Math.min(idx, tabs.length - 1)] ?? null
  return { tabs, activeId: next ? next.id : null }
}

/** 激活标签（幂等） */
export function activateTab(state: TabPoolState, id: string): TabPoolState {
  if (!state.tabs.some((t) => t.id === id)) return state
  return { tabs: state.tabs, activeId: id }
}

/** 更新标签标题/地址（页面 title/导航事件回推） */
export function updateTab(state: TabPoolState, id: string, patch: { title?: string; url?: string }): TabPoolState {
  return {
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.url !== undefined ? { url: patch.url } : {}) } : t)),
    activeId: state.activeId,
  }
}

/** 按平台找已有标签（地址栏域名路由优先复用该平台的既有标签） */
export function findTabByPlatform(state: TabPoolState, platform: string): TabInfo | null {
  return state.tabs.find((t) => t.platform === platform) ?? null
}
