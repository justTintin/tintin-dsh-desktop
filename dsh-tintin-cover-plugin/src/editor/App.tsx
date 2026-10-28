// 封面制作编辑器(WP-6 MVP):三栏 = 图层面板 | Player 实时画布 | 会话/导出面板。
// 铁律 8:本文件属插件包;样式内联,无外部 UI 库依赖(积木选型见需求文档 §9.8)。
import { Player } from '@remotion/player'
import React from 'react'
import { getTemplate, templateOfOrientation, type LayerDef } from '../registry'
import { FONT_WHITELIST } from '../../templates/text-style'
import { checkCurrent, undo, useEditor } from './store'

function LayersPanel(): React.ReactElement {
  const { templateId, hiddenLayers, selectedLayer, toggleLayer, selectLayer, setProp, props } = useEditor()
  const tpl = getTemplate(templateId)
  return (
    <div style={panelStyle}>
      <div style={headStyle}>图层 · {tpl.label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {[...tpl.layerDefs].reverse().map((l) => {
          const hidden = hiddenLayers.includes(l.id)
          const selected = selectedLayer === l.id
          return (
            <div
              key={l.id}
              onClick={() => selectLayer(l.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8,
                cursor: 'pointer', userSelect: 'none',
                background: selected ? 'rgba(79,124,255,0.18)' : 'transparent',
                border: selected ? '1px solid rgba(79,124,255,0.55)' : '1px solid transparent',
              }}
            >
              <button
                title={hidden ? '显示' : '隐藏'}
                onClick={(e) => { e.stopPropagation(); toggleLayer(l.id) }}
                style={{ ...iconBtn, opacity: hidden ? 0.35 : 1 }}
              >{hidden ? '🚫' : '👁'}</button>
              <span style={{ fontSize: 12 }}>{icon(l.type)}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: hidden ? '#8b8b88' : '#e8e8e6' }}>{l.label}</span>
              {l.type === 'text' && !hidden && (
                <span style={{ color: '#8b8b88', fontSize: 10 }}>点击画布下编辑</span>
              )}
            </div>
          )
        })}
      </div>
      {/* 选中图层的文字编辑(§9.3:面板改的与会话改的是同一份 props) */}
      {(() => {
        const layer = tpl.layerDefs.find((l) => l.id === selectedLayer)
        if (!layer || hiddenLayers.includes(layer.id)) return null
        const key = layer.propsKey ?? layer.id
        const value = props[key]
        if (layer.type === 'text') {
          const text = Array.isArray(value) ? value.join('\n') : String(value ?? '')
          return (
            <div style={{ marginTop: 14 }}>
              <div style={headStyle}>编辑「{layer.label}」</div>
              <textarea
                value={text}
                rows={Array.isArray(value) ? Math.max(3, value.length + 1) : 3}
                onChange={(e) => {
                  if (Array.isArray(value)) setProp(key, e.target.value.split('\n'))
                  else setProp(key, e.target.value)
                }}
                style={inputStyle({ height: 'auto', resize: 'vertical', minHeight: 64, fontFamily: 'inherit' })}
              />
              <TextStyleEditor layerId={layer.id} />
              <div style={{ fontSize: 10.5, color: '#8b8b88', marginTop: 4 }}>
                {Array.isArray(value) ? '每行一条(钩子/卖点);末行默认跳色可被颜色覆盖' : '支持中文;改动即时预览'}
              </div>
            </div>
          )
        }
        // 图片图层(产品图/环境图):上传替换 + 环境图可 AI 生成
        if (layer.type === 'product' || key === 'bgImage') {
          return <ImageLayerEditor layerLabel={layer.label} propKey={key} />
        }
        return null
      })()}
      <div style={{ marginTop: 'auto', paddingTop: 10 }}>
        <button style={ghostBtn} onClick={() => undo()} title="撤销上一步(会话与面板操作同栈)">↩ 撤销</button>
      </div>
    </div>
  )
}

