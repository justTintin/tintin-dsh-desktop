// 横竖屏双模式回归矩阵(2026-11-12 用户裁决:默认竖屏 + 切换比例迁移 + 两模式效果一致;
// 同日晚批:图片层迁移语义按种类分派——背景组统一比例居中,其余层丢弃显式 height
// 重链接纵横比,根因=显式 height 按 wr/hr 各自映射把盒子长宽比翻转≈3倍=渲染拉伸变形):
// · 默认模板=video-portrait(方案B);
// · setOrientation 迁移:customLayers x/y/width(普通层 height 丢弃)、styles dx/dy/sx/sy、参考线、选中线;
// · 往返(video→portrait→video)漂移≤2px(两次 Math.round 的取整上界;图片层 height 不再往返保持);
// · setTemplate=换文档,参考线作废;setOrientation=同文档迁移,参考线保留;
// · 参考线建线夹取语义两模板一致(addUserGuide 按当前模板界限拒绝越界)。
import { describe, expect, it, beforeEach } from 'vitest'
import { useEditor } from '../src/editor/store'
import { getTemplate } from '../src/registry'

const S = () => useEditor.getState()

describe('默认竖屏(方案B)', () => {
  it('编辑器初始模板=video-portrait', () => {
    expect(S().templateId).toBe('video-portrait')
  })
})

