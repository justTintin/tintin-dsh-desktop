// layers-panel — 图层面板(2026-11-11 WP-B 自 panels.tsx 迁出并 PhotoCraft 化;参照系=
// 行为规格: crates/ui-egui/src/panels/layers.rs 头行混合模式/不透明度、layer_row.rs 行
// =缩略图+眼睛+名字+拖柄、双击重命名、右键菜单、拖到页脚垃圾桶删除):
// · 行 = 眼睛 + 缩略图 + 名字(双击就地重命名,显示名存 store.layerNames,会话内存态)
//   + 锁 + 拖柄;拖动调层级/素材拖入成层/组投放=原行为零改动;
// · 头行 = 混合模式 + 不透明度(作用于选中图片图层: 自由层/产品图/环境图;文字层无
//   opacity 通道,禁用并提示——不透明度拖动=预览-提交分离,写 el.style.opacity);
// · 右键菜单 = 重命名/锁定/隐藏/排列四向/复制/删除(菜单皮肤=ui.ensureMenuStyle);
// · 页脚 = 🗑 垃圾桶(拖行到此删除,仅自由图层)+ 操作提示。
import React from 'react'
import { getTemplate } from '../registry'
import type { CustomLayer } from '../../templates/CustomLayers'
import { BLEND_MODES } from '../../templates/image-style'
import { lockedOf } from './image-ops'
import { effectiveOrder, useEditor } from './store'
import { buildLayerRows } from './layer-rows'
import { CustomLayerEditor, DelayedTextEditor, ImageLayerEditor, TextStyleEditor } from './layer-editors'
import { ensureMenuStyle, headStyle, iconBtn } from './ui'
import { layerEl } from './canvas-geom'

const THUMB_PX = 30

