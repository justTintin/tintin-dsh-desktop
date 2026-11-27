// test/tintin-montage-storyboard-llm.test.ts — 分镜生成 LLM 调用契约回归
// （2026-11-25 用户报障：输入长口播文案点「AI 生成分镜脚本」失败。探针实锤根因=
//  服务端 /llm/chat/completions 默认 max_tokens=4096，长文案分镜 JSON 超帽截断
//  （finish_reason=length）。本文件钉住修复契约：分镜生成必须显式携带放大后的
//  max_tokens 与放宽超时走 server.post，且截断形态给出可辨识的报错文案。）
import { describe, expect, it, beforeAll } from 'vitest'
import { ref } from 'vue'
import { createStoryboardTabs, type StoryboardTab } from '../src/composables/copywritingMontage/useCopywritingMontageStoryboardTabs'
import { STORYBOARD_LLM_MAX_TOKENS, STORYBOARD_LLM_TIMEOUT_MS } from '../src/composables/copywritingMontageStep2ConcatLogic'

type PostCall = { path: string; payload: Record<string, unknown>; timeout: unknown }

let lastPost: PostCall | null = null
const notifications: string[] = []
/** 服务端返回形态（各用例改写）；finish_reason 默认 stop+合法 JSON = 成功链 */
let llmReply: () => unknown = () => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify([
    { index: 1, shot_type: '近景', visual: '画面', audio: '文案', sfx: '', duration: 3 },
  ]) } }],
})

beforeAll(() => {
  ;(globalThis as unknown as { window: unknown }).window = {
    tintin: {
      server: {
        post: async (path: string, payload: Record<string, unknown>, _headers: unknown, timeout: unknown) => {
          lastPost = { path, payload, timeout }
          return llmReply()
        },
      },
      shell: {
        showNotification: (title: string, body: string) => { notifications.push(`${title}：${body}`) },
      },
      env: {},
    },
  }
})

function makeTabs() {
  const storyboards = ref<StoryboardTab[]>([])
  const tabs = createStoryboardTabs({
    storyboards,
    activeStoryboardId: ref(''),
    productInfo: () => ({}),
    statusText: ref(''),
    syncToServer: () => {},
  })
  return { storyboards, tabs }
}

describe('genStoryboardsForTabs LLM 调用契约（长文案截断修复）', () => {
  it('走 server.post /llm/chat/completions，显式携带 STORYBOARD_LLM_MAX_TOKENS 与放宽超时', async () => {
    const { storyboards, tabs } = makeTabs()
    const tab = tabs.addStoryboardTab({ name: '输入文案', narrative: '长文案', shots: [] })
    expect(tab).toBeTruthy()
    await tabs.genStoryboardsForTabs([storyboards.value[0]!])
    expect(lastPost).toBeTruthy()
    expect(lastPost!.path).toBe('/llm/chat/completions')
    expect(lastPost!.payload.max_tokens).toBe(STORYBOARD_LLM_MAX_TOKENS)
    expect(lastPost!.payload.max_tokens).toBe(16384) // 默认帽 4096 会被长文案分镜 JSON 顶破
    expect(lastPost!.timeout).toBe(STORYBOARD_LLM_TIMEOUT_MS)
    // messages 契约不变：system + user（user 尾段=旁白原文）
    const msgs = lastPost!.payload.messages as Array<{ role: string; content: string }>
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user'])
    expect(msgs[1]!.content.endsWith('长文案')).toBe(true)
    // 成功链：shots 写回 + clipGroups 对齐
    expect(storyboards.value[0]!.shots.length).toBe(1)
    expect(storyboards.value[0]!.clipGroups).toEqual([[]])
  })

  it('截断形态（finish_reason=length）报错可辨识（含 max_tokens 截断提示），失败不写 shots', async () => {
    notifications.length = 0
    const { storyboards, tabs } = makeTabs()
    const tab = tabs.addStoryboardTab({ name: '输入文案', narrative: '更长文案', shots: [] })
    expect(tab).toBeTruthy()
    llmReply = () => ({
      choices: [{ finish_reason: 'length', message: { content: '[{"index":1,"shot_type":"近景","visual":"画面半截"' } }],
    })
    await tabs.genStoryboardsForTabs([storyboards.value[0]!])
    // 失败不写 shots（=实机「失败后同步零请求」的根由：纯文案 tab 被同步守卫跳过）
    expect(storyboards.value[0]!.shots.length).toBe(0)
    expect(notifications.some((n) => n.includes('max_tokens 截断'))).toBe(true)
    // 对照：普通解析失败（finish=stop 但非 JSON）报原口径文案
    notifications.length = 0
    llmReply = () => ({ choices: [{ finish_reason: 'stop', message: { content: '这不是 JSON' } }] })
    await tabs.genStoryboardsForTabs([storyboards.value[0]!])
    expect(notifications.some((n) => n.includes('模型未返回 JSON 数组') && !n.includes('max_tokens'))).toBe(true)
  })
})

describe('生成画幅契约（2026-11-27 用户裁决：按钮前选择，写入 tab.layout 锁定）', () => {
  it('ratio=horizontal：prompt 出横屏（16:9）画面描述口径，layout 写入 horizontal', async () => {
    llmReply = () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify([
      { index: 1, shot_type: '近景', visual: '画面', audio: '文案', sfx: '', duration: 3 },
    ]) } }] }) // 前用例改写的回复形态会毒化本链（模块态泄漏防，文件头既有纪律）
    const { storyboards, tabs } = makeTabs()
    tabs.addStoryboardTab({ name: '横屏稿', narrative: '横屏文案', shots: [] })
    await tabs.genStoryboardsForTabs([storyboards.value[0]!], 'horizontal')
    expect(lastPost).toBeTruthy()
    const msgs = lastPost!.payload.messages as Array<{ role: string; content: string }>
    expect(msgs[1]!.content).toContain('横屏（16:9）')
    expect(msgs[1]!.content).not.toContain('竖屏')
    expect(storyboards.value[0]!.layout).toBe('horizontal')
    expect(storyboards.value[0]!.shots.length).toBe(1)
  })

  it('缺省 ratio=vertical：prompt 出竖屏（9:16），layout 写入 vertical（现状口径不变）', async () => {
    const { storyboards, tabs } = makeTabs()
    tabs.addStoryboardTab({ name: '竖屏稿', narrative: '竖屏文案', shots: [] })
    await tabs.genStoryboardsForTabs([storyboards.value[0]!])
    const msgs = lastPost!.payload.messages as Array<{ role: string; content: string }>
    expect(msgs[1]!.content).toContain('竖屏（9:16）')
    expect(storyboards.value[0]!.layout).toBe('vertical')
  })
})
