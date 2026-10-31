import React from 'react'

/** 封面技能管理弹窗(2026-10-30 用户裁决:形态=视频剪辑聊天里的 Skill 大居中弹窗——
 *  已安装/发现 两个 tab + ＋添加 skill + 搜索 + 我的/服务端 分区 + 行内详情展开;
 *  不是右下小弹层,也不是整页)。数据走 /tintin/cover/api/skills*(与安装落盘管线同一条):
 *  registry=服务端注册表(中文名/版本/描述/执行方),installed=已安装装位(含描述)。
 *  版本徽标与更新判定同创作模式口径(分段数值,缺段=0,容忍 v 前缀;缺失/坏值不误报)。 */
type RegistrySkill = { id: string; name: string; version: string; description: string; executor: string }
type InstalledSkill = { id: string; name: string; version: string; description: string }

const versionNewer = (serverVersion: string, installedVersion: string): boolean => {
  const parse = (v: string): number[] | null => {
    const t = String(v ?? '').trim().replace(/^v/i, '')
    if (!t) return null
    const parts = t.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : -1))
    return parts.some((p) => p < 0) ? null : parts
  }
  const sv = parse(serverVersion)
  const iv = parse(installedVersion)
  if (!sv || !iv) return false
  const len = Math.max(sv.length, iv.length)
  for (let i = 0; i < len; i++) {
    const a = sv[i] ?? 0
    const b = iv[i] ?? 0
    if (a !== b) return a > b
  }
  return false
}

