// test/tintin-shot-material-gen.test.ts — 分镜轨道生产（在线搜索/AI生成/A-Roll）逐镜逐轨回归
// （2026-11-25 用户报障：原全局单 busy/msg——看不出哪个镜在生成、无进度、导致重复
//  点击。2026-11-26 四源四轨裁决：产物写 shot.slots 各轨占位（不再入绑定池）、
//  状态按 `${idx}:${track}` 隔离、批量两入口按 markARoll/markAI 复选标记过滤。
//  A-Roll=仿爆款 stage=aroll 同管线 + 服务端按镜拆分音频（探针 2026-11-26 实证：
//  submit 零校验直接入队、worker 快速失败、产物回填任务 result.material_id）。
//  测试坑（沿用）：假定时器相位二象性——推进一律有界循环到目标态，不钉 advance 次数；
//  测试间模块态泄漏——共享变量在每个用例头重置。）
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { ref } from 'vue'
import { useShotMaterialGen } from '../src/composables/useShotMaterialGen'
import type { StoryboardShot } from '../src/composables/opsStoryboardLogic'

const shot = (visual = '实验室走廊，服务器机柜蓝绿灯闪烁'): StoryboardShot =>
  ({ index: 1, shot_type: '中景', visual, audio: '', sfx: '', duration: 3 }) as unknown as StoryboardShot

let postResult: unknown = { task_id: 't-A' }        // /generate/video
let scheduledPostResult: unknown = { id: 'ah-1' }   // /scheduled/tasks
let splitPostResult: unknown = { items: [{ shot_index: 1, audio_id: 'aud-1' }] } // /audio/voice/split-by-shots
let taskNode: () => unknown = () => ({ status: 'done', result: { output_url: 'http://srv/v.mp4' } })
let scheduledTaskNode: () => unknown = () => ({ status: 'queued' })
let scriptDetail: unknown = {}
let downloadOk = true
const downloads: string[] = []
const posts: string[] = []

beforeAll(() => {
  vi.useFakeTimers()
  ;(globalThis as unknown as { window: unknown }).window = {
    tintin: {
      server: {
        post: async (path: string) => {
          posts.push(path)
          if (path === '/scheduled/tasks') return scheduledPostResult
          if (path === '/audio/voice/split-by-shots') return splitPostResult
          return postResult
        },
        get: async (path: string) => (path.startsWith('/scheduled/tasks/')
          ? scheduledTaskNode()
          : path.startsWith('/api/storyboard/scripts/') ? scriptDetail : null),
        tasksUnifiedItem: async () => taskNode(),
        downloadResult: async (_u: string, local: string) => {
          downloads.push(String(local))
          return downloadOk ? { ok: true, local } : { error: '下载失败' }
        },
      },
      env: { cacheDir: async () => ({ dir: 'C:/cache' }) },
      shell: {},
    },
  }
})
afterAll(() => { vi.useRealTimers() })

function makeGen(shots: StoryboardShot[], dh?: () => { scriptId: string; voiceAudioId: string }) {
  const gen = useShotMaterialGen({
    imageDuration: ref(5), splitsJobId: ref('job1'),
    activeLayout: ref('vertical'), productBrief: ref({}),
    activeShots: () => shots,
    digitalHuman: dh ?? (() => ({ scriptId: 'sb_1', voiceAudioId: 'audio_1' })),
  })
  return gen
}

