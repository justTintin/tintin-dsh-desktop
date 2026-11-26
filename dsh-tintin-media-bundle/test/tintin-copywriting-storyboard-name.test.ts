// test/tintin-copywriting-storyboard-name.test.ts — 分镜 tab 名·保存回学规则回归
// 2026-09-25 用户报障「脚本已保存 tab 还叫脚本 1」后裁决：保存成功后 tab 名
// 回学选题——仍是默认「脚本N」才回学，用户双击重命名过的名字保留。
// 源项目（SRC useCopywritingMontageStep3Voice.ts:989 同款）保存也不回学名，
// 本规则为两边之上的新裁决。
import { describe, expect, it } from 'vitest'
import {
  isAutoStoryboardName,
  storyboardNameAfterSave,
  storyboardDatePrefix,
  datedStoryboardName,
  copyHeadName,
  cloneDisplayProgress,
} from '../src/composables/copywritingMontageStep3VoiceLogic'

describe('isAutoStoryboardName（默认「脚本N」判定）', () => {
  it('脚本1/脚本12 命中；含内嵌空格的「脚本 1」按既有正则属用户命名不命中', () => {
    expect(isAutoStoryboardName('脚本1')).toBe(true)
    expect(isAutoStoryboardName('脚本12')).toBe(true)
    expect(isAutoStoryboardName(' 脚本3 ')).toBe(true) // 首尾空白 trim 后命中
    expect(isAutoStoryboardName('脚本 1')).toBe(false) // 内嵌空格≠自增默认名（保守：视为用户命名不覆盖）
    expect(isAutoStoryboardName('261126 13:45 脚本3')).toBe(true) // YYMMDD HH:mm 前缀（2026-11-26 用户裁决：去 20 从 26 起）
    expect(isAutoStoryboardName('20261126 13:45 脚本3')).toBe(true) // YYYYMMDD HH:mm 前缀（同日上一版形态仍命中）
    expect(isAutoStoryboardName('2026-11-26 13:45 脚本3')).toBe(true) // 旧连字符形态（历史 tab）仍命中
  })

  it('用户重命名/选题名/空值 不命中', () => {
    expect(isAutoStoryboardName('卫衣上新')).toBe(false)
    expect(isAutoStoryboardName('分镜脚本_20260924_1529')).toBe(false)
    expect(isAutoStoryboardName('20261126 13:45 目前全球AI领域')).toBe(false) // 文案头名=用户可读名不覆盖
    expect(isAutoStoryboardName('脚本一')).toBe(false)
    expect(isAutoStoryboardName('')).toBe(false)
  })
})

describe('storyboardNameAfterSave（保存回学规则）', () => {
  const topic = '分镜脚本_20260924_1529'

  it('默认名「脚本N」→ 回学选题', () => {
    expect(storyboardNameAfterSave('脚本1', topic)).toBe(topic)
    expect(storyboardNameAfterSave('脚本10', topic)).toBe(topic)
    expect(storyboardNameAfterSave('2026-11-26 13:45 脚本3', topic)).toBe(topic)
  })

  it('用户重命名过 → 保留不覆盖', () => {
    expect(storyboardNameAfterSave('卫衣上新', topic)).toBe('卫衣上新')
  })

  it('选题为空/全空白 → 维持原名（含默认名）', () => {
    expect(storyboardNameAfterSave('脚本1', '')).toBe('脚本1')
    expect(storyboardNameAfterSave('脚本1', '   ')).toBe('脚本1')
    expect(storyboardNameAfterSave('卫衣上新', '')).toBe('卫衣上新')
  })

  it('选题两端空白被裁掉后回学', () => {
    expect(storyboardNameAfterSave('脚本2', `  ${topic}  `)).toBe(topic)
  })
})

describe('datedStoryboardName（分镜脚本名默认日期开头）', () => {
  const d = new Date(2026, 10, 26, 13, 45)
  it('日期前缀 YYMMDD HH:mm（2026-11-26 用户两连裁：去连字符、年份去「20」从 26 起精确到分钟）', () => {
    expect(storyboardDatePrefix(d)).toBe('261126 13:45')
    expect(datedStoryboardName('脚本1', d)).toBe('261126 13:45 脚本1')
    expect(datedStoryboardName('价格冲击式', d)).toBe('261126 13:45 价格冲击式')
    expect(datedStoryboardName('目前全球AI领域', d)).toBe('261126 13:45 目前全球AI领域')
  })
  it('已有日期或服务端选题形态不重复加', () => {
    expect(datedStoryboardName('261126 13:45 脚本1', d)).toBe('261126 13:45 脚本1')
    expect(datedStoryboardName('20261126 13:45 脚本1', d)).toBe('20261126 13:45 脚本1') // 全日期形态不重加
    expect(datedStoryboardName('2026-11-26 13:45 脚本1', d)).toBe('2026-11-26 13:45 脚本1') // 旧形态不重加
    expect(datedStoryboardName('分镜脚本_20261126_1200', d)).toBe('分镜脚本_20261126_1200')
    expect(datedStoryboardName('', d)).toBe('')
  })
})

describe('copyHeadName（2026-11-26 用户裁决：tab 名尾=文案开头 5-10 字替代「输入文案」）', () => {
  it('取前 10 字、尾端标点裁掉', () => {
    expect(copyHeadName('目前全球AI领域，封锁与反制是公认的两大核心态势')).toBe('目前全球AI领域')
    expect(copyHeadName('2026年10月22日，就舆论热议AI伦理的一个间隙。后续……')).toBe('2026年10月22日')
  })
  it('短文案全取；空白剥离；空值返回空（调用方回落脚本N 自增）', () => {
    expect(copyHeadName('降价了')).toBe('降价了')
    expect(copyHeadName('  多段\n空白　文案开头这里  ')).toBe('多段空白文案开头这里')
    expect(copyHeadName('')).toBe('')
    expect(copyHeadName('   ')).toBe('')
  })
  it('正好 10 字不裁标点、超长截断不加省略号', () => {
    expect(copyHeadName('一二三四五六七八九十')).toBe('一二三四五六七八九十')
    expect(copyHeadName('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghij')
  })
})

describe('cloneDisplayProgress（克隆进度显示值：真实完成率 vs 时间爬升取大）', () => {
  it('批次开局首条合成期间按轮次爬升，封顶在进行中那条的 90% 位', () => {
    // 5 条批次（done=0）：每轮 +1%，封顶 18%（(0+0.9)/5）
    expect(cloneDisplayProgress(0, 0, 5)).toBe(1)
    expect(cloneDisplayProgress(10, 0, 5)).toBe(11)
    expect(cloneDisplayProgress(17, 0, 5)).toBe(18)
    expect(cloneDisplayProgress(18, 0, 5)).toBe(18) // 封顶不再上涨
    expect(cloneDisplayProgress(50, 0, 5)).toBe(18) // 上一批遗留值被压回封顶
  })
  it('真实完成一到即被真实值覆盖，不虚报', () => {
    expect(cloneDisplayProgress(18, 1, 5)).toBe(20) // 首条完成→真实 20%
    expect(cloneDisplayProgress(20, 1, 5)).toBe(21) // 封顶 38% 内继续爬升
  })
})

  it('全部完成=真实 100%；total=0 不炸', () => {
    expect(cloneDisplayProgress(88, 5, 5)).toBe(100)
    expect(cloneDisplayProgress(0, 0, 0)).toBe(1)
  })
