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
import { createArollPerShotSync } from '../src/composables/copywritingMontage/useCopywritingMontageArollPerShotSync'
import type { StoryboardTab } from '../src/composables/copywritingMontage/useCopywritingMontageStoryboardTabs'
import type { StoryboardShot } from '../src/composables/opsStoryboardLogic'

const shot = (visual = '实验室走廊，服务器机柜蓝绿灯闪烁'): StoryboardShot =>
  ({ index: 1, shot_type: '中景', visual, audio: '', sfx: '', duration: 3 }) as unknown as StoryboardShot

let postResult: unknown = { task_id: 't-A' }        // /generate/video
let genVideoBody: Record<string, unknown> | null = null // /generate/video 请求体（prompt 契约钉定）
let scheduledPostResult: unknown = { id: 'ah-1' }   // /scheduled/tasks
let splitPostResult: unknown = { items: [{ shot_index: 1, audio_id: 'aud-1' }] } // /audio/voice/split-by-shots
let splitPostThrow: Error | null = null // 置非 null=该端点直接 reject（模拟 HTTP 404 等）
let splitPostBody: Record<string, unknown> | null = null // split 请求体（source_audio_id 契约钉定）
let taskNode: () => unknown = () => ({ status: 'done', result: { output_url: 'http://srv/v.mp4' } })
let scheduledTaskNode: (path?: string) => unknown = () => ({ status: 'queued' })
let scriptDetail: unknown = {}  // 函数形态=按回读次数动态演化（增量回轨测试用）
let scheduledTaskBody: Record<string, unknown> | null = null
let cancelPostBody: Record<string, unknown> | null = null // /tasks/batch_cancel 请求体（task_ids 契约钉定，2026-11-27 探针）
const cancelPaths: string[] = [] // /scheduled/tasks/{id}/cancel 触发记录（2026-11-27 停止裁决）
let downloadOk = true
const downloads: string[] = []
const posts: string[] = []
const scheduledBodies: Array<Record<string, unknown>> = [] // 逐镜独立提交体（v4 再裁决契约钉定）
const puts: string[] = []