describe('setOrientation 比例迁移(方案1)', () => {
  beforeEach(() => {
    S().setTemplate('video')
    const s = S()
    useEditor.setState({
      props: {
        ...s.props,
        customLayers: [
          { id: 'img-a', image: 'a.png', x: 1150, y: 650, width: 360, height: 120 },
          { id: 'img-bg', image: 'bg.png', x: 0, y: 0, width: 1280, height: 720, group: 'environment' },
        ],
        styles: { title: { dx: 100, dy: 50, sx: 1.2, sy: 1.2 }, subtitle: { dy: -30 } },
        layerOrder: [...getTemplate('video').layerDefs.map((l) => l.id), 'img-a', 'img-bg'],
      },
      userGuides: { h: [600, 610], v: [1200] },
      selectedGuide: { axis: 'h', pos: 600 },
    })
  })

  it('video→video-portrait:普通层几何按比例落位+显式 height 重链接;背景组统一比例居中', () => {
    S().setOrientation('portrait')
    const s = S()
    expect(s.templateId).toBe('video-portrait')
    const ls = s.props.customLayers as Array<{ id: string; x: number; y: number; width: number; height?: number; group?: string }>
    const l = ls.find((x) => x.id === 'img-a')!
    // wr=1080/1280=0.84375, hr=1440/720=2.0;x 轴量跟 wr、y 轴量跟 hr;height 丢弃(重链接)
    expect(l.x).toBe(Math.round(1150 * 0.84375)) // 970
    expect(l.y).toBe(650 * 2) // 1300
    expect(l.width).toBe(Math.round(360 * 0.84375)) // 304
    expect(l.height).toBeUndefined()
    const bg = ls.find((x) => x.id === 'img-bg')!
    // s=max(0.84375,2)=2:统一比例(盒子纵横比 1280/720 不变=不变形),画布居中
    expect(bg.width).toBe(2560)
    expect(bg.height).toBe(1440)
    expect(bg.x).toBe(Math.round((1080 - 2560) / 2)) // -740
    expect(bg.y).toBe(0)
    const styles = s.props.styles as Record<string, { dx?: number; dy?: number; sx?: number; sy?: number }>
    expect(styles.title!.dx).toBe(Math.round(100 * 0.84375)) // 84
    expect(styles.title!.dy).toBe(50 * 2) // 100
    expect(styles.title!.sx).toBe(1.013) // 1.2×0.84375=1.0125→clampScale 三位小数
    expect(styles.title!.sy).toBe(2.4) // 1.2×2
    expect(styles.subtitle!.dy).toBe(-30 * 2)
    expect(s.userGuides.v).toEqual([Math.round(1200 * 0.84375)]) // 1013
    expect(s.userGuides.h).toEqual([1200, 1220]) // 两线映射后不撞线=都保留
    expect(s.selectedGuide).toEqual({ axis: 'h', pos: 1200 })
  })

  it('往返 video→portrait→video 漂移≤2px(图片层 height 例外:重链接后为 undefined)', () => {
    const before = {
      layer: { x: 1150, y: 650, width: 360 },
      dx: 100, dy: 50, guideV: 1200, guideH: 600,
    }
    S().setOrientation('portrait')
    S().setOrientation('landscape')
    const s = S()
    const ls = s.props.customLayers as Array<{ id: string; x: number; y: number; width: number; height?: number }>
    const l = ls.find((x) => x.id === 'img-a')!
    expect(Math.abs(l.x - before.layer.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(l.y - before.layer.y)).toBeLessThanOrEqual(2)
    expect(Math.abs(l.width - before.layer.width)).toBeLessThanOrEqual(2)
    expect(l.height).toBeUndefined()
    const bg = ls.find((x) => x.id === 'img-bg')!
    // 背景组统一比例往返不保尺寸(居中语义不可逆),但纵横比必须不变=永不变形
    expect(bg.width / bg.height).toBeCloseTo(1280 / 720, 1)
    const styles = s.props.styles as Record<string, { dx?: number; dy?: number }>
    expect(Math.abs(styles.title!.dx! - before.dx)).toBeLessThanOrEqual(2)
    expect(Math.abs(styles.title!.dy! - before.dy)).toBeLessThanOrEqual(2)
    expect(Math.abs(s.userGuides.v[0]! - before.guideV)).toBeLessThanOrEqual(2)
    expect(Math.abs(s.userGuides.h[0]! - before.guideH)).toBeLessThanOrEqual(2)
  })

  it('映射撞线合并:两条近线映射到同一点只留一条', () => {
    // 100→200, 100.2→round(200.4)=200:映射后 <0.5 合并
    useEditor.setState({ userGuides: { h: [100, 100.2], v: [] }, selectedGuide: null })
    S().setOrientation('portrait')
    expect(S().userGuides.h).toHaveLength(1)
  })

  it('夹取兜底:越界参考线映射后夹进新画布', () => {
    // 直接注入越界态(等价旧版遗留数据),迁移必须夹回界限内
    useEditor.setState({ userGuides: { h: [720], v: [1280] }, selectedGuide: null })
    S().setOrientation('portrait')
    const s = S()
    expect(s.userGuides.h[0]).toBeLessThanOrEqual(getTemplate('video-portrait').height)
    expect(s.userGuides.v[0]).toBeLessThanOrEqual(getTemplate('video-portrait').width)
  })
})

describe('文档域语义:setTemplate 清参考线,setOrientation 保留', () => {
  it('setTemplate(换模板/项目)参考线与选中作废', () => {
    S().setTemplate('video')
    S().addUserGuide('h', 300)
    useEditor.setState({ selectedGuide: { axis: 'h', pos: 300 }, multiSelected: ['img-x'] })
    S().setTemplate('cover')
    const s = S()
    expect(s.userGuides).toEqual({ h: [], v: [] })
    expect(s.selectedGuide).toBeNull()
    expect(s.multiSelected).toEqual([])
  })

  it('setOrientation(同文档)参考线保留(已迁移)', () => {
    S().setTemplate('video')
    S().addUserGuide('h', 300)
    S().setOrientation('portrait')
    expect(S().userGuides.h).toEqual([600])
    expect(S().templateId).toBe('video-portrait')
  })
})

describe('参考线建线夹取两模板语义一致', () => {
  it('越界拒绝、界限内接受(video 720 / portrait 1440 各自成立)', () => {
    S().setTemplate('video')
    expect(S().addUserGuide('h', 721)).toBeUndefined()
    expect(S().userGuides.h).toEqual([])
    S().addUserGuide('h', 720)
    expect(S().userGuides.h).toEqual([720])
    S().setOrientation('portrait')
    expect(S().addUserGuide('h', 1441)).toBeUndefined()
    expect(S().userGuides.h).toEqual([720 * 2]) // 旧线已迁移至 1440=新界限
    S().addUserGuide('h', 1440)
    expect(S().userGuides.h).toEqual([1440]) // 1440 与迁移线重合→addUserGuide 去重
  })
})
