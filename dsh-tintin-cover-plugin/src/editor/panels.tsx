// 工程素材面板 + 导出模态(2026-10-29 从 App.tsx 迁出;千行付账)。
// 2026-11-11 WP-B: 图层面板迁 layers-panel.tsx(PhotoCraft 化升级),本文件只剩素材条+导出。
import React from 'react'
import { getTemplate } from '../registry'
import { useEditor } from './store'
import { chatFrameRef, ensureMenuStyle, ghostBtn, iconBtn } from './ui'

/** 横向素材条样式(:hover/:active 语义 inline style 无法表达,一次性注入)。
 *  右键菜单皮肤上收 ui.ts ensureMenuStyle(2026-11-11 WP-B,与图层面板共用)。 */
let stripStyleInjected = false
function ensureStripStyle(): void {
  if (stripStyleInjected || typeof document === 'undefined') return
  ensureMenuStyle()
  stripStyleInjected = true
  const s = document.createElement('style')
  s.textContent = [
    '.tintin-as-cell{position:relative}',
    '.tintin-as-drop{outline:2px dashed var(--accent);outline-offset:-8px}',
    /* 收藏星标(右键菜单「收藏」) */
    '.tintin-as-fav{position:absolute;top:4px;right:4px;z-index:5;color:#f5c451;font-size:12px;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.6)}',
    /* 滚动条与右侧会话框同款(2026-10-31 用户裁决:细条圆角透明轨道;取自 chat.css Thin scrollbars) */
    '::-webkit-scrollbar{width:9px;height:9px}',
    '::-webkit-scrollbar-track{background:transparent}',
    '::-webkit-scrollbar-thumb{background:var(--border-strong,#3f3f46);border-radius:99px;border:2px solid transparent;background-clip:padding-box}',
    '::-webkit-scrollbar-thumb:hover{background:var(--text-faint,var(--text-faint));background-clip:padding-box}',
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
    void fetch('/tintin/ipc/cover/acp/hello').then((r) => r.json()).then((d) => {
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
    void fetch(`/tintin/ipc/cover/acp/files?project=${encodeURIComponent(project)}`).then((r) => r.json()).then((d) => {
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
          await fetch('/tintin/ipc/cover/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
        }
        useEditor.getState().addCustomLayer(name.replace(/^public\//, ''), Math.round(tpl.width / 2 - 180), Math.round(tpl.height / 3), 360)
      } catch { /* 失败静默(同原按钮口径) */ }
    })()
  }
  const referFile = (name: string): void => {
    chatFrameRef.current?.contentWindow?.postMessage({ type: 'tintin-cover:refer-file', name }, '*')
  }
  /** 导入/拖入(2026-10-30 用户裁决):图片文件上传落当前项目目录(upload-image 双写
      三写位+项目,画布/素材条/导出三处可用);重名自动加时间戳前缀。
      2026-11-02 用户裁决:成败按服务端真实应答判定;失败界面只说人话(拒绝原因),
      HTTP 状态码与 JSON 原文进 console 供排查——UI 禁现传输层噪音。 */
  const importFiles = async (list: FileList | null): Promise<void> => {
    const files = Array.from(list ?? []).filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f.name))
    if (!files.length) { flashNotice('仅支持图片文件(png/jpg/webp/gif/svg)'); return }
    setImportBusy(true)
    const existing = new Set(items.map((i) => i.path.split('/').pop() ?? i.path))
    let ok = 0
    const failures: string[] = []
    for (const f of files) {
      /* 客户端预检(2026-11-12 素材创作批):超限先拦,免整包上传才被 413 */
      if (f.size > 15 * 1024 * 1024) { failures.push(`${f.name}：超过 15MB 上限，请压缩后再导入`); continue }
      let name = f.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\.\./g, '-')
      if (existing.has(name)) name = `${Date.now()}-${name}`
      existing.add(name)
      try {
        const bytes = await f.arrayBuffer()
        const r = await fetch(`/tintin/ipc/cover/upload-image?name=${encodeURIComponent(name)}&project=${encodeURIComponent(project)}`, {
          method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes,
        })
        if (!r.ok) {
          const raw = (await r.text()).trim()
          console.warn(`[tintin] 导入被拒 HTTP ${r.status} ${name} ${raw.slice(0, 200)}`)
          let server = ''
          try { const j = JSON.parse(raw); if (typeof j?.error === 'string') server = j.error } catch { if (raw && !raw.startsWith('{') && !raw.startsWith('<')) server = raw.slice(0, 80) }
          const human = r.status === 400 ? (server || '文件内容或名称不被接受')
            : r.status === 403 ? '本地服务安全校验未通过'
            : r.status === 404 ? '服务接口缺失(版本不匹配?)'
            : r.status === 413 ? '文件过大'
            : r.status >= 500 ? (server || '本地服务处理失败')
            : (server || `本地服务返回错误码 ${r.status}`)
          throw new Error(human)
        }
        ok += 1
      } catch (e) {
        failures.push(`${f.name}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setImportBusy(false)
    reloadNow()
    if (failures.length === 0) flashNotice(`已导入 ${ok} 张素材到当前项目`)
    else if (ok > 0) flashNotice(`已导入 ${ok} 张；失败 ${failures.length} 张——${failures[0]}`)
    else flashNotice(`导入失败——${failures[0] ?? '请重试'}`)
  }
  /** URL 拖入导入(2026-10-31 用户报障:从浏览器/网页拖图,载荷无 File 只有 URI):
      主进程侧拉取(免页面 CORS),落盘口径与 upload-image 一致。 */
  const importUrl = (url: string): void => {
    setImportBusy(true)
    void (async () => {
      try {
        const r = await (await fetch('/tintin/ipc/cover/upload-url', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, project }),
        })).json() as { ok?: boolean; name?: string; error?: string; warning?: string }
        if (!r.ok || !r.name) throw new Error(r.error || 'URL 导入失败')
        reloadNow()
        /* 项目目录落盘失败如实呈现(2026-11-12 素材创作批:路由回 warning 字段) */
        flashNotice(r.warning ? `已导入 ${r.name}——${r.warning}` : `已导入 ${r.name}`)
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
      style={{ flexShrink: 0, background: 'var(--bg-panel)', borderTop: '1px solid var(--border)', padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
      onDragOver={stripDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false) }}
      onDrop={stripDrop}
    >
      {/* 头行 40px=与顶部工具栏同高;字号对齐图层面板头行(2026-10-30 用户裁决) */}
      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* 标题字体对齐项目 tab(2026-10-30 用户裁决:11.5 + tab 同亮色) */}
        <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700 }}>素材 · {items.length} 张</span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importBusy}
          title="从系统目录选择图片文件导入当前项目"
          style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid var(--border-strong)', cursor: importBusy ? 'wait' : 'pointer', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}
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
        {notice ? <span style={{ fontSize: 11, color: notice.includes('失败') ? 'var(--warn)' : 'var(--ok)' }}>{notice}</span> : null}
        <span style={{ flex: 1 }} />
        {/* 打开封面项目文件目录(2026-10-29 用户裁决):复用 /api/reveal(缺省=封面目录)。
            图标与热区放大(2026-10-30 用户追问:13px emoji 过小,与 40px 头行不匹配) */}
        <button
          type="button"
          title="打开封面项目的文件目录"
          onClick={() => { void fetch('/tintin/ipc/cover/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) }}
          style={{ ...iconBtn, width: 30, height: 30, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
        >📁</button>
        <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>拖图入库 · 拖到画布成层</span>
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
                style={{ flexShrink: 0, width: 128, height: 148, borderRadius: 8, border: '1px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 20, background: 'var(--bg-app)' }}
              >
                {i === 0 ? '⬆' : '🖼'}
              </div>
            ))}
            {/* 提示文案只在确认加载完成且确为空时出现;加载中不闪文案(切项目防抖动) */}
            {loaded ? (
              <div style={{ flexShrink: 0, alignSelf: 'center', fontSize: 11, color: 'var(--text-faint)', padding: '0 10px', lineHeight: 1.8 }}>
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
                cursor: 'default', border: sel ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 8,
                overflow: 'hidden', background: 'var(--bg-app)', flexShrink: 0, width: 128,
              }}
            >
              {/* 1:1 方格+棋盘格衬底=透明素材可见（RGBA 装饰落在近黑底上曾是黑块） */}
              <div style={{ height: 128, background: 'repeating-conic-gradient(#2e2e35 0% 25%, #1b1b21 0% 50%) 0 0 / 12px 12px' }}>
                <img src={`/tintin/ipc/cover/acp/asset?name=${encodeURIComponent(name)}`} alt={base} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              </div>
              <div style={{ padding: '3px 6px', fontSize: 10, lineHeight: '12px', color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{base}</div>
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
            <button onClick={() => { void fetch('/tintin/ipc/cover/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: menu.name }) }); setMenu(null) }}><span className="ico">📂</span>在文件资源管理器中显示</button>
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
                  const r = await (await fetch('/tintin/ipc/cover/delete-asset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: menu.name }) })).json() as { ok?: boolean; error?: string; keptInAssets?: boolean; referencedBy?: string[] }
                  if (!r.ok) throw new Error(r.error || '删除失败')
                  if (selected === menu.name) setSelected(null)
                  reloadNow()
                  /* 素材位保留说明(2026-11-12 素材创作批:他项目仍引用时三写位不清) */
                  if (r.keptInAssets) flashNotice(`已从项目删除；素材位保留（仍被其它项目引用：${(r.referencedBy ?? []).join('、')}）`)
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

/** 桌面目录桥(2026-11-14 导出批;OpenFilm `openfilm:native:pick-folder` 同款语义的
 *  Desktop 版):`dshDesktopFolderPicker.pick({title, defaultPath})` → 绝对目录或 null。
 *  优先本窗、回退父窗;缺失/异常=手输路径回退(ExportCenter folderDraft 同款)。 */
type FolderPicker = { pick(params?: { title?: string; defaultPath?: string }): Promise<string | null> }
function resolveFolderPicker(): FolderPicker | null {
  const self = window as unknown as { dshDesktopFolderPicker?: FolderPicker }
  const parent = window.parent !== window ? (window.parent as unknown as { dshDesktopFolderPicker?: FolderPicker }) : null
  return self.dshDesktopFolderPicker ?? parent?.dshDesktopFolderPicker ?? null
}

/** 绝对路径 → 基名(目录截断展示避免状态行爆长) */
const dirNameOf = (p: string): string => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1)

/** 字节数 → 人话(视频剪辑 export-jobs formatBytes 同款口径) */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  const kb = n / 1024
  if (kb < 1023.5) return `${Math.max(1, Math.round(kb))} KB`
  const mb = n / (1024 * 1024)
  if (mb < 1023.5) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(n / (1024 ** 3)).toFixed(2)} GB`
}

/** 导出模态自用样式(旋转加载圈;inline style 无法表达 keyframes,一次性注入) */
let exportStyleInjected = false
function ensureExportStyle(): void {
  if (exportStyleInjected || typeof document === 'undefined') return
  exportStyleInjected = true
  const s = document.createElement('style')
  s.textContent = [
    '@keyframes tintin-exp-rotate{to{transform:rotate(360deg)}}',
    '.tintin-exp-spin{animation:tintin-exp-rotate .9s linear infinite}',
  ].join('\n')
  document.head.append(s)
}

/* 导出弹窗小组件(逐件照搬视频剪辑 ExportCenter 的同名件,尺寸/间距/圆角同值,
   token 用封面编辑器同源变量) */

function ExpField({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </div>
  )
}

function ExpOptionCard({ on, title, size, desc, onClick }: {
  on: boolean; title: string; size?: string; desc: string; onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, borderRadius: 12,
        border: `1px solid ${on ? 'var(--border-strong)' : 'var(--border)'}`, background: on ? 'var(--bg-pressed)' : 'transparent',
        padding: '10px 12px', textAlign: 'left', cursor: 'pointer', transition: 'border-color .12s, background .12s',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, width: '100%' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        {size ? <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{size}</span> : null}
      </span>
      <span style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--text-muted)' }}>{desc}</span>
    </button>
  )
}

const ICON_FOLDER = (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.9a2 2 0 0 1 1.69.9l.8 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </svg>
)
const ICON_CHEVRON = (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
)
const ICON_SPIN = (
  <svg className="tintin-exp-spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

type ExportVariantKey = 'landscape' | 'portrait'
type ExportFormatKey = 'jpg' | 'png' | 'psd'
const EXPORT_EXT: Record<ExportFormatKey, string> = { jpg: 'jpg', png: 'png', psd: 'psd' }
/** 上次所选目录(与视频剪辑 ExportCenter 同款:浏览器侧记忆,下次回来) */
const EXPORT_DIR_STORE_KEY = 'tintin-cover.exportDir.v1'

/** 导出选项模态(2026-11-14 重构:复制视频剪辑 ExportCenter 图片页结构再改——左预览区/
   右格式列/底部路径条;格式 JPG/PNG/PSD,卡片上的文件大小=编辑期精确编码值;
   目录默认=封面项目目录(图片路径),点击 chip 弹原生「选择导出的保存位置」) */
function ExportModal({ project, onClose }: { project: string; onClose: () => void }): React.ReactElement {
  ensureExportStyle()
  const templateId = useEditor((s) => s.templateId)
  const props = useEditor((s) => s.props)
  const hiddenLayers = useEditor((s) => s.hiddenLayers)
  const family = getTemplate(templateId).family
  /* 打开瞬间的载荷快照:弹窗盖住画布,编辑不动,编码/落盘共用同一份(props 进缓存键) */
  const payload = React.useRef({ templateId, props, hiddenLayers })

  const [targets, setTargets] = React.useState([
    { key: 'landscape' as ExportVariantKey, label: '横屏', size: '1280×720', checked: true },
    { key: 'portrait' as ExportVariantKey, label: '竖屏', size: '1080×1440', checked: true },
  ])
  const [formats, setFormats] = React.useState([
    { key: 'jpg' as ExportFormatKey, label: 'JPG', hint: '体积小，适合直接分享', checked: false },
    { key: 'png' as ExportFormatKey, label: 'PNG', hint: '无损，通用', checked: true },
    { key: 'psd' as ExportFormatKey, label: 'PSD', hint: 'PS 可打开（拍平单层）', checked: false },
  ])
  /* 编码产物:每变体 PNG 预览 + 每格式的精确字节数(尺寸/宽高由渲染结果回填) */
  const [preview, setPreview] = React.useState<Partial<Record<ExportVariantKey, string>>>({})
  const [dims, setDims] = React.useState<Partial<Record<ExportVariantKey, string>>>({})
  const [sizeOf, setSizeOf] = React.useState<Partial<Record<ExportVariantKey, Partial<Record<ExportFormatKey, number>>>>>({})
  const [encoding, setEncoding] = React.useState(true)
  const [encodeErr, setEncodeErr] = React.useState('')
  /* 目录:默认=项目目录(图片路径);上次选过的目录优先(localStorage,视频剪辑同款);
     chip 点击=原生「选择导出的保存位置」;无桥=手输回退(folderDraft) */
  const [dir, setDir] = React.useState('')
  const [dirDefault, setDirDefault] = React.useState('')
  const [picking, setPicking] = React.useState(false)
  const [folderDraft, setFolderDraft] = React.useState<string | null>(null)
  const [baseName, setBaseName] = React.useState(project || family)
  const [exporting, setExporting] = React.useState(false)
  const [results, setResults] = React.useState<Array<{ ok: boolean; text: string; file?: string }>>([])

  /** 单变体编码(PNG=预览+字节 → JPEG → PSD),结果就地并入状态;两变体并行请求,
   *  谁先渲染完谁的预览先亮(整弹窗等待≈单变体耗时,非两倍) */
  const encodeVariant = async (variant: ExportVariantKey): Promise<void> => {
    const r = await fetch('/tintin/ipc/cover/export-encode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload.current, variants: [variant] }),
    }).then((x) => x.json()) as {
      ok?: boolean; error?: string; previews?: Record<string, string>
      items?: Array<{ variant: ExportVariantKey; format: ExportFormatKey; size: number; width: number; height: number }>
    }
    if (!r?.ok) throw new Error(r?.error || '编码失败')
    const pv = (r.previews ?? {})[variant]
    if (pv) setPreview((p) => ({ ...p, [variant]: pv }))
    const byFormat: Partial<Record<ExportFormatKey, number>> = {}
    for (const it of r.items ?? []) {
      byFormat[it.format] = it.size
      setDims((d) => ({ ...d, [it.variant]: `${it.width}×${it.height}` }))
    }
    setSizeOf((s) => ({ ...s, [variant]: byFormat }))
  }
  const encodeAll = async (): Promise<void> => {
    setEncoding(true)
    setEncodeErr('')
    const errs: string[] = []
    await Promise.all((['landscape', 'portrait'] as ExportVariantKey[]).map(async (v) => {
      try { await encodeVariant(v) } catch (e) { errs.push(`${v === 'landscape' ? '横屏' : '竖屏'}: ${e instanceof Error ? e.message : String(e)}`) }
    }))
    if (errs.length) setEncodeErr(errs.join('；'))
    setEncoding(false)
  }

  React.useEffect(() => {
    /* 首帧先读上次目录(chip 立即有名字),再取默认项目目录兜底;随后开编码 */
    let saved = ''
    try { saved = localStorage.getItem(EXPORT_DIR_STORE_KEY) ?? '' } catch { /* 私窗=跳过 */ }
    if (saved) setDir(saved)
    void (async () => {
      try {
        const r = await fetch('/tintin/ipc/cover/export-dir').then((x) => x.json()) as { ok?: boolean; dir?: string }
        if (r?.ok && r.dir) {
          setDirDefault(r.dir)
          if (!saved) setDir(r.dir)
        }
      } catch { /* 默认目录拿不到=chip 空着,可选/手输 */ }
    })()
    void encodeAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleVariant = (key: string): void => {
    setTargets((ts) => ts.map((t) => (t.key === key ? { ...t, checked: !t.checked } : t)))
  }
  const toggleFormat = (key: string): void => {
    setFormats((fs) => fs.map((f) => (f.key === key ? { ...f, checked: !f.checked } : f)))
  }

  const selectedVariants = targets.filter((t) => t.checked)
  const selectedFormats = formats.filter((f) => f.checked)
  /** 某格式在已勾选变体上的合计字节(编码完成后是精确值) */
  const sizeFor = (format: ExportFormatKey): number | null => {
    let total = 0
    for (const t of selectedVariants) {
      const v = sizeOf[t.key]?.[format]
      if (typeof v !== 'number') return null
      total += v
    }
    return total
  }
  const fileCount = selectedVariants.length * selectedFormats.length
  const cleanBase = baseName.replace(/[\\/:*?"<>|]/g, '_').trim() || family
  const emptyReason = !selectedVariants.length || !selectedFormats.length
    ? '请至少选择一个尺寸和一个格式。'
    : !dir ? '请先选择保存位置。' : ''

  /** chip 点击=原生「选择导出的保存位置」(OpenFilm changeFolder 同流程);桥缺失/异常=手输回退 */
  const changeFolder = async (): Promise<void> => {
    if (picking) return
    const picker = resolveFolderPicker()
    if (!picker) { setFolderDraft(dir || dirDefault); return }
    setPicking(true)
    try {
      const picked = await picker.pick({ title: '选择导出的保存位置', defaultPath: dir || dirDefault || undefined })
      if (picked) {
        setDir(picked)
        try { localStorage.setItem(EXPORT_DIR_STORE_KEY, picked) } catch { /* 私窗=不记忆 */ }
      }
    } catch {
      setFolderDraft(dir || dirDefault)
    } finally {
      setPicking(false)
    }
  }
  const commitFolder = (): void => {
    if (folderDraft == null) return
    const next = folderDraft.trim()
    if (next) {
      setDir(next)
      try { localStorage.setItem(EXPORT_DIR_STORE_KEY, next) } catch { /* 不记忆 */ }
    }
    setFolderDraft(null)
  }

  /** 导出落盘:编码期产物按内容键缓存,命中直接写盘(秒出);过期按需重编。
   *  每文件独立结果行,失败不拖垮其余。 */
  const doExport = async (): Promise<void> => {
    if (exporting || emptyReason) return
    setExporting(true)
    setResults([])
    try {
      const files = selectedVariants.flatMap((t) => selectedFormats.map((f) => ({
        variant: t.key,
        format: f.key,
        fileName: `${cleanBase}-${t.key}.${EXPORT_EXT[f.key]}`,
      })))
      const r = await fetch('/tintin/ipc/cover/export-write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload.current, outDir: dir, baseName: cleanBase, files }),
      }).then((x) => x.json()) as { ok?: boolean; results?: Array<{ variant: string; format: string; ok: boolean; file?: string; error?: string }> }
      const label = (v: string): string => targets.find((t) => t.key === v)?.label ?? v
      const rows = (r?.results ?? []).map((it) => ({
        ok: it.ok,
        file: it.ok ? it.file : undefined,
        text: it.ok
          ? `✓ ${label(it.variant)} ${it.format.toUpperCase()} → ${it.file}`
          : `✗ ${label(it.variant)} ${it.format.toUpperCase()}: ${it.error || '?'}`,
      }))
      setResults(rows)
    } catch (e) {
      setResults([{ ok: false, text: `✗ ${e instanceof Error ? e.message : String(e)}` }])
    } finally {
      setExporting(false)
    }
  }

  const totalBytes = selectedFormats.reduce((sum, f) => sum + (sizeFor(f.key) ?? 0), 0)
  const sizesReady = selectedFormats.every((f) => sizeFor(f.key) !== null)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={() => { if (!exporting) onClose() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="导出封面"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 94vw)', height: 'min(640px, 90vh)', display: 'flex', flexDirection: 'column',
          minWidth: 0, minHeight: 0, overflow: 'hidden', borderRadius: 16, border: '1px solid var(--border)',
          background: 'var(--bg-raised)', boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* 头部:标题+描述+关闭(ExportCenter 头部同构) */}
        <div style={{ display: 'flex', flexShrink: 0, alignItems: 'flex-start', gap: 8, padding: '16px 20px 4px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>导出封面</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>把当前封面保存为独立图片文件，支持 JPG / PNG / PSD。</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => { if (!exporting) onClose() }}
            style={{ alignSelf: 'flex-start', borderRadius: 8, border: 0, background: 'transparent', padding: 4, color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>

        {/* 主体:左=预览区 / 右=尺寸+格式列(ExportCenter 图片页 grid 同款) */}
        <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden auto', padding: '12px 20px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 272px', gap: 24, minHeight: 0 }}>
            {/* 左:预览区(勾选的横/竖屏逐张渲染;渲染中=占位) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              {targets.filter((t) => t.checked).map((t) => (
                <figure key={t.key} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', minWidth: 0 }}>
                  {preview[t.key] ? (
                    <img src={preview[t.key]} alt={`${t.label} 预览`} style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }} />
                  ) : (
                    <div style={{ width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, border: '1px dashed var(--border-strong)', color: 'var(--text-faint)', fontSize: 12 }}>
                      {encodeErr ? '—' : <>{ICON_SPIN} 渲染中…</>}
                    </div>
                  )}
                  <figcaption style={{ fontSize: 11, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                    {t.label}{dims[t.key] ? ` · ${dims[t.key]}` : ` · ${t.size}`}
                  </figcaption>
                </figure>
              ))}
              {!targets.some((t) => t.checked) ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>勾选左侧尺寸后出预览</div>
              ) : null}
              {encodeErr ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--err)', wordBreak: 'break-all' }}>✗ {encodeErr}</span>
                  <button
                    onClick={() => { void encodeAll() }}
                    style={{ ...ghostBtn, width: 'auto', padding: '4px 12px', fontSize: 11 }}
                  >重新编码</button>
                </div>
              ) : null}
            </div>

            {/* 右:尺寸 + 格式(含每格式精确文件大小) */}
            <div style={{ display: 'flex', minWidth: 0, flexDirection: 'column', gap: 20 }}>
              <ExpField label="尺寸">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {targets.map((t) => (
                    <ExpOptionCard
                      key={t.key}
                      on={t.checked}
                      title={t.label}
                      desc={t.size}
                      onClick={() => toggleVariant(t.key)}
                    />
                  ))}
                </div>
              </ExpField>
              <ExpField label="格式">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {formats.map((f) => {
                    const bytes = sizeFor(f.key)
                    return (
                      <ExpOptionCard
                        key={f.key}
                        on={f.checked}
                        title={f.label}
                        size={bytes !== null ? formatBytes(bytes) : '…'}
                        desc={f.hint}
                        onClick={() => toggleFormat(f.key)}
                      />
                    )
                  })}
                </div>
              </ExpField>
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                大小按当前画布精确编码得出；PSD 为拍平单层，逐图层精修仍走 PhotoCraft 底稿。
              </p>
            </div>
          </div>
        </div>

        {/* 底部:路径 chip + 文件名 + 汇总 + 导出(ExportCenter 底栏同构) */}
        <div style={{ display: 'flex', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center', columnGap: 20, rowGap: 12, borderTop: '1px solid var(--border)', padding: '14px 20px' }}>
          <div style={{ display: 'flex', flex: '1 1 280px', maxWidth: 560, minWidth: 0, alignItems: 'center', gap: 8 }}>
            {folderDraft != null ? (
              <input
                autoFocus
                value={folderDraft}
                spellCheck={false}
                aria-label="保存到"
                onChange={(e) => setFolderDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commitFolder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitFolder() }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFolderDraft(null) }
                }}
                style={{ height: 40, minWidth: 0, flex: 1, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-panel)', padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', outline: 'none' }}
              />
            ) : (
              <button
                type="button"
                onClick={() => void changeFolder()}
                disabled={picking}
                title={dir || '选择导出的保存位置'}
                aria-label={`保存到: ${dir || '—'}`}
                style={{ display: 'flex', height: 40, minWidth: 0, maxWidth: '45%', flexShrink: 0, alignItems: 'center', gap: 8, borderRadius: 8, border: '1px solid var(--border)', paddingLeft: 12, paddingRight: 10, fontSize: 13, color: 'var(--text)', outline: 'none', cursor: 'pointer', background: 'transparent', transition: 'border-color .12s' }}
              >
                {picking ? <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>{ICON_SPIN}</span> : <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>{ICON_FOLDER}</span>}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir ? dirNameOf(dir) : '选择位置'}</span>
                <span style={{ color: 'var(--text-faint)', display: 'inline-flex', flexShrink: 0 }}>{ICON_CHEVRON}</span>
              </button>
            )}
            <input
              value={baseName}
              spellCheck={false}
              placeholder={family}
              aria-label="名称"
              title="导出文件名（自动加尺寸与格式后缀）"
              onChange={(e) => setBaseName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => { if (e.key === 'Enter' && !emptyReason) { e.preventDefault(); void doExport() } }}
              style={{ height: 40, minWidth: 0, flex: 1, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-field)', padding: '0 12px', fontSize: 13, color: 'var(--text)', outline: 'none', transition: 'border-color .12s' }}
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', minWidth: 0, alignItems: 'center', gap: 16 }}>
            {/* 打开目录(2026-11-14 用户裁决:预览区结果块撤除,入口移到底栏「已导出」左边;
                几何=导出钮同款 40px/圆角 12,ghost 描边不抢主钮) */}
            {results.some((r) => r.ok) ? (
              <button
                type="button"
                onClick={() => {
                  const firstOk = results.find((r) => r.ok && r.file)
                  void fetch('/tintin/ipc/cover/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(firstOk?.file ? { dir: firstOk.file.slice(0, firstOk.file.length - dirNameOf(firstOk.file).length - 1) } : {}) }).catch(() => {})
                }}
                style={{ display: 'flex', height: 40, flexShrink: 0, alignItems: 'center', gap: 8, borderRadius: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', padding: '0 16px', fontSize: 13, cursor: 'pointer', transition: 'border-color .12s' }}
              >
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>{ICON_FOLDER}</span>
                打开目录
              </button>
            ) : null}
            <div style={{ minWidth: 0, textAlign: 'right', fontSize: 12, lineHeight: 1.4 }}>
              {results.length ? (
                <span style={{ color: results.every((r) => r.ok) ? 'var(--ok)' : 'var(--err)' }}>
                  {results.every((r) => r.ok) ? `已导出 ${results.filter((r) => r.ok).length} 个文件` : '部分失败，详见预览区'}
                </span>
              ) : emptyReason ? (
                <span style={{ color: 'var(--text-faint)' }}>{emptyReason}</span>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {fileCount} 个文件{sizesReady && totalBytes > 0 ? ` · 共 ${formatBytes(totalBytes)}` : encoding ? ' · 编码中…' : ''}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void doExport()}
              disabled={Boolean(emptyReason) || exporting}
              style={{ display: 'flex', height: 40, flexShrink: 0, alignItems: 'center', gap: 8, borderRadius: 12, border: 0, background: 'var(--primary)', color: 'var(--on-primary)', padding: '0 24px', fontSize: 13.5, fontWeight: 500, cursor: emptyReason || exporting ? 'default' : 'pointer', opacity: emptyReason || exporting ? 0.4 : 1 }}
            >
              {exporting ? <span style={{ display: 'inline-flex', color: 'var(--on-primary)' }}>{ICON_SPIN}</span> : null}
              {exporting ? '正在导出…' : fileCount > 1 ? `导出 ${fileCount} 个文件` : '导出'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { AssetsPanel, ExportModal }
