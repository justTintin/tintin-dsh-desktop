// ═══════════════════════════════════════════════════════════════
// useCopywritingMontageStoryboardTabs.ts — 文案混剪·分镜 tab 生命周期与多稿装载·编排壳
// （2026-11-05 自 useCopywritingMontageStep3Voice.ts 分离以控其行数——铁律 10：
//  新文件 ≤1000 行，宿主文件只留接缝。依赖经参数注入，不持状态，行为零改动。）
// 职责：
//   ① tab CRUD（新增/删除/重命名/激活——2026-09-21/22 用户裁决语义原样迁入）
//   ② 多稿装载 loadCopyCandidateTabs（2026-11-05 用户裁决：文案写法弹窗改多选——
//     按勾选个数装载「仅文案」tab（shots 留空），替换上一批未生成分镜的装载）
//   ③ 批量分镜补全 genStoryboardsForTabs（2026-11-05 用户裁决：「AI 生成分镜脚本」
//     对仅文案 tab 逐个按其旁白生成一套分镜；单 tab 失败不阻断，口径同批量克隆）
// ═══════════════════════════════════════════════════════════════
import { ref } from 'vue'
import type { Ref } from 'vue'
import { notify, errText } from './context'
import { buildCopywritingStoryboardPrompt } from '../copywritingMontageLogic'
import { parseStoryboardShots, type StoryboardShot } from '../opsStoryboardLogic'

/** 分镜 tab 上限（2026-09-21 用户裁决：最多 10 个分镜脚本） */
export const COPY_STORYBOARD_MAX = 10

/** 分镜 tab（宿主 useCopywritingMontageStep3Voice 与本模块共用结构） */
export interface StoryboardTab {
  id: string
  name: string
  /** 来源脚本库 id（''=AI 生成/手动；选择脚本时同 id 的 tab 已存在则直接切换） */
  scriptId: string
  /** 服务端脚本库选题（首次同步/保存时生成；同 topic 覆盖更新） */
  topic: string
  /** 该脚本的旁白（第一步文案框绑定激活 tab 的旁白） */
  narrative: string
  shots: StoryboardShot[]
  /** 每镜绑定的分割素材 idx 有序组（2026-09-22 用户裁决：一镜多片·按时长装填——
   *  外层=镜、内层=该镜按序使用的片段；空数组=未绑定） */
  clipGroups: number[][]
  /** 分镜生成/应用时的旁白快照（过期判定：narrative 改过即过期） */
  sourceNarrative: string
  /** 整体克隆产物（2026-09-21 用户裁决：每分镜脚本一条整段声音；二/三步批量处理） */
  voiceWav: string
  voiceDurSec: number
  /** 克隆产物在服务端音频库的 id（2026-09-30 用户裁决 B：wav 上传
   *  POST /audio/library/upload category=口播→归一「配音」池；''=未上传——脚本
   *  同步不携带口播引用，换机应用脚本后无口播可恢复，重新批量克隆即可重建） */
  voiceAudioId: string
  /** 每脚本视频设置（2026-09-23 用户裁决：输出画幅/转场动画/输出帧率按 tab 绑定——
   *  切 tab 即切设置，导出按各 tab 自身 transition 消费；时长限制=跟随本 tab 声音时长派生值） */
  layout: string
  transition: string
  fps: number | 'source'
  /** 产品快照（2026-09-23 用户裁决：品牌/产品/型号 摘要，创建时自 sharedProductInfo
   *  快照、选择脚本时自服务端 detail.product 带回；选择弹窗等处展示脚本基本信息） */
  productBrief: string
}

/** 产品信息来源（sharedProductInfo / 服务端 detail.product 结构性最小集） */
export interface ProductBriefSource { brand?: string; product?: string; category?: string; model?: string }

/** 产品快照摘要（品牌/产品(品类)/型号 非空拼接；detail.product 与 sharedProductInfo 两形态通用） */
export function productBriefOf(p: ProductBriefSource): string {
  return [p.brand, p.product || p.category, p.model].map((x) => String(x || '').trim()).filter(Boolean).join(' / ')
}