/** 行缩略图(PhotoCraft 64px 缩略图的小型化;照片行=内嵌小图,文字行=字样,图形行=◇) */
function LayerThumb({ row, layerDefs, props }: {
  row: { id: string; rowType: 'group' | 'free' }
  layerDefs: ReturnType<typeof getTemplate>['layerDefs']
  props: Record<string, unknown>
}): React.ReactElement {
  const def = row.rowType === 'group' ? layerDefs.find((l) => l.id === row.id) : undefined
  const checker = { background: 'repeating-conic-gradient(#2e2e35 0% 25%, #1b1b21 0% 50%) 0 0 / 8px 8px' }
  const box: React.CSSProperties = { width: THUMB_PX, height: THUMB_PX, borderRadius: 4, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }
  if (row.rowType === 'free') {
    const img = (row as { image?: string }).image ?? ''
    return (
      <div style={{ ...box, ...checker, border: '1px solid var(--border)' }}>
        <img src={`/tintin/ipc/cover/acp/asset?name=${encodeURIComponent(img)}`} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      </div>
    )
  }
  const key = def?.propsKey ?? row.id
  const value = props[key]
  if (def?.type === 'text') {
    const styles = (props.styles as Record<string, { scale?: number; gscale?: number; color?: string; font?: string }> | undefined)?.[row.id]
    const raw = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
    return (
      <div style={{ ...box, border: '1px solid var(--border)', background: 'var(--bg-app)', padding: 2 }}>
        <span style={{
          fontSize: 10, lineHeight: 1, color: styles?.color ?? '#e6e6e6', fontWeight: 700,
          fontFamily: styles?.font ? `"${styles.font}", sans-serif` : undefined,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
        }}>{raw || '字'}</span>
      </div>
    )
  }
  if (def?.type === 'product' || key === 'bgImage') {
    const src = typeof value === 'string' && value ? value : ''
    return (
      <div style={{ ...box, ...checker, border: '1px solid var(--border)' }}>
        {src
          ? <img src={`/tintin/ipc/cover/acp/asset?name=${encodeURIComponent(src)}`} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>🖼</span>}
      </div>
    )
  }
  return (
    <div style={{ ...box, border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>◇</span>
    </div>
  )
}

/** 图层面板(行视觉=2026-10-29 用户裁决基座;2026-11-11 WP-B PhotoCraft 化) */
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
  const setProp = useEditor((s) => s.setProp)
  const removeCustomLayer = useEditor((s) => s.removeCustomLayer)
  const setCustomLayer = useEditor((s) => s.setCustomLayer)
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const reorderLayer = useEditor((s) => s.reorderLayer)
  const arrangeLayer = useEditor((s) => s.arrangeLayer)
  const duplicateCustomLayer = useEditor((s) => s.duplicateCustomLayer)
  const customLayers = useEditor((s) => s.props.customLayers) as CustomLayer[] | undefined
  const order = React.useMemo(() => effectiveOrder(useEditor.getState()), [templateId, props])
  const customById = new Map((customLayers ?? []).map((l) => [l.id, l]))
  const tpl = getTemplate(templateId)
  const rows = React.useMemo(
    () => buildLayerRows({ layerDefs: tpl.layerDefs, topToBottom: [...order].reverse(), props, customLayers: customLayers ?? [], hiddenLayers }),
    [tpl, order, props, customLayers, hiddenLayers],
  ) // 顶→底(视觉从上到下);行模型=快照视图模型(方案 B,照 PhotoCraft LayersModel)
  const defOf = (id: string) => tpl.layerDefs.find((l) => l.id === id)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)
  const [assetOverId, setAssetOverId] = React.useState<string | null>(null)
  const [trashHot, setTrashHot] = React.useState(false)
  const [renaming, setRenaming] = React.useState<{ id: string; value: string } | null>(null)
  const [menu, setMenu] = React.useState<{ id: string; x: number; y: number } | null>(null)
  const endDrag = (): void => { setDragId(null); setOverId(null); setAssetOverId(null); setTrashHot(false) }
  /** 显示名:layerNames 优先(双击重命名),缺省=行默认名 */
  const displayName = (row: { rowType: 'group' | 'free'; id: string; label: string }): string => layerNames[row.id] ?? row.label
  /** 素材拖入图层面板(2026-10-30 用户裁决):拖到某层行=作为自定义层插到该层层级位置;
      拖到面板空白处=置顶。同步收纳(非 public 先 asset-sync 到项目素材位)。 */
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
  /** 锁定位置切换(菜单/行锁标同源;自由层写 customLayers[i].locked,槽位写 styles.locked) */
  const toggleLock = (id: string): void => {
    if (id.startsWith('img-')) setCustomLayer(id, { locked: !lockedOf(props, id) })
    else setLayerStyle(id, { locked: !lockedOf(props, id) })
  }
  /* 头行混合/不透明度(2026-11-11 WP-B,对照 layers.rs):作用于选中图片图层。
     文字层无 opacity 通道(模板文字节点不吃 styles.opacity),禁用;不透明度拖动=
     预览写 el.style.opacity,松手提交(同画布手柄的预览-提交分离)。 */
  const selIsImage = Boolean(selectedLayer && (selectedLayer.startsWith('img-') || selectedLayer === 'product' || (defOf(selectedLayer)?.propsKey ?? selectedLayer) === 'bgImage'))
  const selLook = ((): { blend?: string; opacity?: number } => {
    if (!selectedLayer) return {}
    if (selectedLayer.startsWith('img-')) return customById.get(selectedLayer) ?? {}
    return (props.styles as Record<string, { blend?: string; opacity?: number }> | undefined)?.[selectedLayer] ?? {}
  })()
  const [opDraft, setOpDraft] = React.useState<number | null>(null)
  const applyBlend = (mode: string): void => {
    if (!selectedLayer || !selIsImage) return
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
    if (!selectedLayer || !selIsImage) return
    const op = Math.min(1, Math.max(0, v / 100))
    if (selectedLayer.startsWith('img-')) setCustomLayer(selectedLayer, { opacity: op })
    else setLayerStyle(selectedLayer, { opacity: op })
  }
  /* 右键菜单动作 */
  const menuRow = menu ? rows.find((r): r is Extract<typeof r, { rowType: 'group' | 'free' }> => ('id' in r ? r.id === menu.id : false)) : null
  return (
    <div style={{ flex: '1 1 auto', minHeight: 0, background: 'var(--bg-panel)', padding: 12, display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ ...headStyle, display: 'flex', alignItems: 'center' }}>
        {/* 标题字体对齐项目 tab(2026-10-30 用户裁决:11.5 + tab 同亮色,去字距) */}
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', letterSpacing: 'normal' }}>图层 · {tpl.label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>拖 ⠿ 调层级</span>
      </div>
      {/* 头行=混合模式+不透明度(PhotoCraft layers.rs;选中图片图层时生效) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexShrink: 0 }}>
        <select
          value={selLook.blend ?? 'normal'}
          disabled={!selIsImage}
          onChange={(e) => applyBlend(e.target.value)}
          title={selIsImage ? '图层混合模式' : '混合模式仅作用于图片图层(自由层/产品图/环境图)'}
          style={{ flex: 1, minWidth: 0, background: 'var(--bg-field)', color: selIsImage ? 'var(--text)' : 'var(--text-faint)', border: '1px solid var(--border-strong)', borderRadius: 6, fontSize: 11, padding: '3px 4px', cursor: selIsImage ? 'pointer' : 'default' }}
        >
          {BLEND_MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <input
          type="range" min={0} max={100} step={1}
          value={opDraft ?? Math.round((selLook.opacity ?? 1) * 100)}
          disabled={!selIsImage}
          onChange={(e) => previewOpacity(Number(e.target.value))}
          onPointerUp={(e) => commitOpacity(Number(e.currentTarget.value))}
          onKeyUp={(e) => commitOpacity(Number(e.currentTarget.value))}
          onBlur={(e) => commitOpacity(Number(e.currentTarget.value))}
          title={selIsImage ? '图层不透明度' : '不透明度仅作用于图片图层'}
          style={{ width: 64, accentColor: 'var(--accent)', cursor: selIsImage ? 'pointer' : 'default' }}
        />
        <span style={{ fontSize: 10, color: 'var(--text-faint)', width: 30, textAlign: 'right' }}>{opDraft ?? Math.round((selLook.opacity ?? 1) * 100)}%</span>
      </div>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-tintin-cover-layer')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
        }}
        onDrop={(e) => {
          e.preventDefault()
          const assetName = e.dataTransfer.getData('application/x-tintin-cover-layer')
          if (assetName) dropAssetAsLayer(assetName, null)
          setAssetOverId(null)
        }}
      >
        {rows.map((row) => {
          if (row.rowType === 'default') {
            /* 默认图层行(图层组阶段 1):缩进挂在组头下,点击=选中该组进编辑;不独立参与 z 拖拽 */
            const selected = selectedLayer === row.groupId
            return (
              <div
                key={`${row.groupId}:default`}
                onClick={() => selectLayer(row.groupId)}
                style={{
                  marginLeft: 20, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', userSelect: 'none',
                  fontSize: 11, color: row.hidden ? 'var(--text-faint)' : '#a9a9af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  background: selected ? 'var(--bg-selected)' : 'transparent',
                }}
              >
                └ 默认图层 · {row.detail}
              </div>
            )
          }
          const id = row.id
          const selected = selectedLayer === id
          const isOver = overId === id && dragId !== null && dragId !== id
          const isGroup = row.rowType === 'group'
          const free = row.rowType === 'free' ? (row as Extract<typeof row, { rowType: 'free' }>) : null
          const nameEl = renaming?.id === id ? (
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
              style={{ minWidth: 0, flex: 1, background: 'var(--bg-field)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 5, fontSize: 12, padding: '0 5px', outline: 'none' }}
            />
          ) : (
            <span
              onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ id, value: displayName(row) }) }}
              title={displayName(row) + '(双击重命名)'}
              style={{ flex: 1, minWidth: 0, fontSize: 12, color: row.hidden ? 'var(--text-faint)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: (isGroup ? 0 : 10) + (free?.group ? 0 : isGroup ? 0 : 0) }}
            >
              {free?.group && defOf(free.group) ? <span style={{ fontSize: 9.5, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 4px', marginRight: 5 }}>{defOf(free.group)?.label}</span> : null}
              {displayName(row)}
            </span>
          )
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
              onDragOver={(e) => {
                if (dragId && dragId !== id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverId(id); return }
                /* 素材拖入图层行/组行(2026-10-30 用户裁决):高亮,松手=插到该层层级位置(图片组=加入本组) */
                if (!dragId && e.dataTransfer.types.includes('application/x-tintin-cover-layer')) {
                  e.preventDefault(); e.dataTransfer.dropEffect = isGroup && row.imageGroup ? 'copy' : 'copy'; setAssetOverId(id)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const assetName = e.dataTransfer.getData('application/x-tintin-cover-layer')
                if (assetName && isGroup && row.imageGroup) {
                  /* 阶段2 叠放:素材拖到图片组=加入本组(成员层,几何=画布中上,可再拖动微调) */
                  void (async () => {
                    try {
                      if (!assetName.startsWith('public/')) {
                        await fetch('/tintin/ipc/cover/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: assetName }) })
                      }
                      const newId = useEditor.getState().addCustomLayer(assetName.replace(/^public\//, ''), Math.round(tpl.width / 2 - 180), Math.round(tpl.height / 3), 360, id)
                      reorderLayer(newId, id)
                      useEditor.getState().selectLayer(newId)
                    } catch { /* 同步失败静默(同画布口径) */ }
                  })()
                  endDrag(); return
                }
                if (assetName) { dropAssetAsLayer(assetName, id); endDrag(); return }
                if (dragId && dragId !== id) reorderLayer(dragId, id)
                endDrag()
              }}
              onDragEnd={endDrag}
              onDragLeave={(e) => { if (assetOverId === id && !e.currentTarget.contains(e.relatedTarget as Node)) setAssetOverId(null) }}
              onClick={() => selectLayer(id)}
              onContextMenu={(e) => { e.preventDefault(); selectLayer(id); setMenu({ id, x: e.clientX, y: e.clientY }) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 8,
                cursor: 'default', userSelect: 'none',
                background: selected ? 'var(--bg-selected)' : 'var(--bg-hover)',
                border: selected
                  ? '1px solid var(--accent)'
                  : assetOverId === id ? '1px dashed var(--accent)'
                  : '1px solid transparent',
                boxShadow: isOver ? 'inset 0 2px 0 var(--accent)' : 'none',
                opacity: dragId === id ? 0.45 : 1,
              }}
            >
              <button
                title={row.hidden ? '显示' : '隐藏'}
                onClick={(e) => { e.stopPropagation(); toggleLayer(id) }}
                style={{ ...iconBtn, opacity: row.hidden ? 0.35 : 1, width: 22, height: 22, fontSize: 12 }}
              >{row.hidden ? '🚫' : '👁'}</button>
              <LayerThumb row={row} layerDefs={tpl.layerDefs} props={props} />
              {nameEl}
              {isGroup && row.members > 0 ? <span style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0 }}>{row.members} 层</span> : null}
              {lockedOf(props, id) ? <button title="已锁定位置(点击解锁;菜单可再锁)" onClick={(e) => { e.stopPropagation(); toggleLock(id) }} style={{ ...iconBtn, width: 20, height: 22, fontSize: 11 }}>🔒</button> : null}
              {isGroup ? <span title="图层组:素材拖到组上=加入本组(图片组,叠放)" style={{ fontSize: 9.5, color: 'var(--text-faint)', border: '1px solid var(--border-strong)', borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>组</span> : null}
              {/* 拖动柄放行尾(2026-10-30 用户裁决) */}
              <span title="拖动调层级" style={{ color: 'var(--text-faint)', fontSize: 11, flexShrink: 0, cursor: 'grab' }}>⠿</span>
            </div>
          )
        })}
      </div>
      {/* 页脚(PhotoCraft 页脚垃圾桶;仅自由图层可删——文字/图形槽位无删除语义) */}
      <div
        onDragOver={(e) => { if (dragId && dragId.startsWith('img-')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setTrashHot(true) } }}
        onDragLeave={() => setTrashHot(false)}
        onDrop={(e) => {
          e.preventDefault()
          if (dragId && dragId.startsWith('img-')) removeCustomLayer(dragId)
          endDrag()
        }}
        style={{
          marginTop: 'auto', paddingTop: 8, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
          borderRadius: 8, border: trashHot ? '1px dashed var(--err)' : '1px solid transparent', padding: 6,
          background: trashHot ? 'rgba(242,102,95,0.12)' : 'transparent', transition: 'background .12s',
        }}
      >
        <span style={{ fontSize: 14, opacity: trashHot ? 1 : 0.5 }}>🗑</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{trashHot ? '松手删除图层' : '拖自由图层到此处删除 · 右键行=菜单 · 双击名字=重命名'}</span>
      </div>
      {/* 右键菜单(重命名/锁定/隐藏/排列/复制/删除;皮肤与素材面板同款) */}
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
      {/* 选中图层编辑:固定层走原文字/图片编辑;自定义层 = 宽度/透明度/旋转 */}
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
            <div style={{ marginTop: 14 }}>
              <div style={headStyle}>编辑「{layerNames[layer.id] ?? layer.label}」</div>
              <DelayedTextEditor key={layer.id} value={text} isArray={Array.isArray(value)}
                rows={Array.isArray(value) ? Math.max(3, value.length + 1) : 3}
                onCommit={(v) => setProp(key, Array.isArray(value) ? v.split('\n') : v)} />
              {/* 钩子行管理(§2.5 P2):逐行删/加一行;文案编辑仍在上方文本框 */}
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
              <TextStyleEditor layerId={layer.id} baseFontSize={layer.fontSize ?? 36} />
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                {Array.isArray(value) ? '每行一条(钩子/卖点);末行默认跳色可被颜色覆盖' : '支持中文;改动即时预览'}
              </div>
            </div>
          )
        }
        if (layer.type === 'product' || key === 'bgImage') {
          return <ImageLayerEditor layerId={layer.id} layerLabel={layerNames[layer.id] ?? layer.label} propKey={key} project={project} />
        }
        /* 装饰层的文案可编辑(2026-10-30 用户裁决:品牌条/栏目角标等不再锁死) */
        if (typeof value === 'string') {
          return (
            <div style={{ marginTop: 14 }}>
              <div style={headStyle}>编辑「{layerNames[layer.id] ?? layer.label}」</div>
              <DelayedTextEditor key={layer.id} value={value} isArray={false}
                onCommit={(v) => setProp(key, v)} />
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>装饰层文案,改动即时预览;字号/配色由模板排版</div>
            </div>
          )
        }
        return null
      })()}
    </div>
  )
}
