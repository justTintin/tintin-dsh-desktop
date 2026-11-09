// 选中图片图层的属性卡(2026-11-01 用户裁决:对齐 PhotoCraft)。分区照 PhotoCraft 的落点:
// 图层面板头(混合模式/不透明度/锁定位置)→ 属性面板「变换」(W🔗H/X/Y/角度)→
// 编辑›变换(翻转/旋转 90°·180°)→ 图层›排列 → 复制/删除。自由图层与产品图槽位共用;
// 环境底图(全幅铺底,模板不按图层序叠放)只开放外观与翻转。X/Y=图层框左上角(画布 px)。
import React from 'react'
import { getTemplate } from '../registry'
import type { CustomLayer } from '../../templates/CustomLayers'
import { BLEND_MODES, lookOpacity, lookScale, type ImageLook } from '../../templates/image-style'
import { canvasBoxIn, compositionRectIn, layerEl, type CanvasBox } from './canvas-geom'
import { clampScale, flipPatch, resizeWH, rotatePatch, type Arrange } from './image-ops'
import { useEditor } from './store'
import { ghostBtn, headStyle, inputStyle } from './ui'

export type ImageTarget =
  | { kind: 'custom'; layer: CustomLayer }
  | { kind: 'slot'; id: string; look: ImageLook & { dx?: number; dy?: number }; geometry: boolean }

export const numBox: React.CSSProperties = {
  width: 56, background: 'var(--bg-app)', border: '1px solid #444', borderRadius: 6,
  color: 'var(--text)', fontSize: 11, padding: '3px 5px', outline: 'none',
}
const label: React.CSSProperties = { fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }
const chip = (on = true): React.CSSProperties => ({ ...ghostBtn, width: 'auto', padding: '3px 8px', fontSize: 11, opacity: on ? 1 : 0.4, cursor: on ? 'pointer' : 'default' })

/** 数字框:输入中只改草稿,回车/失焦提交,Esc 还原(同 PhotoCraft 选项栏/属性面板字段) */
function NumField({ value, onCommit, disabled, min, max, title }: {
  value: number; onCommit: (v: number) => void; disabled?: boolean; min?: number; max?: number; title?: string
}): React.ReactElement {
  const [draft, setDraft] = React.useState(String(value))
  const cancelled = React.useRef(false)
  React.useEffect(() => { setDraft(String(value)) }, [value])
  const commit = (): void => {
    let v = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(v)) { setDraft(String(value)); return }
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    if (v !== value) onCommit(v)
    setDraft(String(v === value ? value : v))
  }
  return (
    <input
      type="number" value={draft} disabled={disabled} title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (cancelled.current) { cancelled.current = false; setDraft(String(value)) } else commit() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur() }
      }}
      style={{ ...numBox, opacity: disabled ? 0.45 : 1 }}
    />
  )
}

/** 滑条预览-提交分离:拖动中只写 CSS 预览,松手/键盘抬起/失焦一次性提交 */
export function PreviewSlider({ min, max, step, value, preview, commit }: {
  min: number; max: number; step: number; value: number
  preview: (v: number) => void
  commit: (v: number) => void
}): React.ReactElement {
  return (
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => preview(Number(e.target.value))}
      onPointerUp={(e) => commit(Number(e.currentTarget.value))}
      onKeyUp={(e) => commit(Number(e.currentTarget.value))}
      onBlur={(e) => commit(Number(e.currentTarget.value))}
      style={{ flex: 1, minWidth: 0, accentColor: 'var(--accent)' }}
    />
  )
}

