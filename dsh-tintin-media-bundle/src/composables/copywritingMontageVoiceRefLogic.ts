// ═══════════════════════════════════════════════════════════════
// copywritingMontageVoiceRefLogic.ts — 文案混剪口播音频跨机同步·纯逻辑
// （2026-09-30 用户裁决 B：克隆产物 wav 上传服务端音频库，脚本载荷携带
//  audio id 引用，换机应用脚本后按 id 下载回填——机制对齐 09-29 A′ 素材绑定
//  clip_groups 的「保存附加字段 / 恢复按标识重建」双端模式。）
// 契约依据（2026-09-30 探针实测 script_a1e533855aa6，已删）：
//   · 上传 POST /audio/library/upload（multipart file+category+tags），
//     category='口播' → 服务端归一「配音」池（四值枚举 配乐/音效/配音/其它，
//     别名表大小写不敏感、去括号容错——2026-09-30 服务端口径）
//   · 下载 GET /audio/library/{id}/file（audio/x-wav，404=不存在，已实测）
//   · **脚本根级未知字段被服务端丢弃**（voice_audio_id 挂根 POST 后 GET 回读
//     为 None）——口播引用必须挂 shot 级，与 clip_groups 同层透传（已实证）。
//     早先版本挂根字段，恢复侧永远拿到空 id → 换机应用脚本必然「暂无声音」。
// 本文件不做任何 IPC / DOM 操作（铁律 6/7 分层）。
// ═══════════════════════════════════════════════════════════════

/** 保存侧：脚本载荷逐镜附加口播音频库引用（tab 级单音频 → 每镜同值冗余，
 *  任一镜存活即恢复——对齐 clip_groups 的 per-shot 写入口径）。
 *  id 为空（未上传/上传失败）或载荷无 shots 数组时不附加任何字段——旧脚本
 *  形态保持逐字节不变；时长钳 0 并保留 3 位小数（服务端存数值，恢复侧据此
 *  回填 voiceDurSec）。 */
export function attachVoiceRef(
  payload: Record<string, unknown>,
  tab: { voiceAudioId?: unknown; voiceDurSec?: unknown },
): void {
  const id = String(tab?.voiceAudioId ?? '').trim()
  const shots = payload.shots
  if (!id || !Array.isArray(shots)) return
  const durSec = Math.max(0, Math.round((Number(tab?.voiceDurSec) || 0) * 1000) / 1000)
  for (const s of shots) {
    if (!s || typeof s !== 'object') continue
    const shot = s as Record<string, unknown>
    shot.voice_audio_id = id
    shot.voice_dur_sec = durSec
  }
}

/** 恢复侧：脚本详情 shots[] 提取口播引用（取首个非空 voice_audio_id 的镜）。
 *  解包口径与 parseScriptDetail 同源：兼容 {script:{...}} 包裹 / 裸 dict；
 *  字段宽容取值（缺失/非法 → 空 id + 0 时长，调用方据此跳过恢复）。 */
export function voiceRefFromScriptDetail(data: unknown): { audioId: string; durSec: number } {
  if (!data || typeof data !== 'object') return { audioId: '', durSec: 0 }
  const raw = data as Record<string, unknown>
  const s = (raw.script && typeof raw.script === 'object' ? raw.script : raw) as Record<string, unknown>
  const shots = Array.isArray(s.shots) ? s.shots : []
  for (const sh of shots) {
    if (!sh || typeof sh !== 'object') continue
    const shot = sh as Record<string, unknown>
    const id = String(shot.voice_audio_id ?? '').trim()
    if (!id) continue
    return { audioId: id, durSec: Math.max(0, Number(shot.voice_dur_sec) || 0) }
  }
  return { audioId: '', durSec: 0 }
}
