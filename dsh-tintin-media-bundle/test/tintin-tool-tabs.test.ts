// test/tintin-tool-tabs.test.ts — 多 Tab 工作区模型层回归
// （useToolTabs：开关切/邻位聚焦/软上限/LRU 保活淘汰/busy 保护/批量关闭；
//   需求规格 docs/tintin-multitab-workspace.md，2026-11-12 用户裁决：
//   软上限 12、保活 8、关闭焦点先右后左、busy=任务运行中不参与淘汰）
import { beforeEach, describe, expect, it } from 'vitest'
import { useToolTabs, TOOL_TAB_KEEP_ALIVE, TOOL_TAB_MAX } from '../src/composables/useToolTabs'

/** 固定时钟基线（lastActiveAt 平铺同刻→LRU 淘汰按数组序稳定取最早创建者） */
let baseT = 1_700_000_000_000
beforeEach(() => { baseT = 1_700_000_000_000 })

describe('useToolTabs 打开/切换/关闭', () => {
  it('打开即新开 tab 并激活；同卡可多开且实例 id 互不相同', () => {
    const m = useToolTabs()
    const a = m.openTab('imitation-video')
    const b = m.openTab('imitation-video')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.id).not.toBe(b!.id)
    expect(m.tabs.value).toHaveLength(2)
    expect(m.activeTabId.value).toBe(b!.id)
  })

  it('关闭活动 tab 焦点先右后左；关闭最后一个回导航页', () => {
    const m = useToolTabs()
    const a = m.openTab('a')!
    const b = m.openTab('b')!
    const c = m.openTab('c')!
    const d = m.openTab('d')!
    m.activate(c.id)
    m.closeTab(c.id)
    expect(m.activeTabId.value).toBe(d.id) // 右邻
    m.closeTab(d.id)
    expect(m.activeTabId.value).toBe(b.id) // 无右邻回左邻
    m.closeTab(b.id)
    m.closeTab(a.id)
    expect(m.tabs.value).toHaveLength(0)
    expect(m.activeTabId.value).toBeNull() // 全关光=导航页
  })

  it('关闭非活动 tab 不改变活动焦点', () => {
    const m = useToolTabs()
    m.openTab('a')
    const b = m.openTab('b')!
    m.activate(b.id)
    const a0 = m.tabs.value[0]
    m.closeTab(a0.id)
    expect(m.activeTabId.value).toBe(b.id)
  })

  it('goHome 只回导航页，tabs 与活动记录保留；activate 切回', () => {
    const m = useToolTabs()
    const t = m.openTab('x')!
    m.goHome()
    expect(m.activeTabId.value).toBeNull()
    expect(m.tabs.value).toHaveLength(1)
    m.activate(t.id)
    expect(m.activeTabId.value).toBe(t.id)
  })
})

describe('useToolTabs 上限与批量操作', () => {
  it('软上限 12：满员拒绝新开（返回 null，既有 tab 不受影响）', () => {
    const m = useToolTabs()
    for (let i = 0; i < TOOL_TAB_MAX; i++) {
      expect(m.openTab(`t${i}`)).not.toBeNull()
    }
    expect(m.tabs.value).toHaveLength(TOOL_TAB_MAX)
    expect(m.openTab('overflow')).toBeNull()
    expect(m.tabs.value).toHaveLength(TOOL_TAB_MAX)
  })

  it('closeOthers 保留指定 tab；closeRight 只关右侧', () => {
    const m = useToolTabs()
    const a = m.openTab('a')!
    const b = m.openTab('b')!
    const c = m.openTab('c')!
    m.closeRight(b.id)
    expect(m.tabs.value.map((t) => t.id)).toEqual([a.id, b.id])
    m.closeOthers(b.id)
    expect(m.tabs.value.map((t) => t.id)).toEqual([b.id])
    expect(m.activeTabId.value).toBe(b.id)
    void c
  })
})

describe('useToolTabs LRU 保活（浏览器 discard 语义）', () => {
  it('存活实例超 8 淘汰最久未激活者（切回重建）', () => {
    const m = useToolTabs()
    const created = []
    for (let i = 0; i < TOOL_TAB_KEEP_ALIVE; i++) created.push(m.openTab(`t${i}`)!)
    expect(m.discarded.size).toBe(0)
    const ninth = m.openTab('t8')!
    expect(m.discarded.has(created[0].id)).toBe(true) // 最早创建且未激活 → 淘汰
    expect(m.activeTabId.value).toBe(ninth.id)
    // 切回被淘汰 tab：移出 discarded（重建语义）
    m.activate(created[0].id)
    expect(m.discarded.has(created[0].id)).toBe(false)
    expect(m.activeTabId.value).toBe(created[0].id)
  })

  it('busy（任务运行中）tab 不参与淘汰；活动 tab 不淘汰', () => {
    const m = useToolTabs()
    const created = []
    for (let i = 0; i < TOOL_TAB_KEEP_ALIVE + 1; i++) created.push(m.openTab(`t${i}`)!)
    // created[0] 已被淘汰（前例语义）；busy 保护：给次早者置 busy，再触发一次淘汰
    created[1].busy = 1
    m.activate(created[1].id) // busy tab 设为活动（双保险场景）
    m.openTab('extra') // 触发 prune
    expect(m.discarded.has(created[1].id)).toBe(false) // 活动+busy 双重豁免
    // 应淘汰的是最早的非活动非 busy 幸存者
    expect(m.discarded.has(created[2].id)).toBe(true)
  })

  it('isBusy 读 tab.busy 计数（pane busy 通道维护的数据）', () => {
    const m = useToolTabs()
    const t = m.openTab('x')!
    expect(m.isBusy(t.id)).toBe(false)
    t.busy = 2
    expect(m.isBusy(t.id)).toBe(true)
    t.busy = 0
    expect(m.isBusy(t.id)).toBe(false)
  })

  it('关闭 discarded 中的 tab 同步清理 discarded 集合', () => {
    const m = useToolTabs()
    const first = m.openTab('a')!
    for (let i = 1; i < TOOL_TAB_KEEP_ALIVE + 1; i++) m.openTab(`t${i}`)
    expect(m.discarded.has(first.id)).toBe(true)
    m.closeTab(first.id)
    expect(m.discarded.has(first.id)).toBe(false)
  })
})