describe('useShotMaterialGen 逐镜逐轨状态（2026-11-25 报障修复 + 1126 轨道化）', () => {
  it('并行两镜 AI 轨独立推进：进度写各自状态、产物写 slots.gen（不入绑定池）', async () => {
    let taskStage: 'running' | 'done' = 'running'
    taskNode = () => (taskStage === 'running'
      ? { status: 'running', progress: 0.4 }
      : { status: 'done', result: { output_url: 'http://srv/v.mp4' } })
    postResult = { task_id: 't-par' }
    downloads.length = 0
    const shots = [shot(), shot('A-roll 数字人开场')]
    const gen = makeGen(shots)
    const p0 = gen.generate(0, shots[0]!)
    const p1 = gen.generate(1, shots[1]!)
    expect(gen.active(0, 'gen')).toBe(true)
    expect(gen.active(1, 'gen')).toBe(true) // 不同镜可并行（原全局 busy 会互相堵死）
    for (let k = 0; k < 6 && ((gen.stateOf(0, 'gen')?.progress ?? -1) < 0 || (gen.stateOf(1, 'gen')?.progress ?? -1) < 0); k++) {
      await vi.advanceTimersByTimeAsync(3000)
    }
    expect(gen.stateOf(0, 'gen')?.phase).toBe('generating')
    expect(gen.stateOf(0, 'gen')?.progress).toBe(40) // ≤1 小数 ×100 口径
    expect(gen.stateOf(1, 'gen')?.progress).toBe(40)
    expect(gen.stateOf(0, 'gen')?.taskId).toBe('t-par')
    taskStage = 'done'
    for (let k = 0; k < 8 && (gen.active(0, 'gen') || gen.active(1, 'gen')); k++) {
      await vi.advanceTimersByTimeAsync(3000)
    }
    const [r0, r1] = await Promise.all([p0, p1])
    expect(r0 && r1).toBe(true)
    expect(gen.stateOf(0, 'gen')?.phase).toBe('done')
    expect(gen.stateOf(1, 'gen')?.progress).toBe(100)
    // 轨道化核心断言：产物写 slots.gen 本地路径，不产生绑定
    expect(shots[0]!.slots?.gen?.local).toContain('t-par.mp4')
    expect(shots[1]!.slots?.gen?.local).toContain('t-par.mp4')
    expect(gen.active(0, 'gen')).toBe(false)
  })

  it('同镜同轨防重入：AI 轨进行中再次 generate 直接 false（其他镜/轨不拦）', async () => {
    const shots = [shot()]
    const gen = makeGen(shots)
    taskNode = () => ({ status: 'running', progress: 0.1 })
    postResult = { task_id: 't-hang' }
    const p = gen.generate(2, shots[0]!)
    expect(await gen.generate(2, shots[0]!)).toBe(false)
    taskNode = () => ({ status: 'done', result: { output_url: 'http://srv/v2.mp4' } })
    for (let k = 0; k < 8 && gen.active(2, 'gen'); k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(gen.stateOf(2, 'gen')?.phase).toBe('done')
  })

  it('提交失败：phase=failed + 错误文案就地可见，active 归 false', async () => {
    const shots = [shot()]
    const gen = makeGen(shots)
    postResult = { error: '模型资源不可用' }
    const ok = await gen.generate(4, shots[0]!)
    expect(ok).toBe(false)
    expect(gen.stateOf(4, 'gen')?.phase).toBe('failed')
    expect(gen.stateOf(4, 'gen')?.msg).toContain('模型资源不可用')
    expect(gen.active(4, 'gen')).toBe(false)
  })

  it('在线素材下载：产物写 slots.stock（搜索轨），失败落 failed', async () => {
    const shots = [shot()]
    const gen = makeGen(shots)
    downloadOk = true
    const ok = await gen.addOnline(0, { id: 'x1', url: 'http://srv/a.mp4', type: 'video', provider: 'pexels' } as never)
    expect(ok).toBe(true)
    expect(shots[0]!.slots?.stock?.url).toBe('http://srv/a.mp4')
    expect(shots[0]!.slots?.stock?.local).toBeTruthy()
    expect(gen.stateOf(0, 'stock')?.phase).toBe('done')
    downloadOk = false
    const ok2 = await gen.addOnline(0, { id: 'x2', url: 'http://srv/b.mp4', type: 'video', provider: 'pexels' } as never)
    expect(ok2).toBe(false)
    expect(gen.stateOf(0, 'stock')?.phase).toBe('failed')
    expect(gen.stateOf(0, 'stock')?.msg).toContain('下载失败')
  })
})

describe('批量入口（2026-11-26 四源四轨裁决）', () => {
  it('batchGenerateAI：只跑勾选 AI生成 且无产物的镜；产物写 slots.gen', async () => {
    const shots = [shot('a'), shot('b'), shot('c')]
    shots[0]!.markAI = true
    shots[1]!.markAI = true
    shots[2]!.markARoll = true // 非本批
    shots[1]!.slots = { gen: { local: 'C:/cache/already.mp4', taskId: 'done-1' } } // 已有产物不重做
    const gen = makeGen(shots)
    downloadOk = true // 前面用例的失败下载残留会毒化本链（模块态泄漏防）
    posts.length = 0
    postResult = { task_id: 't-batch' }
    taskNode = () => ({ status: 'done', result: { output_url: 'http://srv/bb.mp4' } })
    const p = gen.batchGenerateAI()
    // 假定时器下必须持续推进（轮询 setTimeout 不自然触发）；有界次数兜底防挂
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(posts.filter((p) => p === '/generate/video').length).toBe(1) // 只有镜 0 提交
    expect(shots[0]!.slots?.gen?.local).toContain('t-batch.mp4')
    expect(shots[1]!.slots?.gen?.local).toBe('C:/cache/already.mp4')
    expect(shots[2]!.slots?.gen).toBeUndefined()
  })

  it('batchGenerateARoll：拆分端点缺失整批拒绝并明示「未部署」', async () => {
    const shots = [shot()]
    shots[0]!.markARoll = true
    const gen = makeGen(shots)
    splitPostResult = { detail: 'Not Found' }
    await gen.batchGenerateARoll('42')
    expect(gen.msg.value).toContain('服务端未部署')
    expect(posts.filter((p) => p === '/scheduled/tasks').length).toBe(0) // 不提交任务
  })

  it('batchGenerateARoll happy path：拆分→逐镜 scheduled(aroll_audio_id)→产物写 slots.aroll', async () => {
    const shots = [shot('开场'), shot('第二镜')]
    shots[0]!.index = 1
    shots[1]!.index = 2
    shots[0]!.markARoll = true
    shots[1]!.markAI = true // 非本批
    const gen = makeGen(shots)
    scheduledPostResult = { id: 'ah-b1' }
    downloadOk = true // 前面用例的失败下载残留会毒化本链（模块态泄漏防）
    let polls = 0
    scheduledTaskNode = () => {
      polls += 1
      return polls < 2 ? { status: 'running', progress: 0.5 } : { status: 'done', result: { material_id: 77 } }
    }
    splitPostResult = { items: [{ shot_index: 0, audio_id: 'aud-1' }, { shot_index: 1, audio_id: 'aud-2' }] }
    downloads.length = 0
    posts.length = 0
    const p = gen.batchGenerateARoll('42')
    // 假定时器持续推进（批量先走拆分微任务再起任务；有界次数兜底防挂）
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(shots[0]!.slots?.aroll?.local).toContain('ah-b1.mp4')
    expect(shots[0]!.slots?.aroll?.audioId).toBe('aud-1')
    expect(shots[1]!.slots?.aroll).toBeUndefined() // 未勾选 aroll 不跑
    expect(gen.msg.value).toContain('A-Roll 批量生成完成：成功 1/1')
  })

  it('三道闸：未同步脚本 / 无口播音频 / 人物图 ID 非法 各自拒绝且不提交', async () => {
    const shots = [shot()]
    shots[0]!.markARoll = true
    const gen = makeGen(shots, () => ({ scriptId: '', voiceAudioId: '' }))
    await gen.batchGenerateARoll('12')
    expect(gen.msg.value).toContain('尚未同步到服务端')
    const gen2 = makeGen(shots, () => ({ scriptId: 'sb_2', voiceAudioId: '' }))
    await gen2.batchGenerateARoll('12')
    expect(gen2.msg.value).toContain('口播配音')
    const gen3 = makeGen(shots)
    await gen3.batchGenerateARoll('')
    expect(gen3.msg.value).toContain('上传人物图')
  })

  it('worker 失败透传：scheduled 任务 failed 落该镜 A-Roll 轨 failed 态', async () => {
    const shots = [shot()]
    shots[0]!.markARoll = true
    const gen = makeGen(shots)
    scheduledPostResult = { id: 'ah-err' }
    scheduledTaskNode = () => ({ status: 'failed', error_msg: '脚本不存在: sb_1' })
    const p = gen.batchGenerateARoll('42')
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(gen.stateOf(0, 'aroll')?.phase).toBe('failed')
    expect(gen.stateOf(0, 'aroll')?.msg).toContain('脚本不存在')
    expect(gen.active(0, 'aroll')).toBe(false)
  })

  it('splitVoiceByScript 解析：数组形态/items 包裹/audioId 别名；端点缺失返回 null', async () => {
    const gen = makeGen()
    splitPostResult = [{ shot_index: 3, audio_id: 'aud-3' }]
    expect((await gen.splitVoiceByScript('sb_x'))?.get(3)).toBe('aud-3')
    splitPostResult = { items: [{ shot_index: 2, audioId: 'aud-2' }] }
    expect((await gen.splitVoiceByScript('sb_x'))?.get(2)).toBe('aud-2')
    splitPostResult = null
    expect(await gen.splitVoiceByScript('sb_x')).toBeNull()
  })
})
