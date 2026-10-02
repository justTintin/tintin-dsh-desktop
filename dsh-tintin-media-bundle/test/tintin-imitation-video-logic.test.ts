// test/tintin-imitation-video-logic.test.ts — 仿视频 V3.5 客户端纯函数回归（2026-10-02）
// 契约锚点：《仿视频流程规范》PRD-M-5·V3.5（2026-10-02 v1.0 + 同日评审复核）
// §3 数据模型与两条状态机 / §4 Part1 输入 / §5.1 storyboard_generate 输入 /
// §5.3 徽标与解锁 / §6 gen_spec 镜像 / §11-9 stage 显式必填。
import { describe, expect, it } from 'vitest'
import {
  arollTimelineWarning,
  buildFramesConfirmBody,
  buildFramesReplaceFiles,
  buildImitateBody,
  buildStoryboardGenerateBody,
  canConfirmFrames,
  clampDuration,
  composedDuration,
  framesBadgeText,
  genBadgeText,
  isStageDReady,
  nextGenName,
  normalizeImitateVideo,
  shotsTotalDuration,
  switchShotSource,
  validateGenShots,
  type ImitationShot,
} from '../src/composables/imitationVideoLogic'

function genShot(name: string, over: Partial<ImitationShot> = {}): ImitationShot {
  return {
    index: 1,
    visual: '深色木桌上的鼠标特写',
    audio: '口播文案',
    duration: 5,
    source: 'generate',
    gen: {
      backend: 'comfygen',
      name,
      scene: { surface: 'dark_wood_desk', environment: 'gaming_room', lighting: 'purple_blue', style: 'ecommerce', composition: 'centered' },
      scene_en: 'dark wood desk closeup with RGB accents',
      end_scene_en: 'the same scene, camera closer to the product',
      camera: 'push_in',
      fidelity: 'balanced',
      first_frame: null,
      last_frame: null,
      frames_status: 'pending',
      status: 'pending',
      job_id: null,
      check: null,
      error: null,
    },
    ...over,
  }
}

describe('frames_status 状态机（§3 定稿：pending→generated→confirmed）', () => {
  it('仅 generated 态可确认（HumanGate②）', () => {
    expect(canConfirmFrames(genShot('shot_01'))).toBe(false)
    expect(canConfirmFrames(genShot('shot_01', { gen: { ...genShot('x').gen!, frames_status: 'generated' } }))).toBe(true)
    expect(canConfirmFrames(genShot('shot_01', { gen: { ...genShot('x').gen!, frames_status: 'confirmed' } }))).toBe(false)
  })

  it('阶段 D 放行 = 全部生成镜 confirmed；无生成镜放行；混入 pending 拒绝', () => {
    const matShot: ImitationShot = { duration: 4, source: 'material', material_id: 12 }
    const confirmed = genShot('a', { gen: { ...genShot('x').gen!, frames_status: 'confirmed' } })
    expect(isStageDReady([matShot])).toBe(true)
    expect(isStageDReady([matShot, confirmed])).toBe(true)
    expect(isStageDReady([confirmed, genShot('b')])).toBe(false)
  })

  it('废拼法 frames_generated 不在合法值内（评审复核统一为 generated）', () => {
    const legacy = genShot('a', { gen: { ...genShot('x').gen!, frames_status: 'frames_generated' as unknown as 'generated' } })
    expect(validateGenShots([legacy]).some((i) => i.field === 'gen.frames_status')).toBe(true)
  })
})