/** 图层的视觉包围盒与布局尺寸(布局尺寸不含 transform=缩放前的底尺寸);变化后下一帧重量 */
function useLayerMetrics(id: string, sig: string): { box: CanvasBox; layoutW: number; layoutH: number } | null {
  const tplWidth = useEditor((s) => getTemplate(s.templateId).width)
  const [m, setM] = React.useState<{ box: CanvasBox; layoutW: number; layoutH: number } | null>(null)
  React.useEffect(() => {
    let stopped = false
    const read = (): void => {
      if (stopped) return
      const el = layerEl(id)
      setM(el ? { box: canvasBoxIn(el, compositionRectIn(document), tplWidth), layoutW: el.offsetWidth, layoutH: el.offsetHeight } : null)
    }
    const raf = requestAnimationFrame(read)
    const el = layerEl(id)
    if (el instanceof HTMLImageElement && !el.complete) el.addEventListener('load', read, { once: true })
    return () => { stopped = true; cancelAnimationFrame(raf); el?.removeEventListener('load', read) }
  }, [id, sig, tplWidth])
  return m
}

export function ImageLayerProps({ target }: { target: ImageTarget }): React.ReactElement {
  const setCustomLayer = useEditor((s) => s.setCustomLayer)
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const arrangeLayer = useEditor((s) => s.arrangeLayer)
  const duplicateCustomLayer = useEditor((s) => s.duplicateCustomLayer)
  const removeCustomLayer = useEditor((s) => s.removeCustomLayer)
  const templateId = useEditor((s) => s.templateId)
  const allProps = useEditor((s) => s.props)
  const customLayers = useEditor((s) => s.props.customLayers) as CustomLayer[] | undefined
  const [linked, setLinked] = React.useState(true)
  const [exportMsg, setExportMsg] = React.useState('')
  const id = target.kind === 'custom' ? target.layer.id : target.id
  const look: ImageLook & { dx?: number; dy?: number } = target.kind === 'custom' ? target.layer : target.look
  const geometry = target.kind === 'custom' || target.geometry
  const locked = look.locked === true
  const metrics = useLayerMetrics(id, `${templateId}|${JSON.stringify(look)}`)

  /** 单层导出(2026-11-02 对齐 PhotoCraft quick-export):隐藏其余全部图层后 render,
   *  PNG 落项目目录。文字层隐藏=不参与校验(B2 语义),模板底图保留。 */
  const exportThisLayer = async (): Promise<void> => {
    const tpl = getTemplate(templateId)
    const others = tpl.layerDefs.map((l) => l.id).filter((x) => x !== id)
    const customOthers = ((allProps.customLayers as CustomLayer[] | undefined) ?? []).map((l) => l.id).filter((x) => x !== id)
    const hidden = [...others, ...customOthers]
    setExportMsg('渲染中…')
    try {
      const r = await fetch('/tintin/ipc/cover/render', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId, props: { ...allProps, hiddenLayers: hidden }, fileName: `仅-${id}.png` }),
      }).then((x) => x.json()) as { ok?: boolean; file?: string; error?: string }
      if (!r.ok) throw new Error(r.error || '渲染失败')
      setExportMsg(`✓ 已导出 ${r.file}`)
    } catch (err) {
      setExportMsg(`✗ ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const apply = (patch: ImageLook & { x?: number; y?: number; width?: number; height?: number; dx?: number; dy?: number }): void => {
    if (target.kind === 'custom') setCustomLayer(id, patch)
    else setLayerStyle(id, patch)
  }

  // 尺寸:自由图层=width/height(高缺省随纵横比);产品图槽位=布局底尺寸×缩放倍率
  const size = ((): { w: number; h: number } | null => {
    if (target.kind === 'custom') {
      const h = target.layer.height ?? (metrics && metrics.layoutH > 0 ? metrics.layoutH : null)
      return h === null ? null : { w: target.layer.width, h }
    }
    if (!metrics || metrics.layoutW <= 0 || metrics.layoutH <= 0) return null
    return { w: Math.round(metrics.layoutW * lookScale(look.sx)), h: Math.round(metrics.layoutH * lookScale(look.sy)) }
  })()
  const setSize = (edit: { w?: number; h?: number }): void => {
    if (!size) return
    const next = resizeWH(size, edit, linked, target.kind === 'custom' ? 20 : 1)
    if (target.kind === 'custom') {
      apply(linked && target.layer.height === undefined ? { width: next.w } : { width: next.w, height: next.h })
    } else if (metrics) {
      apply({ sx: clampScale(next.w / metrics.layoutW), sy: clampScale(next.h / metrics.layoutH) })
    }
  }
  const pos = target.kind === 'custom'
    ? { x: target.layer.x, y: target.layer.y }
    : metrics ? { x: Math.round(metrics.box.left), y: Math.round(metrics.box.top) } : null
  const setPos = (edit: { x?: number; y?: number }): void => {
    if (!pos) return
    if (target.kind === 'custom') { apply(edit); return }
    apply({
      dx: Math.round((look.dx ?? 0) + (edit.x !== undefined ? edit.x - pos.x : 0)),
      dy: Math.round((look.dy ?? 0) + (edit.y !== undefined ? edit.y - pos.y : 0)),
    })
  }
  const opacity = Math.round(lookOpacity(look) * 100)
  const arrangeBtn = (how: Arrange, text: string, keys: string): React.ReactElement => (
    <button key={how} onClick={() => arrangeLayer(id, how)} title={`${text}(${keys})`} style={chip()}>{text}</button>
  )
  const transformBtn = (text: string, patch: ImageLook, title: string): React.ReactElement => (
    <button key={text} disabled={locked} onClick={() => apply(patch)} title={locked ? '图层已锁定位置' : title} style={chip(!locked)}>{text}</button>
  )

  return (
    <div data-image-props="" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(127,127,127,0.07)', border: '1px solid var(--border)' }}>
      <div style={{ ...row, marginTop: 0 }}>
        <select
          value={look.blend ?? 'normal'} title="混合模式"
          onChange={(e) => apply({ blend: e.target.value === 'normal' ? undefined : e.target.value })}
          style={inputStyle({ width: 104, height: 24, fontSize: 11, padding: '0 4px', flexShrink: 0 })}
        >
          {BLEND_MODES.map(([mode, text]) => <option key={mode} value={mode}>{text}</option>)}
        </select>
        <span style={label}>不透明度</span>
        <PreviewSlider min={0} max={100} step={1} value={opacity}
          preview={(v) => { const el = layerEl(id); if (el) el.style.opacity = String(v / 100) }}
          commit={(v) => { if (v !== opacity) apply({ opacity: v / 100 }) }} />
        <NumField value={opacity} min={0} max={100} title="不透明度 %" onCommit={(v) => apply({ opacity: Math.round(v) / 100 })} />
      </div>
      <label style={{ ...row, cursor: 'pointer', fontSize: 11, color: locked ? '#facc15' : 'var(--text-muted)' }}>
        <input type="checkbox" checked={locked} onChange={(e) => apply({ locked: e.target.checked ? true : undefined })} />
        🔒 锁定位置{locked ? '(移动/变换已禁用)' : ''}
      </label>

      {/* 投影(2026-11-02 对齐 PhotoCraft 图层样式):图片=drop-shadow 滤镜;开=默认黑投影,大小可调 */}
      <div style={row}>
        <span style={label}>投影</span>
        <button
          onClick={() => apply(look.shadow ? { shadow: undefined } : { shadow: { dx: 0, dy: 10, blur: 18, color: 'rgba(0,0,0,0.55)' } })}
          title={look.shadow ? '关闭投影' : '开启投影'}
          style={{ ...ghostBtn, width: 'auto', padding: '2px 10px', fontSize: 11, color: look.shadow ? 'var(--accent)' : 'var(--text-faint)', borderColor: look.shadow ? 'var(--accent)' : undefined }}
        >{look.shadow ? '开' : '关'}</button>
        {look.shadow ? (
          <>
            <span style={label}>大小</span>
            <NumField value={Math.round(look.shadow.blur ?? 0)} min={0} max={80} title="投影大小(px)" onCommit={(v) => apply({ shadow: { ...(look.shadow ?? { dx: 0, dy: 10, color: 'rgba(0,0,0,0.55)' }), blur: v } })} />
          </>
        ) : null}
      </div>

      {geometry ? (
        <>
          <div style={{ ...headStyle, margin: '10px 0 0' }}>变换</div>
          <div style={row}>
            <span style={label}>W</span>
            <NumField value={size?.w ?? 0} disabled={locked || !size} min={1} max={8000} title="宽度(px)" onCommit={(v) => setSize({ w: v })} />
            <button onClick={() => setLinked(!linked)} title={linked ? '链接宽度和高度(点击解除)' : '宽高未链接(点击链接)'}
              style={{ ...chip(), padding: '2px 6px', color: linked ? 'var(--accent)' : 'var(--text-faint)', borderColor: linked ? 'var(--accent)' : undefined }}>{linked ? '🔗' : '⛓'}</button>
            <span style={label}>H</span>
            <NumField value={size?.h ?? 0} disabled={locked || !size} min={1} max={8000} title="高度(px)" onCommit={(v) => setSize({ h: v })} />
            <span style={label}>px</span>
          </div>
          <div style={row}>
            <span style={label}>X</span>
            <NumField value={pos?.x ?? 0} disabled={locked || !pos} title="左上角 X(画布 px)" onCommit={(v) => setPos({ x: v })} />
            <span style={label}>Y</span>
            <NumField value={pos?.y ?? 0} disabled={locked || !pos} title="左上角 Y(画布 px)" onCommit={(v) => setPos({ y: v })} />
            <span style={label}>角度</span>
            <NumField value={look.rotate ?? 0} disabled={locked} min={-180} max={180} title="旋转角度(°)" onCommit={(v) => apply({ rotate: Math.round(v) })} />
            <span style={label}>°</span>
          </div>
        </>
      ) : null}
      <div style={{ ...row, flexWrap: 'wrap' }}>
        {transformBtn('⇋ 水平翻转', flipPatch(look, 'x'), '编辑›变换›水平翻转')}
        {transformBtn('⇅ 垂直翻转', flipPatch(look, 'y'), '编辑›变换›垂直翻转')}
        {geometry ? (
          <>
            {transformBtn('↻ 90°', rotatePatch(look, 90), '顺时针旋转 90°')}
            {transformBtn('↺ 90°', rotatePatch(look, -90), '逆时针旋转 90°')}
            {transformBtn('180°', rotatePatch(look, 180), '旋转 180°')}
          </>
        ) : null}
      </div>
      {geometry ? (
        <div style={{ ...row, flexWrap: 'wrap' }}>
          <span style={label}>排列</span>
          {arrangeBtn('front', '置顶', 'Ctrl+Shift+]')}
          {arrangeBtn('forward', '上移一层', 'Ctrl+]')}
          {arrangeBtn('backward', '下移一层', 'Ctrl+[')}
          {arrangeBtn('back', '置底', 'Ctrl+Shift+[')}
        </div>
      ) : null}
      {target.kind === 'custom' ? (
        <div style={{ ...row, flexWrap: 'wrap' }}>
          <button onClick={() => duplicateCustomLayer(id)} title="复制图层(Ctrl+J):全部属性照搬,副本在原图层之上" style={chip()}>⧉ 复制图层</button>
          <button onClick={() => removeCustomLayer(id)} title="删除图层(Delete)" style={{ ...chip(), color: 'var(--err)' }}>🗑 删除图层</button>
        </div>
      ) : null}
      {/* 单层导出(2026-11-02 对齐 PhotoCraft quick-export):隐藏其余全部图层后 render */}
      <div style={row}>
        <button onClick={() => void exportThisLayer()} title="隐藏其余图层,只渲染本图层为 PNG(落项目目录)" style={{ ...chip(), color: '#93c5fd' }}>⬇ 仅显示此图层导出</button>
        {exportMsg ? <span style={{ fontSize: 11, color: exportMsg.startsWith('✓') ? 'var(--ok)' : 'var(--err)', wordBreak: 'break-all' }}>{exportMsg}</span> : null}
      </div>
    </div>
  )
}
