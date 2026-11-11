// text-properties — 文字层属性面板(2026-11-11 R11,用户裁决「1比1复制 PhotoCraft 字符操作」;
// 参照系=crates/ui-egui/src/panels/properties.rs + layer_props_ui.rs + type_panels_ui.rs):
// · 变换段: W[px](文本框宽,可改=换行约束)/H[px](随内容,只读)/X[px]/Y[px](画布绝对位,改=平移 dx/dy);
//   W-H 链接钮(文字层 H 随内容,禁用);字段=24px field 底/边框/圆角 3,mono 数字+px 后缀;
// · 对齐与分布段: 六向对齐(相对画布,与画布对齐工具条同数学)+水平/垂直分布段钮
//   (分布需 ≥3 选中对象,面板单选语义=禁用);图标=Lucide 路径逐字(assets/icons);
// · 字符段: 字体/样式下拉(既有组件重排)+字号 pt(基准×scale,live 跟随画布拖动)/
//   行距 px(模板默认=placeholder「默认」)/字距 px/基线偏移 px/水平缩放 %/垂直缩放 %/
//   颜色=单色块(替代色板,点击取色)/大小写四钮(text-transform);
// · 段落段: 左/居中/右/两端对齐(text-align,继承到逐行子节点);
// · 图层样式段: 投影/描边(既有功能收编)。
// 数据全部走 styles[layerId](layerStyle 输出直投模板节点);字段留空=还原模板默认。
import React from 'react'
import { FontFamilyPicker, FontStylePicker } from './font-picker'
import { getTemplate } from '../registry'
import { BLEND_MODES } from '../../templates/image-style'
import { canvasBoxIn, compRectRef } from './canvas-geom'
import { liveLayer, liveLayerSnapshot, subscribeLiveLayer } from './ui'
import { useEditor } from './store'
import {
  IconAlignCenter, IconAlignJustify, IconAlignLeft, IconAlignRight,
  IconChevronDown, IconDistributeHorizontal, IconDistributeVertical,
  IconLink2,
} from './layer-icons'
import { AlignButtons, IconBtn } from './align-row'

const PC = {
  field: '#242424',
  fieldBorder: '#4A4A4A',
  text: '#DEDEDE',
  textDim: '#B2B2B2',
  textFaint: '#808080',
  icon: '#C8C8C8',
  accent: '#378EF0',
  separator: '#1E1E1E',
} as const

const FIELD: React.CSSProperties = {
  height: 24, background: PC.field, color: PC.text, border: `1px solid ${PC.fieldBorder}`,
  borderRadius: 3, fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace', outline: 'none',
}

/** 数值字段: 焦点内本地草稿,Enter/失焦提交,Esc 还原;placeholder=模板默认 */
function NumField({ value, placeholder, suffix, onCommit, min, max, disabled, title }: {
  value: number | undefined
  placeholder?: string
  suffix: string
  onCommit: (v: number | undefined) => void
  min?: number
  max?: number
  disabled?: boolean
  title?: string
}): React.ReactElement {
  const [draft, setDraft] = React.useState<string | null>(null)
  const shown = draft ?? (value === undefined ? '' : String(value))
  const commit = (): void => {
    if (draft === null) return
    const t = draft.trim()
    setDraft(null)
    if (!t) { onCommit(undefined); return }
    const v = Number(t)
    if (!Number.isFinite(v)) return
    onCommit(Math.round(Math.min(max ?? 99999, Math.max(min ?? -99999, v)) * 10) / 10)
  }
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        title={title}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); return }
          if (e.key === 'Escape') { setDraft(null); e.stopPropagation() }
        }}
        style={{ ...FIELD, width: '100%', padding: '0 24px 0 8px', cursor: disabled ? 'default' : 'text' }}
      />
      <span style={{ position: 'absolute', right: 6, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace', color: PC.textFaint, pointerEvents: 'none' }}>{suffix}</span>
    </div>
  )
}

/** 段标题(折叠头,照 properties.rs 段行) */
function SectionHead({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }): React.ReactElement {
  return (
    <div
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 2px 5px', cursor: 'pointer', userSelect: 'none' }}
    >
      <span style={{ display: 'flex', color: PC.textDim }}><IconChevronDown size={13} /></span>
      <span style={{ fontSize: 12, fontWeight: 600, color: PC.text }}>{label}</span>
    </div>
  )
}