export const SkillsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [registry, setRegistry] = React.useState<RegistrySkill[]>([])
  const [installed, setInstalled] = React.useState<InstalledSkill[]>([])
  const [serverError, setServerError] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)
  const [tab, setTab] = React.useState<'installed' | 'discover'>('installed')
  const [query, setQuery] = React.useState('')
  const [addOpen, setAddOpen] = React.useState(false)
  const [addId, setAddId] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [detailId, setDetailId] = React.useState<string | null>(null)

  const load = async (): Promise<void> => {
    try {
      const r = await fetch('/tintin/cover/api/skills').then((x) => x.json())
      if (r?.error) setServerError(String(r.error))
      else setServerError('')
      setRegistry(Array.isArray(r?.registry) ? r.registry : [])
      setInstalled(Array.isArray(r?.installed) ? r.installed : [])
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }

  React.useEffect(() => { void load() }, [])

  const act = async (id: string, action: 'install' | 'remove'): Promise<void> => {
    setBusy(id + action)
    setStatus(action === 'install' ? `安装「${id}」中…` : `删除「${id}」中…`)
    try {
      const r = await fetch(`/tintin/cover/api/skills/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
      }).then((x) => x.json())
      if (!r?.ok) throw new Error(r?.error || `HTTP 失败`)
      setStatus(action === 'install' ? `已安装「${id}」${r.dir ? `→ ${r.dir}` : ''}——封面 / 菜单即可引用；当前会话若未见新技能，新开会话即生效。` : `已删除「${id}」`)
      await load()
    } catch (e) {
      setStatus((action === 'install' ? '安装失败：' : '删除失败：') + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy('')
    }
  }

  const addById = async (): Promise<void> => {
    const id = addId.trim()
    if (!id) return
    setAddOpen(false)
    await act(id, 'install')
  }

  const installedById = new Map(installed.map((s) => [s.id, s]))
  const q = query.trim().toLowerCase()
  const hit = (fields: string[]): boolean => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q))
  const installedList = installed.filter((s) => hit([s.name, s.description, s.id]))
  const discoverList = registry.filter((s) => hit([s.name, s.description, s.id]))

  const input: React.CSSProperties = {
    background: '#141416', color: '#e8e8e6', border: '1px solid #3a3a3e', borderRadius: 8,
    padding: '6px 10px', fontSize: 12.5, outline: 'none',
  }
  const btn = (tone: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
    padding: '5px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
    background: tone === 'primary' ? '#4f7cff' : 'transparent',
    border: tone === 'danger' ? '1px solid #7f2d2d' : tone === 'ghost' ? '1px solid #3a3a3e' : 0,
    color: tone === 'primary' ? '#fff' : tone === 'danger' ? '#f87171' : '#c9c9cf',
  })

  const row = (opts: {
    key: string; name: string; version: string; description: string; installed: boolean; update: boolean
    meta: string; detailFields: Array<[string, string]>
    buttons: React.ReactNode
  }): React.ReactElement => {
    const expanded = detailId === opts.key
    return (
      <div key={opts.key} style={{ display: 'flex', gap: 12, padding: '10px 12px', border: '1px solid #26272b', borderRadius: 10, background: '#16171a', alignItems: 'flex-start' }}>
        <div style={{ width: 52, height: 52, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, background: 'linear-gradient(135deg,#232733,#16171a 65%)', border: '1px solid #26272b' }}>🧩</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e2e6' }}>{opts.name}</span>
            {opts.update ? <span style={{ fontSize: 10, fontWeight: 700, color: '#e8a23c', border: '1px solid rgba(232,162,60,.45)', background: 'rgba(232,162,60,.12)', borderRadius: 999, padding: '1px 8px' }}>⟳ 有新版本</span> : null}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {[opts.version ? `v${opts.version.replace(/^v/i, '')}` : '', ...opts.detailFields.filter(([k]) => k === '执行方').map(([, v]) => v)].filter(Boolean).map((chip, i) => (
              <span key={i} style={{ fontSize: 10, color: '#9a9ba1', background: 'rgba(127,127,127,.16)', borderRadius: 999, padding: '1px 8px' }}>{chip}</span>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: '#8a8a90', marginTop: 6, display: '-webkit-box', WebkitLineClamp: expanded ? 'unset' : '2', WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.6 }}>{opts.description || '（无描述）'}</div>
          {expanded ? (
            <div style={{ marginTop: 8, fontSize: 11, color: '#8a8a90', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {opts.detailFields.map(([k, v]) => (
                <div key={k}><span style={{ color: '#b9b9b6' }}>{k}：</span>{v || '—'}</div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
          <button onClick={() => setDetailId(expanded ? null : opts.key)} style={btn('ghost')}>{expanded ? '收起' : '详情'}</button>
          {opts.buttons}
        </div>
      </div>
    )
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        /* 尺寸=影片 Skill 弹窗同款(2026-10-31 用户裁决: 参考视频剪辑一样大)——
           min(1200px, 100vw-64px) × min(800px, 100vh-80px), 居中, 圆角, 投影 */
        style={{ width: 'min(1200px, calc(100vw - 64px))', height: 'min(800px, calc(100vh - 80px))', background: '#1e1e20', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* 头部: 标题行(右上角关闭钮=影片同款) + tab 行(右侧=＋添加 skill + 搜索, 影片同排版) */}
        <div style={{ padding: '14px 18px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>技能管理</span>
            <span style={{ flex: 1 }} />
            <button onClick={onClose} title="关闭" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 14, lineHeight: 1, color: '#9a9ba1', background: 'transparent', border: 0, cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, borderBottom: '1px solid #2c2c30' }}>
            {([
              ['installed', `已安装（${installed.length}）`],
              ['discover', `发现（${registry.length}）`],
            ] as Array<[typeof tab, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{ padding: '7px 14px', fontSize: 12.5, cursor: 'pointer', background: tab === key ? '#18191d' : 'transparent', color: tab === key ? '#e2e2e6' : '#8a8a90', fontWeight: tab === key ? 700 : 400, border: `1px solid ${tab === key ? '#26272b' : 'transparent'}`, borderBottom: tab === key ? '1px solid #18191d' : '1px solid #2c2c30', borderRadius: '8px 8px 0 0' }}
              >{label}</button>
            ))}
            <span style={{ flex: 1 }} />
            {addOpen ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
                <input autoFocus value={addId} placeholder="输入服务端技能 id，如 tintin-image-gen" onChange={(e) => setAddId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addById(); if (e.key === 'Escape') setAddOpen(false) }} style={{ ...input, width: 260 }} />
                <button onClick={() => void addById()} disabled={busy !== '' || !addId.trim()} style={{ ...btn('primary'), flexShrink: 0 }}>安装</button>
                <button onClick={() => setAddOpen(false)} style={{ ...btn('ghost'), flexShrink: 0 }}>取消</button>
              </div>
            ) : (
              <button onClick={() => { setAddOpen(true); setTab('discover') }} style={{ ...btn('ghost'), flexShrink: 0, marginBottom: 6 }}>＋ 添加 skill</button>
            )}
            <input value={query} placeholder="搜索 skill" onChange={(e) => setQuery(e.target.value)} style={{ ...input, width: 200, borderRadius: 999, marginBottom: 6 }} />
          </div>
        </div>
        {/* 主体滚动区 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tab === 'installed' ? (
            <>
              <div style={{ fontSize: 11, color: '#8a8a90' }}>我的 —— 已装在封面专属装位（<span style={{ color: '#b9b9b6' }}>%DSH_HOME%\cover-skills\</span>），封面 / 菜单可引用</div>
              {!loaded ? <div style={{ fontSize: 12, color: '#8a8a90', padding: 14 }}>加载中…</div>
                : installedList.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#8a8a90', border: '1px dashed #3a3a3e', borderRadius: 10, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                    <span>还没有已安装的技能——到「发现」选择服务端技能安装，或点「＋ 添加 skill」按 id 安装。</span>
                    <button onClick={() => { setTab('discover'); setAddOpen(true) }} style={{ ...btn('ghost'), flexShrink: 0 }}>＋ 添加 skill</button>
                  </div>
                ) : installedList.map((s) => {
                  const remote = registry.find((x) => x.id === s.id)
                  const update = remote ? versionNewer(remote.version, s.version) : false
                  return row({
                    key: s.id, name: s.name || s.id, version: s.version, description: s.description,
                    installed: true, update, meta: '',
                    detailFields: [['id', s.id], ['版本', s.version], ['装位', `%DSH_HOME%\\cover-skills\\${s.id}`], ['描述', s.description]],
                    buttons: (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {update ? <button onClick={() => void act(s.id, 'install')} disabled={busy !== ''} style={btn('primary')}>{busy === s.id + 'install' ? '更新中…' : '更新'}</button> : null}
                        <button onClick={() => void act(s.id, 'remove')} disabled={busy !== ''} style={btn('danger')}>删除</button>
                      </div>
                    ),
                  })
                })}
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#8a8a90' }}>服务端技能库（{registry.length}）—— 安装后落到技能主目录，封面 / 菜单可引用{serverError ? <span style={{ color: '#ff8f8f' }}> · 清单刷新失败：{serverError}</span> : null}</div>
              {!loaded ? <div style={{ fontSize: 12, color: '#8a8a90', padding: 14 }}>加载中…</div>
                : discoverList.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#8a8a90', padding: 14 }}>{serverError ? `服务端不可达（${serverError}）——点「刷新」或到 ⚙ 服务设置检查地址。` : `没有匹配「${query}」的服务端技能。`}</div>
                ) : discoverList.map((s) => {
                  const local = installedById.get(s.id)
                  const update = local ? versionNewer(s.version, local.version) : false
                  return row({
                    key: s.id, name: s.name, version: s.version, description: s.description,
                    installed: Boolean(local), update, meta: '',
                    detailFields: [['id', s.id], ['版本', s.version], ['执行方', s.executor], ['描述', s.description]],
                    buttons: (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {local ? <span style={{ fontSize: 10, fontWeight: 700, color: '#8fd6a4', border: '1px solid rgba(143,214,164,.4)', background: 'rgba(143,214,164,.12)', borderRadius: 999, padding: '1px 8px' }}>✓ 已安装</span> : null}
                        {!local ? <button onClick={() => void act(s.id, 'install')} disabled={busy !== ''} style={btn('primary')}>{busy === s.id + 'install' ? '安装中…' : '安装'}</button> : null}
                        {update ? <button onClick={() => void act(s.id, 'install')} disabled={busy !== ''} style={btn('primary')}>{busy === s.id + 'install' ? '更新中…' : '更新'}</button> : null}
                        {local ? <button onClick={() => void act(s.id, 'remove')} disabled={busy !== ''} style={btn('danger')}>删除</button> : null}
                      </div>
                    ),
                  })
                })}
            </>
          )}
        </div>
        <div style={{ padding: '6px 18px 12px', fontSize: 11, color: '#8a8a90', flexShrink: 0, whiteSpace: 'pre-wrap' }}>{status || '安装=下载技能包落盘并注册到封面 / 菜单；当前会话若未见新技能，新开会话即生效。'}</div>
      </div>
    </div>
  )
}
