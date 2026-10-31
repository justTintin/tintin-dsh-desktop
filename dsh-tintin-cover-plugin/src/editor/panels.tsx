// 工程素材面板 + 导出模态 + 图层面板(2026-10-29 从 App.tsx 迁出;千行付账)。
import React from 'react'
import { getTemplate, type LayerDef } from '../registry'
import { FONT_WHITELIST } from '../../templates/text-style'
import { effectiveOrder, useEditor } from './store'
import { buildLayerRows } from './layer-rows'
import { CustomLayerEditor, DelayedTextEditor, ImageLayerEditor, TextStyleEditor } from './layer-editors'
import { chatFrameRef, ghostBtn, headStyle, iconBtn, inputStyle, panelStyle } from './ui'

/** 横向素材条样式(:hover/:active 语义 inline style 无法表达,一次性注入) */
let stripStyleInjected = false
function ensureStripStyle(): void {
  if (stripStyleInjected || typeof document === 'undefined') return
  stripStyleInjected = true
  const s = document.createElement('style')
  s.textContent = [
    '.tintin-as-cell{position:relative}',
    '.tintin-as-drop{outline:2px dashed #4f7cff;outline-offset:-8px}',
    /* 右键菜单(2026-10-31 用户裁决:与视频剪辑素材右键同款) */
    '.tintin-as-menu{position:fixed;z-index:2300;min-width:200px;background:#1e1e20;border:1px solid #3a3a3e;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.5);padding:5px}',
    '.tintin-as-menu button{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:#d9d9de;font:400 12px/1.6 system-ui;padding:7px 10px;border-radius:8px;cursor:pointer;text-align:left;white-space:nowrap}',
    '.tintin-as-menu button:hover{background:#26272b}',
    '.tintin-as-menu button.danger{color:#f87171}',
    '.tintin-as-menu button .ico{width:16px;text-align:center;flex-shrink:0;color:#a9a9af}',
    '.tintin-as-menu button.danger .ico{color:#f87171}',
    /* 收藏星标(右键菜单「收藏」) */
    '.tintin-as-fav{position:absolute;top:4px;right:4px;z-index:5;color:#f5c451;font-size:12px;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.6)}',
    /* 滚动条与右侧会话框同款(2026-10-31 用户裁决:细条圆角透明轨道;取自 chat.css Thin scrollbars) */
    '::-webkit-scrollbar{width:9px;height:9px}',
    '::-webkit-scrollbar-track{background:transparent}',
    '::-webkit-scrollbar-thumb{background:var(--border-strong,#3f3f46);border-radius:99px;border:2px solid transparent;background-clip:padding-box}',
    '::-webkit-scrollbar-thumb:hover{background:var(--text-faint,#8b8b88);background-clip:padding-box}',
    '::-webkit-scrollbar-corner{background:transparent}',
  ].join('\n')
  document.head.append(s)
}

/** 横向素材条(2026-10-30 用户裁决:素材移到预览区下方;只列当前项目目录的图片,
 *  插件公共装饰不混入)。右键菜单(2026-10-31 用户裁决:与视频剪辑素材右键同款,
 *  「移动到」替换为「添加为图层」):添加为图层/在对话中引用/资源管理器显示/复制路径/
 *  收藏/删除;原格子上的悬停「＋图层/@引用」按钮随菜单删除。操作栏「导入」=系统目录
 *  选图;整条拖入图片文件=导入——均落当前项目目录(upload-image 双写)。 */
