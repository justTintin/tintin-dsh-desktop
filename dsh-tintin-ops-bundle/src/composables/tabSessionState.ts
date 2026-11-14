// ═══════════════════════════════════════════════════════════════
// tabSessionState — 多 Tab 工作区·LRU discard 的会话快照（内存级）
//
// 2026-11-13 用户裁决（产品资料「选中过些时间丢失」根治·方案 B）：LRU
// discard 会卸载 tab 组件实例（超保活上限 8 时最久未激活者），切回重建=
// 全部 ref 重置。busy 豁免只护任务，交互状态（选中/表单/滚动/弹窗）由此
// 模块按 tab 实例键控留快照，重建时组件自行恢复——根治而非豁免。
//
// 语义边界（如实）：
//   · 内存 Map：tab 关闭后条目留存成小垃圾（每份数百字节级），应用退出
//     即清——不做落盘，跨应用重启的恢复属「会话恢复」另行排期。
//   · key=tab.id（ToolTabCtx 注入）；无 tab 环境 fallback 固定 key，
//     单实例挂载/测试同样可恢复。
// ═══════════════════════════════════════════════════════════════

const store = new Map<string, unknown>()

/** 覆盖写一份 tab 实例的会话快照（浅引用即可，调用方负责传不可变快照）。 */
export function saveTabSession<T>(key: string, value: T): void {
  store.set(key, value)
}

/** 读一份快照；无记录/已清 → undefined（调用方走首次挂载流程）。 */
export function loadTabSession<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

/** 清除一份快照（tab 关闭时可选调用；不调也不泄漏——条目仅数百字节级）。 */
export function clearTabSession(key: string): void {
  store.delete(key)
}