/** 图片图层编辑器:上传产品图/底图 + AI 生成底图(仅 bgImage;分钟级) */
function ImageLayerEditor({ layerLabel, propKey }: { layerLabel: string; propKey: string }): React.ReactElement {
  const setProp = useEditor((s) => s.setProp)
  const current = useEditor((s) => s.props[propKey])
  const [state, setState] = React.useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: '', ok: true })
  const inputRef = React.useRef<HTMLInputElement>(null)
  const isBg = propKey === 'bgImage'
  const [bgPrompt, setBgPrompt] = React.useState('')
  const genEngine = useEditor((s) => s.genEngine)
  const tplForAspect = useEditor((s) => s.templateId)
  const upload = (file: File): void => {
    setState({ busy: true, msg: `上传 ${file.name}…`, ok: true })
    void file.arrayBuffer()
      .then((buf) => fetch(`/tintin/cover/api/upload-image?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: buf,
      }))
        .then((r) => r.json())
        .then((r: { ok: boolean; name?: string; error?: string }) => {
          if (r.ok && r.name) {
            setProp(propKey, r.name)
            setState({ busy: false, msg: `✓ 已应用 ${r.name}`, ok: true })
          } else setState({ busy: false, msg: `✗ ${r.error || '上传失败'}`, ok: false })
        })
      .catch((e) => setState({ busy: false, msg: `✗ ${String(e)}`, ok: false }))
  }
  const generateBg = (): void => {
    if (!bgPrompt.trim()) { setState({ busy: false, msg: '先描述画面(不含文字)', ok: false }); return }
    setState({ busy: true, msg: 'AI 生成底图中…(分钟级,勿关页面)', ok: true })
    void fetch('/tintin/cover/api/generate-background', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: bgPrompt.trim(), aspect: getTemplate(tplForAspect).orientation === 'portrait' ? '9:16' : '16:9', engine: genEngine }),
    })
      .then((r) => r.json())
      .then((r: { ok: boolean; name?: string; error?: string }) => {
        if (r.ok && r.name) {
          setProp(propKey, r.name)
          setState({ busy: false, msg: `✓ 底图已应用 ${r.name}`, ok: true })
        } else setState({ busy: false, msg: `✗ ${r.error || '生成失败'}`, ok: false })
      })
      .catch((e) => setState({ busy: false, msg: `✗ ${String(e)}`, ok: false }))
  }
  return (
    <div style={{ marginTop: 14 }}>
      <div style={headStyle}>图片「{layerLabel}」</div>
      <div style={{ fontSize: 11, color: '#8b8b88', marginBottom: 8, wordBreak: 'break-all' }}>
        当前:{typeof current === 'string' && current ? current : '(未设置,用模板默认)'}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          disabled={state.busy}
          onClick={() => inputRef.current?.click()}
          style={ghostBtn}
          title="上传 jpg/png/webp(≤15MB);白底图在深色模板会自动羽化"
        >{state.busy && !isBg ? '上传中…' : '⬆ 上传图片'}</button>
        {current ? (
          <button onClick={() => { setProp(propKey, undefined); setState({ busy: false, msg: '已恢复默认', ok: true }) }} style={ghostBtn}>恢复默认</button>
        ) : null}
      </div>
      {isBg ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...headStyle, marginTop: 0 }}>AI 生成底图(文字由模板排版,画面里别写文案)</div>
          <textarea
            value={bgPrompt}
            rows={3}
            onChange={(e) => setBgPrompt(e.target.value)}
            placeholder="如:深夜城市赛博朋克街道,蓝色霓虹光晕,科技感,无文字"
            style={inputStyle({ height: 'auto', resize: 'vertical', minHeight: 52, fontFamily: 'inherit' })}
          />
          <button
            disabled={state.busy}
            onClick={generateBg}
            style={{
              width: '100%', marginTop: 6, padding: '8px 0', borderRadius: 8, border: 0, cursor: state.busy ? 'default' : 'pointer',
              background: state.busy ? 'rgba(79,124,255,0.4)' : 'linear-gradient(135deg,#4f7cff,#22d3ee)', color: '#fff', fontSize: 12.5, fontWeight: 700,
            }}
          >{state.busy ? '生成中…(分钟级)' : '✦ AI 生成底图'}</button>
        </div>
      ) : propKey === 'image' ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...headStyle, marginTop: 0 }}>AI 重绘(图生图:以当前产品图为参考)</div>
          <textarea
            value={bgPrompt}
            rows={2}
            onChange={(e) => setBgPrompt(e.target.value)}
            placeholder="如:把产品放在赛博展台上,蓝紫氛围光"
            style={inputStyle({ height: 'auto', resize: 'vertical', minHeight: 44, fontFamily: 'inherit' })}
          />
          <button
            disabled={state.busy || !current}
            onClick={() => {
              if (!bgPrompt.trim()) { setState({ busy: false, msg: '先描述想要的场景/风格', ok: false }); return }
              setState({ busy: true, msg: genEngine === 'jimeng' ? '图生图中…(即梦通道,分钟级)' : '生成中…(服务端,分钟级)', ok: true })
              void fetch('/tintin/cover/api/generate-product', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ prompt: bgPrompt.trim(), image: String(current), engine: genEngine }),
              })
                .then((r) => r.json())
                .then((r: { ok: boolean; name?: string; error?: string }) => {
                  if (r.ok && r.name) {
                    setProp(propKey, r.name)
                    setState({ busy: false, msg: `✓ 已重绘 ${r.name}`, ok: true })
                  } else setState({ busy: false, msg: `✗ ${r.error || '重绘失败'}`, ok: false })
                })
                .catch((e) => setState({ busy: false, msg: `✗ ${String(e)}`, ok: false }))
            }}
            style={{
              width: '100%', marginTop: 6, padding: '8px 0', borderRadius: 8, border: 0, cursor: state.busy ? 'default' : 'pointer',
              background: state.busy ? 'rgba(79,124,255,0.4)' : '#2f3352', color: '#e8e8e6', fontSize: 12.5, fontWeight: 700,
            }}
            title={current ? '即梦 image2image' : '先上传产品图作参考'}
          >{state.busy ? '重绘中…(分钟级)' : current ? '✦ AI 重绘产品图' : '✦ 需先上传产品图'}</button>
        </div>
      ) : null}
      {state.msg ? <div style={{ marginTop: 6, fontSize: 11, color: state.ok ? '#22c55e' : '#f87171', wordBreak: 'break-all' }}>{state.msg}</div> : null}
    </div>
  )
}

/** 文字样式细调:字号缩放(0.5..1.8)+ 颜色预设;存 props.styles(§9.3 同一份 props 投影) */
const STYLE_COLORS = ['#ffffff', '#22d3ee', '#facc15', '#f97316', '#f87171', '#4ade80', '#93c5fd', '#0f172a']

function TextStyleEditor({ layerId }: { layerId: string }): React.ReactElement {
  const styles = useEditor((s) => (s.props.styles as Record<string, { scale?: number; color?: string; dx?: number; dy?: number; font?: string }> | undefined)?.[layerId])
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const scale = styles?.scale ?? 1
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(127,127,127,0.07)', border: '1px solid #2c2c30' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#8b8b88', flexShrink: 0 }}>字号</span>
        <input
          type="range" min="0.5" max="1.8" step="0.05" value={scale}
          onChange={(e) => setLayerStyle(layerId, { scale: Number(e.target.value) })}
          style={{ flex: 1, accentColor: '#4f7cff' }}
        />
        <span style={{ fontSize: 11, color: '#e8e8e6', width: 34, textAlign: 'right' }}>{scale.toFixed(2)}×</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#8b8b88' }}>颜色</span>
        {STYLE_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setLayerStyle(layerId, styles?.color === c ? { color: undefined } : { color: c })}
            title={styles?.color === c ? `${c}(点击还原默认)` : c}
            style={{
              width: 20, height: 20, borderRadius: 999, cursor: 'pointer', padding: 0,
              background: c, border: styles?.color === c ? '2px solid #4f7cff' : '1px solid #555',
            }}
          />
        ))}
        {(styles?.scale !== undefined || styles?.color !== undefined || styles?.dx !== undefined || styles?.dy !== undefined) ? (
          <button onClick={() => setLayerStyle(layerId, null)} style={{ ...ghostBtn, width: 'auto', padding: '2px 10px', fontSize: 10.5, marginLeft: 'auto' }}>重置样式</button>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#8b8b88', flexShrink: 0 }}>字体</span>
        <select
          value={styles?.font ?? ''}
          onChange={(e) => setLayerStyle(layerId, e.target.value ? { font: e.target.value } : { font: undefined })}
          style={inputStyle({ flex: 1, height: 26, fontSize: 12 })}
        >
          <option value="">默认(黑体系)</option>
          {FONT_WHITELIST.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#8b8b88', flexShrink: 0 }}>位置</span>
        <span style={{ fontSize: 10.5, color: '#8b8b88' }}>X</span>
        <input
          type="range" min="-360" max="360" step="4" value={styles?.dx ?? 0}
          onChange={(e) => setLayerStyle(layerId, { dx: Number(e.target.value) })}
          style={{ flex: 1, accentColor: '#4f7cff' }}
        />
        <span style={{ fontSize: 10.5, color: '#8b8b88' }}>Y</span>
        <input
          type="range" min="-360" max="360" step="4" value={styles?.dy ?? 0}
          onChange={(e) => setLayerStyle(layerId, { dy: Number(e.target.value) })}
          style={{ flex: 1, accentColor: '#4f7cff' }}
        />
      </div>
    </div>
  )
}

function CanvasPanel(): React.ReactElement {
  const { templateId, props, hiddenLayers } = useEditor()
  const tpl = getTemplate(templateId)
  const selectLayer = useEditor((s) => s.selectLayer)
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ layerId: string; startX: number; startY: number; baseDx: number; baseDy: number; scale: number } | null>(null)
  // PhotoCraft 为主(2026-10-27 15:09 裁决):画布 = PhotoCraft 截图轮询
  const [pcRunning, setPcRunning] = React.useState<boolean | null>(null) // null=未探测
  const [shot, setShot] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (pcRunning === false) return
    let stop = false
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch('/tintin/cover/api/pc/screenshot').then((resp) => resp.json())
        if (!stop && r.ok && r.data) { setPcRunning(true); setShot(`data:image/png;base64,${r.data}`) }
        else if (!stop && pcRunning === null) setPcRunning(false)
      } catch { if (!stop) setPcRunning(false) }
    }
    void tick()
    const t = setInterval(tick, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [pcRunning])

  const layerAt = (clientX: number, clientY: number): string | null => {
    const host = hostRef.current
    if (!host) return null
    const el = document.elementFromPoint(clientX, clientY)
    const marked = el instanceof Element ? el.closest('[data-cover-layer]') : null
    if (!marked || !host.contains(marked)) return null
    const id = marked.getAttribute('data-cover-layer') || ''
    return hiddenLayers.includes(id) ? null : id
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (pcRunning) return // PhotoCraft 为主:画布交互在原生窗口,网页仅镜像
    const id = layerAt(e.clientX, e.clientY)
    selectLayer(id)
    if (!id) return
    const host = hostRef.current
    if (!host) return
    const styles = (props.styles as Record<string, { dx?: number; dy?: number }> | undefined)?.[id]
    dragRef.current = {
      layerId: id,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: styles?.dx ?? 0,
      baseDy: styles?.dy ?? 0,
      scale: host.getBoundingClientRect().width / tpl.width,
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    if (drag) {
      const dx = drag.baseDx + Math.round((e.clientX - drag.startX) / Math.max(drag.scale, 0.05))
      const dy = drag.baseDy + Math.round((e.clientY - drag.startY) / Math.max(drag.scale, 0.05))
      setLayerStyle(drag.layerId, { dx, dy })
    } else {
      // 悬停手型反馈
      const host = hostRef.current
      if (host) host.style.cursor = layerAt(e.clientX, e.clientY) ? 'grab' : 'default'
    }
  }
  const onPointerUp = (): void => { dragRef.current = null }

  return (
    <div
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#101012', gap: 12 }}>
      {pcRunning ? (
        <>
          {shot ? <img src={shot} alt="PhotoCraft" style={{ maxWidth: '96%', maxHeight: '74vh', borderRadius: 10, boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }} /> : null}
          <div style={{ color: '#8b8b88', fontSize: 11 }}>PhotoCraft 实时镜像 · 图层与编辑在 PhotoCraft 窗口 · 会话可直接驱动</div>
        </>
      ) : (
        <>
      {pcRunning === false ? (
        <div style={{ color: '#8b8b88', fontSize: 11, marginBottom: 8 }}>模板快出模式 · 点右上角 🎛 启动 PhotoCraft 精修</div>
      ) : null}
          <Player
            component={tpl.component}
            inputProps={{ ...props, hiddenLayers }}
            durationInFrames={1}
            compositionWidth={tpl.width}
            compositionHeight={tpl.height}
            fps={30}
            style={tpl.height > tpl.width
              ? { height: '76vh', width: 'auto', aspectRatio: `${tpl.width}/${tpl.height}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }
              : { width: '100%', maxWidth: 920, borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }}
          />
          <div style={{ color: '#8b8b88', fontSize: 11 }}>
            {tpl.width}×{tpl.height} · 模板快出模式 · 点选文字可直接拖动 · 导出走 renderStill
          </div>
        </>
      )}
    </div>
  )
}

