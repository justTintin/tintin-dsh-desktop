// test/jianying-export-tracks.test.ts — exportMultiToDraft 轨道时间轴行为回归。
// 背景（2026-09-29）：727a6eb 去掉了视频轨的半秒片段间隙，副轨游标漂移随之
// 修死——副轨窗口与视频段窗口逐段相等、显式音效无条件落轨。
// 2026-11-06 用户裁定（修正 11-05 一刀切）：5 秒黑场只加在方案成片之间
// （gapAfterUs 按片段表传入），方案内镜头缺省 0=紧密相接（转场靠相邻生效）。
// 本文件锁死：缺省全紧密+转场挂接、副轨跟视频段实际起点、方案边界 5s 黑场
// （该边界转场不挂、副轨/口播随实际起点顺移）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as exporter from '../lib/jianying/jianying-exporter.js'

let home = ''
let savedLocalAppData = ''

const US = (sec: number): number => Math.round(sec * 1e6)
// 方案成片之间的黑场间隔 5 秒（仅方案边界传给 exporter，方案内不传）
const GAP = US(5)

function makeFakeVideo(name: string): string {
  const p = join(home, name)
  writeFileSync(p, 'fake')
  return p
}

function makeFakeSrt(name: string): string {
  const p = join(home, name)
  writeFileSync(p, '1\n00:00:00,000 --> 00:00:01,000\nA\n')
  return p
}

function makeFakeWav(name: string): string {
  const p = join(home, name)
  writeFileSync(p, 'fake')
  return p
}

