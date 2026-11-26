// useCopywritingMontageArollPerShotSync.ts — A-roll per_shot 模式预置回写（2026-11-26
// 用户转述服务端契约：脚本 aroll.mode='per_shot' + stage=aroll 一次触发——切分/对齐/
// 逐镜生成/回写全服务端包干，客户端不再调拆分接口）。自 Step3Voice 抽出（行数门付账）：
// 与 syncStoryboardsToServer 同一条 upsert 通道（POST /api/storyboard/scripts，按 topic
// 覆盖同脚本），payload.aroll.mode='per_shot' 随脚本落库，worker 读该模式按镜生成。
import type { Ref } from 'vue'
import { buildScriptPayload } from '../opsStoryboardLogic'
import { attachVoiceRef } from '../copywritingMontageVoiceRefLogic'
import type { StoryboardTab } from './useCopywritingMontageStoryboardTabs'

export function createArollPerShotSync(deps: {
  storyboards: Ref<StoryboardTab[]>
  sharedProductInfo: Ref<Record<string, unknown>>
  /** 与宿主桥 server:post 同签名（path/body/headers/timeout，300s 供大脚本回写） */
  post: (path: string, body: unknown, headers?: Record<string, string>, timeout?: number) => Promise<unknown>
  /** 单脚本失败上报（clientError 落 harness.log），异常继续向调用方上抛 */
  onError: (e: unknown) => void
  /** 绑定组随脚本透传（Step3Voice 本地函数注入——normalizeShot 白名单外字段） */
  attachClipGroups: (payload: Record<string, unknown>, tab: StoryboardTab) => void
}) {
  return async function syncScriptsWithArollPerShot(): Promise<void> {
    for (const tab of deps.storyboards.value) {
      if (!tab.scriptId || !tab.shots.length) continue
      const info = deps.sharedProductInfo.value
      const payload = buildScriptPayload({
        topic: tab.topic,
        ratio: 'vertical',
        shots: tab.shots,
        product: { brand: String(info.brand || ''), model: String(info.model || ''), category: String(info.product || ''), name: '' },
      })
      deps.attachClipGroups(payload, tab)
      attachVoiceRef(payload, tab)
      const payShots = (payload.shots ?? []) as Array<Record<string, unknown>>
      tab.shots.forEach((s, i) => {
        const row = payShots[i]
        if (!row) return
        row.mark_aroll = s.markARoll === true
        if (s.markMaterial) row.mark_material = true
        if (s.markAI) row.mark_ai = true
        if (s.slots && (s.slots.stock || s.slots.gen || s.slots.aroll)) row.slots = s.slots
        if (s.splitAudioId) row.split_audio_id = s.splitAudioId
      })
      payload.aroll = { mode: 'per_shot' }
      // 2026-11-26 探针实测修订（实弹对照证据）：worker 只认 aroll.audio_id——
      // voice_audio_id 挂脚本根字段不免疫（script_1ad32b343720 任务 2003 报
      // 「缺口播音频（aroll.audio_id 或脚本 voice_audio_id）」实败；验收临时脚本
      // script_65e20f5b3a92 任务 2004 带 aroll.audio_id 实过音频门直接 running）。
      // 克隆声音 id（tab.voiceAudioId=脚本根 voice_audio_id 同源）随 per_shot 预置一并落 aroll.audio_id。
      const arollAudioId = String(tab.voiceAudioId ?? '').trim()
      if (arollAudioId) payload.aroll = { mode: 'per_shot', audio_id: arollAudioId }
      try {
        await deps.post('/api/storyboard/scripts', payload, undefined, 300000)
      } catch (e) {
        deps.onError(e)
        throw e
      }
    }
  }
}
