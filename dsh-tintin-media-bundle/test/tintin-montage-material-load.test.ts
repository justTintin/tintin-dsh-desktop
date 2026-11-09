// test/tintin-montage-material-load.test.ts — 素材装载统一语义回归
// （2026-11-06 用户裁决：手动选文件夹与拖入文件夹完全同语义——重复度算法输入=
//  该文件夹全部收集素材，结果追加；再次操作也是追加，同路径去重不重复入列）
import { describe, expect, it } from 'vitest'
import {
  hasVideoExt,
  appendMaterialBatch,
  materialLoadSummary,
  montageProjectIdNow,
  projectIdentityOf,
  serializeMaterialBatch,
  parseMaterialBatch,
} from '../src/composables/copywritingMontageStep1SplitLogic'

describe('hasVideoExt（拖入回退直推的扩展名判定）', () => {
  it('识别带点扩展名（大小写不敏感）', () => {
    expect(hasVideoExt('W:\\素材\\a.mp4')).toBe(true)
    expect(hasVideoExt('W:\\素材\\B.MOV')).toBe(true)
    expect(hasVideoExt('W:\\素材\\c.WebM')).toBe(true)
  })

  it('无扩展名/非视频扩展名/目录名不含点 → false', () => {
    expect(hasVideoExt('W:\\素材\\未命名')).toBe(false)
    expect(hasVideoExt('W:\\素材\\封面.png')).toBe(false)
    expect(hasVideoExt('W:\\素材入库')).toBe(false)
  })
})

describe('appendMaterialBatch（追加+去重+上限，两个入口共用）', () => {
  it('按批顺序追加新路径；批内与清单内重复路径不重复入列', () => {
    const list = ['W:\\a\\1.mp4']
    const { added, capBlocked } = appendMaterialBatch(list, [
      'W:\\a\\1.mp4', // 已在清单：跳过
      'W:\\a\\2.mp4',
      'W:\\a\\2.mp4', // 批内重复：跳过
      '',
      'W:\\b\\3.mp4',
    ], 500)
    expect(list).toEqual(['W:\\a\\1.mp4', 'W:\\a\\2.mp4', 'W:\\b\\3.mp4'])
    expect(added).toBe(2)
    expect(capBlocked).toBe(0)
  })

  it('总量达上限后剩余全部计入 capBlocked，不静默丢弃', () => {
    const list = ['W:\\a\\1.mp4', 'W:\\a\\2.mp4']
    const batch = ['W:\\b\\3.mp4', 'W:\\b\\4.mp4', 'W:\\b\\5.mp4', 'W:\\b\\6.mp4']
    const { added, capBlocked } = appendMaterialBatch(list, batch, 4)
    expect(list).toEqual(['W:\\a\\1.mp4', 'W:\\a\\2.mp4', 'W:\\b\\3.mp4', 'W:\\b\\4.mp4'])
    expect(added).toBe(2)
    expect(capBlocked).toBe(2)
  })

  it('清单已在满额时全部拦截', () => {
    const list = ['W:\\a\\1.mp4']
    const { added, capBlocked } = appendMaterialBatch(list, ['W:\\b\\2.mp4'], 1)
    expect(added).toBe(0)
    expect(capBlocked).toBe(1)
    expect(list).toEqual(['W:\\a\\1.mp4'])
  })
})

describe('materialLoadSummary（两入口共用同一份反馈）', () => {
  it('算法有筛选：明示收集→匹配与新增个数', () => {
    expect(materialLoadSummary(500, 44, 44, 0, 500))
      .toBe('已按重复度筛选：素材 500 个 → 匹配 44 个；新增 44 个')
  })

  it('无筛选小文件夹：只报新增', () => {
    expect(materialLoadSummary(12, 12, 12, 0, 500)).toBe('新增 12 个')
  })

  it('再次操作同文件夹：匹配不变新增为 0 → 明示均已在清单中', () => {
    expect(materialLoadSummary(500, 44, 0, 0, 500))
      .toBe('已按重复度筛选：素材 500 个 → 匹配 44 个；所选素材均已在清单中')
  })

  it('上限截断明示未导入个数', () => {
    expect(materialLoadSummary(500, 100, 20, 80, 500))
      .toBe('已按重复度筛选：素材 500 个 → 匹配 100 个；新增 20 个；素材已达上限（500），80 个未导入')
  })

  it('匹配 0 个给出可操作出路（分镜脚本/景别关键词/全部选择档）', () => {
    const msg = materialLoadSummary(500, 0, 0, 0, 500)
    expect(msg).toContain('已按重复度筛选：素材 500 个 → 匹配 0 个')
    expect(msg).toContain('全部选择')
  })
})

