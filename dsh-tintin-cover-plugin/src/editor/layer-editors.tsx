// layer-editors — 图层面板的选中图层编辑卡族(2026-10-31 方案 B §2.5,自 panels.tsx 提取付账:
// 千行门禁)。滑条预览-提交分离(PreviewSlider)/文本防抖(DelayedTextEditor)/文字样式细调/
// 自定义图片层与产品图编辑卡(从素材替换/抠图直达——抠图结果=素材,2026-10-31 裁决)。
import React from 'react'
import { liveLayer, liveLayerSnapshot, subscribeLiveLayer } from './ui'
import { getTemplate, type LayerDef } from '../registry'
import type { CustomLayer } from '../../templates/CustomLayers'
import { FontFamilyPicker, FontStylePicker } from './font-picker'
import { layerEl } from './canvas-geom'
import { ImageLayerProps, numBox, type ImageTarget } from './image-props'
import { useEditor } from './store'
import { ghostBtn, headStyle, inputStyle } from './ui'

type ImageTargetLook = Extract<ImageTarget, { kind: 'slot' }>['look']
function CustomLayerEditor({ layer, project }: { layer: CustomLayer; project: string }): React.ReactElement {
  const setCustomLayer = useEditor((s) => s.setCustomLayer)
  const selectedAsset = useEditor((s) => s.selectedAsset)
  const [matting, setMatting] = React.useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: '', ok: true })
  /** 选中素材 → 同步进项目素材位(非 public 先 asset-sync) → 替换本层图,几何(x/y/宽/旋)不动 */
  const replaceFromAsset = (): void => {
    if (!selectedAsset) return
    void (async () => {
      try {
        if (!selectedAsset.startsWith('public/')) {
          await fetch('/tintin/ipc/cover/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: selectedAsset }) })
        }
        setCustomLayer(layer.id, { image: selectedAsset.replace(/^public\//, '') })
      } catch { /* 同步失败静默(同画布口径) */ }
    })()
  }
  const mattingNow = (): void => {
    setMatting({ busy: true, msg: '', ok: true })
    void (async () => {
      try {
        const r = await fetch('/tintin/ipc/cover/matting', {
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
      <ImageLayerProps target={{ kind: 'custom', layer }} />
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
      {matting.msg ? <div style={{ marginTop: 6, fontSize: 11, color: matting.ok ? 'var(--ok)' : 'var(--err)', wordBreak: 'break-all' }}>{matting.msg}</div> : null}
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>画布拖动改位置 · 拖右下角柄改大小 · 拖上方圆点旋转 · Alt+拖动复制</div>
    </div>
  )
}

/** 图片图层编辑器(2026-10-29 用户裁决:去掉「上传图片」与「AI 重绘产品图」;
 *  底图保留 AI 生成;产品图来源=素材面板拖入/会话生成。
 *  2026-10-31 §2.5 P1:产品图补「用选中素材设为产品图」(素材区点选→一键设图)与「抠图去背景」;
 *  2026-11-01 用户裁决:删除「恢复默认」;外观/变换/排列统一走 ImageLayerProps(对齐 PhotoCraft)) */
const STYLE_COLORS = ['#ffffff', '#22d3ee', '#facc15', '#f97316', 'var(--err)', '#4ade80', '#93c5fd', '#0f172a']

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
  const styles = useEditor((s) => (s.props.styles as Record<string, { scale?: number; gscale?: number; color?: string; dx?: number; dy?: number; font?: string; weight?: number; italic?: boolean; shadow?: { dx: number; dy: number; blur: number; color: string }; stroke?: { width: number; color: string } }> | undefined)?.[layerId])
  const setLayerStyle = useEditor((s) => s.setLayerStyle)
  /* live 值(2026-11-10 对齐 PhotoCraft #128): 画布拖动/缩放中编辑卡实时跟随——
     useSyncExternalStore 订阅 liveLayer(v 变化即重渲),选中层匹配时显示 live 值。 */
  React.useSyncExternalStore(subscribeLiveLayer, liveLayerSnapshot)
  const scale = typeof styles?.scale === 'number' ? styles.scale : 1
  const gs = typeof styles?.gscale === 'number' ? styles.gscale : 1
  // 有效视觉字号 = 基准 × 字号倍率 × 几何缩放(2026-11-11 WP-A4:画布角柄=几何缩放)
  const px = liveLayer.scaleId === layerId ? liveLayer.scalePx : Math.round(baseFontSize * scale * gs)
  const [liveSlide, setLiveSlide] = React.useState<number | null>(null)
  const shownPx = liveSlide ?? px
  const setPx = (v: number): void => {
    if (!Number.isFinite(v)) return
    setLayerStyle(layerId, { scale: Math.min(3, Math.max(0.3, v / baseFontSize)) })
  }
  const dx = styles?.dx ?? 0
  const dy = styles?.dy ?? 0
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(127,127,127,0.07)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>字体</span>
        <FontFamilyPicker
          value={styles?.font}
          onChange={(f) => setLayerStyle(layerId, { font: f, weight: undefined, italic: undefined })} // 换字体重置样式字面
        />
      </div>
      {styles?.font ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>样式</span>
          <FontStylePicker
            font={styles.font}
            weight={typeof styles?.weight === 'number' ? styles.weight : undefined}
            italic={styles?.italic === true}
            onChange={(v) => setLayerStyle(layerId, v ? { weight: v.weight, italic: v.italic } : { weight: undefined, italic: undefined })}
          />
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>大小</span>
        {/* 滑条 live 显示(2026-11-10 用户报障「放大拖动时右边的值没变」): 拖动中显示 live 值
            (受控 value 锚 store 值=React 拉回,滑块回弹+显示不变),松手/失焦提交 store。 */}
        <input
          type="range" min={Math.max(14, Math.round(baseFontSize * 0.3))} max={Math.round(baseFontSize * 3)} step={1} value={shownPx}
          onChange={(e) => { const v = Number(e.target.value); setLiveSlide(v); const el = layerEl(layerId); if (el) el.style.fontSize = `${v}px` }}
          onPointerUp={(e) => { setPx(Number(e.currentTarget.value)); setLiveSlide(null) }}
          onKeyUp={(e) => { setPx(Number(e.currentTarget.value)); setLiveSlide(null) }}
          onBlur={(e) => { setPx(Number(e.currentTarget.value)); setLiveSlide(null) }}
          style={{ flex: 1, accentColor: 'var(--accent)' }}
        />
        <input type="number" min={10} max={400} value={shownPx} onChange={(e) => { setPx(Number(e.target.value)); setLiveSlide(null) }} style={numBox} />
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>px</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>位置</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>X</span>
        <input type="number" min={-1200} max={1200} value={liveLayer.posId === layerId ? liveLayer.posDx : dx} onChange={(e) => setLayerStyle(layerId, { dx: Number(e.target.value) })} style={numBox} />
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Y</span>
        <input type="number" min={-1200} max={1200} value={liveLayer.posId === layerId ? liveLayer.posDy : dy} onChange={(e) => setLayerStyle(layerId, { dy: Number(e.target.value) })} style={numBox} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>颜色</span>
        {STYLE_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setLayerStyle(layerId, styles?.color === c ? { color: undefined } : { color: c })}
            title={styles?.color === c ? `${c}(点击还原默认)` : c}
            style={{
              width: 20, height: 20, borderRadius: 999, cursor: 'pointer', padding: 0,
              background: c, border: styles?.color === c ? '2px solid var(--accent)' : '1px solid #555',
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
      </div>
      {/* 投影/描边(2026-11-02 对齐 PhotoCraft 图层样式;设置后覆盖模板硬编码阴影) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>投影</span>
        <button
          onClick={() => setLayerStyle(layerId, styles?.shadow ? { shadow: undefined } : { shadow: { dx: 0, dy: 6, blur: 14, color: 'rgba(0,0,0,0.6)' } })}
          title={styles?.shadow ? '关闭投影' : '开启投影'}
          style={{ ...ghostBtn, width: 'auto', padding: '2px 10px', fontSize: 11, color: styles?.shadow ? 'var(--accent)' : 'var(--text-faint)', borderColor: styles?.shadow ? 'var(--accent)' : undefined }}
        >{styles?.shadow ? '开' : '关'}</button>
        {styles?.shadow ? (
          <>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>大小</span>
            <input type="number" min={0} max={60} value={styles.shadow.blur} onChange={(e) => setLayerStyle(layerId, { shadow: { ...styles.shadow!, blur: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } })} style={numBox} />
            <input type="color" value="#000000" onChange={(e) => setLayerStyle(layerId, { shadow: { ...styles.shadow!, color: e.target.value } })} title="投影颜色" style={{ width: 26, height: 20, padding: 0, border: '1px solid #555', borderRadius: 4, background: 'transparent', cursor: 'pointer' }} />
          </>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>描边</span>
        <button
          onClick={() => setLayerStyle(layerId, styles?.stroke ? { stroke: undefined } : { stroke: { width: 3, color: 'rgba(2,6,23,0.65)' } })}
          title={styles?.stroke ? '关闭描边' : '开启描边'}
          style={{ ...ghostBtn, width: 'auto', padding: '2px 10px', fontSize: 11, color: styles?.stroke ? 'var(--accent)' : 'var(--text-faint)', borderColor: styles?.stroke ? 'var(--accent)' : undefined }}
        >{styles?.stroke ? '开' : '关'}</button>
        {styles?.stroke ? (
          <>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>宽</span>
            <input type="number" min={0} max={12} value={styles.stroke.width} onChange={(e) => setLayerStyle(layerId, { stroke: { ...styles.stroke!, width: Math.max(0, Math.min(12, Number(e.target.value) || 0)) } })} style={numBox} />
            <input type="color" value="#ffffff" onChange={(e) => setLayerStyle(layerId, { stroke: { ...styles.stroke!, color: e.target.value } })} title="描边颜色" style={{ width: 26, height: 20, padding: 0, border: '1px solid #555', borderRadius: 4, background: 'transparent', cursor: 'pointer' }} />
          </>
        ) : null}
      </div>
    </div>
  )
}

function ImageLayerEditor({ layerId, layerLabel, propKey, project }: { layerId: string; layerLabel: string; propKey: string; project: string }): React.ReactElement {
  const setProp = useEditor((s) => s.setProp)
  const current = useEditor((s) => s.props[propKey])
  const look = useEditor((s) => (s.props.styles as Record<string, ImageTargetLook> | undefined)?.[layerId])
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
          await fetch('/tintin/ipc/cover/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: selectedAsset }) })
        }
        setProp(propKey, selectedAsset.replace(/^public\//, ''))
      } catch { /* 同步失败静默(同画布口径) */ }
    })()
  }
  const mattingNow = (): void => {
    const name = String(current ?? '')
    if (!name) { setState({ busy: false, msg: '当前主体图为空,无可抠图', ok: false }); return }
    setState({ busy: true, msg: '', ok: true })
    void (async () => {
      try {
        const r = await fetch('/tintin/ipc/cover/matting', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, project }),
        }).then((x) => x.json()) as { ok?: boolean; name?: string; error?: string }
        if (!r.ok) throw new Error(r.error || '抠图失败')
        setState({ busy: false, msg: `已生成素材 ${r.name}(结果=素材;要用它请先在素材区点选,再点「设为主体图」)`, ok: true })
      } catch (err) {
        setState({ busy: false, msg: err instanceof Error ? err.message : String(err), ok: false })
      }
    })()
  }
  const generateBg = (): void => {
    if (!bgPrompt.trim()) { setState({ busy: false, msg: '先描述画面(不含文字)', ok: false }); return }
    setState({ busy: true, msg: 'AI 生成底图中…(分钟级,勿关页面)', ok: true })
    void fetch('/tintin/ipc/cover/generate-background', {
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
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 8, wordBreak: 'break-all' }}>
        当前:{typeof current === 'string' && current ? current : '(未设置)'}
      </div>
      <ImageLayerProps target={{ kind: 'slot', id: layerId, look: look ?? {}, geometry: isProduct }} />
      {isProduct ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            onClick={setFromAsset}
            disabled={!selectedAsset}
            title={selectedAsset ? `用素材区的「${selectedAsset}」设为主体图` : '先在素材区点选一张图'}
            style={{ ...ghostBtn, width: 'auto', padding: '4px 10px', fontSize: 11, opacity: selectedAsset ? 1 : 0.45 }}
          >设为主体图</button>
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
              background: state.busy ? 'var(--bg-pressed)' : 'var(--primary)', color: 'var(--on-primary)', fontSize: 12.5, fontWeight: 700,
            }}
          >{state.busy ? '生成中…(分钟级)' : '✦ AI 生成底图'}</button>
        </div>
      ) : null}
      {state.msg ? <div style={{ marginTop: 6, fontSize: 11, color: state.ok ? '#22c55e' : 'var(--err)', wordBreak: 'break-all' }}>{state.msg}</div> : null}
    </div>
  )
}
export { CustomLayerEditor, DelayedTextEditor, ImageLayerEditor, TextStyleEditor }