function SessionPanel(): React.ReactElement {
  const { templateId, lastExport } = useEditor()
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<{ done: number; total: number; files: string[]; errors: string[] } | null>(null)
  const [targets, setTargets] = React.useState([
    { key: 'landscape', label: '横屏', size: '1280×720', checked: true, variant: '' },
    { key: 'portrait', label: '竖屏', size: '1080×1440', checked: true, variant: '-portrait' },
    { key: 'square', label: '方屏', size: '1080×1080', checked: false, variant: '' },
  ])
  const family = getTemplate(templateId).family
  const exportCover = async (): Promise<void> => {
    const check = checkCurrent()
    if (!check.ok) { useEditor.getState().setLastExport({ ok: false, error: check.error }); return }
    const selected = targets.filter((t) => t.checked)
    if (!selected.length) { useEditor.getState().setLastExport({ ok: false, error: '未选择导出格式' }); return }
    setBusy(true)
    setProgress({ done: 0, total: selected.length, files: [], errors: [] })
    const s = useEditor.getState()
    const files: string[] = []
    const errors: string[] = []
    for (const [i, target] of selected.entries()) {
      const variant = target.variant || ''
      const tid = family + variant
      try {
        const r = await fetch('/api/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId: tid, props: s.props, fileName: `${s.templateId.replace(/-portrait$/, '')}-${target.key}` }),
        }).then((resp) => resp.json())
        if (r.ok && r.file) { files.push(r.file) } else { errors.push(`${target.label}: ${r.error || '?'}`) }
      } catch (e) { errors.push(`${target.label}: ${String(e)}`) }
      setProgress({ done: i + 1, total: selected.length, files: [...files], errors: [...errors] })
    }
    s.setLastExport({ ok: errors.length === 0, error: errors.join('; ') || undefined })
    setProgress((prev) => prev ? { ...prev, files: [...files] } : prev)
    setBusy(false)
  }
  const toggle = (key: string): void => {
    setTargets((ts) => ts.map((t) => (t.key === key ? { ...t, checked: !t.checked } : t)))
  }
  return (
    <div style={panelStyle}>
      <div style={headStyle}>生图引擎</div>
      <EngineToggle />
      <ChatPanel />
      <div style={{ flex: 1 }} />
      <div style={headStyle}>导出</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {targets.map((t) => (
          <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={t.checked} onChange={() => toggle(t.key)} style={{ accentColor: '#4f7cff' }} />
            <span>{t.label}</span>
            <span style={{ color: '#8b8b88', fontSize: 10.5, marginLeft: 'auto' }}>{t.size}</span>
          </label>
        ))}
      </div>
      <button
        disabled={busy}
        onClick={() => void exportCover()}
        style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: 0, cursor: busy ? 'default' : 'pointer',
          background: busy ? 'rgba(79,124,255,0.4)' : 'var(--primary, #4f7cff)', color: '#fff', fontSize: 13, fontWeight: 700,
        }}
      >{busy ? `渲染中 ${progress?.done ?? 0}/${progress?.total ?? 0}…` : '导出 PNG(落工作目录 cover/)'}</button>
      {progress && (progress.files.length > 0 || progress.errors.length > 0) ? (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          {progress.files.map((f) => <div key={f} style={{ color: '#22c55e', wordBreak: 'break-all', userSelect: 'text' }}>✓ {f}</div>)}
          {progress.errors.map((e, i) => <div key={i} style={{ color: '#f87171', wordBreak: 'break-all' }}>✗ {e}</div>)}
        </div>
      ) : null}
      {lastExport && !progress && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: lastExport.ok ? '#22c55e' : '#f87171', wordBreak: 'break-all', userSelect: 'text' }}>
          {lastExport.ok ? `✓ ${lastExport.file}` : `✗ ${lastExport.error}`}
          {lastExport.ok ? (
            <button
              onClick={() => { void fetch('/tintin/cover/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {}) }}
              style={{ ...ghostBtn, display: 'inline-block', width: 'auto', padding: '3px 10px', fontSize: 10.5, marginLeft: 8 }}
            >📂 打开目录</button>
          ) : null}
        </div>
      )}
    </div>
  )
}


