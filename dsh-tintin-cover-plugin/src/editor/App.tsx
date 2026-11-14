// 封面制作编辑器(WP-6 MVP):三栏 = 图层/编辑面板 | 自持画布(edit-canvas) | 会话/导出面板。
// 铁律 8:本文件属插件包;样式内联,无外部 UI 库依赖(积木选型见需求文档 §9.8)。
// 2026-10-29:图层面板族迁 panels.tsx(千行付账);画布加选中图片层旋转手柄。
// 2026-11-11 WP-A2(用户裁决「编辑态弃 Remotion Player」):CanvasPanel 整体迁 edit-canvas.tsx
// (自持画布+旋转感知选择框);本文件只剩应用壳(顶栏/项目 tab/三栏布局/设置顶条)。
import React from 'react'
import { getTemplate } from '../registry'
import { redo, undo, useEditor } from './store'
import { CanvasPanel } from './edit-canvas'
import { CoverChatPanel, reloadProjectState, useAgentPropsSync, useChatContextPush } from './agent-sync'
import { AssetsPanel, ExportModal } from './panels'
import { LayersPanel } from './layers-panel'
import { ServerSettingsModal } from './server-settings'
import { SkillsModal } from './skills-modal'
import { chatFrameRef } from './ui'
import { canvasDragFreeze } from './use-canvas-zoom'

/** 预览区顶条(2026-10-29 用户裁决:设置从左面板移到预览区上方横条;横竖屏+预览显示同行)。
 *  2026-11-14 用户裁决:「▦ 模板管理」从本条撤到右栏图标位(技能管理图标左边)——入口统一。 */
