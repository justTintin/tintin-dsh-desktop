// layer-editors — 图层面板的选中图层编辑卡族(2026-10-31 方案 B §2.5,自 panels.tsx 提取付账:
// 千行门禁)。滑条预览-提交分离(PreviewSlider)/文本防抖(DelayedTextEditor)/文字样式细调/
// 自定义图片层与产品图编辑卡(从素材替换/抠图直达——抠图结果=素材,2026-10-31 裁决)。
import React from 'react'
import { getTemplate, type LayerDef } from '../registry'
import { FONT_WHITELIST } from '../../templates/text-style'
import { useEditor } from './store'
import { ghostBtn, headStyle, inputStyle } from './ui'
function CustomLayerEditor({ layer, project }: { layer: { id: string; image: string; width: number; opacity?: number; rotate?: number }; project: string }): React.ReactElement {
  const setCustomLayer = useEditor((s) => s.setCustomLayer)
  const selectedAsset = useEditor((s) => s.selectedAsset)
  const [matting, setMatting] = React.useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: '', ok: true })
  /** 选中素材 → 同步进项目素材位(非 public 先 asset-sync) → 替换本层图,几何(x/y/宽/旋)不动 */
  const replaceFromAsset = (): void => {
    if (!selectedAsset) return
    void (async () => {
      try {
        if (!selectedAsset.startsWith('public/')) {
          await fetch('/tintin/cover/api/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: selectedAsset }) })
        }
        setCustomLayer(layer.id, { image: selectedAsset.replace(/^public\//, '') })
      } catch { /* 同步失败静默(同画布口径) */ }
    })()
  }
  const mattingNow = (): void => {
    setMatting({ busy: true, msg: '', ok: true })
    void (async () => {
      try {
        const r = await fetch('/tintin/cover/api/matting', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: layer.image, project }),
        }).then((x) => x.json()) as { ok?: boolean; name?: string; error?: string }
        if (!r.ok) throw new Error(r.error || '抠图失败')
        setMatting({ busy: false, msg: `已生成素材 ${r.name}(结果=素材;要用它请先在素材区点选,再点「从素材替换」)`, ok: true })
      } catch (err) {
        setMatting({ busy: false, msg: err instanceof Error ? err.message : String(err), ok: false })
      }
    })()
  }
  return (
    <div style={{ marginTop: 14 }}>
      <div style={headStyle}>编辑「{layer.image.split('/').pop()}」</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#8b8b88', flexShrink: 0 }}>宽度</span>
        <PreviewSlider min={80} max={1280} step={10} value={layer.width}
          preview={(v) => { const el = layerEl(layer.id); if (el) el.style.width = `${v}px` }}
          commit={(v) => setCustomLayer(layer.id, { width: v })} />
        <input type="number" min={20} max={4000} value={layer.width}
          onChange={(e) => setCustomLayer(layer.id, { width: Math.max(20, Math.min(4000, Number(e.target.value) || 20)) })} style={numBox} />
        <span style={{ fontSize: 10.5, color: '#8b8b88' }}>px</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#8b8b88', flexShrink: 0 }}>不透明</span>
        <PreviewSlider min={0.2} max={1} step={0.05} value={layer.opacity ?? 1}
          preview={(v) => { const el = layerEl(layer.id); if (el) el.style.opacity = String(v) }}
          commit={(v) => setCustomLayer(layer.id, { opacity: v })} />
        <input type="number" min={20} max={100} value={Math.round((layer.opacity ?? 1) * 100)}
          onChange={(e) => setCustomLayer(layer.id, { opacity: Math.max(20, Math.min(100, Number(e.target.value) || 100)) / 100 })} style={numBox} />
        <span style={{ fontSize: 10.5, color: '#8b8b88' }}>%</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#8b8b88', flexShrink: 0 }}>旋转</span>
        <PreviewSlider min={-180} max={180} step={1} value={layer.rotate ?? 0}
          preview={(v) => { const el = layerEl(layer.id); if (el) el.style.transform = `rotate(${v}deg)` }}
          commit={(v) => setCustomLayer(layer.id, { rotate: v })} />
        <input type="number" min={-180} max={180} value={layer.rotate ?? 0}
          onChange={(e) => setCustomLayer(layer.id, { rotate: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) })} style={numBox} />
        <span style={{ fontSize: 10.5, color: '#8b8b88' }}>°</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          onClick={replaceFromAsset}
          disabled={!selectedAsset}
          title={selectedAsset ? `用素材区的「${selectedAsset}」替换本层图片(位置/宽度/旋转保留)` : '先在素材区点选一张图'}
          style={{ ...ghostBtn, width: 'auto', padding: '4px 10px', fontSize: 11, opacity: selectedAsset ? 1 : 0.45 }}
        >从素材替换</button>
        <button
          onClick={mattingNow}
          disabled={matting.busy}
          title="调服务端抠图:透明底 PNG 存为素材(不自动上图)"
          style={{ ...ghostBtn, width: 'auto', padding: '4px 10px', fontSize: 11, opacity: matting.busy ? 0.5 : 1 }}
        >{matting.busy ? '抠图中…' : '抠图去背景'}</button>
      </div>
      {matting.msg ? <div style={{ marginTop: 6, fontSize: 11, color: matting.ok ? '#7ee2a8' : '#f87171', wordBreak: 'break-all' }}>{matting.msg}</div> : null}
      <div style={{ fontSize: 10.5, color: '#8b8b88', marginTop: 6 }}>画布拖动改位置 · 面板拖 ⠿ 调层级 · 选中后拖画布上方圆点旋转</div>
    </div>
  )
}

