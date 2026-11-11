// align-row — 对齐与分布段(2026-11-11 R17 用户裁决「和 PhotoCraft 一比一复制;对齐点了不起作用」)。
// 规格源=crates/ui-egui/src/panels/layer_props_ui.rs:
// · align_glyph(:144-181): 参考线(stroke 1.2)+两根不等长实心条(10/6 与 3 宽),六种 kind 几何逐项对齐;
//   纵向参考线 kind(left/center/right)=竖线 x∈{c−6,c,c+6} + 横条 dy∈{−3,+3}(左端锚 x / 右端锚 x−w / 居中锚 x−w/2);
//   横向参考线 kind(top/vcenter/bottom)=横线 y∈{c−6,c,c+6} + 竖条 dx∈{−3,+3}(顶端锚 y / 底端锚 y−h / 居中锚 y−h/2);
// · align_and_distribute(:273-311): 单行六个 24×24 按钮、间距 2、第三枚后 8px;hover=token.hover;
//   enabled=token.icon / disabled=token.text_faint;分布=两个纯文本按钮(水平/垂直),≥3 选中才可用;
// · ProMedium tokens(:225-244): icon #E2E2E2 / text_faint #A0A0A0 / hover #626262 / field #454545 / field_border #686868 / text #EEEEEE。
// 动作层:对齐/分布一律点击时现场量 DOM(不吃面板 memo 快照——memo 测量提交前跑,天然慢一拍);
// 文字层写 styles.dx/dy、自由图片层写 x/y、槽位写 styles.dx/dy;锁定层跳过。
import React from 'react'
import { getTemplate } from '../registry'
import { compRectRef, layerEl } from './canvas-geom'
import { lockedOf } from './image-ops'
import { useEditor } from './store'

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'

type Kind = 'leftEdges' | 'horizontalCenters' | 'rightEdges' | 'topEdges' | 'verticalCenters' | 'bottomEdges'

const KINDS: ReadonlyArray<{ kind: Kind; mode: AlignMode; title: string }> = [
  { kind: 'leftEdges', mode: 'left', title: '左对齐画布' },
  { kind: 'horizontalCenters', mode: 'centerX', title: '水平居中画布' },
  { kind: 'rightEdges', mode: 'right', title: '右对齐画布' },
  { kind: 'topEdges', mode: 'top', title: '顶对齐画布' },
  { kind: 'verticalCenters', mode: 'centerY', title: '垂直居中画布' },
  { kind: 'bottomEdges', mode: 'bottom', title: '底对齐画布' },
]

/** 图标小钮(字符/段落面板沿用;24×22,active=#242424 底 #378EF0 字) */
export function IconBtn({ children, onClick, disabled, active, title }: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title: string
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 24, height: 22, border: 0, borderRadius: 3, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? '#242424' : 'transparent',
        color: disabled ? '#808080' : active ? '#378EF0' : '#C8C8C8',
      }}
    >
      {children}
    </button>
  )
}

/** PhotoCraft align_glyph 1:1(24×24 viewBox;坐标=layer_props_ui.rs:144-181 逐项换算) */
function AlignGlyph({ kind, on }: { kind: Kind; on: boolean }): React.ReactElement {
  const color = on ? '#E2E2E2' : '#A0A0A0'
  const verticalRef = kind === 'leftEdges' || kind === 'horizontalCenters' || kind === 'rightEdges'
  if (verticalRef) {
    const x = kind === 'leftEdges' ? 6 : kind === 'rightEdges' ? 18 : 12
    const x0a = kind === 'leftEdges' ? x : kind === 'rightEdges' ? x - 10 : x - 5
    const x0b = kind === 'leftEdges' ? x : kind === 'rightEdges' ? x - 6 : x - 3
    return (
      <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
        <line x1={x} y1={5} x2={x} y2={19} stroke={color} strokeWidth={1.2} />
        <rect x={x0a} y={7.5} width={10} height={3} fill={color} />
        <rect x={x0b} y={13.5} width={6} height={3} fill={color} />
      </svg>
    )
  }
  const y = kind === 'topEdges' ? 6 : kind === 'bottomEdges' ? 18 : 12
  const y0a = kind === 'topEdges' ? y : kind === 'bottomEdges' ? y - 10 : y - 5
  const y0b = kind === 'topEdges' ? y : kind === 'bottomEdges' ? y - 6 : y - 3
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
      <line x1={5} y1={y} x2={19} y2={y} stroke={color} strokeWidth={1.2} />
      <rect x={7.5} y={y0a} width={3} height={10} fill={color} />
      <rect x={13.5} y={y0b} width={3} height={6} fill={color} />
    </svg>
  )
}

/** 画布盒测量(现场量;compRectRef 由画布每次渲染回写) */
function measureBox(id: string): { left: number; top: number; w: number; h: number; scale: number } | null {
  const comp = compRectRef.current
  if (!comp || comp.width <= 0) return null
  const st = useEditor.getState()
  const tpl = getTemplate(st.templateId)
  const el = layerEl(id)
  if (!(el instanceof HTMLElement)) return null
  const scale = Math.max(comp.width / tpl.width, 0.05)
  const r = el.getBoundingClientRect()
  return { left: (r.left - comp.left) / scale, top: (r.top - comp.top) / scale, w: r.width / scale, h: r.height / scale, scale }
}