function CanvasSettingsStrip(): React.ReactElement {
  const showGuides = useEditor((s) => s.guides)
  const showGrid = useEditor((s) => s.canvasGrid)
  const setGuides = useEditor((s) => s.setGuides)
  const setCanvasGrid = useEditor((s) => s.setCanvasGrid)
  const zoom = useEditor((s) => s.zoom)
  const setZoom = useEditor((s) => s.setZoom)
  const fitScale = useEditor((s) => s.fitScale)
  const zoomBtn = (label: string, factor: number, titleText: string): React.ReactElement => (
    <button
      onClick={() => setZoom(zoom * factor)}
      title={titleText}
      style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, cursor: 'pointer' }}
    >{label}</button>
  )
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
      <OrientationToggle />
      <div style={{ width: 1, height: 18, background: '#333' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={showGuides} onChange={(e) => setGuides(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
        拖动对齐参考线
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={showGrid} onChange={(e) => setCanvasGrid(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
        画布网格
      </label>
      {/* 画布缩放(2026-10-31 §2.6 对照 PhotoCraft):Ctrl+滚轮同款,按钮=无滚轮入口;点百分比=复位适合窗口 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {zoomBtn('−', 1 / 1.25, '缩小画布')}
        <button
          onClick={() => setZoom(1)}
          title="复位为适合窗口"
          style={{ minWidth: 46, height: 24, borderRadius: 6, border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
        >{Math.round(fitScale * zoom * 100)}%</button>
        {zoomBtn('＋', 1.25, '放大画布')}
      </div>
      <span style={{ flex: 1 }} />
      {/* 撤销移到顶条右端(2026-10-29 用户裁决),原右栏底部入口撤销;提示文字删除;重做(2026-10-31 §2.6 P1) */}
      <button
        onClick={() => undo()}
        title="撤销上一步(会话与面板操作同栈)"
        style={{ border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-muted)', borderRadius: 7, fontSize: 12, padding: '4px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >↩ 撤销</button>
      <button
        onClick={() => redo()}
        title="重做(Ctrl+Shift+Z)"
        style={{ border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-muted)', borderRadius: 7, fontSize: 12, padding: '4px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >↪ 重做</button>
    </div>
  )
}

/** 模板管理弹窗(2026-11-13 用户裁决:服务端封面模板 /templates 体系 type=cover;
 *  2026-11-14 用户裁决:弹窗形态=视频剪辑技能管理弹窗同款(1200×800 大居中、
 *  头部标题+tab 行右「＋上传 PSD」+搜索、行卡片=图标/名称/徽标/描述/详情展开/行内
 *  预览/操作钮、底部状态行)——封面模板全在服务端,无本地安装语义,故单列表;
 *  行操作=注入版式(贴进会话输入框,原注入面板能力并入)+删除;PSD 经本机
 *  PhotoCraft 无头转 PNG 建模板。入口=编辑器顶栏「模板管理」图标。 */
type TplRow = Record<string, unknown>

function TemplateManagerModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const [rows, setRows] = React.useState<Array<TplRow>>([])
  const [busy, setBusy] = React.useState('')
  const [err, setErr] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [previews, setPreviews] = React.useState<Record<string, string>>({})

  const load = (): void => {
    void fetch('/tintin/ipc/cover/pc/tpl-list').then((r) => r.json()).then((r) => {
      if (r && r.ok === false) { setErr(String(r.error ?? '')); return }
      setRows(Array.isArray(r?.templates) ? r.templates : [])
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    .finally(() => setLoaded(true))
  }
  React.useEffect(() => { load() }, [])
  const defaultsOf = (tpl: TplRow): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const p of Array.isArray(tpl.params) ? tpl.params : []) {
      const n = String((p as { name?: unknown }).name ?? '')
      const d = (p as { default?: unknown }).default
      if (n && d !== null && d !== undefined && typeof d !== 'object') out[n] = d
    }
    return out
  }
  /** 渲染预览(详情展开行内出图;首次分钟级,结果按模板 id 缓存) */
  const previewTpl = (tpl: TplRow): void => {
    const id = String(tpl.id ?? '')
    if (previews[id]) return
    setBusy(`渲染预览「${String(tpl.name ?? id)}」…(首次可能分钟级)`)
    void fetch('/tintin/ipc/cover/pc/tpl-preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: id, params: defaultsOf(tpl), type: 'cover' }),
    })
      .then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => null); setErr(String(j?.error ?? `HTTP ${r.status}`)); return }
        const blob = await r.blob()
        setPreviews((m) => ({ ...m, [id]: URL.createObjectURL(blob) }))
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(''))
  }
  const removeTpl = (tpl: TplRow): void => {
    const label = String(tpl.name ?? tpl.id ?? '')
    if (!window.confirm(`删除模板「${label}」?服务端删除不可恢复。`)) return
    setBusy(`删除 ${label}…`)
    void fetch('/tintin/ipc/cover/pc/tpl-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: String(tpl.id ?? '') }) })
      .then((r) => r.json()).then((r) => { if (r && r.ok !== true) { setErr(String(r.error ?? '删除失败')); return } load() })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(''))
  }
  /* 注入版式(原会话注入面板能力并入本弹窗)——把模板版式参数贴进会话输入框,
     供智能体按版式快速模仿;经 chat iframe 的 tintin-cover:inject-text 通道 */
  const injectTpl = (tpl: TplRow): void => {
    const label = String(tpl.name ?? tpl.id ?? '')
    const frame = chatFrameRef.current
    if (!frame || !frame.contentWindow) { setErr('会话框未就绪——请先打开右侧会话再注入'); return }
    const lines: string[] = [`【封面模板】${label}（模板 id：${String(tpl.id ?? '')}）`]
    const canvas = tpl.canvas as { width?: unknown; height?: unknown } | undefined
    if (canvas && Number(canvas.width) > 0 && Number(canvas.height) > 0) lines.push(`画幅：${Number(canvas.width)}×${Number(canvas.height)}`)
    const params = Array.isArray(tpl.params) ? (tpl.params as Array<Record<string, unknown>>) : []
    if (params.length) {
      lines.push('版式参数（按此风格模仿）：' + params
        .map((p) => `${String(p.label ?? p.name ?? '')}=${String(p.default ?? '')}`)
        .filter((s) => s.split('=')[1]?.trim())
        .join('；'))
    }
    lines.push('说明：这是服务端封面模板（/templates 体系），请按上述版式风格快速生成/模仿封面。')
    frame.contentWindow.postMessage({ type: 'tintin-cover:inject-text', text: lines.join('\n') }, '*')
    setStatus(`已把「${label}」版式注入会话输入框——回会话直接发送即可`)
  }
  const uploadPsd = (file: File | null): void => {
    if (!file) return
    setBusy(`上传 ${file.name} 并转换…`)
    setErr('')
    void fetch('/tintin/ipc/cover/pc/psd-import?name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file })
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!j || j.ok !== true) { setErr(String(j?.error ?? `HTTP ${r.status}`)); return }
        setStatus(`已上传「${file.name}」并建模板。`)
        load()
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(''))
  }

  const q = query.trim().toLowerCase()
  const hit = (fields: string[]): boolean => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q))
  const list = rows.filter((t) => hit([String(t.name ?? ''), String(t.category ?? ''), String(t.id ?? '')]))

  const input: React.CSSProperties = {
    background: 'var(--bg-app)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 8,
    padding: '6px 10px', fontSize: 12.5, outline: 'none',
  }
  const btn = (tone: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
    padding: '5px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
    background: tone === 'primary' ? 'var(--accent)' : 'transparent',
    border: tone === 'danger' ? '1px solid #7f2d2d' : tone === 'ghost' ? '1px solid var(--border-strong)' : 0,
    color: tone === 'primary' ? '#fff' : tone === 'danger' ? 'var(--err)' : 'var(--text-muted)',
  })

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        /* 尺寸=技能管理弹窗同款: min(1200px, 100vw-64px) × min(800px, 100vh-80px) */
        style={{ width: 'min(1200px, calc(100vw - 64px))', height: 'min(800px, calc(100vh - 80px))', background: 'var(--bg-raised)', borderRadius: 'var(--radius-lg)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* 头部: 标题行(右上角关闭钮) + tab 行(右侧=＋上传 PSD 建模板 + 搜索, 技能弹窗同排版) */}
        <div style={{ padding: '14px 18px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>模板管理</span>
            <span style={{ flex: 1 }} />
            <button onClick={onClose} title="关闭" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 14, lineHeight: 1, color: '#9a9ba1', background: 'transparent', border: 0, cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, borderBottom: '1px solid #2c2c30' }}>
            {/* 封面模板全在服务端(无本地安装语义)——单 tab,保持技能弹窗同排版 */}
            <button style={{ padding: '7px 14px', fontSize: 12.5, cursor: 'default', background: '#18191d', color: 'var(--text)', fontWeight: 700, border: '1px solid var(--bg-hover)', borderBottom: '1px solid #18191d', borderRadius: '8px 8px 0 0' }}>服务端模板（{rows.length}）</button>
            <span style={{ flex: 1 }} />
            <label style={{ ...btn('ghost'), flexShrink: 0, marginBottom: 6, display: 'inline-block' }}>
              ＋ 上传 PSD 建模板
              <input type="file" accept=".psd" style={{ display: 'none' }} onChange={(e) => { uploadPsd(e.target.files?.[0] ?? null); e.currentTarget.value = '' }} />
            </label>
            <input value={query} placeholder="搜索模板" onChange={(e) => setQuery(e.target.value)} style={{ ...input, width: 200, borderRadius: 999, marginBottom: 6 }} />
          </div>
        </div>
        {/* 主体滚动区 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>服务端封面模板（{rows.length}）—— 「注入版式」把版式贴进会话输入框，按风格快速模仿</div>
          {!loaded ? <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: 14 }}>加载中…</div>
            : list.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', border: '1px dashed var(--border-strong)', borderRadius: 10, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                <span>{err ? `服务端不可达（${err}）——到 ⚙ 服务设置检查地址。` : rows.length ? `没有匹配「${query}」的模板。` : '服务端暂无封面模板——点「＋ 上传 PSD 建模板」，或由生成侧创建。'}</span>
                <label style={{ ...btn('ghost'), flexShrink: 0 }}>
                  ＋ 上传 PSD 建模板
                  <input type="file" accept=".psd" style={{ display: 'none' }} onChange={(e) => { uploadPsd(e.target.files?.[0] ?? null); e.currentTarget.value = '' }} />
                </label>
              </div>
            ) : list.map((tpl) => {
              const id = String(tpl.id ?? '')
              const expanded = detailId === id
              const params = Array.isArray(tpl.params) ? (tpl.params as Array<Record<string, unknown>>) : []
              const canvas = tpl.canvas as { width?: unknown; height?: unknown } | undefined
              const canvasStr = canvas && Number(canvas.width) > 0 ? `${Number(canvas.width)}×${Number(canvas.height)}` : ''
              return (
                <div key={id} onClick={() => injectTpl(tpl)} title="点击把此模板版式注入会话输入框（同选择产品语义）" style={{ display: 'flex', gap: 12, padding: '10px 12px', border: '1px solid var(--bg-hover)', borderRadius: 10, background: 'var(--bg-field)', alignItems: 'flex-start', cursor: 'pointer' }}>
                  <div style={{ width: 52, height: 52, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, background: 'linear-gradient(135deg,#232733,var(--bg-field) 65%)', border: '1px solid var(--bg-hover)' }}>▦</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{String(tpl.name ?? id)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      {[String(tpl.category ?? ''), params.length ? `${params.length} 参数` : '', canvasStr].filter(Boolean).map((chip, i) => (
                        <span key={i} style={{ fontSize: 10, color: '#9a9ba1', background: 'rgba(127,127,127,.16)', borderRadius: 999, padding: '1px 8px' }}>{chip}</span>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6, display: '-webkit-box', WebkitLineClamp: expanded ? 'unset' : '2', WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.6 }}>
                      {params.length
                        ? params.map((p) => `${String(p.label ?? p.name ?? '')}=${String(p.default ?? '')}`).filter((s) => s.split('=')[1]?.trim()).join('；') || '（无版式参数）'
                        : '（无版式参数）'}
                    </div>
                    {expanded ? (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div><span style={{ color: '#b9b9b6' }}>id：</span>{id || '—'}</div>
                        <div><span style={{ color: '#b9b9b6' }}>品类：</span>{String(tpl.category ?? '') || '—'}</div>
                        <div><span style={{ color: '#b9b9b6' }}>画幅：</span>{canvasStr || '—'}</div>
                        {previews[id] ? <img src={previews[id]} alt="模板预览" style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 8, border: '1px solid var(--border)', marginTop: 6 }} /> : null}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setDetailId(expanded ? null : id); if (!expanded) previewTpl(tpl) }} style={btn('ghost')}>{expanded ? '收起' : '详情'}</button>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => injectTpl(tpl)} disabled={busy !== ''} style={btn('primary')}>注入版式</button>
                      <button onClick={() => removeTpl(tpl)} disabled={busy !== ''} style={btn('danger')}>删除</button>
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
        <div style={{ padding: '6px 18px 12px', fontSize: 11, color: 'var(--text-faint)', flexShrink: 0, whiteSpace: 'pre-wrap' }}>{busy || err || status || '上传 PSD=经本机 PhotoCraft 无头转 PNG 建模板；注入版式=把模板版式贴进会话输入框，发送后智能体按风格模仿。'}</div>
      </div>
    </div>
  )
}

/** 横竖屏设置(2026-10-27 裁决:设置=横竖屏;同族切换保留内容) */
function OrientationToggle(): React.ReactElement {
  const templateId = useEditor((s) => s.templateId)
  const setOrientation = useEditor((s) => s.setOrientation)
  const current = getTemplate(templateId).orientation
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 0, width: 170, flexShrink: 0 }}>
      {([['portrait', '竖屏'], ['landscape', '横屏']] as const).map(([value, label]) => (
        <button
          key={value}
          onClick={() => setOrientation(value)}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            background: current === value ? 'var(--bg-selected)' : 'var(--bg-hover)',
            border: current === value ? '1px solid var(--accent)' : '1px solid transparent',
            color: current === value ? 'var(--accent)' : 'var(--text)', fontWeight: 700,
          }}
        >{label} {current === value ? '●' : ''}</button>
      ))}
    </div>
  )
}


