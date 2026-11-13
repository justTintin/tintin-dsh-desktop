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
import { canvasDragFreeze } from './use-canvas-zoom'

/** 预览区顶条(2026-10-29 用户裁决:设置从左面板移到预览区上方横条;横竖屏+预览显示同行) */
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
  React.useEffect(() => {
    const onRequest = (event: MessageEvent): void => {
      const data = event.data as { type?: string } | null
      if (data && data.type === 'tintin-cover:skills-open') setShowSkills(true)
    }
    window.addEventListener('message', onRequest)
    return () => window.removeEventListener('message', onRequest)
  }, [])
  /* PhotoCraft 未安装引导(2026-11-13 用户裁决:PhotoCraft 不随包集成——点击时检测,
     未装弹引导窗:下载地址+选择安装目录(粘贴目录或 exe 路径),保存进 config.json
     photocraft.dir 后直接启动;之后一键直启。 */
  const [pcNotInstalled, setPcNotInstalled] = React.useState<null | { downloadUrl: string; releasesUrl: string; hint?: string }>(null)
  const [pcDirInput, setPcDirInput] = React.useState('')
  const [pcPickError, setPcPickError] = React.useState('')
  const openPhotoCraft = (): void => {
    /* 送当前模板+props:主进程按其构建图层底稿,PhotoCraft 随文档启动(不再开空窗) */
    const s = useEditor.getState()
    void fetch('/tintin/ipc/cover/pc/launch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: s.templateId, props: { ...s.props, hiddenLayers: s.hiddenLayers } }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (r && r.notInstalled) {
          setPcDirInput('')
          setPcPickError('')
          setPcNotInstalled({ downloadUrl: String(r.downloadUrl ?? 'https://getartcraft.com/'), releasesUrl: String(r.releasesUrl ?? ''), hint: String(r.hint ?? '') })
          return
        }
        if (r && r.ok === false) window.alert('PhotoCraft 打开失败：' + String(r.error ?? ''))
      })
      .catch(() => {})
  }
  const savePcDirAndLaunch = (): void => {
    void fetch('/tintin/ipc/cover/pc/save-config', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: pcDirInput }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (!r || r.ok !== true) { setPcPickError(String(r?.error ?? '保存失败')); return }
        setPcNotInstalled(null)
        openPhotoCraft()
      })
      .catch((e) => setPcPickError(e instanceof Error ? e.message : String(e)))
  }
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
        {/* 技能管理入口(2026-11-09 用户裁决:顶栏 ⚙ 左边加图标——此前入口只剩空会话
            「更多技能」链接,0.3.0 composer 重绘后 ▦ 通道不稳,编辑器顶栏给常驻直达) */}
        <button onClick={() => setShowSkills(true)} title="技能管理" style={{ ...iconBtn }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/></svg>
        </button>
        {/* 按钮序(2026-10-31 用户裁决):设置第一,其后 PhotoCraft、导出;技能管理 2026-11-09 加于设置左侧 */}
        <button onClick={() => setShowServer(true)} title="服务设置（服务端地址 + MCP 自动发现）" style={{ ...iconBtn }}>
          ⚙
        </button>
        <button onClick={openPhotoCraft} title="用 PhotoCraft 打开精修" style={{ ...iconBtn }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
        </button>
        <button onClick={() => setShowExport(true)} title="导出封面 PNG" style={{ ...iconBtn }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
      {showExport ? <ExportModal onClose={() => setShowExport(false)} /> : null}
      {showServer ? <ServerSettingsModal onClose={() => setShowServer(false)} /> : null}
      {showSkills ? <SkillsModal onClose={() => setShowSkills(false)} /> : null}
      {pcNotInstalled ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
          <div style={{ width: 480, background: 'var(--surface-2, #232326)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', color: 'var(--text)', fontSize: 12.5, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>未安装 PhotoCraft</div>
            <div style={{ color: 'var(--text-muted)', lineHeight: 1.7 }}>
              PhotoCraft 不随客户端集成（安装包体积原因）。请下载 <b>windows-x64-portable</b> 版并解压到任意目录：
              <div style={{ marginTop: 4 }}>
                <a href={pcNotInstalled.downloadUrl} target="_blank" rel="noreferrer" style={{ color: '#7aa2ff' }}>官网 getartcraft.com</a>
                {' · '}
                <a href={pcNotInstalled.releasesUrl} target="_blank" rel="noreferrer" style={{ color: '#7aa2ff' }}>GitHub Releases</a>
              </div>
            </div>
            <div style={{ margin: '12px 0 6px' }}>解压后选择安装目录（内含 photocraft-cli.exe；也可直接粘贴 exe 路径）。保存为配置后，以后一键直接启动：</div>
            <input
              value={pcDirInput}
              onChange={(e) => { setPcDirInput(e.target.value); setPcPickError('') }}
              placeholder="例如 D:\localprogram\photocraft-0.22.0-windows-x64-portable"
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface, #1c1c1e)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 12, padding: '7px 10px', outline: 'none' }}
            />
            {pcPickError ? <div style={{ color: '#ff8a8a', marginTop: 6 }}>{pcPickError}</div> : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button
                onClick={() => { setPcNotInstalled(null); setPcPickError('') }}
                style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
              >取消</button>
              <button
                onClick={savePcDirAndLaunch}
                style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(79,124,255,0.55)', background: 'rgba(79,124,255,0.18)', color: '#bfdbfe', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >保存并启动</button>
            </div>
          </div>
        </div>
      ) : null}
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