/** 图片图层编辑器(2026-10-29 用户裁决:去掉「上传图片」与「AI 重绘产品图」;
 *  底图保留 AI 生成;产品图来源=素材面板拖入/会话生成,恢复默认仍可用。
 *  2026-10-31 §2.5 P1:产品图补「用选中素材设为产品图」(素材区点选→一键设图)与「抠图去背景」) */
const STYLE_COLORS = ['#ffffff', '#22d3ee', '#facc15', '#f97316', '#f87171', '#4ade80', '#93c5fd', '#0f172a']

const numBox: React.CSSProperties = {
  width: 56, background: '#101012', border: '1px solid #444', borderRadius: 6,
  color: '#e8e8e6', fontSize: 11, padding: '3px 5px', outline: 'none',
}

/** 被拖/被调图层的 DOM 节点(滑条预览直写目标) */
const layerEl = (id: string): HTMLElement | null => document.querySelector(`[data-cover-layer="${id}"]`) as HTMLElement | null

/** 滑条预览-提交分离(方案 B §2.5 P0,与画布拖动同一管线):拖动中 input 事件只做 CSS 直写预览
 *  (Remotion 树零重渲染),松手/键盘抬起/失焦一次性提交 props。 */
function PreviewSlider({ min, max, step, value, preview, commit }: {
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
      style={{ flex: 1, accentColor: '#4f7cff' }}
    />
  )
}

/** 文本防抖提交(方案 B §2.5 P0):输入中只写本地态,停顿 250ms 或失焦才写 props——
 *  击键风暴合并为单次渲染。外部值变更(智能体/轮询)即时同步本地。 */
function DelayedTextEditor({ value, isArray, rows, onCommit }: {
  value: string; isArray: boolean; rows?: number
  onCommit: (v: string) => void
}): React.ReactElement {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => { setDraft(value) }, [value])
  const timer = React.useRef<number | undefined>(undefined)
  const flush = (v: string): void => {
    if (timer.current !== undefined) { window.clearTimeout(timer.current); timer.current = undefined }
    onCommit(v)
  }
  const edit = (v: string): void => {
    setDraft(v)
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { timer.current = undefined; onCommit(v) }, 250)
  }
  const shared = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => edit(e.target.value),
    onBlur: () => flush(draft),
  }
  return isArray
    ? <textarea {...shared} rows={rows ?? 3} style={inputStyle({ height: 'auto', resize: 'vertical', minHeight: 64, fontFamily: 'inherit' })} />
    : <input {...shared} style={inputStyle()} />
}

/** 文字样式(PhotoCraft 式,2026-10-28):字体 / 大小(px 绝对,基准字号×倍率换算)/
 *  位置(X·Y 数值输入+滑条)/ 颜色(色板+自由取色器)。存储契约不变(styles.scale 等)。 */
