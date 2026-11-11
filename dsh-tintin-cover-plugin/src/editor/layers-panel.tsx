// layers-panel — 图层面板(2026-11-11 用户裁决「按钮/图标一比一复制 PhotoCraft」整版重绘;
// 参照系=crates/ui-egui/src/panels/layers.rs + layer_row*.rs + layer_tree_ui.rs 绘制规格:
// · 行 32px,眼列 30px 全高(可见=eye 15px,隐藏=空白),行左 1px 竖分隔+行底 1px 横分隔;
// · 组行=实心展开三角(折叠朝右),每层缩进 14px,组可折叠;
// · 缩略芯片 24px:图片=棋盘格 5px+信箱图,组/空=field 底+folder 18,文字=#DEDEDE 底+type 20;
// · 右缘指示=lock 12px(仅锁定)+混合模式标签 10.5px(≠正常);整行拖拽(无手柄);
// · 投放指示=2px accent 线(行上/下缘)或组内描边(layer_drag.rs:180-188);
// · 页脚=1px 分隔+30px 条(trash/square-plus 26×26,行拖到按钮=动作);
// · 头行=blend 下拉(field/border/radius 3+chevron 区)+不透明度数值字段(24px mono+%,
//   ▾ 区开 160px 弹出滑条,fields.rs:89/320-323);
// · Pro-dark 调色板(theme.rs ProMedium 暗档)。业务逻辑=原逻辑零改动。
import React from 'react'
import { getTemplate } from '../registry'
import type { CustomLayer } from '../../templates/CustomLayers'
import { BLEND_MODES, imgDropShadow, lookBlend, lookOpacity, lookTransform, type ImageLook } from '../../templates/image-style'
import { lockedOf } from './image-ops'
import { effectiveOrder, useEditor } from './store'
import { buildLayerRows } from './layer-rows'
import { CustomLayerEditor, DelayedTextEditor, ImageLayerEditor } from './layer-editors'
import { TextProperties } from './text-properties'
import { ensureMenuStyle, headStyle } from './ui'
import { layerEl } from './canvas-geom'
import { IconChevronDown, IconDisclosure, IconEye, IconFolder, IconLock, IconSquarePlus, IconTrash, IconType } from './layer-icons'

/* Pro-dark 调色板(theme.rs ProMedium 暗档) */
const PC = {
  field: '#242424',
  fieldBorder: '#4A4A4A',
  rowSelected: '#525252',
  separator: '#1E1E1E',
  text: '#DEDEDE',
  textDim: '#B2B2B2',
  textFaint: '#808080',
  icon: '#C8C8C8',
  accent: '#378EF0',
  thumbBorder: '#141414',
  chip: '#DEDEDE',
} as const

const ROW_H = 32
const EYE_W = 30
const INDENT = 14
const THUMB = 24

/** 行缩略芯片(layer_row.rs:617-677): 图片=棋盘格 5px+信箱图;文字=#DEDEDE 底+type 20;
 *  组/空/图形=field 底 radius 6(+folder 18)。外描边 1px #141414(radius 0 pro)。 */