describe('徽标文案（§5.3-4/5）', () => {
  it('生成徽标四态 + 失败带原因', () => {
    expect(genBadgeText({ duration: 4, source: 'material' })).toBe('实拍')
    expect(genBadgeText(genShot('a'))).toBe('待生成')
    expect(genBadgeText(genShot('a', { gen: { ...genShot('x').gen!, status: 'submitted' } }))).toBe('生成中')
    expect(genBadgeText(genShot('a', { gen: { ...genShot('x').gen!, status: 'done' } }))).toBe('已完成')
    expect(genBadgeText(genShot('a', { gen: { ...genShot('x').gen!, status: 'failed', error: 'timeout' } }))).toBe('失败：timeout')
  })

  it('帧徽标三态，实拍镜为空', () => {
    expect(framesBadgeText(genShot('a'))).toBe('帧待生成')
    expect(framesBadgeText(genShot('a', { gen: { ...genShot('x').gen!, frames_status: 'generated' } }))).toBe('帧待确认')
    expect(framesBadgeText(genShot('a', { gen: { ...genShot('x').gen!, frames_status: 'confirmed' } }))).toBe('帧已确认')
    expect(framesBadgeText({ duration: 4, source: 'material' })).toBe('')
  })
})

describe('整镜来源切换（§5.3-2）', () => {
  it('material→generate：清空绑片字段并初始化 gen（唯一名、双状态机归 pending）', () => {
    const mat: ImitationShot = { duration: 6, source: 'material', material_id: 33, visual: 'v', audio: 'a' }
    const shot = switchShotSource(mat, 'generate', [genShot('shot_01'), genShot('shot_02')])
    expect(shot.source).toBe('generate')
    expect(shot.material_id).toBe(0) // 实测 Shot.material_id 为 integer default 0 非 nullable
    expect(shot.material_path).toBe('')
    expect(shot.gen?.name).toBe('shot_03') // 已占 01/02 → 冲突递增
    expect(shot.gen?.frames_status).toBe('pending')
    expect(shot.gen?.status).toBe('pending')
    expect(shot.visual).toBe('v')
  })

  it('generate→material：移除 gen 块，保留编辑字段与既有绑片', () => {
    const g = genShot('shot_01', { material_id: 77 })
    const shot = switchShotSource(g, 'material')
    expect(shot.source).toBe('material')
    expect(shot.gen).toBeUndefined()
    expect(shot.duration).toBe(5)
    expect(shot.audio).toBe('口播文案')
    expect(shot.material_id).toBe(77)
  })
})

describe('gen_spec 客户端镜像（§6）', () => {
  it('name 重复 / 非 ASCII / duration 越界 / 未知运镜逐一报错', () => {
    const dupA = genShot('shot_01')
    const dupB = genShot('shot_01')
    const chinese = genShot('shot_02', { gen: { ...genShot('x').gen!, scene_en: '深色木桌' } })
    const badDur = genShot('shot_03', { duration: 20 })
    const badCam = genShot('shot_04', { gen: { ...genShot('x').gen!, camera: 'zoom' as never } })
    const issues = validateGenShots([dupA, dupB, chinese, badDur, badCam])
    expect(issues.some((i) => i.message.includes('name 重复'))).toBe(true)
    expect(issues.some((i) => i.field === 'gen.scene_en')).toBe(true)
    expect(issues.some((i) => i.field === 'duration')).toBe(true)
    expect(issues.some((i) => i.field === 'gen.camera')).toBe(true)
  })

  it('follow 运镜暂收（待 comfygen #11）；干净脚本零问题', () => {
    const follow = genShot('shot_01', { gen: { ...genShot('x').gen!, camera: 'follow' } })
    expect(validateGenShots([follow])).toEqual([])
    expect(validateGenShots([genShot('shot_01'), { duration: 4, source: 'material' }])).toEqual([])
  })

  it('clampDuration 归一 3~15，非法回退 5', () => {
    expect(clampDuration(1)).toBe(3)
    expect(clampDuration(99)).toBe(15)
    expect(clampDuration(5.4)).toBe(5)
    expect(clampDuration('x')).toBe(5)
  })

  it('nextGenName 唯一递增', () => {
    expect(nextGenName(['shot_01', 'shot_02'])).toBe('shot_03')
    expect(nextGenName([])).toBe('shot_01')
    expect(nextGenName(['shot_02'])).toBe('shot_01')
  })
})

