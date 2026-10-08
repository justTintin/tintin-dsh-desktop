// test/tintin-montage-clip-binding.test.ts — 分镜素材绑定随脚本跨机同步·纯函数回归
// （2026-09-29 A′：clip_groups 附加字段随 shots 上传，服务端存储原样透传已实测
//  script_1cafea8187bc；本测试锁定编解码容错口径）
import { describe, expect, it } from 'vitest'
import {
  clipGroupsFromMaterialIds,
  clipGroupsFromScriptShots,
  decodeClipGroups,
  encodeClipGroups,
} from '../src/composables/copywritingMontageClipBindingLogic'

const pool = [
  { idx: 1, serverPath: 'material://7', duration: 3.5, mediaType: 'image' as const },
  { idx: 2, serverPath: '/montage/splits/job_a/clip_001.mp4', duration: 4 },
  { idx: 3, serverPath: '', duration: 9 }, // 无标识行：编码时跳过
]

describe('encodeClipGroups（保存侧：下标组 → 实体标识组）', () => {
  it('按下标映射 serverPath/duration/mediaType，空组保留为空数组', () => {
    expect(encodeClipGroups([[2, 1], [], [1]], pool)).toEqual([
      [
        { ref: '/montage/splits/job_a/clip_001.mp4', duration: 4 },
        { ref: 'material://7', duration: 3.5, mediaType: 'image' },
      ],
      [],
      [{ ref: 'material://7', duration: 3.5, mediaType: 'image' }],
    ])
  })

  it('池中缺失的下标与无 serverPath 行跳过该段；空输入 → 空数组', () => {
    expect(encodeClipGroups([[99, 3]], pool)).toEqual([[]])
    expect(encodeClipGroups([], pool)).toEqual([])
  })
})

describe('decodeClipGroups（恢复侧：详情 shots[].clip_groups → 绑定段）', () => {
  it('合法嵌套原样恢复，duration 非正数钳 0，media_type 下划线字段兼容', () => {
    expect(decodeClipGroups([
      [{ ref: 'material://7', duration: 3.5, media_type: 'image' }],
      [{ ref: '/a/b.mp4', duration: -2 }, { ref: '', duration: 5 }, 'junk'],
    ])).toEqual([
      [{ ref: 'material://7', duration: 3.5, mediaType: 'image' }],
      [{ ref: '/a/b.mp4', duration: 0 }],
    ])
  })

  it('容错：非数组/段非对象/空 ref 段丢弃', () => {
    expect(decodeClipGroups(undefined)).toEqual([])
    expect(decodeClipGroups('x')).toEqual([])
    expect(decodeClipGroups([null, 'x', [{ ref: 'a' }]])).toEqual([[], [], [{ ref: 'a', duration: 0 }]])
  })
})

describe('clipGroupsFromScriptShots（详情 shots → 逐镜提取，与 normalizeShot 对齐）', () => {
  it('逐镜取 clip_groups（单组=段数组），缺失镜为空组；shots 非数组 → 空', () => {
    const shots = [
      { index: 1, clip_groups: [{ ref: 'material://7', duration: 2 }] },
      { index: 2 },
    ]
    expect(clipGroupsFromScriptShots(shots)).toEqual([
      [{ ref: 'material://7', duration: 2 }],
      [],
    ])
    expect(clipGroupsFromScriptShots(null)).toEqual([])
  })
})

describe('clipGroupsFromMaterialIds（2026-10-06 仿视频桥接：material_id 兜底）', () => {
  it('clip_groups 有段的镜原样保留；无段镜用 material_id>0 构造 material:// 单段（duration=镜标）', () => {
    const shots = [
      { material_id: 41, duration: 3 },
      { material_id: 0, duration: 3 },
      { material_id: 42, duration: 0 },
    ]
    const groups = [[{ ref: '/split/a_0.mp4', duration: 2.5 }], [], []]
    expect(clipGroupsFromMaterialIds(shots, groups)).toEqual([
      [{ ref: '/split/a_0.mp4', duration: 2.5 }],
      [],
      [{ ref: 'material://42', duration: 0 }],
    ])
  })

  it('material_id 非正整数（0/null/缺失）保持空组', () => {
    expect(clipGroupsFromMaterialIds([{ material_id: 0 }, {}, { material_id: null as unknown as number }], [])).toEqual([[], [], []])
  })
})