/** 横竖屏设置(2026-10-27 裁决:设置=横竖屏;同族切换保留内容) */
function OrientationToggle(): React.ReactElement {
  const templateId = useEditor((s) => s.templateId)
  const setOrientation = useEditor((s) => s.setOrientation)
  const current = getTemplate(templateId).orientation
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
      {([['landscape', '横屏'], ['portrait', '竖屏']] as const).map(([value, label]) => (
        <button
          key={value}
          onClick={() => setOrientation(value)}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            background: current === value ? 'rgba(79,124,255,0.25)' : 'rgba(127,127,127,0.08)',
            border: current === value ? '1px solid rgba(79,124,255,0.6)' : '1px solid transparent',
            color: current === value ? '#bfdbfe' : '#e8e8e6', fontWeight: 700,
          }}
        >{label} {current === value ? '●' : ''}</button>
      ))}
    </div>
  )
}

/** 生图通道(2026-10-27 终态裁决:生图统一走服务端 comfygen;即梦降为备用,UI 下线) */
function EngineToggle(): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '7px 10px', borderRadius: 8, background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.35)' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#a5f3fc' }}>生图:服务端 comfygen</span>
      <span style={{ fontSize: 10.5, color: '#8b8b88' }}>(即梦为备用通道,未在界面开放)</span>
    </div>
  )
}