function LayerThumb({ row, layerDefs, props }: {
  row: { id: string; rowType: 'group' | 'free' }
  layerDefs: ReturnType<typeof getTemplate>['layerDefs']
  props: Record<string, unknown>
}): React.ReactElement {
  const def = row.rowType === 'group' ? layerDefs.find((l) => l.id === row.id) : undefined
  const key = def?.propsKey ?? row.id
  const value = props[key]
  const checker: React.CSSProperties = { background: 'repeating-conic-gradient(#2e2e35 0% 25%, #1b1b21 0% 50%) 0 0 / 5px 5px' }
  const box: React.CSSProperties = { width: THUMB, height: THUMB, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 1px ${PC.thumbBorder}` }
  const look = (props.styles as Record<string, ImageLook> | undefined)?.[row.id]
  if (row.rowType === 'free') {
    const layer = row as { image?: string; rotate?: number; opacity?: number; blend?: string; flipX?: boolean; flipY?: boolean; shadow?: { dx: number; dy: number; blur: number; color: string } }
    return (
      <div style={{ ...box, ...checker }}>
        <img
          src={`/tintin/ipc/cover/acp/asset?name=${encodeURIComponent(layer.image ?? '')}`} alt="" loading="lazy"
          style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block',
            transform: lookTransform(layer), opacity: lookOpacity(layer), mixBlendMode: lookBlend(layer),
            filter: imgDropShadow(layer),
          }}
        />
      </div>
    )
  }
  if (def?.type === 'text') {
    return (
      <div style={{ ...box, background: PC.chip }}>
        <IconType size={20} />
      </div>
    )
  }
  if (def?.type === 'product' || key === 'bgImage') {
    const src = typeof value === 'string' && value ? value : ''
    return (
      <div style={{ ...box, ...(src ? checker : { background: PC.field, borderRadius: 6 }) }}>
        {src
          ? <img
              src={`/tintin/ipc/cover/acp/asset?name=${encodeURIComponent(src)}`} alt="" loading="lazy"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', transform: lookTransform(look), opacity: lookOpacity(look), mixBlendMode: lookBlend(look), filter: imgDropShadow(look) }}
            />
          : <IconFolder size={18} />}
      </div>
    )
  }
  return (
    <div style={{ ...box, background: PC.field, borderRadius: 6 }}>
      <IconFolder size={18} />
    </div>
  )
}

/** 图层面板(业务逻辑不变;呈现层=2026-11-11 PhotoCraft 一比一) */
export function LayersPanel({ project }: { project: string }): React.ReactElement {
  ensureMenuStyle()
  const templateId = useEditor((s) => s.templateId)
  const hiddenLayers = useEditor((s) => s.hiddenLayers)
  const selectedLayer = useEditor((s) => s.selectedLayer)
  const props = useEditor((s) => s.props)
  const layerNames = useEditor((s) => s.layerNames)
  const renameLayer = useEditor((s) => s.renameLayer)
  const toggleLayer = useEditor((s) => s.toggleLayer)
  const selectLayer = useEditor((s) => s.selectLayer)
  const toggleMultiSelect = useEditor((s) => s.toggleMultiSelect)
  const setProp = useEditor((s) => s.setProp)
  const removeCustomLayer = useEditor((s) => s.removeCustomLayer)
  const removeCustomLayers = useEditor((s) => s.removeCustomLayers)
  const setCustomLayer = useEditor((s) => s.setCustomLayer)
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const reorderLayer = useEditor((s) => s.reorderLayer)
  const arrangeLayer = useEditor((s) => s.arrangeLayer)
  const duplicateCustomLayer = useEditor((s) => s.duplicateCustomLayer)
  const customLayers = useEditor((s) => s.props.customLayers) as CustomLayer[] | undefined
  const order = React.useMemo(() => effectiveOrder(useEditor.getState()), [templateId, props])
  const customById = new Map((customLayers ?? []).map((l) => [l.id, l]))
  const tpl = getTemplate(templateId)
  const allRows = React.useMemo(
    () => buildLayerRows({ layerDefs: tpl.layerDefs, topToBottom: [...order].reverse(), props, customLayers: customLayers ?? [], hiddenLayers }),
    [tpl, order, props, customLayers, hiddenLayers],
  )
  const defOf = (id: string) => tpl.layerDefs.find((l) => l.id === id)
  const [dragId, setDragId] = React.useState<string | null>(null)
  /** 投放指示(layer_drag.rs:180-188): 行上/下缘=2px accent 线;拖入组=组内描边 */
  const [dropEdge, setDropEdge] = React.useState<{ id: string; kind: 'above' | 'below' | 'into' } | null>(null)
  /** 组折叠(呈现态): 折叠的组隐藏其默认行与成员行 */
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [trashHot, setTrashHot] = React.useState(false)
  const [dupHot, setDupHot] = React.useState(false)
  const [renaming, setRenaming] = React.useState<{ id: string; value: string } | null>(null)
  const [menu, setMenu] = React.useState<{ id: string; x: number; y: number } | null>(null)
  /** 头行不透明度弹出滑条(fields.rs:323 popup 160px) */
  const [opPopup, setOpPopup] = React.useState(false)
  /* 分割可调(2026-11-11 用户裁决):图层区默认占一半,拖分割线调;两块按 ratio 分高,
     切层不改几何(高度固定=无抖动)。ratio=图层区(行区+页脚)占头行以下高度的比例;
     默认按「整个面板高度的一半」校准(挂载测一次,用户拖过后不再覆盖)。 */
  const [splitRatio, setSplitRatio] = React.useState(0.5)
  const splitRef = React.useRef<{ y: number; h: number; r0: number } | null>(null)
  const splitBodyRef = React.useRef<HTMLDivElement>(null)
  const splitRootRef = React.useRef<HTMLDivElement>(null)
  const splitTouchedRef = React.useRef(false)
  React.useLayoutEffect(() => {
    if (splitTouchedRef.current) return
    const rootH = splitRootRef.current?.getBoundingClientRect().height ?? 0
    const bodyH = splitBodyRef.current?.getBoundingClientRect().height ?? 0
    if (rootH <= 0 || bodyH <= 0) return
    const chrome = rootH - bodyH // 标题/头行
    const r = (rootH / 2 - chrome) / bodyH
    setSplitRatio(Math.min(0.85, Math.max(0.2, r)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const onSplitDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    const h = splitBodyRef.current?.getBoundingClientRect().height ?? 0
    if (h <= 0) return
    splitTouchedRef.current = true
    splitRef.current = { y: e.clientY, h, r0: splitRatio }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 合成指针守卫 */ }
  }
  const onSplitMove = (e: React.PointerEvent): void => {
    const s = splitRef.current
    if (!s) return
    const r = Math.min(0.85, Math.max(0.2, s.r0 + (e.clientY - s.y) / Math.max(1, s.h)))
    setSplitRatio(r)
  }
  const onSplitUp = (e: React.PointerEvent): void => {
    splitRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId) } catch { /* 已释放 */ }
  }
  const endDrag = (): void => { setDragId(null); setDropEdge(null); setTrashHot(false); setDupHot(false) }
  const displayName = (row: { rowType: 'group' | 'free'; id: string; label: string }): string => layerNames[row.id] ?? row.label
  const rows = allRows.filter((r) => {
    if (r.rowType === 'default' && collapsed.has(r.groupId)) return false
    if (r.rowType === 'free' && r.group && collapsed.has(r.group)) return false
    return true
  })
  const dropAssetAsLayer = (assetName: string, afterLayerId: string | null): void => {
    void (async () => {
      try {
        if (!assetName.startsWith('public/')) {
          await fetch('/tintin/ipc/cover/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: assetName }) })
        }
        const id = useEditor.getState().addCustomLayer(assetName.replace(/^public\//, ''), Math.round(tpl.width / 2 - 180), Math.round(tpl.height / 3), 360)
        if (afterLayerId) reorderLayer(id, afterLayerId)
        useEditor.getState().selectLayer(id)
      } catch { /* 失败静默(同画布拖放口径) */ }
    })()
  }
  const toggleLock = (id: string): void => {
    if (id.startsWith('img-')) setCustomLayer(id, { locked: !lockedOf(props, id) })
    else setLayerStyle(id, { locked: !lockedOf(props, id) })
  }
  /** Alt+点击眼睛=只显示此层(layer_row.rs:407-411): 其余全部隐藏 */
  const showOnlyThis = (id: string): void => {
    const all = [...tpl.layerDefs.map((l) => l.id), ...(customLayers ?? []).map((l) => l.id)]
    useEditor.setState({ hiddenLayers: all.filter((v) => v !== id), multiSelected: [] })
  }
  /* 头行外观通道(混合/不透明度;selHasLook=图片/文字层) */
  const selHasLook = Boolean(selectedLayer && (selectedLayer.startsWith('img-') || selectedLayer === 'product' || (defOf(selectedLayer)?.propsKey ?? selectedLayer) === 'bgImage' || defOf(selectedLayer)?.type === 'text'))
  const selLook = ((): { blend?: string; opacity?: number } => {
    if (!selectedLayer) return {}
    if (selectedLayer.startsWith('img-')) return customById.get(selectedLayer) ?? {}
    return (props.styles as Record<string, { blend?: string; opacity?: number }> | undefined)?.[selectedLayer] ?? {}
  })()
  const [opDraft, setOpDraft] = React.useState<number | null>(null)
  const applyBlend = (mode: string): void => {
    if (!selectedLayer || !selHasLook) return
    const patch = mode === 'normal' ? { blend: undefined } : { blend: mode }
    if (selectedLayer.startsWith('img-')) setCustomLayer(selectedLayer, patch)
    else setLayerStyle(selectedLayer, patch)
  }
  const previewOpacity = (v: number | null): void => {
    setOpDraft(v)
    const el = selectedLayer ? layerEl(selectedLayer) : null
    if (el) el.style.opacity = v === null ? '' : String(v / 100)
  }
  const commitOpacity = (v: number): void => {
    previewOpacity(null)
    if (!selectedLayer || !selHasLook) return
    const op = Math.min(1, Math.max(0, v / 100))
    if (selectedLayer.startsWith('img-')) setCustomLayer(selectedLayer, { opacity: op })
    else setLayerStyle(selectedLayer, { opacity: op })
  }
  const menuRow = menu ? allRows.find((r): r is Extract<typeof r, { rowType: 'group' | 'free' }> => 'id' in r && r.id === menu.id) : null
  const selFreeIds = [...new Set([selectedLayer, ...useEditor.getState().multiSelected])].filter((v): v is string => Boolean(v && v.startsWith('img-')))
  /** 行拖放落点(edge): 组行中带=into,其余按上下半 */
  const edgeOf = (e: React.DragEvent, id: string, isGroup: boolean): { id: string; kind: 'above' | 'below' | 'into' } => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const at = (e.clientY - r.top) / r.height
    if (isGroup && at > 0.3 && at < 0.7) return { id, kind: 'into' }
    return { id, kind: at <= 0.5 ? 'above' : 'below' }
  }
  return (
    <div ref={splitRootRef} style={{ flex: '1 1 auto', minHeight: 0, background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '8px 12px 6px', fontSize: 12, color: PC.text, fontWeight: 700 }}>图层 · {tpl.label}</div>
      {/* 头行:blend 下拉 + 不透明度数值字段(照 layers.rs:149-184/fields.rs) */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px 4px' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <select
            value={selLook.blend ?? 'normal'}
            disabled={!selHasLook}
            onChange={(e) => applyBlend(e.target.value)}
            title={selHasLook ? '图层混合模式' : '混合模式作用于图片/文字图层(装饰层无外观通道)'}
            style={{
              width: '100%', height: 24, appearance: 'none', background: PC.field, color: selHasLook ? PC.text : PC.textFaint,
              border: `1px solid ${PC.fieldBorder}`, borderRadius: 3, fontSize: 12, padding: '0 22px 0 8px', cursor: selHasLook ? 'pointer' : 'default',
            }}
          >
            {BLEND_MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <div style={{ position: 'absolute', right: 2, top: 2, bottom: 2, width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: PC.textDim, pointerEvents: 'none' }}>
            <IconChevronDown size={14} />
          </div>
        </div>
        {/* 头行「不透明度：」标签(2026-11-11 用户裁决:标签占前面下拉框的伸缩位,值字段宽度不变) */}
        <span style={{ fontSize: 12, color: PC.textDim, flexShrink: 0 }}>不透明度：</span>
        <div style={{ position: 'relative', width: 80, flexShrink: 0 }}>
          <button
            onClick={() => selHasLook && setOpPopup((v) => !v)}
            disabled={!selHasLook}
            title={selHasLook ? '图层不透明度(点击展开滑条)' : '不透明度作用于图片/文字图层'}
            style={{
              width: '100%', height: 24, background: PC.field, color: selHasLook ? PC.text : PC.textFaint,
              border: `1px solid ${PC.fieldBorder}`, borderRadius: 3, cursor: selHasLook ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 0 8px',
            }}
          >
            <span style={{ fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace' }}>{opDraft ?? Math.round((selLook.opacity ?? 1) * 100)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 1, color: PC.textFaint }}>
              <span style={{ fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace' }}>%</span>
              <IconChevronDown size={12} />
            </span>
          </button>
          {opPopup && selHasLook ? (
            <div style={{ position: 'absolute', top: 26, right: 0, width: 160, background: PC.field, border: `1px solid ${PC.fieldBorder}`, borderRadius: 3, padding: 10, zIndex: 2300 }}>
              <input
                type="range" min={0} max={100} step={1}
                value={opDraft ?? Math.round((selLook.opacity ?? 1) * 100)}
                onChange={(e) => previewOpacity(Number(e.target.value))}
                onPointerUp={(e) => commitOpacity(Number(e.currentTarget.value))}
                onKeyUp={(e) => commitOpacity(Number(e.currentTarget.value))}
                style={{ width: '100%', accentColor: PC.accent }}
              />
            </div>
          ) : null}
        </div>
      </div>
      {/* 分割可调(2026-11-11 用户裁决): 图层区默认占 50%,拖下方分割线调整;两块按 ratio
          分高=切层几何恒定(编辑卡内容变化只滚动不挤压行区) */}
      <div ref={splitBodyRef} style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: `${splitRatio} 1 0`, minHeight: 48, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 行区(layers.rs:248-257) */}
      <div
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-tintin-cover-layer')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
        }}
        onDrop={(e) => {
          e.preventDefault()
          const assetName = e.dataTransfer.getData('application/x-tintin-cover-layer')
          if (assetName) dropAssetAsLayer(assetName, null)
          setDropEdge(null)
        }}
      >
        {rows.map((row) => {
          if (row.rowType === 'default') {
            const selected = selectedLayer === row.groupId
            return (
              <div
                key={`${row.groupId}:default`}
                onClick={(e) => { if (e.shiftKey) { toggleMultiSelect(row.groupId); return } selectLayer(row.groupId) }}
                style={{
                  marginLeft: 30 + INDENT, height: 22, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', cursor: 'pointer', userSelect: 'none',
                  fontSize: 11.5, color: row.hidden ? PC.textFaint : PC.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  background: selected ? PC.rowSelected : 'transparent', borderBottom: `1px solid ${PC.separator}`,
                }}
              >
                └ 默认图层 · {row.detail}
              </div>
            )
          }
          const id = row.id
          const isGroup = row.rowType === 'group'
          const free = row.rowType === 'free' ? (row as Extract<typeof row, { rowType: 'free' }>) : null
          const selected = selectedLayer === id
          const edge = dropEdge?.id === id ? dropEdge : null
          const depth = isGroup ? 0 : 1
          const blendLabel = ((): string | null => {
            const look = id.startsWith('img-') ? customById.get(id) : (props.styles as Record<string, { blend?: string }> | undefined)?.[id]
            const b = look?.blend
            return b && b !== 'normal' ? (BLEND_MODES.find(([bid]) => bid === b)?.[1] ?? b) : null
          })()
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
              onDragOver={(e) => {
                if (dragId && dragId !== id) {
                  e.preventDefault(); e.dataTransfer.dropEffect = 'move'
                  setDropEdge(edgeOf(e, id, isGroup && Boolean(row.imageGroup)))
                  return
                }
                if (!dragId && e.dataTransfer.types.includes('application/x-tintin-cover-layer')) {
                  e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropEdge({ id, kind: isGroup && row.imageGroup ? 'into' : 'below' })
                }
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropEdge(null) }}
              onDrop={(e) => {
                e.preventDefault()
                const assetName = e.dataTransfer.getData('application/x-tintin-cover-layer')
                if (assetName && isGroup && row.imageGroup) {
                  void (async () => {
                    try {
                      if (!assetName.startsWith('public/')) {
                        await fetch('/tintin/ipc/cover/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: assetName }) })
                      }
                      const newId = useEditor.getState().addCustomLayer(assetName.replace(/^public\//, ''), Math.round(tpl.width / 2 - 180), Math.round(tpl.height / 3), 360, id)
                      reorderLayer(newId, id)
                      useEditor.getState().selectLayer(newId)
                    } catch { /* 同步失败静默 */ }
                  })()
                  endDrag(); return
                }
                if (assetName) { dropAssetAsLayer(assetName, id); endDrag(); return }
                if (dragId && dragId !== id) reorderLayer(dragId, id)
                endDrag()
              }}
              onDragEnd={endDrag}
              onClick={(e) => { if (e.shiftKey) { toggleMultiSelect(id); return } selectLayer(id) }}
              onContextMenu={(e) => { e.preventDefault(); selectLayer(id); setMenu({ id, x: e.clientX, y: e.clientY }) }}
              style={{
                height: ROW_H, display: 'flex', alignItems: 'stretch', position: 'relative', userSelect: 'none',
                cursor: 'default', flexShrink: 0,
                background: selected ? PC.rowSelected : 'transparent',
                borderBottom: `1px solid ${PC.separator}`,
              }}
            >
              {/* 眼列(30px 全高;可见=eye,隐藏=空白;Alt+点击=只显示此层) */}
              <div
                title={row.hidden ? '显示(Alt+点击=只显示此层)' : '隐藏(Alt+点击=只显示此层)'}
                onClick={(e) => { e.stopPropagation(); if (e.altKey) showOnlyThis(id); else toggleLayer(id) }}
                onDragStart={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                style={{ width: EYE_W, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRight: `1px solid ${PC.separator}`, color: PC.icon }}
              >
                {row.hidden ? null : <IconEye size={15} />}
              </div>
              {/* 缩进+组三角+缩略芯片+名 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 6 + depth * INDENT, flex: 1, minWidth: 0 }}>
                {isGroup ? (
                  <div
                    title={collapsed.has(id) ? '展开' : '折叠'}
                    onClick={(e) => { e.stopPropagation(); setCollapsed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n }) }}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ width: 14, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: PC.icon, flexShrink: 0, marginLeft: -4 }}
                  >
                    <IconDisclosure size={9} expanded={!collapsed.has(id)} />
                  </div>
                ) : null}
                <LayerThumb row={row} layerDefs={tpl.layerDefs} props={props} />
                {renaming?.id === id ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id, value: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => { renameLayer(id, renaming.value); setRenaming(null) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { renameLayer(id, renaming.value); setRenaming(null); return }
                      if (e.key === 'Escape') { setRenaming(null); e.stopPropagation() }
                    }}
                    style={{ minWidth: 0, flex: 1, height: 22, background: PC.field, color: PC.text, border: `1px solid ${PC.accent}`, borderRadius: 3, fontSize: 12, padding: '0 5px', outline: 'none' }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ id, value: displayName(row) }) }}
                    title={displayName(row) + '(双击重命名)'}
                    style={{ flex: 1, minWidth: 0, fontSize: 12, color: row.hidden ? PC.textFaint : PC.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {free?.group && defOf(free.group) ? <span style={{ fontSize: 9.5, color: PC.accent, border: `1px solid ${PC.accent}`, borderRadius: 3, padding: '0 4px', marginRight: 5 }}>{defOf(free.group)?.label}</span> : null}
                    {displayName(row)}
                  </span>
                )}
                {/* 右缘指示(layer_row_ui.rs:195-232): 混合标签+lock */}
                {blendLabel ? <span style={{ fontSize: 10.5, color: PC.textFaint, flexShrink: 0 }}>{blendLabel}</span> : null}
                {lockedOf(props, id) ? (
                  <button
                    title="已锁定位置(点击解锁)"
                    onClick={(e) => { e.stopPropagation(); toggleLock(id) }}
                    style={{ width: 14, height: 14, padding: 0, border: 0, background: 'transparent', color: PC.textFaint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 10 }}
                  >
                    <IconLock size={12} />
                  </button>
                ) : <span style={{ width: 24, flexShrink: 0 }} />}
              </div>
              {/* 投放指示(layer_drag.rs:180-188): 上/下缘 2px accent 线;组内=内描边 */}
              {edge ? (
                edge.kind === 'into' ? (
                  <div style={{ position: 'absolute', inset: 1, border: `2px solid ${PC.accent}`, borderRadius: 3, pointerEvents: 'none' }} />
                ) : (
                  <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: PC.accent, pointerEvents: 'none', top: edge.kind === 'above' ? -1 : ROW_H - 1 }} />
                )
              ) : null}
            </div>
          )
        })}
      </div>
      {/* 页脚(layers.rs:402-528): 1px 分隔+30px 条,右对齐 26×26 按钮;行拖到按钮=动作 */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${PC.separator}`, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, padding: '0 8px' }}>
        <button
          title="删除图层(点击=删选中自由层;行拖到此=删除)"
          onClick={() => { if (selFreeIds.length) removeCustomLayers(selFreeIds) }}
          onDragOver={(e) => { if (dragId?.startsWith('img-')) { e.preventDefault(); setTrashHot(true) } }}
          onDragLeave={() => setTrashHot(false)}
          onDrop={(e) => { e.preventDefault(); if (dragId?.startsWith('img-')) removeCustomLayer(dragId); endDrag() }}
          style={{
            width: 26, height: 26, border: 0, borderRadius: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: trashHot ? '#424242' : 'transparent', color: trashHot ? PC.text : PC.icon,
          }}
        >
          <IconTrash size={14} />
        </button>
        <button
          title="复制图层(点击=复制选中自由层;行拖到此=复制)"
          onClick={() => { if (selectedLayer?.startsWith('img-')) duplicateCustomLayer(selectedLayer) }}
          onDragOver={(e) => { if (dragId?.startsWith('img-')) { e.preventDefault(); setDupHot(true) } }}
          onDragLeave={() => setDupHot(false)}
          onDrop={(e) => { e.preventDefault(); if (dragId?.startsWith('img-')) duplicateCustomLayer(dragId); endDrag() }}
          style={{
            width: 26, height: 26, border: 0, borderRadius: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: dupHot ? '#424242' : 'transparent', color: dupHot ? PC.text : PC.icon,
          }}
        >
          <IconSquarePlus size={14} />
        </button>
      </div>
      </div>
      {/* 分割线(拖动调整图层区高度;7px 命中区,视觉 1px) */}
      <div
        title="拖动调整图层区高度"
        onPointerDown={onSplitDown}
        onPointerMove={onSplitMove}
        onPointerUp={onSplitUp}
        onPointerCancel={onSplitUp}
        style={{ flexShrink: 0, height: 7, cursor: 'ns-resize', display: 'flex', alignItems: 'center', touchAction: 'none' }}
      >
        <div style={{ width: '100%', height: 1, background: PC.separator }} />
      </div>
      {/* 右键菜单 */}
      {menu && menuRow ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 2290 }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="tintin-as-menu" style={{ left: Math.min(menu.x, window.innerWidth - 216), top: Math.min(menu.y, window.innerHeight - 330) }}>
            <button onClick={() => { setRenaming({ id: menu.id, value: displayName(menuRow) }); setMenu(null) }}><span className="ico">✎</span>重命名</button>
            <button onClick={() => { toggleLayer(menu.id); setMenu(null) }}><span className="ico">👁</span>{menuRow.hidden ? '显示图层' : '隐藏图层'}</button>
            <button onClick={() => { toggleLock(menu.id); setMenu(null) }}><span className="ico">{lockedOf(props, menu.id) ? '🔓' : '🔒'}</span>{lockedOf(props, menu.id) ? '解锁位置' : '锁定位置'}</button>
            <button onClick={() => { arrangeLayer(menu.id, 'front'); setMenu(null) }}><span className="ico">⤒</span>置顶</button>
            <button onClick={() => { arrangeLayer(menu.id, 'forward'); setMenu(null) }}><span className="ico">↑</span>上移一层</button>
            <button onClick={() => { arrangeLayer(menu.id, 'backward'); setMenu(null) }}><span className="ico">↓</span>下移一层</button>
            <button onClick={() => { arrangeLayer(menu.id, 'back'); setMenu(null) }}><span className="ico">⤓</span>置底</button>
            {menu.id.startsWith('img-') ? (
              <>
                <button onClick={() => { duplicateCustomLayer(menu.id); setMenu(null) }}><span className="ico">⧉</span>复制图层</button>
                <button className="danger" onClick={() => { removeCustomLayer(menu.id); setMenu(null) }}><span className="ico">🗑</span>删除图层</button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {/* 选中图层编辑(高度=剩余比例,内部滚动;内容变化不再挤压行区) */}
      <div style={{ flex: `${1 - splitRatio} 1 0`, minHeight: 96, overflowY: 'auto', overflowX: 'hidden' }}>
      {(() => {
        if (!selectedLayer) return null
        if (customById.has(selectedLayer)) return <CustomLayerEditor layer={customById.get(selectedLayer)!} project={project} />
        const layer = defOf(selectedLayer)
        if (!layer || hiddenLayers.includes(layer.id)) return null
        const key = layer.propsKey ?? layer.id
        const value = props[key]
        if (layer.type === 'text') {
          const text = Array.isArray(value) ? value.join('\n') : String(value ?? '')
          const lines = Array.isArray(value) ? (value as string[]) : null
          return (
            <div style={{ marginTop: 14, padding: '0 12px 12px', overflowY: 'auto' }}>
              <div style={headStyle} title={'编辑「' + (layerNames[layer.id] ?? layer.label) + '」'}>编辑「{layerNames[layer.id] ?? layer.label}」</div>
              <DelayedTextEditor key={layer.id} value={text} isArray={Array.isArray(value)}
                rows={Array.isArray(value) ? Math.max(3, value.length + 1) : 3}
                onCommit={(v) => setProp(key, Array.isArray(value) ? v.split('\n') : v)} />
              {lines ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                  {lines.map((line, i) => (
                    <span key={`${i}:${line}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--border-strong)', borderRadius: 999, padding: '1px 4px 1px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                      行{i + 1}
                      <button
                        title={`删除行${i + 1}`}
                        onClick={() => { if (lines.length <= 1) return; setProp(key, lines.filter((_, j) => j !== i)) }}
                        style={{ border: 0, background: 'transparent', color: lines.length > 1 ? 'var(--err)' : 'var(--text-faint)', cursor: lines.length > 1 ? 'pointer' : 'default', fontSize: 10, padding: '0 3px' }}
                      >✕</button>
                    </span>
                  ))}
                  <button
                    onClick={() => setProp(key, [...lines, ''])}
                    title="追加一行(在文本框里填内容)"
                    style={{ border: '1px dashed var(--border-strong)', borderRadius: 999, background: 'transparent', color: 'var(--text-faint)', fontSize: 11, padding: '1px 8px', cursor: 'pointer' }}
                  >＋ 添加一行</button>
                </div>
              ) : null}
              <TextProperties layerId={layer.id} baseFontSize={layer.fontSize ?? 36} tplWidth={tpl.width} />
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                {Array.isArray(value) ? '每行一条(钩子/卖点);末行默认跳色可被颜色覆盖' : '支持中文;改动即时预览'}
              </div>
            </div>
          )
        }
        if (layer.type === 'product' || key === 'bgImage') {
          return <ImageLayerEditor layerId={layer.id} layerLabel={layerNames[layer.id] ?? layer.label} propKey={key} project={project} />
        }
        if (typeof value === 'string') {
          return (
            <div style={{ marginTop: 14, padding: '0 12px 12px', overflowY: 'auto' }}>
              <div style={headStyle} title={'编辑「' + (layerNames[layer.id] ?? layer.label) + '」'}>编辑「{layerNames[layer.id] ?? layer.label}」</div>
              <DelayedTextEditor key={layer.id} value={value} isArray={false}
                onCommit={(v) => setProp(key, v)} />
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>装饰层文案,改动即时预览;字号/配色由模板排版</div>
            </div>
          )
        }
        return null
      })()}
      </div>
      </div>
    </div>
  )
}
