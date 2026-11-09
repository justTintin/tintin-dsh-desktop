// tab-model 单测（2026-11-08 第二批 #2）：建/关/激活/更新/上限/后继激活
import { describe, expect, it } from 'vitest'
import { activateTab, closeTab, findTabByPlatform, MAX_TABS, openTab, updateTab, type TabPoolState } from '../src/browser/tab-model'

const empty: TabPoolState = { tabs: [], activeId: null }

describe('tab pool (2026-11-08 第二批标签化)', () => {
  it('openTab 新建并激活；超上限返回 null', () => {
    let s: TabPoolState | null = openTab(empty, 'web')
    expect(s).not.toBeNull()
    expect(s!.tabs).toHaveLength(1)
    expect(s!.activeId).toBe(s!.tabs[0]!.id)
    let cur = s!
    for (let i = 0; i < MAX_TABS; i++) {
      const next = openTab(cur, 'douyin')
      if (i < MAX_TABS - 1) {
        expect(next).not.toBeNull()
        cur = next!
      } else expect(next).toBeNull()
    }
  })

  it('closeTab 右邻优先、左邻兜底、关最后一个=空池', () => {
    const s1 = openTab(openTab(openTab(empty, 'web')!, 'douyin')!, 'bilibili')!
    const [a, b, c] = s1.tabs.map((t) => t.id)
    // 关中间（active=最后建的 c）→ active 不变
    const s2 = closeTab(s1, b!)
    expect(s2.tabs).toHaveLength(2)
    expect(s2.activeId).toBe(c)
    // 关 active（最右）→ 后继=右邻不存在则左邻
    const s3 = closeTab(s2, c!)
    expect(s3.activeId).toBe(a)
    // 关最后一个 → 空池 activeId=null
    const s4 = closeTab(s3, a!)
    expect(s4.tabs).toHaveLength(0)
    expect(s4.activeId).toBeNull()
  })

  it('closeTab 未知 id 幂等；activateTab 幂等且忽略未知', () => {
    const s = openTab(openTab(empty, 'web')!, 'douyin')!
    expect(closeTab(s, 'nope')).toBe(s)
    const s2 = activateTab(s, s.tabs[0]!.id)
    expect(s2.activeId).toBe(s.tabs[0]!.id)
    expect(activateTab(s2, 'nope')).toBe(s2)
  })

  it('updateTab 只改目标标签的字段', () => {
    const s = openTab(openTab(empty, 'web')!, 'douyin')!
    const id = s.tabs[1]!.id
    const s2 = updateTab(s, id, { title: '抖音视频', url: 'https://www.douyin.com/video/1' })
    expect(s2.tabs[1]!.title).toBe('抖音视频')
    expect(s2.tabs[1]!.url).toBe('https://www.douyin.com/video/1')
    expect(s2.tabs[0]!.title).toBe('新标签页')
  })

  it('findTabByPlatform 找同平台既有标签', () => {
    const s = openTab(openTab(empty, 'web')!, 'douyin')!
    expect(findTabByPlatform(s, 'douyin')?.id).toBe(s.tabs[1]!.id)
    expect(findTabByPlatform(s, 'bilibili')).toBeNull()
  })
})