/** 会话框(2026-10-27 裁决批次 B):真实对话回路 + @ 图层引用 + / 快捷命令 */
interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  text: string
  actions?: string[]
}

interface SlashCommand {
  cmd: string
  label: string
  action: () => void
}

const SLASH_COMMANDS: Array<{ cmd: string; desc: string; op: string; extra?: Record<string, unknown> }> = [
  { cmd: '/导出', desc: '导出当前封面 PNG', op: 'export' },
  { cmd: '/竖屏', desc: '切换为竖屏布局', op: 'set_orientation', extra: { orientation: 'portrait' } },
  { cmd: '/横屏', desc: '切换为横屏布局', op: 'set_orientation', extra: { orientation: 'landscape' } },
  { cmd: '/生成底图', desc: 'AI 生成环境底图(需要描述)', op: 'generate_environment' },
]

function ChatPanel(): React.ReactElement {
  const templateId = useEditor((s) => s.templateId)
  const tpl = getTemplate(templateId)
  const [messages, setMessages] = React.useState<ChatMsg[]>([
    { role: 'system', text: '我是封面助手:直接说改哪层怎么改(如「主标题改成 0.2ms 超快光轴」「环境图换深夜霓虹」「竖屏」)。' },
  ])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  /** 会话动作 → 画布操作(图层词汇 = 注册表 layer id) */
  const applyAction = async (a: { op: string; [k: string]: unknown }): Promise<string> => {
    const s = useEditor.getState()
    const tpl = getTemplate(s.templateId)
    const def = tpl.layerDefs.find((l) => l.id === a.layer)
    switch (a.op) {
      case 'set_text': {
        if (!def) return `✗ 未知图层 ${String(a.layer)}`
        const key = def.propsKey ?? def.id
        const cur = s.props[key]
        let value: unknown = String(a.text ?? '')
        if (Array.isArray(cur)) value = String(a.text ?? '').split('\n')
        s.setProp(key, value)
        return `✎ ${def.label}:已改文字`
      }
      case 'set_style': {
        if (!def) return `✗ 未知图层 ${String(a.layer)}`
        const patch: Record<string, unknown> = {}
        for (const k of ['scale', 'color', 'dx', 'dy', 'font']) if (a[k] !== undefined) patch[k] = a[k]
        s.setLayerStyle(def.id, patch as never)
        return `✎ ${def.label}:样式已更新`
      }
      case 'toggle_layer': {
        if (!def) return `✗ 未知图层 ${String(a.layer)}`
        s.toggleLayer(def.id)
        return `👁 ${def.label}:切换显隐`
      }
      case 'set_orientation':
        s.setOrientation(a.orientation === 'portrait' ? 'portrait' : 'landscape')
        return `⇄ 已切${a.orientation === 'portrait' ? '竖屏' : '横屏'}`
      case 'generate_environment': {
        const r = await fetch('/tintin/cover/api/generate-background', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: String(a.prompt || ''),
            aspect: getTemplate(s.templateId).orientation === 'portrait' ? '9:16' : '16:9',
            engine: s.genEngine,
          }),
        }).then((resp) => resp.json())
        if (r.ok && r.name) {
          const envDef = tpl.layerDefs.find((l) => l.type === 'environment')
          if (envDef) s.setProp(envDef.propsKey ?? envDef.id, r.name)
          return `🖼 环境图已生成并应用(${r.name})`
        }
        return `✗ 环境图生成失败:${r.error || '?'}`
      }
      case 'generate_product': {
        const prodDef = tpl.layerDefs.find((l) => l.type === 'product')
        const curImage = prodDef ? s.props[prodDef.propsKey ?? prodDef.id] : undefined
        const r = await fetch('/tintin/cover/api/generate-product', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: String(a.prompt || ''), image: typeof curImage === 'string' ? curImage : '', engine: s.genEngine }),
        }).then((resp) => resp.json())
        if (r.ok && r.name) {
          if (prodDef) s.setProp(prodDef.propsKey ?? prodDef.id, r.name)
          return `📷 产品图已重绘并应用(${r.name})`
        }
        return `✗ 产品图重绘失败:${r.error || '?'}`
      }
      case 'export': {
        const check = checkCurrent()
        if (!check.ok) return `✗ ${check.error}`
        const r = await fetch('/tintin/cover/api/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId: s.templateId, props: s.props }),
        }).then((resp) => resp.json())
        if (r.ok) {
          s.setLastExport(r)
          return `✓ 已导出 ${r.file}`
        }
        s.setLastExport(r)
        return `✗ 导出失败:${r.error || '?'}`
      }
      default:
        return `✗ 未支持动作 ${a.op}`
    }
  }

  const send = (): void => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text }])
    setBusy(true)
    const s = useEditor.getState()
    const tpl = getTemplate(s.templateId)
    const contextText = `当前模板: ${s.templateId} (${tpl.width}×${tpl.height})\n图层: ${tpl.layerDefs.map((l) => `${l.id}(${l.label})`).join(', ')}\n当前内容: ${JSON.stringify(Object.fromEntries(Object.entries(s.props).filter(([k]) => k !== 'styles')))}`

    // ACP 模式:先确认会话,再发消息
    void fetch('/tintin/cover/api/pc/acp-start', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then(() => fetch('/tintin/cover/api/pc/acp-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `${text}\n\n${contextText}` }),
      }))
      .then((r) => r.json())
      .then((r: { ok: boolean; stopReason?: string; error?: string }) => {
        setBusy(false)
        setMessages((m) => [...m, { role: 'assistant', text: r.ok ? `agent 完成(stop: ${r.stopReason})` : `✗ ${r.error || 'agent 回复失败'}` }])
      })
      .catch((e) => {
        setBusy(false)
        setMessages((m) => [...m, { role: 'assistant', text: `✗ ${String(e)}` }])
      })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12 }}>
      <div ref={listRef} style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(127,127,127,0.06)', border: '1px solid #2c2c30' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
            <div style={{
              padding: '6px 10px', borderRadius: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text',
              background: m.role === 'user' ? 'rgba(79,124,255,0.28)' : m.role === 'system' ? 'transparent' : 'rgba(127,127,127,0.12)',
              color: m.role === 'system' ? '#8b8b88' : '#e8e8e6',
            }}>{m.text}</div>
            {m.actions?.length ? (
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {m.actions.map((c, j) => (
                  <div key={j} style={{ fontSize: 10.5, color: c.startsWith('✗') ? '#f87171' : '#8b8b88', padding: '2px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.18)' }}>{c}</div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? <div style={{ fontSize: 11, color: '#8b8b88', alignSelf: 'flex-start' }}>思考中…</div> : null}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 2px', marginBottom: 6 }}>
        {tpl.layerDefs.filter((l) => l.type === 'text' || l.type === 'product' || l.type === 'environment').map((l) => (
          <button
            key={`@${l.id}`}
            onClick={() => setInput((prev) => prev + `@${l.label} `)}
            style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(79,124,255,0.3)', background: 'rgba(79,124,255,0.08)', color: '#93c5fd', fontSize: 10.5, cursor: 'pointer' }}
          >@{l.label}</button>
        ))}
        {SLASH_COMMANDS.map((sc) => (
          <button
            key={sc.cmd}
            onClick={() => setInput((prev) => prev + sc.cmd + ' ')}
            style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(34,211,238,0.3)', background: 'rgba(34,211,238,0.06)', color: '#67e8f9', fontSize: 10.5, cursor: 'pointer' }}
          >{sc.cmd}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <textarea
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="如:主标题改成「0.2ms」,环境图换深夜霓虹,字体楷体"
          style={inputStyle({ flex: 1, height: 'auto', resize: 'none', minHeight: 44, fontFamily: 'inherit' })}
        />
        <button
          disabled={busy}
          onClick={send}
          style={{ width: 46, borderRadius: 8, border: 0, cursor: busy ? 'default' : 'pointer', background: 'var(--primary, #4f7cff)', color: '#fff', fontSize: 16, fontWeight: 800 }}
          title="发送(Enter;Shift+Enter 换行)"
        >➤</button>
      </div>
    </div>
  )
}

function icon(type: LayerDef['type']): string {
  return type === 'environment' ? '🖼' : type === 'product' ? '📷' : type === 'text' ? '🅣' : '◇'
}

const panelStyle: React.CSSProperties = {
  width: 252, flexShrink: 0, background: '#1a1a1c', borderRight: '1px solid #333',
  padding: 12, display: 'flex', flexDirection: 'column', overflowY: 'auto',
}
const headStyle: React.CSSProperties = { fontSize: 11, color: '#8b8b88', margin: '4px 0 8px', fontWeight: 700, letterSpacing: 1 }
const iconBtn: React.CSSProperties = { border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, padding: 0, width: 22 }
const ghostBtn: React.CSSProperties = {
  width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #444',
  background: 'transparent', color: '#e8e8e6', fontSize: 12, cursor: 'pointer',
}
const inputStyle = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  width: '100%', background: '#101012', border: '1px solid #444', borderRadius: 6,
  color: '#e8e8e6', fontSize: 12, padding: '6px 8px', outline: 'none', ...extra,
})

/** 导出选项模态(2026-10-27 裁决:点击导出弹出,勾选格式,默认全选横竖屏) */
function ExportModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const templateId = useEditor((s) => s.templateId)
  const props = useEditor((s) => s.props)
  const family = getTemplate(templateId).family
  const [targets, setTargets] = React.useState([
    { key: 'landscape', label: '横屏', size: '1280×720', checked: true, variant: '' },
    { key: 'portrait', label: '竖屏', size: '1080×1440', checked: true, variant: '-portrait' },
    { key: 'square', label: '方屏', size: '1080×1080', checked: false, variant: '' },
  ])
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<Array<{ ok: boolean; text: string }>>([])

  const toggle = (key: string): void => {
    setTargets((ts) => ts.map((t) => (t.key === key ? { ...t, checked: !t.checked } : t)))
  }

  const doExport = async (): Promise<void> => {
    const selected = targets.filter((t) => t.checked)
    if (!selected.length) return
    setBusy(true)
    setResults([])
    for (const t of selected) {
      const tid = family + t.variant
      try {
        const r = await fetch('/tintin/cover/api/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId: tid, props, fileName: `${family}-${t.key}` }),
        }).then((resp) => resp.json())
        setResults((prev) => [...prev, { ok: !!r.ok, text: r.ok ? `✓ ${t.label} ${t.size} → ${r.file}` : `✗ ${t.label}: ${r.error || '?'}` }])
      } catch (e) {
        setResults((prev) => [...prev, { ok: false, text: `✗ ${t.label}: ${String(e)}` }])
      }
    }
    setBusy(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ width: 380, background: '#1e1e20', borderRadius: 14, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#e8e8e6', marginBottom: 16 }}>导出封面</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {targets.map((t) => (
            <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={t.checked} onChange={() => toggle(t.key)} style={{ accentColor: '#4f7cff', width: 16, height: 16 }} />
              <span style={{ color: '#e8e8e6', fontWeight: 600 }}>{t.label}</span>
              <span style={{ color: '#8b8b88', fontSize: 11, marginLeft: 'auto' }}>{t.size}</span>
            </label>
          ))}
        </div>
        <button
          disabled={busy}
          onClick={() => void doExport()}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 8, border: 0, cursor: busy ? 'default' : 'pointer',
            background: busy ? 'rgba(79,124,255,0.4)' : 'var(--primary, #4f7cff)', color: '#fff', fontSize: 14, fontWeight: 700,
          }}
        >{busy ? '渲染中…' : `导出 ${targets.filter((t) => t.checked).length} 张 PNG`}</button>
        {results.length ? (
          <div style={{ marginTop: 12, fontSize: 11.5 }}>
            {results.map((r, i) => (
              <div key={i} style={{ color: r.ok ? '#22c55e' : '#f87171', wordBreak: 'break-all', userSelect: 'text', marginBottom: 4 }}>{r.text}</div>
            ))}
          </div>
        ) : null}
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#8b8b88', fontSize: 12, padding: '5px 16px', cursor: 'pointer' }}>关闭</button>
        </div>
      </div>
    </div>
  )
}