describe('montageProjectIdNow（项目目录=时间戳标识，2026-11-06 用户裁决）', () => {
  it('格式为 yyyyMMdd-HHmmss-<4hex>，同刻两次生成不碰撞', () => {
    const id = montageProjectIdNow(new Date(2026, 10, 6, 18, 45, 30))
    expect(id).toMatch(/^20261106-184530-[0-9a-f]{4}$/)
    const other = montageProjectIdNow(new Date(2026, 10, 6, 18, 45, 30))
    expect(other).not.toBe(id)
  })

  it('时间戳可排序：晚生成的时间前缀字典序更大', () => {
    const a = montageProjectIdNow(new Date(2026, 10, 6, 9, 0, 0)).slice(0, 15)
    const b = montageProjectIdNow(new Date(2026, 10, 6, 10, 0, 0)).slice(0, 15)
    expect(b > a).toBe(true)
  })
})

describe('projectIdentityOf（项目身份=本轮生成口径 product_desc）', () => {
  it('有产品按产品，无产品按提示词（与 genVoiceoverCandidates 同口径）', () => {
    expect(projectIdentityOf('雪地摩托车 航拍', '品牌A 型号B')).toBe('品牌A 型号B')
    expect(projectIdentityOf('雪地摩托车 航拍', '')).toBe('雪地摩托车 航拍')
  })

  it('两端去重空白；同身份恒等（签名不变=同一项目）', () => {
    expect(projectIdentityOf('  提示词  ', '  ')).toBe('提示词')
    expect(projectIdentityOf('提示词', '产品')).toBe(projectIdentityOf(' 提示词 ', ' 产品 '))
  })
})

describe('批次持久化记录（2026-11-06 裁决：恢复按项目身份校验）', () => {
  const row = { idx: 1, name: 'c1.mp4', sourceName: 'a.mp4', startSec: 0, endSec: 3, duration: 3, description: '', analysis: '', serverPath: '/montage/splits/c1.mp4' }

  it('本项目签名一致 → 完整恢复 src 与有效池行', () => {
    const raw = serializeMaterialBatch({ sig: '产品A', src: ['W:\\a\\1.mp4'], pool: [row] })
    const rec = parseMaterialBatch(raw, '产品A')
    expect(rec).not.toBeNull()
    expect(rec!.src).toEqual(['W:\\a\\1.mp4'])
    expect(rec!.pool).toHaveLength(1)
  })

  it('异项目签名 → null（调用方丢弃记录，不得复活到清单）', () => {
    const raw = serializeMaterialBatch({ sig: '产品A', src: ['W:\\a\\1.mp4'], pool: [row] })
    expect(parseMaterialBatch(raw, '产品B')).toBeNull()
  })

  it('HEAD 旧格式（无签名裸数组）与损坏 JSON → null', () => {
    expect(parseMaterialBatch(JSON.stringify(['W:\\a\\1.mp4']), '产品A')).toBeNull()
    expect(parseMaterialBatch('{broken', '产品A')).toBeNull()
    expect(parseMaterialBatch('', '产品A')).toBeNull()
  })

  it('无效池行（缺 idx/三种定位皆无）被过滤；空 src 项被过滤', () => {
    const badRow = { idx: null, name: 'x' }
    const ghostRow = { idx: 2, name: 'y', sourceName: 'b.mp4', startSec: 0, endSec: 1, duration: 1, description: '', analysis: '' }
    const raw = serializeMaterialBatch({ sig: '产品A', src: ['W:\\a\\1.mp4', '', 3 as unknown as string], pool: [row, badRow, ghostRow] })
    const rec = parseMaterialBatch(raw, '产品A')
    expect(rec!.src).toEqual(['W:\\a\\1.mp4'])
    expect(rec!.pool).toHaveLength(1)
    expect(rec!.pool[0]!.idx).toBe(1)
  })
})