function TextStyleEditor({ layerId, baseFontSize }: { layerId: string; baseFontSize: number }): React.ReactElement {
  const styles = useEditor((s) => (s.props.styles as Record<string, { scale?: number; color?: string; dx?: number; dy?: number; font?: string }> | undefined)?.[layerId])
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  const scale = typeof styles?.scale === 'number' ? styles.scale : 1
  const px = Math.round(baseFontSize * scale)
  const setPx = (v: number): void => {
    if (!Number.isFinite(v)) return
    setLayerStyle(layerId, { scale: Math.min(3, Math.max(0.3, v / baseFontSize)) })
  }
  const dx = styles?.dx ?? 0
  const dy = styles?.dy ?? 0
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(127,127,127,0.07)', border: '1px solid #2c2c30' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        <span style={{ fontSize: 11, color: '#8b8b88', flexShrink: 0 }}>大小</span>
        <input
          type="range" min={Math.max(14, Math.round(baseFontSize * 0.3))} max={Math.round(baseFontSize * 3)} step={1} value={px}
          onChange={(e) => { const el = layerEl(layerId); if (el) el.style.fontSize = `${Number(e.target.value)}px` }}
          onPointerUp={(e) => setPx(Number(e.currentTarget.value))}
          onKeyUp={(e) => setPx(Number(e.currentTarget.value))}
          onBlur={(e) => setPx(Number(e.currentTarget.value))}
          style={{ flex: 1, accentColor: '#4f7cff' }}
        />
        <input type="number" min={10} max={400} value={px} onChange={(e) => setPx(Number(e.target.value))} style={numBox} />
        <span style={{ fontSize: 10.5, color: '#8b8b88' }}>px</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#8b8b88', flexShrink: 0 }}>位置</span>
        <span style={{ fontSize: 10.5, color: '#8b8b88' }}>X</span>
        <input type="number" min={-1200} max={1200} value={dx} onChange={(e) => setLayerStyle(layerId, { dx: Number(e.target.value) })} style={numBox} />
        <span style={{ fontSize: 10.5, color: '#8b8b88' }}>Y</span>
        <input type="number" min={-1200} max={1200} value={dy} onChange={(e) => setLayerStyle(layerId, { dy: Number(e.target.value) })} style={numBox} />
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
        <input
          type="color"
          value={styles?.color ?? '#ffffff'}
          onChange={(e) => setLayerStyle(layerId, { color: e.target.value })}
          title="自由取色"
          style={{ width: 26, height: 20, padding: 0, border: '1px solid #555', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}
        />
        {(styles?.scale !== undefined || styles?.color !== undefined || styles?.dx !== undefined || styles?.dy !== undefined) ? (
          <button onClick={() => setLayerStyle(layerId, null)} style={{ ...ghostBtn, width: 'auto', padding: '2px 10px', fontSize: 10.5, marginLeft: 'auto' }}>重置样式</button>
        ) : null}
      </div>
    </div>
  )
}

function ImageLayerEditor({ layerLabel, propKey, project }: { layerLabel: string; propKey: string; project: string }): React.ReactElement {
  const setProp = useEditor((s) => s.setProp)
  const current = useEditor((s) => s.props[propKey])
  const selectedAsset = useEditor((s) => s.selectedAsset)
  const [state, setState] = React.useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: '', ok: true })
  const [bgPrompt, setBgPrompt] = React.useState('')
  const genEngine = useEditor((s) => s.genEngine)
  const tplForAspect = useEditor((s) => s.templateId)
  const isProduct = propKey === 'image'
  const setFromAsset = (): void => {
    if (!selectedAsset) return
    void (async () => {
      try {
        if (!selectedAsset.startsWith('public/')) {
          await fetch('/tintin/cover/api/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: selectedAsset }) })
        }
        setProp(propKey, selectedAsset.replace(/^public\//, ''))
      } catch { /* 同步失败静默(同画布口径) */ }
    })()
  }
  const mattingNow = (): void => {
    const name = String(current ?? '')
    if (!name) { setState({ busy: false, msg: '当前产品图为空,无可抠图', ok: false }); return }
    setState({ busy: true, msg: '', ok: true })
    void (async () => {
      try {
        const r = await fetch('/tintin/cover/api/matting', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, project }),
        }).then((x) => x.json()) as { ok?: boolean; name?: string; error?: string }
        if (!r.ok) throw new Error(r.error || '抠图失败')
        setState({ busy: false, msg: `已生成素材 ${r.name}(结果=素材;要用它请先在素材区点选,再点「用选中素材设为产品图」)`, ok: true })
      } catch (err) {
        setState({ busy: false, msg: err instanceof Error ? err.message : String(err), ok: false })
      }
    })()
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
      {current ? (
        <button onClick={() => { setProp(propKey, undefined); setState({ busy: false, msg: '已恢复默认', ok: true }) }} style={ghostBtn}>恢复默认</button>
      ) : null}
      {isProduct ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            onClick={setFromAsset}
            disabled={!selectedAsset}
            title={selectedAsset ? `用素材区的「${selectedAsset}」设为产品图` : '先在素材区点选一张图'}
            style={{ ...ghostBtn, width: 'auto', padding: '4px 10px', fontSize: 11, opacity: selectedAsset ? 1 : 0.45 }}
          >用选中素材设为产品图</button>
          <button
            onClick={mattingNow}
            disabled={state.busy}
            title="调服务端抠图:透明底 PNG 存为素材(不自动上图)"
            style={{ ...ghostBtn, width: 'auto', padding: '4px 10px', fontSize: 11, opacity: state.busy ? 0.5 : 1 }}
          >{state.busy ? '抠图中…' : '抠图去背景'}</button>
        </div>
      ) : null}
      {propKey === 'bgImage' ? (
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
      ) : null}
      {state.msg ? <div style={{ marginTop: 6, fontSize: 11, color: state.ok ? '#22c55e' : '#f87171', wordBreak: 'break-all' }}>{state.msg}</div> : null}
    </div>
  )
}
export { CustomLayerEditor, DelayedTextEditor, ImageLayerEditor, TextStyleEditor }