/* 项目 tab/打开项目弹层样式(2026-10-30 用户裁决):× 悬停/激活显隐用 :hover 必须
   走样式表(inline 无法表达),一次性注入 */
let pjStyleInjected = false
function ensurePjStyle(): void {
  if (pjStyleInjected || typeof document === 'undefined') return
  pjStyleInjected = true
  const s = document.createElement('style')
  s.textContent = [
    '.tintin-pj-tab{position:relative}',
    '.tintin-pj-x{opacity:0;transition:opacity .12s;color:var(--text-faint);font-size:11px;line-height:1;cursor:pointer;padding:1px 3px;border-radius:4px}',
    '.tintin-pj-x:hover{color:#f87171;background:rgba(127,127,127,.18)}',
    '.tintin-pj-tab:hover .tintin-pj-x,.tintin-pj-tab.is-active .tintin-pj-x{opacity:1}',
    '.tintin-pj-pop{position:absolute;top:calc(100% + 6px);left:0;width:300px;max-height:340px;overflow:auto;background:var(--bg-raised);border:1px solid var(--border-strong);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.5);z-index:2100;padding:6px}',
    '.tintin-pj-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;color:var(--text-muted)}',
    '.tintin-pj-item:hover{background:var(--bg-hover)}',
    '.tintin-pj-item.is-current{color:#fff}',
    /* 项目右键菜单(2026-11-11 用户裁决):tab/打开项目列表右键=删除项目(确认后连目录删) */
    '.tintin-pj-menu{position:fixed;z-index:2090;min-width:132px;background:var(--bg-raised);border:1px solid var(--border-strong);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.5);padding:4px}',
    '.tintin-pj-menu-item{padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;color:var(--text-muted);white-space:nowrap}',
    '.tintin-pj-menu-item:hover{background:var(--bg-hover)}',
    '.tintin-pj-menu-item.danger{color:#f87171}',
    '.tintin-pj-menu-item.danger:hover{background:rgba(248,113,113,.12)}',
  ].join('\n')
  document.head.append(s)
}