function AssetsPanel({ project }: { project: string }): React.ReactElement {
  ensureStripStyle()
  const [items, setItems] = React.useState<Array<{ path: string; kind: string; size: number }>>([])
  const [loaded, setLoaded] = React.useState(false)
  const selected = useEditor((st) => st.selectedAsset)
  const setSelected = useEditor((st) => st.setSelectedAsset)
  const [importBusy, setImportBusy] = React.useState(false)
  const [dropping, setDropping] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const noticeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const tpl = getTemplate(useEditor((s) => s.templateId))
  /* 右键菜单与收藏(2026-10-31 用户裁决):收藏=按项目的本机标记(localStorage),排序置顶+角标 */
  const [menu, setMenu] = React.useState<{ name: string; x: number; y: number } | null>(null)
  const [favVersion, setFavVersion] = React.useState(0)
  const coverDirRef = React.useRef('')
  const FAV_KEY = 'tintin.cover.favorites.v1'
  const favoritesOf = (project: string): Set<string> => {
    try {
      const all = JSON.parse(window.localStorage.getItem(FAV_KEY) ?? '{}') as Record<string, string[]>
      return new Set(all[project] ?? [])
    } catch { return new Set() }
  }
  const toggleFavorite = (name: string): void => {
    try {
      const all = JSON.parse(window.localStorage.getItem(FAV_KEY) ?? '{}') as Record<string, string[]>
      const list = new Set(all[project] ?? [])
      if (list.has(name)) list.delete(name)
      else list.add(name)
      all[project] = [...list]
      window.localStorage.setItem(FAV_KEY, JSON.stringify(all))
      setFavVersion((v) => v + 1)
    } catch { /* 私密模式等存储失败不阻断 */ }
  }
  React.useEffect(() => {
    void fetch('/tintin/cover/api/acp/hello').then((r) => r.json()).then((d) => {
      coverDirRef.current = String(d.coverDir ?? '')
    }).catch(() => {})
  }, [])
  const flashNotice = (text: string): void => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 4000)
  }
  const reloadNow = (): void => {
    /* project 显式跟随激活 tab(2026-10-31 用户报障「导入成功却不显示」):列表/上传
       不再依赖服务端指针项目,切 tab 后永不串项目。 */
    void fetch(`/tintin/cover/api/acp/files?project=${encodeURIComponent(project)}`).then((r) => r.json()).then((d) => {
      setItems(((d.files ?? []) as Array<{ path: string; kind: string; size: number }>)
        .filter((f) => f.kind === 'image' && !f.path.startsWith('public/')))
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }
  React.useEffect(() => {
    reloadNow()
    const timer = setInterval(reloadNow, 3000)
    return () => clearInterval(timer)
  }, [])
  const asNewLayer = (name: string): void => {
    void (async () => {
      try {
        if (!name.startsWith('public/')) {
          await fetch('/tintin/cover/api/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
        }
        useEditor.getState().addCustomLayer(name.replace(/^public\//, ''), Math.round(tpl.width / 2 - 180), Math.round(tpl.height / 3), 360)
      } catch { /* 失败静默(同原按钮口径) */ }
    })()
  }
  const referFile = (name: string): void => {
    chatFrameRef.current?.contentWindow?.postMessage({ type: 'tintin-cover:refer-file', name }, '*')
  }
  /** 导入/拖入(2026-10-30 用户裁决):图片文件上传落当前项目目录(upload-image 双写
      三写位+项目,画布/素材条/导出三处可用);重名自动加时间戳前缀 */
  const importFiles = async (list: FileList | null): Promise<void> => {
    const files = Array.from(list ?? []).filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f.name))
    if (!files.length) { flashNotice('仅支持图片文件(png/jpg/webp/gif/svg)'); return }
    setImportBusy(true)
    const existing = new Set(items.map((i) => i.path.split('/').pop() ?? i.path))
    let ok = 0
    for (const f of files) {
      let name = f.name.replace(/[\\/:*?"<>|]/g, '-')
      if (existing.has(name)) name = `${Date.now()}-${name}`
      existing.add(name)
      try {
        const bytes = await f.arrayBuffer()
        await fetch(`/tintin/cover/api/upload-image?name=${encodeURIComponent(name)}&project=${encodeURIComponent(project)}`, {
          method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes,
        })
        ok += 1
      } catch { /* 单文件失败继续 */ }
    }
    setImportBusy(false)
    reloadNow()
    flashNotice(ok ? `已导入 ${ok} 张素材到当前项目` : '导入失败——请重试')
  }
  /** URL 拖入导入(2026-10-31 用户报障:从浏览器/网页拖图,载荷无 File 只有 URI):
      主进程侧拉取(免页面 CORS),落盘口径与 upload-image 一致。 */
  const importUrl = (url: string): void => {
    setImportBusy(true)
    void (async () => {
      try {
        const r = await (await fetch('/tintin/cover/api/upload-url', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, project }),
        })).json() as { ok?: boolean; name?: string; error?: string }
        if (!r.ok || !r.name) throw new Error(r.error || 'URL 导入失败')
        reloadNow()
        flashNotice(`已导入 ${r.name}`)
      } catch (e) {
        flashNotice('导入失败——' + (e instanceof Error ? e.message : String(e)))
      } finally { setImportBusy(false) }
    })()
  }
  /* 拖放接受(2026-10-31 用户报障「满时拖入失败」):格子铺满后光标下的落点=素材格,
     接受逻辑须同时挂在格子上;内部素材拖拽(只有自定义类型)照旧忽略。 */
  const isAssetPayload = (e: React.DragEvent): boolean => {
    const types = e.dataTransfer.types
    return types.includes('Files') || types.includes('text/uri-list')
  }
  const stripDragOver = (e: React.DragEvent): void => {
    if (!isAssetPayload(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const stripDrop = (e: React.DragEvent): void => {
    if (!isAssetPayload(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    if (e.dataTransfer.files?.length) { void importFiles(e.dataTransfer.files); return }
    const uri = String(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '')
      .split('\n').map((s) => s.trim()).find((s) => s && !s.startsWith('#') && /^https?:\/\//i.test(s))
    if (uri) void importUrl(uri)
  }
  return (
    <div
      style={{ flexShrink: 0, background: '#1a1a1c', borderTop: '1px solid #2c2c30', padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
      onDragOver={stripDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false) }}
      onDrop={stripDrop}
    >
      {/* 头行 40px=与顶部工具栏同高;字号对齐图层面板头行(2026-10-30 用户裁决) */}
      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* 标题字体对齐项目 tab(2026-10-30 用户裁决:11.5 + tab 同亮色) */}
        <span style={{ fontSize: 11.5, color: '#e8e8e6', fontWeight: 700 }}>素材 · {items.length} 张</span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importBusy}
          title="从系统目录选择图片文件导入当前项目"
          style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid #3a3a3e', cursor: importBusy ? 'wait' : 'pointer', background: 'transparent', color: '#c9c9cf', fontSize: 11, fontWeight: 600 }}
        >{importBusy ? '导入中…' : (
          <>
            {/* 上传图标(2026-10-30 用户裁决:⎘ 语义不对,改 feather upload) */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: '-1.5px' }} aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            导入
          </>
        )}</button>
        {notice ? <span style={{ fontSize: 11, color: notice.startsWith('已导入') ? '#7ee2a8' : '#e8a23c' }}>{notice}</span> : null}
        <span style={{ flex: 1 }} />
        {/* 打开封面项目文件目录(2026-10-29 用户裁决):复用 /api/reveal(缺省=封面目录)。
            图标与热区放大(2026-10-30 用户追问:13px emoji 过小,与 40px 头行不匹配) */}
        <button
          type="button"
          title="打开封面项目的文件目录"
          onClick={() => { void fetch('/tintin/cover/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) }}
          style={{ ...iconBtn, width: 30, height: 30, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c9c9c7' }}
        >📁</button>
        <span style={{ fontSize: 10, color: '#8b8b88' }}>拖图入库 · 拖到画布成层</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { const files = e.target.files; void importFiles(files); e.target.value = '' }}
        />
      </div>
      {/* 行高固定(2026-10-31 用户报障:切项目空态128/有内容≈148互跳=抖动)——按有内容的
          格子(128 图+文件名行)定高,空态/加载中/有内容三态同高,条不再伸缩 */}
      <div
        className={dropping ? 'tintin-as-drop' : ''}
        style={{ display: 'flex', flexDirection: 'row', gap: 6, overflowX: 'auto', overflowY: 'hidden', alignItems: 'flex-start', height: 150 }}
      >
        {items.length === 0 ? (
          <>
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{ flexShrink: 0, width: 128, height: 148, borderRadius: 8, border: '1px dashed #3a3a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#55565c', fontSize: 20, background: '#101012' }}
              >
                {i === 0 ? '⬆' : '🖼'}
              </div>
            ))}
            {/* 提示文案只在确认加载完成且确为空时出现;加载中不闪文案(切项目防抖动) */}
            {loaded ? (
              <div style={{ flexShrink: 0, alignSelf: 'center', fontSize: 11, color: '#8b8b88', padding: '0 10px', lineHeight: 1.8 }}>
                还没有图片素材——点「导入」选图入库，或直接把图片拖进本条；
                <br />上传、AI 生成、会话领养也会出现在这里
              </div>
            ) : null}
          </>
        ) : null}
        {(() => {
          /* 收藏置顶(2026-10-31 右键菜单「收藏」);右键=菜单,原悬停按钮已并入菜单 */
          const favorites = favoritesOf(project)
          const ordered = favVersion >= 0 ? [...items].sort((a, b) => (favorites.has(b.path) ? 1 : 0) - (favorites.has(a.path) ? 1 : 0)) : items
          return ordered.map((item) => {
          const name = item.path
          const base = name.split('/').pop() ?? name
          const sel = selected === name
          const fav = favorites.has(name)
          return (
            <div
              key={name}
              className={'tintin-as-cell' + (sel ? ' is-sel' : '')}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('application/x-tintin-cover-layer', name); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => setSelected(sel ? null : name)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ name, x: e.clientX, y: e.clientY }) }}
              onDragOver={stripDragOver}
              onDrop={(e) => { e.stopPropagation(); stripDrop(e) }}
              style={{
                cursor: 'default', border: sel ? '1px solid rgba(79,124,255,0.7)' : '1px solid #333', borderRadius: 8,
                overflow: 'hidden', background: '#101012', flexShrink: 0, width: 128,
              }}
            >
              {/* 1:1 方格+棋盘格衬底=透明素材可见（RGBA 装饰落在近黑底上曾是黑块） */}
              <div style={{ height: 128, background: 'repeating-conic-gradient(#2e2e35 0% 25%, #1b1b21 0% 50%) 0 0 / 12px 12px' }}>
                <img src={`/tintin/cover/api/acp/asset?name=${encodeURIComponent(name)}`} alt={base} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              </div>
              <div style={{ padding: '3px 6px', fontSize: 10, lineHeight: '12px', color: '#8b8b88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{base}</div>
              {fav ? <span className="tintin-as-fav">★</span> : null}
            </div>
          )
          })
        })()}
      </div>
      {/* 右键菜单(2026-10-31 用户裁决:与视频剪辑素材右键同款;「移动到」替换为「添加为图层」) */}
      {menu ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 2290 }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="tintin-as-menu" style={{ left: Math.min(menu.x, window.innerWidth - 216), top: Math.min(menu.y, window.innerHeight - 260) }}>
            <button onClick={() => { asNewLayer(menu.name); setMenu(null) }}><span className="ico">✚</span>添加为图层</button>
            <button onClick={() => { referFile(menu.name); setMenu(null) }}><span className="ico">💬</span>在对话中引用</button>
            <button onClick={() => { void fetch('/tintin/cover/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: menu.name }) }); setMenu(null) }}><span className="ico">📂</span>在文件资源管理器中显示</button>
            <button onClick={() => {
              const abs = (coverDirRef.current ? coverDirRef.current.replace(/[\\/]+$/, '') + '\\' : '') + menu.name
              const write = (): void => { navigator.clipboard?.writeText(abs).catch(() => {}) }
              if (typeof navigator.clipboard?.writeText === 'function') write()
              else {
                const ta = document.createElement('textarea')
                ta.value = abs
                document.body.append(ta)
                ta.select()
                try { document.execCommand('copy') } catch { /* 剪贴板失败不阻断 */ }
                ta.remove()
              }
              setMenu(null)
            }}><span className="ico">⧉</span>复制路径</button>
            <button onClick={() => { toggleFavorite(menu.name); setMenu(null) }}><span className="ico">★</span>{favoritesOf(project).has(menu.name) ? '取消收藏' : '收藏'}</button>
            <button className="danger" onClick={() => {
              void (async () => {
                try {
                  const r = await (await fetch('/tintin/cover/api/delete-asset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: menu.name }) })).json() as { ok?: boolean; error?: string }
                  if (!r.ok) throw new Error(r.error || '删除失败')
                  if (selected === menu.name) setSelected(null)
                  reloadNow()
                } catch (e) { flashNotice(e instanceof Error ? e.message : String(e)) }
              })()
              setMenu(null)
            }}><span className="ico">🗑</span>删除</button>
          </div>
        </>
      ) : null}
    </div>
  )
}

/** 桌面保存桥(主窗 preload 暴露;编辑器是主窗同源 iframe,优先本窗、回退父窗)。
 *  桥缺失(异常宿主)返回 null,调用方回退默认 cover 目录,导出功能不受阻。 */
type SavePicker = { pick(params?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: Array<string> }> }): Promise<string | null> }
function resolveSavePicker(): SavePicker | null {
  const self = window as unknown as { dshDesktopSaveFilePicker?: SavePicker }
  const parent = window.parent !== window ? (window.parent as unknown as { dshDesktopSaveFilePicker?: SavePicker }) : null
  return self.dshDesktopSaveFilePicker ?? parent?.dshDesktopSaveFilePicker ?? null
}

/** 绝对路径 → 基名(目录截断展示避免状态行爆长) */
const dirNameOf = (p: string): string => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1)

/** 导出选项模态(2026-10-27 裁决:点击导出弹出,勾选格式,默认全选横竖屏) */
function ExportModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const templateId = useEditor((s) => s.templateId)
  const props = useEditor((s) => s.props)
  const hiddenLayers = useEditor((s) => s.hiddenLayers)
  const family = getTemplate(templateId).family
  const [targets, setTargets] = React.useState([
    { key: 'landscape', label: '横屏', size: '1280×720', checked: true, variant: '' },
    { key: 'portrait', label: '竖屏', size: '1080×1440', checked: true, variant: '-portrait' },
    { key: 'square', label: '方屏', size: '1080×1080', checked: false, variant: '' },
  ])
  const [results, setResults] = React.useState<Array<{ ok: boolean; text: string; file?: string }>>([])
  const [busy, setBusy] = React.useState(false)

  const toggle = (key: string): void => {
    setTargets((ts) => ts.map((t) => (t.key === key ? { ...t, checked: !t.checked } : t)))
  }

  /** 保存桥契约(2026-10-29 方案 1 用户裁决):每张先弹原生「另存为」选位置,选完才渲染、
   *  直接写入选的位置;取消=跳过该张继续下一张;桥缺失回退默认 cover 目录。 */
  const doExport = async (): Promise<void> => {
    const selected = targets.filter((t) => t.checked)
    if (!selected.length) return
    setBusy(true)
    setResults([])
    const picker = resolveSavePicker()
    if (!picker) setResults((prev) => [...prev, { ok: false, text: '－ 未检测到桌面保存桥,回退默认 cover 目录' }])
    for (const t of selected) {
      const tid = family + t.variant
      try {
        let fileName = `${family}-${t.key}.png`
        let outDir: string | undefined
        if (picker) {
          const picked = await picker.pick({
            title: `导出封面 · ${t.label}`,
            defaultPath: fileName,
            filters: [{ name: 'PNG 图片', extensions: ['png'] }],
          })
          if (!picked) {
            setResults((prev) => [...prev, { ok: false, text: `－ ${t.label}: 已跳过(未选保存位置)` }])
            continue
          }
          const sep = Math.max(picked.lastIndexOf('\\'), picked.lastIndexOf('/'))
          outDir = sep > 0 ? picked.slice(0, sep) : undefined
          fileName = sep > 0 ? picked.slice(sep + 1) : picked
        }
        const r = await fetch('/tintin/cover/api/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId: tid, props, hiddenLayers, fileName, outDir }),
        }).then((resp) => resp.json())
        setResults((prev) => [...prev, { ok: !!r.ok, file: r.ok ? String(r.file ?? '') : undefined, text: r.ok ? `✓ ${t.label} ${t.size} → ${r.file}` : `✗ ${t.label}: ${r.error || '?'}` }])
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
            {results.some((r) => r.ok) ? (
              <button
                onClick={() => {
                  const firstOk = results.find((r) => r.ok && r.file)
                  void fetch('/tintin/cover/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(firstOk?.file ? { dir: firstOk.file.slice(0, firstOk.file.length - dirNameOf(firstOk.file).length - 1) } : {}) }).catch(() => {})
                }}
                style={{ ...ghostBtn, width: 'auto', padding: '4px 12px', fontSize: 11, marginTop: 4 }}
              >📂 打开目录</button>
            ) : null}
          </div>
        ) : null}
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#8b8b88', fontSize: 12, padding: '5px 16px', cursor: 'pointer' }}>关闭</button>
        </div>
      </div>
    </div>
  )
}

/** 图层类型图标 */
const icon = (type: LayerDef['type']): string =>
  type === 'environment' ? '🖼' : type === 'product' ? '📷' : type === 'text' ? '🅣' : '◇'

/** 图层面板(2026-10-29 用户裁决重做:拖 ⠿ 调层级取代 ↑↓ 按钮;行视觉打磨) */
function LayersPanel({ project }: { project: string }): React.ReactElement {
  const templateId = useEditor((s) => s.templateId)
  const hiddenLayers = useEditor((s) => s.hiddenLayers)
  const selectedLayer = useEditor((s) => s.selectedLayer)
  const props = useEditor((s) => s.props)
  const toggleLayer = useEditor((s) => s.toggleLayer)
  const selectLayer = useEditor((s) => s.selectLayer)
  const setProp = useEditor((s) => s.setProp)
  const removeCustomLayer = useEditor((s) => s.removeCustomLayer)
  const reorderLayer = useEditor((s) => s.reorderLayer)
  const customLayers = useEditor((s) => s.props.customLayers) as Array<{ id: string; image: string; width: number; opacity?: number; rotate?: number }> | undefined
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
  const endDrag = (): void => { setDragId(null); setOverId(null); setAssetOverId(null) }
  /** 素材拖入图层面板(2026-10-30 用户裁决):拖到某层行=作为自定义层插到该层层级位置;
      拖到面板空白处=置顶。同步收纳(非 public 先 asset-sync 到项目素材位)。 */
  const dropAssetAsLayer = (assetName: string, afterLayerId: string | null): void => {
    void (async () => {
      try {
        if (!assetName.startsWith('public/')) {
          await fetch('/tintin/cover/api/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: assetName }) })
        }
        const id = useEditor.getState().addCustomLayer(assetName.replace(/^public\//, ''), Math.round(tpl.width / 2 - 180), Math.round(tpl.height / 3), 360)
        if (afterLayerId) reorderLayer(id, afterLayerId)
        useEditor.getState().selectLayer(id)
      } catch { /* 失败静默(同画布拖放口径) */ }
    })()
  }
  return (
    <div style={{ ...panelStyle, flex: '1 1 auto', minHeight: 0 }}>
      <div style={{ ...headStyle, display: 'flex', alignItems: 'center' }}>
        {/* 标题字体对齐项目 tab(2026-10-30 用户裁决:11.5 + tab 同亮色,去字距) */}
        <span style={{ flex: 1, fontSize: 11.5, color: '#e8e8e6', letterSpacing: 'normal' }}>图层 · {tpl.label}</span>
        <span style={{ fontSize: 10, color: '#8b8b88' }}>拖 ⠿ 调层级</span>
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
                  fontSize: 11, color: row.hidden ? '#6b6b69' : '#a9a9af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  background: selected ? 'rgba(79,124,255,0.12)' : 'transparent',
                }}
              >
                └ 默认图层 · {row.detail}
              </div>
            )
          }
          if (row.rowType === 'group') {
            const id = row.id
            const selected = selectedLayer === id
            const isOver = overId === id && dragId !== null && dragId !== id
            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
                onDragOver={(e) => {
                  if (dragId && dragId !== id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverId(id); return }
                  /* 素材拖入组行:图片组高亮,松手=加入本组(阶段2 叠放成员层) */
                  if (!dragId && e.dataTransfer.types.includes('application/x-tintin-cover-layer')) {
                    e.preventDefault(); e.dataTransfer.dropEffect = row.imageGroup ? 'copy' : 'none'; setAssetOverId(id)
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const assetName = e.dataTransfer.getData('application/x-tintin-cover-layer')
                  if (assetName && row.imageGroup) {
                    /* 阶段2 叠放:素材拖到图片组=加入本组(成员层,几何=画布中上,可再拖动微调);
                       「设为该组图(替换默认层)」在编辑卡按钮。 */
                    void (async () => {
                      try {
                        if (!assetName.startsWith('public/')) {
                          await fetch('/tintin/cover/api/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: assetName }) })
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
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 8,
                  cursor: 'grab', userSelect: 'none',
                  background: selected ? 'linear-gradient(90deg, rgba(79,124,255,0.22), rgba(79,124,255,0.07))' : 'rgba(127,127,127,0.05)',
                  border: selected
                    ? '1px solid rgba(79,124,255,0.55)'
                    : assetOverId === id ? '1px dashed rgba(79,124,255,0.7)'
                    : '1px solid transparent',
                  boxShadow: isOver ? 'inset 0 2px 0 #4f7cff' : 'none',
                  opacity: dragId === id ? 0.45 : 1,
                }}
              >
                <button
                  title={row.hidden ? '显示' : '隐藏'}
                  onClick={(e) => { e.stopPropagation(); toggleLayer(id) }}
                  style={{ ...iconBtn, opacity: row.hidden ? 0.35 : 1, width: 24, height: 24, fontSize: 13 }}
                >{row.hidden ? '🚫' : '👁'}</button>
                <span style={{ fontSize: 12, flexShrink: 0 }}>{icon(row.type)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: row.hidden ? '#8b8b88' : '#e8e8e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                {row.members > 0 ? <span style={{ fontSize: 10, color: '#4f7cff', flexShrink: 0 }}>{row.members} 层</span> : null}
                <span title="图层组:素材拖到组上=加入本组(图片组,叠放)" style={{ fontSize: 9.5, color: '#8b8b88', border: '1px solid #3a3a3e', borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>组</span>
                {/* 拖动柄放行尾(2026-10-30 用户裁决) */}
                <span title="拖动调层级" style={{ color: '#6b6b69', fontSize: 11, flexShrink: 0, cursor: 'grab' }}>⠿</span>
              </div>
            )
          }
          /* 游离素材行(不在任何组) */
          const id = row.id
          const selected = selectedLayer === id
          const isOver = overId === id && dragId !== null && dragId !== id
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
              onDragOver={(e) => {
                if (dragId && dragId !== id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverId(id); return }
                /* 素材拖入图层行(2026-10-30 用户裁决):高亮该行,松手=插到该层层级位置 */
                if (!dragId && e.dataTransfer.types.includes('application/x-tintin-cover-layer')) {
                  e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setAssetOverId(id)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const assetName = e.dataTransfer.getData('application/x-tintin-cover-layer')
                if (assetName) { dropAssetAsLayer(assetName, id); endDrag(); return }
                if (dragId && dragId !== id) reorderLayer(dragId, id)
                endDrag()
              }}
              onDragEnd={endDrag}
              onDragLeave={(e) => { if (assetOverId === id && !e.currentTarget.contains(e.relatedTarget as Node)) setAssetOverId(null) }}
              onClick={() => selectLayer(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 8,
                cursor: 'grab', userSelect: 'none',
                background: selected ? 'linear-gradient(90deg, rgba(79,124,255,0.22), rgba(79,124,255,0.07))' : 'rgba(127,127,127,0.05)',
                border: selected
                  ? '1px solid rgba(79,124,255,0.55)'
                  : assetOverId === id ? '1px dashed rgba(79,124,255,0.7)'
                  : '1px solid transparent',
                boxShadow: isOver ? 'inset 0 2px 0 #4f7cff' : 'none',
                opacity: dragId === id ? 0.45 : 1,
              }}
            >
              <button
                title={row.hidden ? '显示' : '隐藏'}
                onClick={(e) => { e.stopPropagation(); toggleLayer(id) }}
                style={{ ...iconBtn, opacity: row.hidden ? 0.35 : 1, width: 24, height: 24, fontSize: 13 }}
              >{row.hidden ? '🚫' : '👁'}</button>
              <span style={{ fontSize: 12, flexShrink: 0 }}>🖼</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: row.hidden ? '#8b8b88' : '#e8e8e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: row.group ? 10 : 0 }}>
                {row.group && defOf(row.group) ? <span style={{ fontSize: 9.5, color: '#4f7cff', border: '1px solid rgba(79,124,255,0.5)', borderRadius: 4, padding: '0 4px', marginRight: 5 }}>{defOf(row.group)?.label}</span> : null}
                {row.label}
              </span>
              <button title="删除图层" onClick={(e) => { e.stopPropagation(); removeCustomLayer(id) }} style={{ ...iconBtn, color: '#f87171', width: 24, height: 24, fontSize: 12 }}>✕</button>
              {/* 拖动柄放行尾(2026-10-30 用户裁决) */}
              <span title="拖动调层级" style={{ color: '#6b6b69', fontSize: 11, flexShrink: 0, cursor: 'grab' }}>⠿</span>
            </div>
          )
        })}
      </div>
      {/* 选中图层编辑:固定层走原文字/图片编辑;自定义层 = 宽度/透明度/旋转 */}
      {(() => {
        if (!selectedLayer) return null
        if (customById.has(selectedLayer)) return <CustomLayerEditor layer={customById.get(selectedLayer)!} project={project} />
        const layer = tpl.layerDefs.find((l) => l.id === selectedLayer)
        if (!layer || hiddenLayers.includes(layer.id)) return null
        const key = layer.propsKey ?? layer.id
        const value = props[key]
        if (layer.type === 'text') {
          const text = Array.isArray(value) ? value.join('\n') : String(value ?? '')
          const lines = Array.isArray(value) ? (value as string[]) : null
          return (
            <div style={{ marginTop: 14 }}>
              <div style={headStyle}>编辑「{layer.label}」</div>
              <DelayedTextEditor key={layer.id} value={text} isArray={Array.isArray(value)}
                rows={Array.isArray(value) ? Math.max(3, value.length + 1) : 3}
                onCommit={(v) => setProp(key, Array.isArray(value) ? v.split('\n') : v)} />
              {/* 钩子行管理(§2.5 P2):逐行删/加一行;文案编辑仍在上方文本框 */}
              {lines ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                  {lines.map((line, i) => (
                    <span key={`${i}:${line}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #3a3a3e', borderRadius: 999, padding: '1px 4px 1px 8px', fontSize: 10.5, color: '#c9c9cf' }}>
                      行{i + 1}
                      <button
                        title={`删除行${i + 1}`}
                        onClick={() => { if (lines.length <= 1) return; setProp(key, lines.filter((_, j) => j !== i)) }}
                        style={{ border: 0, background: 'transparent', color: lines.length > 1 ? '#f87171' : '#55565c', cursor: lines.length > 1 ? 'pointer' : 'default', fontSize: 10, padding: '0 3px' }}
                      >✕</button>
                    </span>
                  ))}
                  <button
                    onClick={() => setProp(key, [...lines, ''])}
                    title="追加一行(在文本框里填内容)"
                    style={{ border: '1px dashed #3a3a3e', borderRadius: 999, background: 'transparent', color: '#8b8b88', fontSize: 10.5, padding: '1px 8px', cursor: 'pointer' }}
                  >＋ 添加一行</button>
                </div>
              ) : null}
              <TextStyleEditor layerId={layer.id} baseFontSize={layer.fontSize ?? 36} />
              <div style={{ fontSize: 10.5, color: '#8b8b88', marginTop: 4 }}>
                {Array.isArray(value) ? '每行一条(钩子/卖点);末行默认跳色可被颜色覆盖' : '支持中文;改动即时预览'}
              </div>
            </div>
          )
        }
        if (layer.type === 'product' || key === 'bgImage') {
          return <ImageLayerEditor layerLabel={layer.label} propKey={key} project={project} />
        }
        /* 装饰层的文案可编辑(2026-10-30 用户裁决:品牌条/栏目角标等不再锁死——
           它们的文字就是模板 props 的字符串,如 brand/subTag/badge,改字即改画布)。
           纯装饰无 prop 的层(网格纹理等)仍只有 隐藏/层级 两项。 */
        if (typeof value === 'string') {
          return (
            <div style={{ marginTop: 14 }}>
              <div style={headStyle}>编辑「{layer.label}」</div>
              <DelayedTextEditor key={layer.id} value={value} isArray={false}
                onCommit={(v) => setProp(key, v)} />
              <div style={{ fontSize: 10.5, color: '#8b8b88', marginTop: 4 }}>装饰层文案,改动即时预览;字号/配色由模板排版</div>
            </div>
          )
        }
        return null
      })()}
    </div>
  )
}

/** 自定义图片图层编辑:宽度/透明度/旋转(滑条预览-提交分离+数字输入精确值);
 *  从素材替换(保留几何,§2.5 P1)/抠图去背景(结果=素材,2026-10-31 裁决:不自动上图)。 */

export { AssetsPanel, ExportModal, LayersPanel }

/** 文字样式细调:字号缩放+颜色预设;存 props.styles(§9.3 同一份 props 投影) */