describe('A-roll 对轨（§3：±15% 仅提示；成片总长=两轨较长者）', () => {
  const shots = [genShot('a', { duration: 10 }), genShot('b', { duration: 10 })]
  it('Σduration 与偏差计算', () => {
    expect(shotsTotalDuration(shots)).toBe(20)
  })
  it('偏差 ≤15% 不提示；>15% 提示；口播缺失不提示', () => {
    expect(arollTimelineWarning(shots, 18)).toBe('') // |20-18|/18 ≈ 11%
    expect(arollTimelineWarning(shots, 16)).toContain('偏差') // 25%
    expect(arollTimelineWarning(shots, undefined)).toBe('')
    expect(arollTimelineWarning(shots, 0)).toBe('')
  })
  it('成片总长取较长轨', () => {
    expect(composedDuration(20, 30)).toBe(30)
    expect(composedDuration(25, 20)).toBe(25)
    expect(composedDuration(undefined, 20)).toBe(20)
    expect(composedDuration(20, undefined)).toBe(20)
  })
})

describe('Part 1 输入归一化与请求体（§4）', () => {
  it('三形态 + 本地文件需预上传', () => {
    expect(normalizeImitateVideo(123).kind).toBe('material')
    expect(normalizeImitateVideo('https://v.douyin.com/xyz').kind).toBe('url')
    expect(normalizeImitateVideo('D:/work/output/src.mp4').kind).toBe('video_path')
    expect(normalizeImitateVideo('C:/Users/me/Desktop/demo.mp4').kind).toBe('local_file')
    expect(normalizeImitateVideo('').kind).toBe('invalid')
  })
  it('body.video 按 kind 取值（材质=material:// URI，实测 2026-10-02）；products/options 透传；本地文件返回 needsUpload', () => {
    expect(buildImitateBody({ video: 123 })).toEqual({ ok: true, body: { video: 'material://123' }, note: expect.any(String) })
    expect(buildImitateBody({ video: 'https://a/b.mp4' }).body).toEqual({ video: 'https://a/b.mp4' })
    const withOpts = buildImitateBody({ video: 1, products: [{ id: 9 }], options: { ratio: '9:16', fidelity: 'balanced', max_shots: 9 } })
    expect(withOpts.body.video).toBe('material://1')
    expect(withOpts.body.products).toEqual([{ id: 9 }])
    expect(withOpts.body.options).toEqual({ ratio: '9:16', fidelity: 'balanced', max_shots: 9 })
    const local = buildImitateBody({ video: 'C:/local.mp4' })
    expect(local.ok).toBe(false)
    expect(local.needsUpload).toBe('C:/local.mp4')
  })
})

describe('Part 2 请求体（§5.1 / §11-9 stage 显式）', () => {
  it('storyboard_generate body 形状与默认值', () => {
    expect(buildStoryboardGenerateBody({ scriptId: 's1', stage: 'frames' })).toEqual({
      task_type: 'storyboard_generate',
      params: { script_id: 's1', stage: 'frames', auto_montage: false },
    })
    expect(buildStoryboardGenerateBody({ scriptId: 's1', stage: 'videos', onlyShots: ['shot_02'], fidelityOverride: 'fast', autoMontage: true }).params).toEqual({
      script_id: 's1', stage: 'videos', only_shots: ['shot_02'], fidelity_override: 'fast', auto_montage: true,
    })
  })
  it('非法 stage 抛错（与 comfygen stage 同名异值防线）', () => {
    expect(() => buildStoryboardGenerateBody({ scriptId: 's1', stage: 'video' as never })).toThrow()
  })
  it('HumanGate② 帧确认/换帧 body（§9；实测 PUT 为 multipart：confirmed 布尔 + first/last 文件）', () => {
    expect(buildFramesConfirmBody()).toEqual({ confirmed: true })
    expect(buildFramesReplaceFiles('C:/f.png')).toEqual({ first: { path: 'C:/f.png' } })
    expect(buildFramesReplaceFiles('C:/f.png', 'C:/l.png')).toEqual({ first: { path: 'C:/f.png' }, last: { path: 'C:/l.png' } })
    expect(buildFramesReplaceFiles()).toEqual({})
  })
})
