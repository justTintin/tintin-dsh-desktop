// test/tintin-montage-voice-ref.test.ts — 口播音频随脚本跨机同步·纯函数回归
// （2026-09-30 用户裁决 B：克隆 wav 上传音频库 category=口播→「配音」池；引用
//  挂 **shot 级**（voice_audio_id/voice_dur_sec 每镜同值）——2026-09-30 探针
//  实证脚本根级未知字段被服务端丢弃、shot 级与 clip_groups 同层原样透传；
//  本测试锁定附加条件、逐镜写入与解包提取口径）
import { describe, expect, it } from 'vitest'
import {
  attachVoiceRef,
  voiceRefFromScriptDetail,
} from '../src/composables/copywritingMontageVoiceRefLogic'
// 编排壳（上传/下载 IPC 桥接）随本测试进入 typecheck 覆盖（6bc1c32 同模式）；
// 其行为依赖 window.tintin 运行时，不在此单测，由克隆→上传→应用脚本链路实测覆盖。
import '../src/composables/copywritingMontage/useCopywritingMontageVoiceSync'

describe('attachVoiceRef（保存侧：payload 逐镜附加口播引用）', () => {
  it('id 非空 → 每镜写入 voice_audio_id/voice_dur_sec，时长钳 0 保留 3 位小数', () => {
    const p1: Record<string, unknown> = { topic: 't', shots: [{ index: 1 }, { index: 2 }, null] }
    attachVoiceRef(p1, { voiceAudioId: '42', voiceDurSec: 12.34567 })
    expect(p1.shots).toEqual([
      { index: 1, voice_audio_id: '42', voice_dur_sec: 12.346 },
      { index: 2, voice_audio_id: '42', voice_dur_sec: 12.346 },
      null,
    ])
    expect(p1).not.toHaveProperty('voice_audio_id')

    const p2: Record<string, unknown> = { shots: [{}] }
    attachVoiceRef(p2, { voiceAudioId: 7, voiceDurSec: -3 })
    expect(p2.shots).toEqual([{ voice_audio_id: '7', voice_dur_sec: 0 }])
  })

  it('id 空/空白/缺失或载荷无 shots 数组 → 不附加任何字段（旧脚本形态不变）', () => {
    for (const tab of [{ voiceAudioId: '', voiceDurSec: 9 }, { voiceAudioId: '  ' }, {}, undefined]) {
      const p: Record<string, unknown> = { topic: 't', shots: [{ index: 1 }] }
      attachVoiceRef(p, tab as { voiceAudioId?: unknown })
      expect(p).toEqual({ topic: 't', shots: [{ index: 1 }] })
    }
    const noShots: Record<string, unknown> = { topic: 't' }
    attachVoiceRef(noShots, { voiceAudioId: '42', voiceDurSec: 1 })
    expect(noShots).toEqual({ topic: 't' })
    const nullShots: Record<string, unknown> = { topic: 't', shots: 'not-array' }
    attachVoiceRef(nullShots, { voiceAudioId: '42', voiceDurSec: 1 })
    expect(nullShots).toEqual({ topic: 't', shots: 'not-array' })
  })
})

describe('voiceRefFromScriptDetail（恢复侧：详情 shots 提取，兼容 script 包裹）', () => {
  it('裸 dict 与 {script:{...}} 包裹同解；取首个非空镜；数值/字符串字段宽容取值', () => {
    const bare = { topic: 't', shots: [
      { voice_audio_id: '42', voice_dur_sec: 8.5 },
      { voice_audio_id: '43', voice_dur_sec: 9 },
    ] }
    const wrapped = { script: { shots: [{}, { voice_audio_id: 42, voice_dur_sec: '7.25' }] } }
    expect(voiceRefFromScriptDetail(bare)).toEqual({ audioId: '42', durSec: 8.5 })
    expect(voiceRefFromScriptDetail(wrapped)).toEqual({ audioId: '42', durSec: 7.25 })
  })

  it('缺失/非法/非对象输入/根级残留 → 空 id + 0 时长（调用方跳过恢复）', () => {
    expect(voiceRefFromScriptDetail({ topic: 't', shots: [{ index: 1 }] })).toEqual({ audioId: '', durSec: 0 })
    expect(voiceRefFromScriptDetail({ shots: [{ voice_audio_id: '  ', voice_dur_sec: 'x' }] })).toEqual({ audioId: '', durSec: 0 })
    // 根级字段被服务端丢弃（探针实证）——即便残留也不作为恢复依据
    expect(voiceRefFromScriptDetail({ voice_audio_id: '42', voice_dur_sec: 8.5 })).toEqual({ audioId: '', durSec: 0 })
    expect(voiceRefFromScriptDetail(null)).toEqual({ audioId: '', durSec: 0 })
    expect(voiceRefFromScriptDetail('str')).toEqual({ audioId: '', durSec: 0 })
    expect(voiceRefFromScriptDetail({ shots: 'not-array' })).toEqual({ audioId: '', durSec: 0 })
  })
})