/** 导出并把草稿 content 解析回来；LOCALAPPDATA 重定向保证不落真实剪映目录 */
function exportAndRead(options: {
  durationsSec: number[]
  sfxClips?: Array<Array<{ path: string; startUs: number; durUs: number }>>
  tplClips?: Array<Array<{ phrase: string; startUs: number; durUs: number; resourceId: string }>>
  transitions?: string[]
  voiceClips?: Array<Array<{ path: string; startUs: number; durUs: number }>>
  bgmPath?: string
  gapAfterUs?: number[]
}): Record<string, any> {
  const videos = options.durationsSec.map((_, i) => makeFakeVideo(`v${i}.mp4`))
  const srts = options.durationsSec.map((_, i) => makeFakeSrt(`v${i}.srt`))
  const draftRoot = join(home, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft')
  mkdirSync(draftRoot, { recursive: true })
  const res = exporter.exportMultiToDraft({
    videoPaths: videos,
    videoDurations: options.durationsSec.map(US),
    muteVideoAudio: true,
    srtPaths: srts,
    srtLimitUs: null,
    transitions: options.transitions ?? ['fade'],
    textTemplateClips: options.tplClips ?? options.durationsSec.map(() => []),
    sfxClips: options.sfxClips,
    voiceClips: options.voiceClips ?? null,
    bgmPath: options.bgmPath ?? '',
    gapAfterUs: options.gapAfterUs ?? null,
    draftName: 'TRACK_ALIGN_PROBE',
    deps: { probeMedia: () => ({ durationSec: 0.6 }) }
  })
  expect(res.success).toBe(true)
  return JSON.parse(readFileSync(join(String(res.message), 'draft_content.json'), 'utf8'))
}

/** 按素材路径找所在音频轨的段（口播/BGM/音效都是 audio 轨，靠素材区分） */
function audioSegmentsFor(content: Record<string, any>, pathPart: string): Array<any> {
  const ids = new Set(content.materials.audios
    .filter((m: any) => String(m.path).includes(pathPart))
    .map((m: any) => m.id))
  const track = content.tracks.find((t: any) => t.type === 'audio' && (t.segments as any[]).some((s) => ids.has(s.material_id)))
  return track ? track.segments : []
}

describe('exportMultiToDraft track alignment (2026-09-29 regression)', () => {
  afterEach(() => {
    if (savedLocalAppData) process.env.LOCALAPPDATA = savedLocalAppData
    if (home) rmSync(home, { recursive: true, force: true })
    home = ''
    savedLocalAppData = ''
  })

  it('keeps subtitle windows equal to their video windows with adjacent video segments (no per-boundary drift)', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-track-align-'))
    process.env.LOCALAPPDATA = home

    const durations = [1.1, 2.3, 0.9, 3.7]
    const content = exportAndRead({ durationsSec: durations })

    const videoTrack = content.tracks.find((t: any) => t.type === 'video')
    expect(videoTrack.segments).toHaveLength(4)
    // 缺省无 gapAfterUs → 全紧密：下一段起点=前一段终点（0924 契约，转场靠相邻）
    let cursor = 0
    const expectedWindows = durations.map((sec) => {
      const window = { start: cursor, duration: US(sec) }
      cursor += US(sec)
      return window
    })
    expectedWindows.forEach((w, i) => {
      expect(videoTrack.segments[i].target_timerange.start).toBe(w.start)
      expect(videoTrack.segments[i].target_timerange.duration).toBe(w.duration)
    })
    // 副轨对齐：每个字幕 cue 落在对应视频段窗口内且起点=段起点
    // （2026-09-29 前副轨游标自第 2 片起逐边界漂移 +0.5s，起点会大于段起点）
    const subtitleTrack = content.tracks.find((t: any) => t.type === 'text' && t.flag === 1)
    expect(subtitleTrack).toBeTruthy()
    expect(subtitleTrack.segments).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      const sub = subtitleTrack.segments[i].target_timerange
      const vid = videoTrack.segments[i].target_timerange
      expect(sub.start).toBe(vid.start)
      expect(sub.start + sub.duration).toBeLessThanOrEqual(vid.start + vid.duration)
    }
    // 全片时长=各片段之和（无间隙）
    expect(content.duration).toBe(durations.reduce((a: number, b: number) => a + US(b), 0))
  })

  it('lands explicit per-shot sfx even when no text-template hits exist (guard removed)', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-sfx-guard-'))
    process.env.LOCALAPPDATA = home

    const wav0 = makeFakeWav('shot0.wav')
    const wav2 = makeFakeWav('shot2.wav')
    const content = exportAndRead({
      durationsSec: [1.0, 1.0, 1.0],
      sfxClips: [
        [{ path: wav0, startUs: 0, durUs: US(0.6) }],
        [],
        [{ path: wav2, startUs: 0, durUs: US(0.6) }],
      ],
    })

    // 音效轨独立成轨（audio；probeMedia 桩返回 0.6s → 段长=min(0.6s, 0.6s)）
    const sfxTracks = content.tracks.filter((t: any) => t.type === 'audio')
    expect(sfxTracks).toHaveLength(1)
    const segs = sfxTracks[0].segments
    expect(segs).toHaveLength(2)
    expect(segs[0].target_timerange.start).toBe(0)
    // 第 2 段音效跟视频段实际起点（缺省紧密=1.0s+1.0s）
    expect(segs[1].target_timerange.start).toBe(US(2.0))
    for (const s of segs) expect(s.target_timerange.duration).toBe(US(0.6))
    // 音效素材进库
    const sfxPaths = content.materials.audios.map((m: any) => m.path)
    expect(sfxPaths).toContain(wav0)
    expect(sfxPaths).toContain(wav2)
  })

  // 2026-09-30 用户裁决：文字模板段显示时长默认 1.5s（不再跟随服务端命中窗口全程）
  it('text-template segments display 1.5s regardless of hit window width', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-tpl-dur-'))
    process.env.LOCALAPPDATA = home
    // 最小 .textpreset（effect.resource_id 命中即可；无 resources → 无动画/花字附加）
    const presetDir = join(home, 'JianyingPro', 'User Data', 'Presets', 'Text_V2')
    mkdirSync(presetDir, { recursive: true })
    writeFileSync(join(presetDir, 'tpl-001.textpreset'), JSON.stringify({
      effect: { resource_id: 'tpl001' },
      paragraphs: [{ content: JSON.stringify({ text: '', styles: [] }), text_name: 'slot1' }],
      resources: [],
    }))

    // 命中窗口 5s（远大于 1.5s）——段时长必须钳到 1.5s，起点仍=命中起点
    const content = exportAndRead({
      durationsSec: [3.0],
      tplClips: [[{ phrase: '降噪', startUs: 0, durUs: US(5), resourceId: 'tpl001' }]],
    })
    const tplTextTracks = content.tracks.filter((t: any) => t.type === 'text')
    const tplSegs = tplTextTracks.flatMap((t: any) => t.segments).filter((s: any) => s.target_timerange.duration === US(1.5))
    expect(tplSegs.length).toBe(1)
    expect(tplSegs[0].target_timerange.start).toBe(0)
    expect(content.materials.text_templates).toHaveLength(1)
    // 不允许任何文本段仍带着 5s 旧口径
    const allTextSegs = tplTextTracks.flatMap((t: any) => t.segments)
    expect(allTextSegs.some((s: any) => s.target_timerange.duration === US(5))).toBe(false)
  })

  it('keyword fallback segments (preset missing) also display 1.5s', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-tpl-fallback-'))
    process.env.LOCALAPPDATA = home
    // 不写预设 → 命中走纯文本关键词兜底（同窗口同口径）
    const content = exportAndRead({
      durationsSec: [3.0],
      tplClips: [[{ phrase: '降噪', startUs: 0, durUs: US(5), resourceId: 'tpl001' }]],
    })
    expect(content.materials.text_templates ?? []).toHaveLength(0)
    const textTracks = content.tracks.filter((t: any) => t.type === 'text')
    const kwSegs = textTracks.flatMap((t: any) => t.segments).filter((s: any) => s.target_timerange.duration === US(1.5))
    expect(kwSegs.length).toBe(1)
    expect(kwSegs[0].target_timerange.start).toBe(0)
  })

  it('attaches boundary transition materials to the preceding segment (缺省紧密，转场恢复)', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-transition-attach-'))
    process.env.LOCALAPPDATA = home

    const content = exportAndRead({
      durationsSec: [1.0, 1.0, 1.0],
      transitions: ['fade', 'dissolve', 'slideleft'],
    })

    const transitionIds = content.materials.transitions.map((t: any) => t.id)
    // 3 段=2 个边界：normalizeTransitions 数组口径按 clips.length-1 取用
    expect(transitionIds).toHaveLength(2)
    const names = content.materials.transitions.map((t: any) => t.name).sort()
    expect(names).toEqual(['叠化', '模糊'])
    const videoTrack = content.tracks.find((t: any) => t.type === 'video')
    for (let i = 0; i < 2; i++) {
      const refs = videoTrack.segments[i].extra_material_refs
      expect(refs.filter((id: string) => transitionIds.includes(id))).toHaveLength(1)
    }
    // 末段不挂转场
    const lastRefs = videoTrack.segments[2].extra_material_refs
    expect(lastRefs.filter((id: string) => transitionIds.includes(id))).toHaveLength(0)
  })

  // 2026-11-06 用户裁定（修正 11-05 一刀切）：5s 黑场只加方案成片之间——
  // 该边界转场失效（片段不再相邻），方案内边界转场照挂；副轨/口播随实际起点顺移
  it('plan-boundary gapAfterUs: 5s black only at given boundaries (transition skipped there)', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-plan-gap-'))
    process.env.LOCALAPPDATA = home

    const voice = makeFakeWav('voice.wav')
    const bgm = makeFakeWav('bgm.mp3')
    // 方案 A=[v0,v1] 方案 B=[v2,v3]：黑场只加在 v1 之后（方案边界）
    const content = exportAndRead({
      durationsSec: [1.0, 1.0, 1.0, 1.0],
      gapAfterUs: [0, GAP, 0, 0],
      transitions: ['fade', 'fade', 'fade'],
      voiceClips: [[{ path: voice, startUs: 0, durUs: US(0.8) }], [], [{ path: voice, startUs: 0, durUs: US(0.8) }], []],
      bgmPath: bgm,
    })

    const videoTrack = content.tracks.find((t: any) => t.type === 'video')
    const starts = videoTrack.segments.map((s: any) => s.target_timerange.start)
    // 方案内紧密：v1@1.0s；方案边界黑场=实体透明图片段@2.0s×5s；v2@7.0s；v3@8.0s
    expect(starts).toEqual([0, US(1.0), US(2.0), US(7.0), US(8.0)])
    expect(videoTrack.segments).toHaveLength(5)
    // 黑场段=实体透明图片素材（photo，2026-11-06 用户裁决：剪映主轨相邻吸合，
    // 纯游标空隙成片无黑场——必须实体段填充）
    const blackSeg = videoTrack.segments[2]
    expect(blackSeg.target_timerange.duration).toBe(GAP)
    const blackMat = content.materials.videos.find((m: any) => m.id === blackSeg.material_id)
    expect(blackMat?.type).toBe('photo')
    expect(String(blackMat?.path || '')).toContain('tintin_gap_black.png')

    // 转场只在相邻内容段边界挂：v0→v1 挂、v1→黑场不挂、v2→v3 挂 → 共 2 个转场素材
    const transitionIds = content.materials.transitions.map((t: any) => t.id)
    expect(transitionIds).toHaveLength(2)
    const refCount = (seg: any) => (seg.extra_material_refs as string[]).filter((id: string) => transitionIds.includes(id)).length
    expect(refCount(videoTrack.segments[0])).toBe(1)
    expect(refCount(videoTrack.segments[1])).toBe(0)
    expect(refCount(blackSeg)).toBe(0)
    expect(refCount(videoTrack.segments[3])).toBe(1)

    // 字幕窗跟各内容段实际起点（黑场段无字幕）：v0@0、v1@1.0、v2@7.0、v3@8.0
    const subtitleTrack = content.tracks.find((t: any) => t.type === 'text' && t.flag === 1)
    const subStarts = subtitleTrack.segments.map((s: any) => s.target_timerange.start)
    expect(subStarts).toEqual([0, US(1.0), US(7.0), US(8.0)])

    // 口播挂方案首段实际起点：A@0、B@7.0s
    const voiceSegs = audioSegmentsFor(content, 'voice.wav')
    expect(voiceSegs.map((s: any) => s.target_timerange.start)).toEqual([0, US(7.0)])

    // BGM（2026-11-06 用户改判）：止于本方案末尾，黑场 [2s,7s) 静音——任何 BGM 段不得跨入黑场
    const bgmSegs = audioSegmentsFor(content, 'bgm.mp3')
    expect(bgmSegs.length).toBeGreaterThan(0)
    for (const s of bgmSegs) {
      const st = s.target_timerange.start
      const en = st + s.target_timerange.duration
      expect(en <= US(2.0) || st >= US(7.0)).toBe(true)
    }

    // 全片时长=各段之和 4s+方案边界 5s
    expect(content.duration).toBe(US(9.0))
  })

  // 2026-10-16 用户裁决：口播长于画面总长时，全部轨道都以整条草稿时长为准——
  // 末段画面慢放铺到口播末端（配音末端两遍法），口播/BGM 尾巴不得被「音频与视频
  // 同长」截断按原始镜长和裁回去（截断基准=延长后的画面轨末端）。
  it('voice longer than the video sum: tail extends all tracks to the voice end (no re-truncation)', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-voice-end-'))
    process.env.LOCALAPPDATA = home

    const voice = makeFakeWav('voice.wav')
    const bgm = makeFakeWav('bgm.mp3')
    const content = exportAndRead({
      durationsSec: [1.0, 1.0], // 画面原始总长 2.0s
      voiceClips: [[{ path: voice, startUs: 0, durUs: US(3.0) }], []], // 口播 3.0s > 2.0s
      bgmPath: bgm,
    })

    // 末段画面慢放铺满：段窗 [1.0s, 3.0s)，时长=2.0s（速度 0.5）
    const videoTrack = content.tracks.find((t: any) => t.type === 'video')
    const lastVideo = videoTrack.segments[videoTrack.segments.length - 1].target_timerange
    expect(lastVideo.start).toBe(US(1.0))
    expect(lastVideo.duration).toBe(US(2.0))

    // 口播轨不被裁回 2.0s——全长 3.0s
    const voiceSegs = audioSegmentsFor(content, 'voice.wav')
    expect(voiceSegs).toHaveLength(1)
    expect(voiceSegs[0].target_timerange.start).toBe(0)
    expect(voiceSegs[0].target_timerange.duration).toBe(US(3.0))

    // BGM 末窗同步延长：末段终点=口播末端 3.0s
    const bgmSegs = audioSegmentsFor(content, 'bgm.mp3')
    expect(bgmSegs.length).toBeGreaterThan(0)
    const bgmEnd = Math.max(...bgmSegs.map((s: any) => s.target_timerange.start + s.target_timerange.duration))
    expect(bgmEnd).toBe(US(3.0))

    // 内容总时长对齐口播末端
    expect(content.duration).toBe(US(3.0))
  })
})