/** 六向对齐(选中的每一层各自对画布;PhotoCraft layer.align.* 语义) */
export function alignSelection(mode: AlignMode, ids: string[]): void {
  const st = useEditor.getState()
  const tpl = getTemplate(st.templateId)
  const horizontal = mode === 'left' || mode === 'centerX' || mode === 'right'
  for (const id of [...new Set(ids.filter(Boolean))]) {
    if (lockedOf(st.props, id)) continue
    const m = measureBox(id)
    if (!m) continue
    const goal = {
      left: 0, centerX: (tpl.width - m.w) / 2, right: tpl.width - m.w,
      top: 0, centerY: (tpl.height - m.h) / 2, bottom: tpl.height - m.h,
    }[mode]
    if (id.startsWith('img-')) {
      const layer = (st.props.customLayers as Array<{ id: string; x: number; y: number }> | undefined)?.find((l) => l.id === id)
      if (!layer) continue
      st.setCustomLayer(id, horizontal ? { x: Math.round(layer.x + (goal - m.left)) } : { y: Math.round(layer.y + (goal - m.top)) })
    } else {
      const look = (st.props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[id]
      st.setLayerStyle(id, horizontal ? { dx: Math.round((look?.dx ?? 0) + (goal - m.left)) } : { dy: Math.round((look?.dy ?? 0) + (goal - m.top)) })
    }
  }
}

/** 等距分布(PhotoCraft layer.distribute.* 语义;≥3 层:首尾钉住,中间层等间距) */
export function distributeSelection(axis: 'h' | 'v', ids: string[]): boolean {
  const st = useEditor.getState()
  const items = [...new Set(ids.filter(Boolean))]
    .map((id) => ({ id, m: measureBox(id), locked: lockedOf(st.props, id) }))
    .filter((v): v is { id: string; m: NonNullable<ReturnType<typeof measureBox>>; locked: boolean } => Boolean(v.m) && !v.locked)
  if (items.length < 3) return false
  const start = (b: { left: number; top: number }): number => (axis === 'h' ? b.left : b.top)
  const size = (b: { w: number; h: number }): number => (axis === 'h' ? b.w : b.h)
  items.sort((a, b) => start(a.m) - start(b.m))
  const first = items[0]!
  const last = items[items.length - 1]!
  const span = start(last.m) + size(last.m) - start(first.m)
  const sum = items.reduce((s, v) => s + size(v.m), 0)
  const gap = (span - sum) / (items.length - 1)
  let cursor = start(first.m)
  for (const v of items) {
    const delta = Math.round(cursor - start(v.m))
    if (delta !== 0) {
      if (v.id.startsWith('img-')) {
        const layer = (st.props.customLayers as Array<{ id: string; x: number; y: number }> | undefined)?.find((l) => l.id === v.id)
        if (layer) st.setCustomLayer(v.id, axis === 'h' ? { x: layer.x + delta } : { y: layer.y + delta })
      } else {
        const look = (st.props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[v.id]
        st.setLayerStyle(v.id, axis === 'h' ? { dx: (look?.dx ?? 0) + delta } : { dy: (look?.dy ?? 0) + delta })
      }
    }
    cursor += size(v.m) + gap
  }
  return true
}

/** 对齐与分布段(PhotoCraft 1:1:六图标行 + 水平/垂直文本按钮) */
export function AlignButtons({ ids, onAlign, disabled }: {
  ids: string[]
  onAlign: (mode: AlignMode) => void
  disabled?: boolean
}): React.ReactElement {
  const [hover, setHover] = React.useState<Kind | null>(null)
  const distOn = Boolean(!disabled && ids.filter(Boolean).length >= 3)
  const distBtn = (axis: 'h' | 'v', label: string): React.ReactElement => (
    <button
      onClick={() => { if (distOn) distributeSelection(axis, ids) }}
      disabled={!distOn}
      title={distOn ? `${label}等距分布选中图层` : `${label}分布(需 ≥3 个选中图层)`}
      style={{
        height: 20, padding: '0 10px', borderRadius: 3, fontSize: 12, cursor: distOn ? 'pointer' : 'default',
        background: '#454545', border: '1px solid #686868', color: distOn ? '#EEEEEE' : '#A0A0A0',
      }}
    >{label}</button>
  )
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {KINDS.map(({ kind, mode, title }, i) => (
          <React.Fragment key={kind}>
            {i === 3 ? <span style={{ width: 8, flexShrink: 0 }} /> : null}
            <button
              title={title}
              disabled={disabled}
              onClick={() => onAlign(mode)}
              onMouseEnter={() => setHover(kind)}
              onMouseLeave={() => setHover((h) => (h === kind ? null : h))}
              style={{
                width: 24, height: 24, padding: 0, border: 0, borderRadius: 3,
                background: !disabled && hover === kind ? '#626262' : 'transparent',
                cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginRight: i === KINDS.length - 1 ? 0 : 2,
              }}
            >
              <AlignGlyph kind={kind} on={!disabled} />
            </button>
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
        {distBtn('h', '水平')}
        {distBtn('v', '垂直')}
      </div>
    </div>
  )
}