/** 带前缀小图标的字段行(字号 T↕ / 行距 A↕ / 字距 ↔ 等,字符面板字段族) */
function GlyphField({ glyph, children }: { glyph: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: PC.textDim, fontFamily: 'ui-monospace, Consolas, monospace', width: 24, textAlign: 'center', flexShrink: 0 }}>{glyph}</span>
      {children}
    </div>
  )
}

/** 文字层属性面板(替换 TextStyleEditor;数据=styles[layerId],layerStyle 直投模板节点) */
export function TextProperties({ layerId, baseFontSize, tplWidth }: { layerId: string; baseFontSize: number; tplWidth: number }): React.ReactElement {
  const tpl = getTemplate(useEditor((s) => s.templateId))
  type Sel = { dx?: number; dy?: number; scale?: number; gscale?: number; width?: number; lineHeight?: number; tracking?: number; hscale?: number; vscale?: number; baseline?: number; rotate?: number; caseTransform?: string; align?: string; font?: string; color?: string; weight?: number; italic?: boolean; locked?: boolean; shadow?: { dx: number; dy: number; blur: number; color: string }; stroke?: { width: number; color: string } }
  const styles = useEditor((s) => (s.props.styles as Record<string, Sel | undefined> | undefined)?.[layerId])
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const hiddenLayers = useEditor((s) => s.hiddenLayers)
  const selectedLayer = useEditor((s) => s.selectedLayer)
  const customLayers = useEditor((s) => s.props.customLayers) as Array<{ id: string; x: number; y: number }> | undefined
  const [open, setOpen] = React.useState({ transform: true, align: true, char: true, para: true })
  const toggle = (k: keyof typeof open): void => setOpen((o) => ({ ...o, [k]: !o[k] }))
  React.useSyncExternalStore(subscribeLiveLayer, liveLayerSnapshot)
  const live = liveLayer
  /* 投影/描边局部解构(类型收窄) */
  const shadow = styles?.shadow
  const stroke = styles?.stroke
  /* 视觉盒测量(画布 px): props/选择/直显通道任一变化即重测 */
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  React.useLayoutEffect(() => { force() }, [styles, selectedLayer, live.v])
  const measure = React.useMemo(() => {
    const el = document.querySelector(`[data-cover-layer="${layerId}"]`)
    const comp = compRectRef.current
    if (!(el instanceof HTMLElement) || !comp || comp.width <= 0) return null
    const scale = Math.max(comp.width / tplWidth, 0.05)
    const r = el.getBoundingClientRect()
    return { left: (r.left - comp.left) / scale, top: (r.top - comp.top) / scale, w: r.width / scale, h: r.height / scale }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId, tplWidth, styles, selectedLayer, live.v])
  const patch = (p: Record<string, unknown>): void => setLayerStyle(layerId, p)
  const num = (k: keyof NonNullable<typeof styles>): number | undefined => {
    const v = styles?.[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  }
  const setNum = (k: string) => (v: number | undefined): void => patch({ [k]: v })
  /* 变换 X/Y: 画布绝对位 → dx/dy 平移(锁层拒绝;与画布微调同一拒绝面) */
  const locked = styles?.locked === true
  const setPosX = (v: number | undefined): void => {
    if (v === undefined || !measure || locked) return
    patch({ dx: Math.round((styles?.dx as number ?? 0) + (v - measure.left)) })
  }
  const setPosY = (v: number | undefined): void => {
    if (v === undefined || !measure || locked) return
    patch({ dy: Math.round((styles?.dy as number ?? 0) + (v - measure.top)) })
  }
  /* 六向对齐(相对画布;与画布对齐工具条同数学,自测视觉盒) */
  const align = (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'): void => {
    if (!measure || locked) return
    const target = {
      left: 0, centerX: (tplWidth - measure.w) / 2, right: tplWidth - measure.w,
      top: 0, centerY: (tpl.height - measure.h) / 2, bottom: tpl.height - measure.h,
    }[mode]
    const horizontal = mode === 'left' || mode === 'centerX' || mode === 'right'
    const dx = styles?.dx as number ?? 0
    const dy = styles?.dy as number ?? 0
    if (horizontal) patch({ dx: Math.round(dx + (target - measure.left)) })
    else patch({ dy: Math.round(dy + (target - measure.top)) })
  }
  /* 字号 pt: 基准×scale;画布拖动中 live 跟随 */
  const scale = typeof styles?.scale === 'number' ? styles.scale : 1
  const gs = typeof styles?.gscale === 'number' ? styles.gscale : 1
  const px = live.scaleId === layerId ? live.scalePx : Math.round(baseFontSize * scale * gs)
  const setPt = (v: number | undefined): void => {
    if (v === undefined || v <= 0) return
    setLayerStyle(layerId, { scale: Math.min(3, Math.max(0.3, v / baseFontSize)) })
  }
  const fontFamily = typeof styles?.font === 'string' ? styles.font : undefined
  const color = typeof styles?.color === 'string' ? styles.color : '#ffffff'
  const caseT = typeof styles?.caseTransform === 'string' ? styles.caseTransform : undefined
  const alignT = typeof styles?.align === 'string' ? styles.align : undefined
  const look = styles as unknown as { blend?: string }
  const blendLabel = look?.blend && look.blend !== 'normal' ? (BLEND_MODES.find(([bid]) => bid === look.blend)?.[1] ?? look.blend) : null
  /* 段落对齐(text-align 继承到逐行子节点) */
  const setPara = (a: 'left' | 'center' | 'right' | 'justify'): void => patch({ align: alignT === a ? undefined : a })
  return (
    <div style={{ marginTop: 8 }}>
      {/* ── 变换 ── */}
      <SectionHead label="变换" open={open.transform} onToggle={() => toggle('transform')} />
      {open.transform ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: PC.textDim, width: 24, flexShrink: 0 }}>宽</span>
            <NumField value={typeof styles?.width === 'number' ? styles.width : measure?.w ? Math.round(measure.w) : undefined} suffix="px" min={20} max={4000} disabled={locked} title="文本框宽(改=换行约束)" onCommit={(v) => patch({ width: v })} />
            <span title="宽高链接(文字层高度随内容,禁用)" style={{ display: 'flex', color: PC.textFaint, flexShrink: 0 }}><IconLink2 size={13} /></span>
            <span style={{ fontSize: 11, color: PC.textDim, width: 16, flexShrink: 0 }}>高</span>
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <input
                value={measure ? Math.round(measure.h) : ''} readOnly disabled
                title="文字层高度随内容自动"
                style={{ ...FIELD, width: '100%', padding: '0 24px 0 8px', color: PC.textDim }}
              />
              <span style={{ position: 'absolute', right: 6, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace', color: PC.textFaint, pointerEvents: 'none' }}>px</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: PC.textDim, width: 24, flexShrink: 0 }}>X</span>
            <NumField value={measure ? Math.round(measure.left) : undefined} suffix="px" min={-2000} max={4000} disabled={locked} title={locked ? '图层已锁定位置' : '画布绝对 X'} onCommit={setPosX} />
            <span style={{ width: 13, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: PC.textDim, width: 16, flexShrink: 0 }}>Y</span>
            <NumField value={measure ? Math.round(measure.top) : undefined} suffix="px" min={-2000} max={4000} disabled={locked} title={locked ? '图层已锁定位置' : '画布绝对 Y'} onCommit={setPosY} />
          </div>
          {/* 角度: 画布旋转柄拆除(2026-11-11 用户裁决)后的旋转数字入口(styles.rotate,±180 钳位) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: PC.textDim, width: 24, flexShrink: 0 }}>角</span>
            <NumField value={num('rotate')} placeholder="0" suffix="°" min={-180} max={180} disabled={locked} title="旋转角度(度,顺时针为正;留空=0)" onCommit={setNum('rotate')} />
            <span style={{ width: 13, flexShrink: 0 }} />
          </div>
        </div>
      ) : null}
      {/* ── 对齐与分布 ── */}
      <SectionHead label="对齐与分布" open={open.align} onToggle={() => toggle('align')} />
      {open.align ? (
        <div style={{ paddingBottom: 4 }}>
          <AlignButtons onAlign={align} disabled={locked} />
          <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
            <button disabled title="水平分布(需 ≥3 个选中对象)" style={{ height: 22, flex: 1, border: `1px solid ${PC.fieldBorder}`, borderRadius: 3, background: PC.field, color: PC.textFaint, fontSize: 11, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <IconDistributeHorizontal size={13} /> 水平
            </button>
            <button disabled title="垂直分布(需 ≥3 个选中对象)" style={{ height: 22, flex: 1, border: `1px solid ${PC.fieldBorder}`, borderRadius: 3, background: PC.field, color: PC.textFaint, fontSize: 11, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <IconDistributeVertical size={13} /> 垂直
            </button>
          </div>
        </div>
      ) : null}
      {/* ── 字符 ── */}
      <SectionHead label="字符" open={open.char} onToggle={() => toggle('char')} />
      {open.char ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 4 }}>
          <FontFamilyPicker value={fontFamily} onChange={(f) => setLayerStyle(layerId, { font: f, weight: undefined, italic: undefined })} />
          {fontFamily ? (
            <FontStylePicker
              font={fontFamily}
              weight={typeof styles?.weight === 'number' ? styles.weight : undefined}
              italic={styles?.italic === true}
              onChange={(v) => setLayerStyle(layerId, v ? { weight: v.weight, italic: v.italic } : { weight: undefined, italic: undefined })}
            />
          ) : null}
          <div style={{ display: 'flex', gap: 6 }}>
            <GlyphField glyph="T↕">
              <NumField value={live.scaleId === layerId ? live.scalePx : px} suffix="pt" min={4} max={600} title="字号(画布拖角实时跟随)" onCommit={setPt} />
            </GlyphField>
            <GlyphField glyph="A↕">
              <NumField value={num('lineHeight')} placeholder="默认" suffix="pt" min={8} max={400} title="行距(留空=模板默认)" onCommit={setNum('lineHeight')} />
            </GlyphField>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <GlyphField glyph="↔">
              <NumField value={num('tracking')} placeholder="默认" suffix="px" min={-50} max={200} title="字距(留空=模板默认)" onCommit={setNum('tracking')} />
            </GlyphField>
            <GlyphField glyph="A↓">
              <NumField value={num('baseline')} placeholder="0" suffix="px" min={-200} max={200} title="基线偏移" onCommit={setNum('baseline')} />
            </GlyphField>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <GlyphField glyph="W%">
              <NumField value={num('hscale')} suffix="%" min={25} max={400} title="水平缩放" onCommit={setNum('hscale')} />
            </GlyphField>
            <GlyphField glyph="H%">
              <NumField value={num('vscale')} suffix="%" min={25} max={400} title="垂直缩放" onCommit={setNum('vscale')} />
            </GlyphField>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: PC.textDim, width: 24, flexShrink: 0 }}>颜色</span>
            <label title={color + '(点击取色)'} style={{ flex: 1, height: 24, borderRadius: 3, cursor: 'pointer', background: color, border: `1px solid ${PC.fieldBorder}`, position: 'relative', display: 'block' }}>
              <input type="color" value={color} onChange={(e) => setLayerStyle(layerId, { color: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            {[['原样', undefined], ['大写', 'uppercase'], ['小写', 'lowercase'], ['首大', 'capitalize']].map(([label, v]) => (
              <button
                key={label as string}
                title={'大小写:' + (label as string)}
                onClick={() => patch({ caseTransform: v as typeof caseT })}
                style={{
                  height: 22, flex: 1, border: `1px solid ${caseT === v ? PC.accent : PC.fieldBorder}`, borderRadius: 3,
                  background: caseT === v ? PC.field : 'transparent', color: caseT === v ? PC.accent : PC.text,
                  fontSize: 11, cursor: 'pointer', fontFamily: 'ui-monospace, Consolas, monospace',
                }}
              >{label === '原样' ? 'Aa' : label === '大写' ? 'TT' : label === '小写' ? 'tt' : 'Tt'}</button>
            ))}
          </div>
        </div>
      ) : null}
      {/* ── 段落 ── */}
      <SectionHead label="段落" open={open.para} onToggle={() => toggle('para')} />
      {open.para ? (
        <div style={{ display: 'flex', gap: 2, paddingBottom: 4 }}>
          <IconBtn title="左对齐" active={alignT === 'left' || alignT === undefined} onClick={() => setPara('left')}><IconAlignLeft size={14} /></IconBtn>
          <IconBtn title="居中对齐" active={alignT === 'center'} onClick={() => setPara('center')}><IconAlignCenter size={14} /></IconBtn>
          <IconBtn title="右对齐" active={alignT === 'right'} onClick={() => setPara('right')}><IconAlignRight size={14} /></IconBtn>
          <IconBtn title="两端对齐" active={alignT === 'justify'} onClick={() => setPara('justify')}><IconAlignJustify size={14} /></IconBtn>
        </div>
      ) : null}
      {/* ── 图层样式(投影/描边,本编辑器既有功能收编为尾段) ── */}
      <div style={{ borderTop: `1px solid ${PC.separator}`, marginTop: 6, paddingTop: 4, paddingBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: PC.textDim, width: 24, flexShrink: 0 }}>投影</span>
          <button
            onClick={() => setLayerStyle(layerId, shadow ? { shadow: undefined } : { shadow: { dx: 0, dy: 6, blur: 14, color: 'rgba(0,0,0,0.6)' } })}
            title={shadow ? '关闭投影' : '开启投影'}
            style={{ height: 22, flex: 1, border: `1px solid ${shadow ? PC.accent : PC.fieldBorder}`, borderRadius: 3, background: PC.field, color: shadow ? PC.accent : PC.textDim, fontSize: 11, cursor: 'pointer' }}
          >{shadow ? '开' : '关'}</button>
          {shadow ? (
            <>
              <input type="number" min={0} max={60} value={shadow.blur} onChange={(e) => setLayerStyle(layerId, { shadow: { ...shadow, blur: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } })} title="投影模糊" style={{ ...FIELD, width: 52, padding: '0 4px' }} />
              <label title="投影颜色" style={{ width: 24, height: 22, borderRadius: 3, cursor: 'pointer', background: shadow.color, border: `1px solid ${PC.fieldBorder}`, display: 'block', position: 'relative' }}>
                <input type="color" value="#000000" onChange={(e) => setLayerStyle(layerId, { shadow: { ...shadow, color: e.target.value } })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }} />
              </label>
            </>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: PC.textDim, width: 24, flexShrink: 0 }}>描边</span>
          <button
            onClick={() => setLayerStyle(layerId, stroke ? { stroke: undefined } : { stroke: { width: 3, color: 'rgba(2,6,23,0.65)' } })}
            title={stroke ? '关闭描边' : '开启描边'}
            style={{ height: 22, flex: 1, border: `1px solid ${stroke ? PC.accent : PC.fieldBorder}`, borderRadius: 3, background: PC.field, color: stroke ? PC.accent : PC.textDim, fontSize: 11, cursor: 'pointer' }}
          >{stroke ? '开' : '关'}</button>
          {stroke ? (
            <>
              <input type="number" min={0} max={12} value={stroke.width} onChange={(e) => setLayerStyle(layerId, { stroke: { ...stroke, width: Math.max(0, Math.min(12, Number(e.target.value) || 0)) } })} title="描边宽" style={{ ...FIELD, width: 52, padding: '0 4px' }} />
              <label title="描边颜色" style={{ width: 24, height: 22, borderRadius: 3, cursor: 'pointer', background: '#ffffff', border: `1px solid ${PC.fieldBorder}`, display: 'block', position: 'relative' }}>
                <input type="color" value="#ffffff" onChange={(e) => setLayerStyle(layerId, { stroke: { ...stroke, color: e.target.value } })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }} />
              </label>
            </>
          ) : null}
        </div>
        <div style={{ fontSize: 10.5, color: PC.textFaint, marginTop: 6, lineHeight: 1.6 }}>
          字段留空 = 还原模板默认{blendLabel ? ` · 混合:${blendLabel}` : ''}{hiddenLayers.includes(layerId) ? ' · 图层已隐藏' : ''}
        </div>
      </div>
    </div>
  )
}
