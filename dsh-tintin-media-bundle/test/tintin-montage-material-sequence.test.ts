// test/tintin-montage-material-sequence.test.ts — 素材装载·用户操作序列回归
// （2026-11-06 用户报障：清空列表后重新选择文件夹，清单空而提示语报「新增 12 个」。
//  本文件驱动真实编排层复现该序列：清空 → 选择文件夹 → 断言清单与提示语逐字一致。
//  materialFilter 桩给固定配额 12，镜像用户实机「素材 31 个 → 匹配 12 个」的口径——
//  真算法（filterMaterialsByDupMode）已另有纯函数测试，这里只钉序列语义。）
import { describe, expect, it, beforeAll } from 'vitest'
import { ref } from 'vue'
import {
  useCopywritingMontageStep1Split,
  type MontageStep1Context,
} from '../src/composables/copywritingMontage/useCopywritingMontageStep1Split'

const K828_DIR = 'W:/素材入库/K828 白 夏心小兔'
const K828_VIDEOS = Array.from({ length: 31 }, (_, i) => `${K828_DIR}/中景使用场景/c${String(i + 1).padStart(2, '0')}.mp4`)

let fakeOpenDir: string | null = K828_DIR

beforeAll(() => {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
    clear: () => { store.clear() },
  } as Storage
  ;(globalThis as unknown as { window: unknown }).window = {
    tintin: {
      dialog: {
        openDir: async () => fakeOpenDir,
        collectVideos: async (p: { root: string }) => (p.root === K828_DIR ? K828_VIDEOS : []),
        openFiles: async () => [],
      },
      ffmpeg: {
        probeDuration: async () => 8,
        probe: async () => ({ width: 1080, height: 1920, fps: 30 }),
        ensurePlayable: async (p: string) => ({ path: p }),
      },
      server: new Proxy({}, { get: () => async () => ({}) }),
      shell: {},
      env: {},
    },
  }
})

function makeStep1(): ReturnType<typeof useCopywritingMontageStep1Split> {
  const ctx: MontageStep1Context = {
    statusText: ref(''),
    ensureServerUrl: async () => '',
    toAbsolute: (u: string) => u,
    // 固定配额 12：镜像用户实机「素材 31 个 → 匹配 12 个」（真算法另有纯函数测试）
    materialFilter: (paths: string[]) => paths.slice(0, 12),
    projectSignature: () => '测试项目',
  }
  return useCopywritingMontageStep1Split(ctx)
}

/** selectFolder 是 fire-and-forget async：等(openDir+collect+watchers)落地 */
const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

describe('素材装载·用户操作序列（清空 → 重选）', () => {
  it('清空即清空：清单空且提示语=已清空素材', async () => {
    const s = makeStep1()
    await settled()
    s.clearAllVideos()
    expect(s.srcVideos.value).toHaveLength(0)
    expect(s.splitMsg.value).toBe('已清空素材')
    expect(s.splitError.value).toBe('')
  })

  it('清空后重新选择文件夹：清单=所选文件夹素材（12 行），提示语=已选文件夹回显', async () => {
    const s = makeStep1()
    await settled()
    s.clearAllVideos()
    s.selectFolder()
    await settled()
    expect(s.srcVideos.value).toHaveLength(12)
    expect(s.srcVideos.value.every((p) => p.startsWith(K828_DIR))).toBe(true)
    expect(s.splitMsg.value).toBe(`已选文件夹：${K828_DIR}；已按重复度筛选：素材 31 个 → 匹配 12 个；新增 12 个`)
  })

  it('同文件夹重复选择（追加语义）：路径去重不重复入列，明示已在清单', async () => {
    const s = makeStep1()
    await settled()
    s.clearAllVideos()
    s.selectFolder()
    await settled()
    expect(s.srcVideos.value).toHaveLength(12)
    s.selectFolder()
    await settled()
    expect(s.srcVideos.value).toHaveLength(12)
    expect(s.splitMsg.value).toBe(`已选文件夹：${K828_DIR}；已按重复度筛选：素材 31 个 → 匹配 12 个；所选素材均已在清单中`)
  })

  it('取消选择不再静默：提示语=已取消选择文件夹（未导入），清单不动', async () => {
    const s = makeStep1()
    await settled()
    s.clearAllVideos()
    s.selectFolder()
    await settled()
    expect(s.srcVideos.value).toHaveLength(12)
    fakeOpenDir = null
    try {
      s.selectFolder()
      await settled()
      expect(s.splitMsg.value).toBe('已取消选择文件夹（未导入）')
      expect(s.srcVideos.value).toHaveLength(12)
    } finally {
      fakeOpenDir = K828_DIR
    }
  })
})