export interface StoryboardTabsDeps {
  storyboards: Ref<StoryboardTab[]>
  activeStoryboardId: Ref<string>
  /** 产品信息来源（装载/生成时快照 productBrief 随 tab 持久化） */
  productInfo: () => ProductBriefSource
  /** 状态行（批量补全逐 tab 进度文案） */
  statusText: Ref<string>
  /** 分镜同步服务端脚本库（每步完成即同步的既有裁决，批量补全完成后触发） */
  syncToServer: () => void
}

/** 分镜 tab 生命周期编排（宿主一次性创建并解构回原名——调用点零改动） */
export function createStoryboardTabs(deps: StoryboardTabsDeps) {
  const { storyboards, activeStoryboardId } = deps
  function nextStoryboardName(): string {
    let max = 0
    for (const s of storyboards.value) {
      const m = /^脚本(\d+)$/.exec(s.name)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return `脚本${max + 1}`
  }
  /** 新增分镜 tab（AI 生成分镜/多稿装载/选择脚本都走这里）；超上限返回 null */
  function addStoryboardTab(init: { name?: string; scriptId?: string; topic?: string; narrative: string; shots: StoryboardShot[]; productBrief?: string }): StoryboardTab | null {
    if (storyboards.value.length >= COPY_STORYBOARD_MAX) return null
    const tab: StoryboardTab = {
      id: `sb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      name: (init.name || '').trim() || nextStoryboardName(),
      scriptId: init.scriptId || '',
      topic: init.topic || '',
      narrative: init.narrative,
      shots: init.shots,
      clipGroups: init.shots.map(() => []),
      sourceNarrative: init.narrative,
      voiceWav: '',
      voiceDurSec: 0,
      voiceAudioId: '',
      layout: 'vertical',
      transition: 'random',
      fps: 'source',
      productBrief: (init.productBrief || '').trim(),
    }
    storyboards.value.push(tab)
    activeStoryboardId.value = tab.id
    return tab
  }
  function removeStoryboardTab(id: string): void {
    const i = storyboards.value.findIndex((s) => s.id === id)
    if (i < 0) return
    storyboards.value.splice(i, 1)
    if (activeStoryboardId.value === id) {
      activeStoryboardId.value = storyboards.value[Math.min(i, storyboards.value.length - 1)]?.id || ''
    }
  }
  function renameStoryboardTab(id: string, name: string): void {
    const tab = storyboards.value.find((s) => s.id === id)
    if (tab && name.trim()) tab.name = name.trim().slice(0, 20)
  }
  function setActiveStoryboard(id: string): void {
    if (storyboards.value.some((s) => s.id === id)) activeStoryboardId.value = id
  }
  /** 多稿装载（2026-11-05 用户裁决：文案写法弹窗改多选）：替换上一批「仅文案」tab
   *  （shots 为空的 tab 只会由本功能产生）后按选中稿各建一个 tab——name=写法名、
   *  narrative=稿文、shots 留空待「AI 生成分镜脚本」批量补全；产品快照随 tab 存。
   *  返回实际装载个数（超上限截断）；装载后激活第一个新 tab（文案框即显第一稿） */
  function loadCopyCandidateTabs(list: Array<{ name?: string; narrative: string }>): number {
    // 声音继承（2026-11-05 用户问「克隆成功为何第一个 tab 无音频」）：被替换的纯文案
    // tab 若已克隆声音，按文案原文匹配继承给新装载 tab（同文案=同声音仍有效）——
    // 否则重新确认文案会静默丢掉刚克隆的声音
    const voiceByNarrative = new Map<string, { voiceWav: string; voiceDurSec: number; voiceAudioId: string }>()
    for (const t of storyboards.value) {
      if (t.shots.length || !t.voiceWav) continue
      const k = t.narrative.trim()
      if (k && !voiceByNarrative.has(k)) {
        voiceByNarrative.set(k, { voiceWav: t.voiceWav, voiceDurSec: t.voiceDurSec, voiceAudioId: t.voiceAudioId })
      }
    }
    for (let i = storyboards.value.length - 1; i >= 0; i--) {
      if (!storyboards.value[i]!.shots.length) removeStoryboardTab(storyboards.value[i]!.id)
    }
    let firstId = ''
    let created = 0
    for (const c of list) {
      const narrative = String(c.narrative || '').trim()
      if (!narrative) continue
      if (storyboards.value.length >= COPY_STORYBOARD_MAX) break
      const tab = addStoryboardTab({
        name: String(c.name || '').trim(),
        narrative,
        shots: [],
        productBrief: productBriefOf(deps.productInfo()),
      })
      if (!tab) break
      // 响应式代理修复（2026-09-30 教训）：闭包原始对象直写不触发更新——经数组重解析再写
      const live = storyboards.value.find((t) => t.id === tab.id)
      const v = voiceByNarrative.get(narrative)
      if (live && v) {
        live.voiceWav = v.voiceWav
        live.voiceDurSec = v.voiceDurSec
        live.voiceAudioId = v.voiceAudioId
      }
      created++
      if (!firstId) firstId = tab.id
    }
    if (firstId) activeStoryboardId.value = firstId
    return created
  }
  const storyboardBusy = ref(false)
  /** 批量补全：为每个「仅文案」tab 按其旁白各生成一套分镜（顺序调服务端 LLM；
   *  单 tab 失败不阻断其余，口径同批量克隆）。写回须经 storyboards.value 重新解析出
   *  代理对象（2026-09-30 实测教训：闭包原始对象直写不触发响应式更新与持久化 watch） */
  async function genStoryboardsForTabs(tabs: StoryboardTab[]): Promise<void> {
    storyboardBusy.value = true
    const fails: string[] = []
    let done = 0
    try {
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i]!
        const copy = tab.narrative.trim()
        deps.statusText.value = `正在为「${tab.name}」生成分镜脚本（${i + 1}/${tabs.length}）...`
        try {
          const { systemPrompt, userPrompt } = buildCopywritingStoryboardPrompt(copy)
          const res = await window.tintin.server.llmChat({
            model: '',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          })
          if (res && 'error' in res) throw new Error(String(res.error) || '服务端返回空错误')
          const content = String(res?.choices?.[0]?.message?.content ?? '')
          const parsed = parseStoryboardShots(content)
          if (parsed.fallback || !parsed.shots.length) throw new Error('分镜解析失败（模型未返回 JSON 数组）')
          const live = storyboards.value.find((t) => t.id === tab.id)
          if (!live) continue // 生成期间被用户删除的 tab 跳过
          live.shots = parsed.shots
          live.clipGroups = parsed.shots.map(() => [])
          done++
          const total = parsed.shots.reduce((s, x) => s + (Number(x.duration) || 0), 0)
          deps.statusText.value = `完成：分镜「${live.name}」已生成（${parsed.shots.length} 镜 / 约 ${Math.round(total)} 秒；${done}/${tabs.length}）`
        } catch (e) {
          fails.push(`「${tab.name}」：${errText(e)}`)
        }
      }
      deps.syncToServer()
      if (fails.length) {
        deps.statusText.value = `失败： ${fails.length}/${tabs.length} 份分镜生成失败`
        notify('部分分镜生成失败', fails.join('\n'))
      } else {
        notify('分镜生成完成', `已为 ${done} 份文案各生成一套分镜（每份一个分镜标签）。`)
      }
    } finally {
      storyboardBusy.value = false
    }
  }
  return {
    addStoryboardTab, removeStoryboardTab, renameStoryboardTab, setActiveStoryboard,
    loadCopyCandidateTabs, genStoryboardsForTabs, storyboardBusy,
  }
}