beforeAll(() => {
  vi.useFakeTimers()
  ;(globalThis as unknown as { window: unknown }).window = {
    tintin: {
      server: {
        post: async (path: string, body?: Record<string, unknown>) => {
          posts.push(path)
          if (path === '/scheduled/tasks') {
            scheduledTaskBody = (body ?? null) as Record<string, unknown> | null
            scheduledBodies.push(scheduledTaskBody!)
            return scheduledPostResult
          }
          if (path === '/generate/video') {
            genVideoBody = (body ?? null) as Record<string, unknown> | null
            return postResult
          }
          if (path === '/audio/voice/split-by-shots') {
            splitPostBody = (body ?? null) as Record<string, unknown> | null
            if (splitPostThrow) throw splitPostThrow
            return splitPostResult
          }
          if (path === '/tasks/batch_cancel') {
            cancelPostBody = (body ?? null) as Record<string, unknown> | null
            return { cancelled: 1, total: 1 }
          }
          if (/^\/scheduled\/tasks\/[^/]+\/cancel$/.test(path)) {
            cancelPaths.push(path)
            return { ok: true }
          }
          return postResult
        },
        get: async (path: string) => (path.startsWith('/scheduled/tasks/')
          ? scheduledTaskNode(path)
          : path.startsWith('/api/storyboard/scripts/')
            ? (typeof scriptDetail === 'function' ? (scriptDetail as () => unknown)() : scriptDetail)
            : null),
        put: async (path: string) => { puts.push(path); return { ok: true } },
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

let syncCalls = 0
let syncFail: Error | null = null
let hasMaterialFrom = -1 // >= 该下标的镜视为素材轨有货（-1=都没有）
function makeGen(shots: StoryboardShot[], dh?: () => { scriptId: string; voiceAudioId: string; voiceWav: string }) {
  const gen = useShotMaterialGen({
    imageDuration: ref(5), splitsJobId: ref('job1'),
    activeLayout: ref('vertical'), productBrief: ref({}),
    activeShots: () => shots,
    digitalHuman: dh ?? (() => ({ scriptId: 'sb_1', voiceAudioId: 'audio_1', voiceWav: 'C:/cache/voice.wav' })),
    syncArollPerShot: async () => {
      syncCalls += 1
      if (syncFail) throw syncFail
    },
    hasMaterial: (i: number) => hasMaterialFrom >= 0 && i >= hasMaterialFrom,
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

  it('AI 生成 prompt 产品字段只取字符串（2026-11-26 报障：对象 join 成 [object Object] 混入）', async () => {
    const shots = [shot()]
    taskNode = () => ({ status: 'done', result: { output_url: 'http://srv/pp.mp4' } })
    postResult = { task_id: 't-pp' }
    downloadOk = true
    const gen = useShotMaterialGen({
      imageDuration: ref(5), splitsJobId: ref('job1'),
      activeLayout: ref('vertical'), productBrief: ref({ brand: '罗技', product: '鼠标', model: 'MX Master', extra: { nested: 1 } }),
      activeShots: () => shots,
      digitalHuman: () => ({ scriptId: 'sb_1', voiceAudioId: '', voiceWav: '' }),
      syncArollPerShot: async () => {},
      hasMaterial: () => false,
    })
    const p = gen.generate(0, shots[0]!)
    for (let k = 0; k < 8 && gen.active(0, 'gen'); k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    const body = (genVideoBody ?? {}) as Record<string, unknown>
    const prompt = String(body.prompt ?? '')
    expect(prompt).toContain('实验室走廊') // 画面描述在前
    expect(prompt).toContain('罗技 / 鼠标 / MX Master') // 产品字段串接（productBriefOf 同口径）
    expect(prompt).not.toContain('[object Object]') // 对象不再整体字符串化
    expect(body.aspect).toBe('9:16')
    expect(body.resolution).toBe('720p')
    expect(body.duration).toBe(3)
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

  it('batchGenerateARoll v3：per_shot 预置→scheduled(aroll_image=服务端路径)→脚本回写逐镜下载', async () => {
    const shots = [shot('开场'), shot('第二镜')]
    shots[0]!.index = 1
    shots[1]!.index = 2
    shots[0]!.markARoll = true
    shots[1]!.markAI = true // 非本批
    const gen = makeGen(shots)
    downloadOk = true
    posts.length = 0; puts.length = 0; downloads.length = 0
    scheduledPostResult = { id: 'ah-v3' }
    let polls = 0
    scheduledTaskNode = () => {
      polls += 1
      return polls < 2 ? { status: 'running', progress: 40 } : { status: 'completed' }
    }
    // 脚本回写：每镜 aroll_material_id（2026-11-26 用户转述契约）
    scriptDetail = { shots: [ { index: 1, aroll_material_id: 881 }, { index: 2, aroll_material_id: 882 } ] }
    const p = gen.batchGenerateARoll('/home/srv/product_images/person.png')
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(syncCalls).toBe(1) // per_shot 模式预置执行过
    // 单次 scheduled 触发，params 契约=script_id+stage+aroll_image（无 audio_id/shot_index）
    expect(posts.filter((p) => p === '/scheduled/tasks').length).toBe(1)
    const body = scheduledTaskBody as { params?: Record<string, unknown> }
    expect(body?.params?.script_id).toBe('sb_1')
    expect(body?.params?.stage).toBe('aroll')
    expect(body?.params?.aroll_image).toBe('/home/srv/product_images/person.png')
    // 2026-11-26 契约 2ef347a0 选镜制：必须显式传 0-based 镜号列表
    expect(body?.params?.aroll_shot_indexes).toEqual([0])
    expect(body?.params?.aroll_audio_id).toBeUndefined()
    expect(body?.params?.aroll_shot_index).toBeUndefined()
    // 逐镜产物=脚本回写 aroll_material_id → /material/serve 下载 → slots.aroll
    expect(downloads.some((d) => d.includes('ah-v3_1.mp4'))).toBe(true)
    expect(shots[0]!.slots?.aroll?.local).toContain('ah-v3_1.mp4')
    expect(shots[1]!.slots?.aroll).toBeUndefined() // 未勾选不跑
    expect(gen.msg.value).toContain('A-roll 批量生成完成：成功 1/1')
  })

  it('有素材镜自动跳过：未回写产物但素材轨有货=done（跳过口径）；全跳过不提交任务', async () => {
    const shots = [shot('开场')]
    shots[0]!.markARoll = true
    hasMaterialFrom = 0
    const gen = makeGen(shots)
    scheduledPostResult = { id: 'ah-skip' }
    scheduledTaskNode = () => ({ status: 'completed' })
    scriptDetail = { shots: [ { index: 1 } ] } // 无 aroll_material_id
    posts.length = 0
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    hasMaterialFrom = -1
    expect(gen.stateOf(0, 'aroll')?.phase).toBe('done')
    expect(gen.stateOf(0, 'aroll')?.msg).toContain('自动跳过')
    // 2026-11-26 选镜制契约：无生成范围（空列表会被拒）不提交任务
    expect(posts.filter((pp) => pp === '/scheduled/tasks').length).toBe(0)
  })

  it('per_shot 预置失败=中断且不提交任务', async () => {
    const shots = [shot()]
    shots[0]!.markARoll = true
    const gen = makeGen(shots)
    syncFail = new Error('PUT 500')
    posts.length = 0
    await gen.batchGenerateARoll('/home/srv/person.png')
    syncFail = null
    expect(gen.msg.value).toContain('PUT 500')
    expect(posts.filter((p) => p === '/scheduled/tasks').length).toBe(0)
  })

  it('三道闸：未同步脚本 / 人物图未选 拒绝且不提交', async () => {
    posts.length = 0
    const shots = [shot()]
    shots[0]!.markARoll = true
    const gen = makeGen(shots, () => ({ scriptId: '', voiceAudioId: '', voiceWav: '' }))
    await gen.batchGenerateARoll('C:/srv/a.png')
    expect(gen.msg.value).toContain('尚未同步到服务端')
    const gen3 = makeGen(shots)
    await gen3.batchGenerateARoll('')
    expect(gen3.msg.value).toContain('上传人物图')
    expect(posts.filter((p) => p === '/scheduled/tasks').length).toBe(0)
  })

  it('生成一个回轨一个（2026-11-26 用户裁决）：逐镜回写一出现立即落轨，不等全部完成', async () => {
    const shots = [shot('开场'), shot('第二镜')]
    shots[0]!.index = 1
    shots[1]!.index = 2
    shots[0]!.markARoll = true
    shots[1]!.markARoll = true
    const gen = makeGen(shots)
    downloadOk = true
    posts.length = 0; downloads.length = 0
    scheduledPostResult = { id: 'ah-inc' }
    scheduledTaskNode = () => ({ status: 'running', progress: 10 })
    // 脚本回写动态演化：第 1 次回读只有镜 0 产物；第 2 次起镜 1 才出现
    let scriptReads = 0
    scriptDetail = () => {
      scriptReads += 1
      return scriptReads <= 1
        ? { shots: [{ index: 1, aroll_material_id: 901 }, { index: 2 }] }
        : { shots: [{ index: 1, aroll_material_id: 901 }, { index: 2, aroll_material_id: 902 }] }
    }
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    await vi.advanceTimersByTimeAsync(3000)
    // 中间态：镜 0 已回轨 done，镜 1 仍在生成（不互相等待）
    expect(shots[0]!.slots?.aroll?.local).toContain('ah-inc_1.mp4')
    expect(gen.stateOf(0, 'aroll')?.phase).toBe('done')
    // 流水线（1127 §8 互斥裁决）：前镜终态后才提交后镜——此瞬后镜尚未提交
    expect(gen.stateOf(1, 'aroll')?.phase).toBe('submitting')
    expect(gen.msg.value).toContain('已回轨 1/2')
    for (let k = 0; k < 10 && gen.active(1, 'aroll'); k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(shots[1]!.slots?.aroll?.local).toContain('ah-inc_2.mp4')
    expect(gen.stateOf(1, 'aroll')?.phase).toBe('done')
    expect(gen.msg.value).toContain('A-roll 批量生成完成：成功 2/2')
    scriptDetail = {}
  })

  it('worker 失败透传：任务 failed 落该镜 A-Roll 轨 failed 态', async () => {
    const shots = [shot()]
    shots[0]!.markARoll = true
    const gen = makeGen(shots)
    scheduledPostResult = { id: 'ah-err' }
    scheduledTaskNode = () => ({ status: 'failed', error_msg: '第 3 镜未铺旁白' })
    scriptDetail = { shots: [] } // 上一用例的增量回写函数会泄漏毒化（模块态纪律）
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(gen.stateOf(0, 'aroll')?.phase).toBe('failed')
    expect(gen.stateOf(0, 'aroll')?.msg).toContain('未铺旁白')
    expect(gen.active(0, 'aroll')).toBe(false)
  })

  it('splitVoiceByScript 富结果：数组/items/audioId 别名解析；404=undeployed；业务 detail 逐字透出', async () => {
    const gen = makeGen()
    splitPostResult = [{ shot_index: 0, audio_id: 'aud-0' }, { shot_index: 3, audio_id: 'aud-3' }]
    const r1 = await gen.splitVoiceByScript('sb_x', 'audio_1')
    // 2026-11-26 服务端实证：绑定回写晚于 split——body 直带 source_audio_id 不依赖脚本绑定
    expect(splitPostBody?.script_id).toBe('sb_x')
    expect(splitPostBody?.source_audio_id).toBe('audio_1')
    expect(r1.map.get(0)).toBe('aud-0')
    expect(r1.map.get(3)).toBe('aud-3')
    expect(r1.detail).toContain('2/2')
    expect(r1.undeployed).toBe(false)
    splitPostResult = { items: [{ shot_index: 2, audioId: 'aud-2' }] }
    expect((await gen.splitVoiceByScript('sb_x')).map.get(2)).toBe('aud-2')
    splitPostResult = { detail: '各镜 shot.audio 全空——先 distribute-voiceover 铺旁白再切分' }
    const r3 = await gen.splitVoiceByScript('sb_x')
    expect(r3.map.size).toBe(0)
    expect(r3.detail).toContain('各镜 shot.audio 全空')
    expect(r3.undeployed).toBe(false)
    splitPostThrow = Object.assign(new Error('HTTP 404：{"detail":"Not Found"}'), { status: 404 })
    expect((await gen.splitVoiceByScript('sb_x')).undeployed).toBe(true)
    splitPostThrow = null
    splitPostResult = null
    expect((await gen.splitVoiceByScript('sb_x')).detail).toContain('响应为空')
  })
})

describe('per_shot 预置回写 aroll.audio_id（2026-11-26 探针实测契约）', () => {
  const tabOf = (voiceAudioId: string): StoryboardTab =>
    ({ id: 'sb1', name: '脚本', scriptId: 'script_x', topic: '验收脚本', narrative: '', voiceAudioId, voiceDurSec: 155.2, shots: [{ index: 1, markARoll: true, audio: '旁白', duration: 3 }] }) as unknown as StoryboardTab
  const runSync = async (tab: StoryboardTab): Promise<Array<Record<string, unknown>>> => {
    const bodies: Array<Record<string, unknown>> = []
    const sync = createArollPerShotSync({
      storyboards: ref([tab]),
      sharedProductInfo: ref({}),
      post: async (_p, body) => { bodies.push(body as Record<string, unknown>); return { ok: true } },
      onError: () => {},
      attachClipGroups: () => {},
    })
    await sync()
    return bodies
  }
  it('克隆声音在：aroll={mode:per_shot, audio_id:voiceAudioId}', async () => {
    const bodies = await runSync(tabOf('5257'))
    const aroll = bodies[0]?.aroll as Record<string, unknown>
    expect(aroll?.mode).toBe('per_shot')
    expect(aroll?.audio_id).toBe('5257')
    expect(bodies[0]?.voice_audio_id).toBe('5257')
  })
  it('克隆声音缺：mode-only 不写假 audio_id（音频门由 worker 明确拒绝）', async () => {
    const bodies = await runSync(tabOf(''))
    const aroll = bodies[0]?.aroll as Record<string, unknown>
    expect(aroll?.mode).toBe('per_shot')
    expect(aroll?.audio_id).toBeUndefined()
  })
})

describe('每镜 15 分钟超时 + 停止按钮（2026-11-27 用户裁决）', () => {
  it('AI 生成单镜 15 分钟超时：queued 不动到点判失败，不再挂 30 分钟旧预算', async () => {
    const shots = [shot()]
    const gen = makeGen(shots)
    taskNode = () => ({ status: 'running', progress: 0.2 })
    postResult = { task_id: 't-slow' }
    downloadOk = true
    const p = gen.generate(0, shots[0]!)
    // 有界推进过 15 分钟（1 分钟步进×20；推进一律有界循环到目标态）
    for (let k = 0; k < 20 && gen.active(0, 'gen'); k++) await vi.advanceTimersByTimeAsync(60_000)
    await p
    expect(gen.stateOf(0, 'gen')?.phase).toBe('failed')
    expect(gen.stateOf(0, 'gen')?.msg).toContain('生成超时（15 分钟/镜）')
    expect(gen.active(0, 'gen')).toBe(false)
    // 判死同步收回服务端资源（2026-11-27 用户裁决：不允许客户端失败服务端还烧）
    expect(posts).toContain('/tasks/batch_cancel')
  })

  it('AI 生成停止：stopBatch 置旗标→轮询收割→/tasks/batch_cancel 带 task_ids→瓦片已停止', async () => {
    const shots = [shot('a'), shot('b')]
    shots[0]!.markAI = true
    shots[1]!.markAI = true
    const gen = makeGen(shots)
    taskNode = () => ({ status: 'running', progress: 0.3 })
    postResult = { task_id: 't-stop' }
    cancelPostBody = null
    const p = gen.batchGenerateAI()
    for (let k = 0; k < 4 && posts.filter((x) => x === '/generate/video').length < 2; k++) await vi.advanceTimersByTimeAsync(3000)
    gen.stopBatch('aroll') // 跨组误触：AI 跑批时 A-Roll 组停止无效果（activeGroup 归属闸）
    expect(gen.groupMsgs.value.aroll).toBe('')
    gen.stopBatch('ai')
    for (let k = 0; k < 10 && (gen.active(0, 'gen') || gen.active(1, 'gen')); k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    await vi.advanceTimersByTimeAsync(3000) // void 取消请求微任务排空
    // 两镜共用同一假任务 id：逐镜各发一次取消，捕获到的是最后一发的 body
    expect(cancelPostBody?.task_ids).toEqual(['t-stop'])
    expect(gen.stateOf(0, 'gen')?.msg).toContain('已停止')
    expect(gen.stateOf(1, 'gen')?.msg).toContain('已停止')
    expect(gen.groupMsgs.value.ai).toContain('已停止')
  })

  it('A-roll 停止：旗标→/scheduled/tasks/{id}/cancel→未回轨镜已停止（主动停止不算失败）', async () => {
    const shots = [shot('开场')]
    shots[0]!.markARoll = true
    const gen = makeGen(shots)
    downloadOk = true
    posts.length = 0; cancelPaths.length = 0
    scheduledPostResult = { id: 'ah-stop' }
    scheduledTaskNode = () => ({ status: 'running', progress: 10 })
    scriptDetail = { shots: [] } // 永无产物=回轨永不发生
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    for (let k = 0; k < 4 && !posts.some((x) => x === '/scheduled/tasks'); k++) await vi.advanceTimersByTimeAsync(3000)
    gen.stopBatch('aroll')
    for (let k = 0; k < 10 && gen.active(0, 'aroll'); k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(cancelPaths).toEqual(['/scheduled/tasks/ah-stop/cancel'])
    expect(gen.stateOf(0, 'aroll')?.msg).toContain('已停止')
    expect(gen.groupMsgs.value.aroll).toContain('已停止')
  })

  it('A-roll 每镜 15 分钟上限：running 不动到点逐镜判超时，整批不挂 120 分钟旧预算', async () => {
    const shots = [shot('开场'), shot('第二镜')]
    shots[0]!.markARoll = true
    shots[1]!.markARoll = true
    const gen = makeGen(shots)
    downloadOk = true
    scheduledPostResult = { id: 'ah-slow' }
    scheduledTaskNode = () => ({ status: 'running', progress: 10 })
    scriptDetail = { shots: [] }
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    // 流水线（§8 互斥）：两镜串行各自 15 分钟 ≈30 分钟——推进预算提到 50 分钟。
    // 无条件推进（submitting 态在 syncArollPerShot/提交之后才落，active() 门控会
    // 漏首拍零推进→永挂——本文件第二次踩同一坑）；收割后剩余推进空转即回
    for (let k = 0; k < 50; k++) await vi.advanceTimersByTimeAsync(60_000)
    await p
    expect(gen.stateOf(0, 'aroll')?.phase).toBe('failed')
    expect(gen.stateOf(0, 'aroll')?.msg).toContain('生成超时（15 分钟/镜）')
    expect(gen.stateOf(1, 'aroll')?.msg).toContain('生成超时（15 分钟/镜）')
    expect(gen.active(0, 'aroll')).toBe(false)
  })
})

describe('逐镜独立任务契约（2026-11-27 用户再裁决：15 分钟按各自开跑起算）', () => {
  it('两镜勾选=两个 scheduled 任务，各自 aroll_shot_indexes 单元素（不再单任务包干全部镜号）', async () => {
    const shots = [shot('开场'), shot('第二镜')]
    shots[0]!.index = 1
    shots[1]!.index = 2
    shots[0]!.markARoll = true
    shots[1]!.markARoll = true
    const gen = makeGen(shots)
    downloadOk = true
    posts.length = 0; downloads.length = 0; scheduledBodies.length = 0
    scheduledPostResult = { id: 'ah-v4' }
    scriptDetail = { shots: [ { index: 1, aroll_material_id: 901 }, { index: 2, aroll_material_id: 902 } ] }
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    console.log('POSTS=', JSON.stringify(posts))
    expect(posts.filter((x) => x === '/scheduled/tasks').length).toBe(2)
    expect(scheduledBodies.map((b) => (b.params as Record<string, unknown>).aroll_shot_indexes)).toEqual([[0], [1]])
    expect(shots[0]!.slots?.aroll?.local).toContain('ah-v4_1.mp4')
    expect(shots[1]!.slots?.aroll?.local).toContain('ah-v4_2.mp4')
  })

  it('queued 不吃生成窗口：排队 20 分钟不超时，转 running 后满 15 分钟才判超时并取消该任务', async () => {
    const shots = [shot('开场')]
    shots[0]!.markARoll = true
    const gen = makeGen(shots)
    downloadOk = true
    posts.length = 0; cancelPaths.length = 0
    scheduledPostResult = { id: 'ah-q' }
    let ticks = 0
    scheduledTaskNode = () => {
      ticks += 1
      return ticks <= 400 ? { status: 'queued' } : { status: 'running', progress: 30 }
    }
    scriptDetail = { shots: [] }
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    // 排队 20 分钟（400 tick×3s）：窗口随 tick 后移，不判超时
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(60_000)
    expect(gen.active(0, 'aroll')).toBe(true)
    expect(gen.stateOf(0, 'aroll')?.msg).toContain('等待服务端队列')
    // running 再 10 分钟（累计 30 分钟墙钟）：仍未到该镜 15 分钟窗口——不超时
    for (let k = 0; k < 10; k++) await vi.advanceTimersByTimeAsync(60_000)
    expect(gen.stateOf(0, 'aroll')?.msg).not.toContain('生成超时')
    // running 满 15 分钟（再 5 分钟）：到点判超时 + 取消该任务让位串行队列
    for (let k = 0; k < 6; k++) await vi.advanceTimersByTimeAsync(60_000)
    await p
    expect(gen.stateOf(0, 'aroll')?.phase).toBe('failed')
    expect(gen.stateOf(0, 'aroll')?.msg).toContain('生成超时（15 分钟/镜）')
    expect(cancelPaths).toContain('/scheduled/tasks/ah-q/cancel')
  })

  it('AI 生成 queued 同口径：排队 20 分钟不超时（转 running 前不烧窗口）', async () => {
    const shots = [shot()]
    const gen = makeGen(shots)
    postResult = { task_id: 't-q' }
    let ticks = 0
    taskNode = () => {
      ticks += 1
      return ticks <= 400 ? { status: 'queued' } : { status: 'running', progress: 0.5 }
    }
    const p = gen.generate(0, shots[0]!)
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(60_000)
    expect(gen.active(0, 'gen')).toBe(true)
    expect(gen.stateOf(0, 'gen')?.msg).toContain('等待服务端队列')
    for (let k = 0; k < 10; k++) await vi.advanceTimersByTimeAsync(60_000)
    expect(gen.stateOf(0, 'gen')?.msg).not.toContain('生成超时')
    // 收尾：转 done 让 generate 走完（防假定时器下悬挂 promise）
    taskNode = () => ({ status: 'done', result: { output_url: 'http://srv/q.mp4' } })
    downloadOk = true
    for (let k = 0; k < 10 && gen.active(0, 'gen'); k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(gen.stateOf(0, 'gen')?.phase).toBe('done')
  })
})

describe('判死同步取消（2026-11-27 用户裁决：客户端失败服务端不许继续烧）', () => {
  it('批量异常中断（轮询通道炸）→ catch 域逐镜取消未回轨镜的任务', async () => {
    const shots = [shot('开场'), shot('第二镜')]
    shots[0]!.index = 1
    shots[1]!.index = 2
    shots[0]!.markARoll = true
    shots[1]!.markARoll = true
    const gen = makeGen(shots)
    posts.length = 0; cancelPaths.length = 0
    scheduledPostResult = { id: 'ah-boom' }
    scheduledTaskNode = () => { throw new Error('轮询通道炸了') }
    scriptDetail = { shots: [] }
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    for (let k = 0; k < 10; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(gen.stateOf(0, 'aroll')?.phase).toBe('failed')
    expect(gen.groupMsgs.value.aroll).toContain('A-roll 生成失败')
    // 流水线（§8 互斥）：异常瞬间仅 in-flight 的镜 1 有任务——被取消；
    // 镜 2 尚未提交（无任务可取消），瓦片由 catch 兜底 stamp
    expect(cancelPaths.filter((x) => x === '/scheduled/tasks/ah-boom/cancel').length).toBe(1)
    expect(gen.stateOf(1, 'aroll')?.msg).toContain('A-roll 生成失败')
  })
})

describe('§8 任务级互斥契约（2026-11-27 实测：同脚本同时只允许一个在飞任务）', () => {
  const shots2 = (): StoryboardShot[] => {
    const arr = [shot('开场'), shot('第二镜')]
    arr[0]!.index = 1
    arr[1]!.index = 2
    arr[0]!.markARoll = true
    arr[1]!.markARoll = true
    return arr
  }

  it('409 在飞竞态：退避重试后成功，镜不误判失败', async () => {
    const shots = shots2()
    const gen = makeGen(shots)
    downloadOk = true
    posts.length = 0; scheduledBodies.length = 0
    scheduledPostResult = { id: 'ah-mutex' }
    scriptDetail = { shots: [ { index: 1, aroll_material_id: 911 }, { index: 2, aroll_material_id: 912 } ] }
    // 首个提交返回 409（互斥竞态）→ 退避重试第二次成功
    let mutexFired = false
    const origPost = window.tintin.server.post
    ;(window.tintin.server as { post: unknown }).post = async (path: string, body?: Record<string, unknown>) => {
      if (path === '/scheduled/tasks' && !mutexFired) {
        mutexFired = true
        throw new Error('HTTP 409：脚本 sb_1 已有生成任务在飞（#2012 queued），完成后或取消后再提交（§8 任务级互斥）')
      }
      return (origPost as (p: string, b?: Record<string, unknown>) => Promise<unknown>)(path, body)
    }
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    for (let k = 0; k < 30; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    ;(window.tintin.server as { post: unknown }).post = origPost
    expect(gen.stateOf(0, 'aroll')?.phase).toBe('done')
    expect(gen.stateOf(1, 'aroll')?.phase).toBe('done')
    expect(gen.msg.value).toContain('成功 2/2')
  })

  it('持续 409：detail 原样透出瓦片（不吞成「服务端不可达」），该镜失败其余镜继续', async () => {
    const shots = shots2()
    shots[0]!.markARoll = false
    shots[1]!.markARoll = true // 只跑镜 2（下标 1），聚焦单镜提交失败透传
    const gen = makeGen(shots)
    posts.length = 0
    scheduledPostResult = { error: 'HTTP 409：脚本 sb_1 已有生成任务在飞（#2012 queued），完成后或取消后再提交（§8 任务级互斥）' }
    scriptDetail = { shots: [] }
    const p = gen.batchGenerateARoll('/home/srv/person.png')
    for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(gen.stateOf(1, 'aroll')?.phase).toBe('failed')
    expect(gen.stateOf(1, 'aroll')?.msg).toContain('已有生成任务在飞')
    expect(gen.stateOf(1, 'aroll')?.msg).not.toContain('服务端不可达')
  })
})