export const EditorApp: React.FC = () => {
  const [showExport, setShowExport] = React.useState(false)
  const [showServer, setShowServer] = React.useState(false)
  /* 封面项目制(2026-10-30 用户裁决):tab=项目;切换=目录+会话(iframe 按纪元重挂)跟随。
     tab × 关闭=仅移出栏(项目目录与数据保留在磁盘,可从「打开项目」重新打开);
     关闭当前项目自动切到剩余项目,无剩余则新建。 */
  const [projects, setProjects] = React.useState<Array<{ name: string; mtimeMs: number }>>([])
  const [currentProject, setCurrentProject] = React.useState('')
  const [projectEpoch, setProjectEpoch] = React.useState(0)
  const [renaming, setRenaming] = React.useState<{ from: string; value: string } | null>(null)
  const [closedProjects, setClosedProjects] = React.useState<string[]>([])
  const [projectListOpen, setProjectListOpen] = React.useState(false)

  const applyProjectSwitch = (r: { current?: unknown; projects?: Array<{ name: string; mtimeMs: number }> }): void => {
    if (Array.isArray(r.projects)) setProjects(r.projects)
    const name = String(r.current ?? '')
    setCurrentProject(name)
    setClosedProjects((list) => list.filter((n) => n !== name))
    setProjectEpoch((e) => e + 1)
    void reloadProjectState()
  }
  const refreshProjects = (): void => {
    void fetch('/tintin/ipc/cover/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((x) => x.json())
      .then((r) => { if (r?.ok) { setProjects(r.projects ?? []); setCurrentProject(String(r.current ?? '')) } })
      .catch(() => {})
  }
  React.useEffect(() => {
    refreshProjects()
    /* 挂载即回读当前项目(2026-11-09 用户报障: 新建时空白、重启/刷新后再进出现模板默认
       装饰+渐变——store 初始值=video 模板 defaultProps 且 hiddenLayers=[], 而
       reloadProjectState 原本只在切换项目时调用, 刷新后无人回读; 轮询只认 origin=agent
       不会兜底。record 有值→套用, 空项目→空白分支清场)。 */
    void reloadProjectState()
  }, [])
  const switchProject = async (name: string): Promise<void> => {
    if (!name || name === currentProject) return
    try {
      const r = await fetch('/tintin/ipc/cover/projects/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((x) => x.json())
      if (r?.ok) applyProjectSwitch(r)
    } catch { /* 请求失败保持原项目 */ }
  }
  const createProject = async (): Promise<void> => {
    try {
      const r = await fetch('/tintin/ipc/cover/projects/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json())
      if (r?.ok) applyProjectSwitch(r)
    } catch { /* 同上 */ }
  }
  const commitRename = async (): Promise<void> => {
    const task = renaming
    setRenaming(null)
    if (!task) return
    const to = task.value.trim()
    if (!to || to === task.from) return
    try {
      const r = await fetch('/tintin/ipc/cover/projects/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: task.from, to }) }).then((x) => x.json())
      if (!r?.ok) return
      if (String(r.current ?? '') === to) applyProjectSwitch(r)
      else if (Array.isArray(r.projects)) setProjects(r.projects)
    } catch { /* 同上 */ }
  }
  /** 关闭项目 tab(2026-10-30 用户裁决):仅从栏内移出,项目目录与数据保留在磁盘,
      可从「打开项目」列表重新打开;关闭当前项目=自动切到剩余项目,无剩余则新建 */
  const closeProject = (name: string): void => {
    const next = Array.from(new Set([...closedProjects, name]))
    setClosedProjects(next)
    if (name !== currentProject) return
    const stillOpen = projects.filter((p) => p.name !== name && !next.includes(p.name))
    if (stillOpen.length) void switchProject(stillOpen[0]?.name ?? '')
    else void createProject()
  }
  /** 打开项目列表项点击:已打开=切换;已关闭=重新打开(移出关闭清单+切换) */
  const openProjectFromList = (name: string): void => {
    setClosedProjects((list) => list.filter((n) => n !== name))
    if (name === currentProject) return
    void switchProject(name)
  }
  /* 项目右键菜单(2026-11-11 用户裁决):tab 与「打开项目」列表项右键都可删 */
  const [pjMenu, setPjMenu] = React.useState<{ name: string; x: number; y: number } | null>(null)
  /** 删除项目(2026-11-11 用户裁决:右键→确认→连目录一起删,素材/状态文件/会话记录
      随目录消失,与 × 仅收起不同)。删当前项目=切到剩余打开项,无剩余则新建——
      引擎侧已把指针回退到剩余最新项目,这里再按前端打开 tab 择一覆盖。 */
  const deleteProject = async (name: string): Promise<void> => {
    if (!window.confirm(`确认删除项目「${name}」？\n项目目录（素材、状态文件、会话记录）将一并删除，不可恢复。`)) return
    let r: { ok?: boolean; error?: string; projects?: Array<{ name: string; mtimeMs: number }> } | null = null
    try {
      r = await fetch('/tintin/ipc/cover/projects/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((x) => x.json())
    } catch { /* 网络失败保持原状 */ }
    if (!r?.ok) { window.alert('删除失败：' + String(r?.error ?? '请求未送达')); return }
    const nextClosed = closedProjects.filter((n) => n !== name)
    setClosedProjects(nextClosed)
    const nextProjects = Array.isArray(r.projects) ? r.projects : projects.filter((p) => p.name !== name)
    setProjects(nextProjects)
    if (name !== currentProject) return
    const stillOpen = nextProjects.filter((p) => !nextClosed.includes(p.name))
    if (stillOpen.length) void switchProject(stillOpen[0]?.name ?? '')
    else void createProject()
  }
  ensurePjStyle()
  useChatContextPush()
  useAgentPropsSync(() => canvasDragFreeze.active)
  /* 技能管理大弹窗(2026-10-30 用户裁决:形态=视频剪辑 Skill 弹窗;聊天 ▦ 经 postMessage 请求打开) */
  const [showSkills, setShowSkills] = React.useState(false)
  /* 模板管理弹窗(2026-11-13 用户裁决:服务端封面模板/渲染预览/上传 PSD 建模板;
      2026-11-14 起入口=编辑器顶栏「模板管理」图标——底栏撤为注入选择器专用) */
  const [tplManagerOpen, setTplManagerOpen] = React.useState(false)
  React.useEffect(() => {
    const onRequest = (event: MessageEvent): void => {
      const data = event.data as { type?: string } | null
      if (!data) return
      if (data.type === 'tintin-cover:skills-open') setShowSkills(true)
      if (data.type === 'tintin-cover:templates-open') setTplManagerOpen(true)
    }
    window.addEventListener('message', onRequest)
    return () => window.removeEventListener('message', onRequest)
  }, [])
  const iconBtn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 6, border: 0, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
    background: 'transparent', color: 'var(--text-muted)',
  }
  return (
    <div data-tintin-cover-scope="" style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-app)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border)' }}>
        {/* 顶栏(2026-10-30 用户裁决):T 图标与「封面制作」文字删除;「打开项目」=弹全部
            项目列表(含已关闭,点击打开/切换);tab × 关闭项目=仅移出栏,数据保留可重开 */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => { void refreshProjects(); setProjectListOpen((v) => !v) }}
            title="打开项目——列出全部封面项目，点击打开/切换"
            style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border-strong)', background: projectListOpen ? 'var(--bg-hover)' : 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >打开项目 ▾</button>
          {projectListOpen ? (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 2050 }} onClick={() => setProjectListOpen(false)} />
              <div className="tintin-pj-pop">
                {projects.length === 0 ? <div style={{ fontSize: 12, color: '#8a8a90', padding: 10 }}>还没有封面项目——点「＋」新建</div> : null}
                {projects.map((p) => {
                  const open = !closedProjects.includes(p.name)
                  return (
                    <div
                      key={p.name}
                      className={'tintin-pj-item' + (p.name === currentProject ? ' is-current' : '')}
                      onClick={() => { openProjectFromList(p.name); setProjectListOpen(false) }}
                      onContextMenu={(e) => { e.preventDefault(); setProjectListOpen(false); setPjMenu({ name: p.name, x: e.clientX, y: e.clientY }) }}
                      title={open ? `切换到 ${p.name}` : `重新打开 ${p.name}（项目数据保留在磁盘）· 右键删除`}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {p.name === currentProject ? <span style={{ fontSize: 11, color: '#8fd6a4' }}>当前</span> : open ? <span style={{ fontSize: 11, color: '#8a8a90' }}>已打开</span> : null}
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: '0 1 auto', overflowX: 'auto', overflowY: 'hidden', padding: '0 2px' }}>
          {/* tab 按项目名升序(默认名=日期时间戳, 名字序=创建序——新建的排最后, 2026-11-09 用户报障:
              服务端 projects 按 mtime 降序(近期修改在前, 对「打开项目」弹层合理), 直接渲染会
              让新建/刚改过的项目跳到第一位;改名项目跟新名字走=可预测)。slice 防 mutate 状态。 */}
          {projects.filter((p) => !closedProjects.includes(p.name)).slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')).map((p) => {
            const active = p.name === currentProject
            const isRenaming = renaming?.from === p.name
            return (
              <div
                key={p.name}
                className={'tintin-pj-tab' + (active ? ' is-active' : '')}
                onClick={() => { if (!isRenaming && !active) void switchProject(p.name) }}
                onDoubleClick={() => setRenaming({ from: p.name, value: p.name })}
                onContextMenu={(e) => { e.preventDefault(); setPjMenu({ name: p.name, x: e.clientX, y: e.clientY }) }}
                title={active ? `${p.name}（当前项目）· 双击重命名 · 右键删除` : `${p.name} · 点击切换 · 双击重命名 · 右键删除`}
                style={{
                  flexShrink: 0, maxWidth: 180, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  padding: '4px 10px', borderRadius: 7, fontSize: 12, whiteSpace: 'nowrap',
                  background: active ? 'var(--bg-selected)' : 'transparent',
                  border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                  color: active ? 'var(--text)' : 'var(--text-faint)', fontWeight: active ? 700 : 400,
                }}
              >
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(e) => setRenaming({ from: p.name, value: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => { void commitRename() }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { void commitRename(); return }
                      if (e.key === 'Escape') { setRenaming(null); e.stopPropagation() }
                    }}
                    style={{ width: 130, background: 'var(--bg-field)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 5, fontSize: 12, padding: '1px 6px', outline: 'none' }}
                  />
                ) : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>}
                {/* × 关闭项目(2026-10-30 用户裁决):悬停/激活时显示;仅移出栏,数据保留可重开 */}
                <span
                  className="tintin-pj-x"
                  title="关闭项目（不删数据，可从「打开项目」重新打开）"
                  onClick={(e) => { e.stopPropagation(); closeProject(p.name) }}
                >×</span>
              </div>
            )
          })}
          <button
            onClick={() => void createProject()}
            title="新建封面项目（默认名=日期时间）"
            style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >＋</button>
        </div>
        <span style={{ flex: 1 }} />
        {/* 模板管理入口(2026-11-14 用户裁决:composer 底栏=注入选择器专用——模板/技能
            「管理」图标从会话底栏撤除,管理入口统一到编辑器顶栏;弹窗内「注入版式」
            回注会话输入框,注入能力不丢) */}
        <button onClick={() => setTplManagerOpen(true)} title="模板管理（服务端封面模板 / 渲染预览 / 上传 PSD 建模板）" style={{ ...iconBtn }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="9" x="3" y="14" rx="1"/><path d="M21 15v2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-2"/></svg>
        </button>
        {/* 技能管理入口(2026-11-09 用户裁决:顶栏 ⚙ 左边加图标——此前入口只剩空会话
            「更多技能」链接,0.3.0 composer 重绘后 ▦ 通道不稳,编辑器顶栏给常驻直达) */}
        <button onClick={() => setShowSkills(true)} title="技能管理" style={{ ...iconBtn }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/></svg>
        </button>
        {/* 按钮序(2026-10-31 用户裁决):设置第一,其后导出;技能管理 2026-11-09 加于设置左侧。
            PhotoCraft 打开按钮删除(2026-11-13 用户裁决:PhotoCraft 不随包集成,外部工具
            经「模板管理→上传 PSD」间接使用,不再有打开精修入口) */}
        <button onClick={() => setShowServer(true)} title="服务设置（服务端地址 + MCP 自动发现）" style={{ ...iconBtn }}>
          ⚙
        </button>
        <button onClick={() => setShowExport(true)} title="导出封面（JPG / PNG / PSD）" style={{ ...iconBtn }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
      {showExport ? <ExportModal project={currentProject} onClose={() => setShowExport(false)} /> : null}
      {showServer ? <ServerSettingsModal onClose={() => setShowServer(false)} /> : null}
      {showSkills ? <SkillsModal onClose={() => setShowSkills(false)} /> : null}
      {tplManagerOpen ? <TemplateManagerModal onClose={() => setTplManagerOpen(false)} /> : null}
      {/* 项目右键菜单(2026-11-11 用户裁决):删除项目——与 tab × 仅收起不同,确认后连目录删 */}
      {pjMenu ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 2080 }} onClick={() => setPjMenu(null)} onContextMenu={(e) => { e.preventDefault(); setPjMenu(null) }} />
          <div className="tintin-pj-menu" style={{ left: Math.min(pjMenu.x, window.innerWidth - 150), top: Math.min(pjMenu.y, window.innerHeight - 76) }}>
            <div
              className="tintin-pj-menu-item danger"
              onClick={() => { const name = pjMenu.name; setPjMenu(null); void deleteProject(name) }}
            >删除项目…</div>
          </div>
        </>
      ) : null}
      {/* 布局(2026-11-02 用户裁决:素材条右侧让出给图层列——素材条只随预览列宽,
          图层+编辑列下延至窗口底;2026-10-30「素材横带跨预览列+中栏」裁决由本条取代) */}
      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        {/* 预览列 = 设置顶条 + 画布 + 素材条(底部,只随本列宽) */}
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <CanvasSettingsStrip />
          <CanvasPanel project={currentProject} />
          {/* 素材条感知项目(2026-10-30 用户裁决方案 1):key=项目纪元,切换/新建/改名即重挂
              重拉——此前它只靠 3 秒轮询,切完最慢 3 秒才出新项目素材 */}
          <AssetsPanel key={projectEpoch} project={currentProject} />
        </div>
        {/* 中栏 = 图层+编辑整栏(横向兄弟,全高;2026-11-02 用户裁决:下延至窗口底) */}
        <div style={{ width: 260, flexShrink: 0, background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)', padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflowX: 'hidden', gap: 10 }}>
          <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <LayersPanel project={currentProject} />
          </div>
        </div>
        {/* 右栏 = 会话列(2026-10-28 裁决:通栏全高官方聊天,不被素材带挤占) */}
        <div style={{ width: 420, flexShrink: 0, background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* 会话随项目:epoch 变化=切换/新建/改名当前项目 → iframe 重挂 → start 以新 cwd 起会话(记录随项目目录) */}
          <CoverChatPanel key={projectEpoch} />
        </div>
      </div>
    </div>
  )
}