export const EditorApp: React.FC = () => {
  const [showExport, setShowExport] = React.useState(false)
  const openPhotoCraft = (): void => {
    void fetch('/tintin/cover/api/pc/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
  }
  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 6, border: 0, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
  }
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#141416', color: '#e8e8e6' }}>
      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: '#1a1a1c', borderBottom: '1px solid #333' }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg,#4f7cff,#22d3ee)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff' }}>T</div>
        <span style={{ fontWeight: 700, fontSize: 13 }}>封面制作</span>
        <span style={{ color: '#8b8b88', fontSize: 11 }}>AI 底图 + 代码排版</span>
        <span style={{ flex: 1 }} />
        <button onClick={openPhotoCraft} title="用 PhotoCraft 打开精修" style={{ ...iconBtn, background: 'rgba(34,211,238,0.1)', color: '#22d3ee' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
        </button>
        <button onClick={() => setShowExport(true)} title="导出封面 PNG" style={{ ...iconBtn, background: 'rgba(79,124,255,0.1)', color: '#93c5fd' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <span style={{ color: '#8b8b88', fontSize: 11 }}>dsh-tintin-cover-plugin</span>
      </div>
      {showExport ? <ExportModal onClose={() => setShowExport(false)} /> : null}
      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        <CanvasPanel />
        <div style={{ width: 260, flexShrink: 0, background: '#1a1a1c', borderLeft: '1px solid #333', borderRight: '1px solid #333', padding: 12, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={headStyle}>设置</div>
          <OrientationToggle />
          <div style={headStyle}>图层</div>
          <LayersPanel />
        </div>
        <div style={{ ...panelStyle, borderRight: 0, borderLeft: '1px solid #333' }}>
          <SessionPanel />
        </div>
      </div>
    </div>
  )
}
