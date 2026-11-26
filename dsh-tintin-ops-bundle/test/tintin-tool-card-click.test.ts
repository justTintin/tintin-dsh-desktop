// test/tintin-tool-card-click.test.ts — 工具卡点击契约回归（2026-11-23 用户报障：
// 「运营工具里的产品资料无法点击进入了，原来是正常的」）
//
// 事故：ee78ed8f84（2026-11-15 问答卡加设置齿轮）把运营工具卡片的 @click 从 openTool(t)
// 改成「仅 kb-qa 才 openTool」的三元式——本意是 div 卡与原生 button 卡分治，结果其余
// 卡的点击成了空操作，产品资料卡入口断（现存 11-20~11-23 五个归档包全部命中）。
// 既有 tintin-tool-tabs-render 冒烟走 SSR 只验 HTML 里出现卡名，测试全绿而入口已断。
//
// 这条静态断言锁住契约（本包测试跑在 node 环境、无 DOM：SFC 按 SSR 编译、没有客户端
// render，「挂载后点击」不可测；与 tintin-tool-card-class 同款源码契约）：
// - 卡片 @click 对每一张卡都是 openTool(t)：点了哪张卡就开哪个工具页
// - 原生 button 卡的 Enter/空格由浏览器合成 click，不得再挂 keydown.enter（会开两次）
// - 渲染成 div[role=button] 的卡不会自动合成 click：keydown.enter 必须在、且只对 div 卡生效
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appVue = readFileSync(new URL('../../dsh-tintin-media-bundle/src/App.vue', import.meta.url), 'utf8')
const opsAppVue = readFileSync(new URL('../src/OpsApp.vue', import.meta.url), 'utf8')

/** 工具卡开标签：class="tool-card" 所在元素，从 '<' 到首个 '>'（属性值里没有 '>'） */
function toolCardTag(source: string): string {
  const occurrences = source.split('class="tool-card"').length - 1
  if (occurrences !== 1) throw new Error(`expected exactly one tool-card element, found ${String(occurrences)}`)
  const at = source.indexOf('class="tool-card"')
  return source.slice(source.lastIndexOf('<', at), source.indexOf('>', at) + 1)
}

/** 卡片点击契约违规项（空数组=合规） */
function clickViolations(tag: string): string[] {
  const out: string[] = []
  const click = tag.match(/@click="([^"]*)"/)?.[1]
  if (click !== 'openTool(t)') {
    out.push(`卡片 @click 必须对每张卡都是 openTool(t)，实际: ${click ?? '(缺失)'}`)
  }
  const enter = tag.match(/@keydown\.enter="([^"]*)"/)?.[1]
  // 有卡渲染成 div 时的分支条件（:is="<条件> ? 'div' : 'button'"）
  const divCond = tag.match(/:is="([^"?]+)\?\s*'div'\s*:\s*'button'"/)?.[1].trim()
  if (divCond !== undefined) {
    if (enter !== `${divCond} ? openTool(t) : undefined`) {
      out.push(`div 卡的 @keydown.enter 必须是「${divCond} ? openTool(t) : undefined」，实际: ${enter ?? '(缺失)'}`)
    }
  } else if (enter !== undefined) {
    out.push('全部是原生 button 的卡片不得挂 keydown.enter（Enter 会合成 click，开两次）')
  }
  return out
}

describe('工具卡点击契约（2026-11-23 报障回归）', () => {
  for (const [name, source] of [['App.vue（媒体工具）', appVue], ['OpsApp.vue（运营工具）', opsAppVue]] as const) {
    it(`${name}：点哪张卡就开哪个工具页`, () => {
      expect(clickViolations(toolCardTag(source))).toEqual([])
    })
  }

  it('事故形态 ee78ed8f84（click 写成仅问答卡才开）必须被判违规', () => {
    const broken = toolCardTag(opsAppVue).replace(
      '@click="openTool(t)"',
      `@click="t.id === 'kb-qa' ? openTool(t) : undefined"`,
    )
    expect(broken).not.toBe(toolCardTag(opsAppVue)) // 替换确实生效（防「replace 没命中 → 假绿」）
    expect(clickViolations(broken)).toHaveLength(1)
  })

  it('原生 button 卡再挂 keydown.enter（Enter 开两次）必须被判违规', () => {
    const twice = toolCardTag(appVue).replace('@click="openTool(t)"', '@click="openTool(t)" @keydown.enter="openTool(t)"')
    expect(twice).not.toBe(toolCardTag(appVue))
    expect(clickViolations(twice)).toHaveLength(1)
  })
})
