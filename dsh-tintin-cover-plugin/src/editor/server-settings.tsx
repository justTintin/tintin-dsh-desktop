import React from 'react'

/** 服务设置弹层(2026-10-29 用户裁决:封面工作本内可配服务端地址+MCP 自动发现)。
 *  地址=共享单一事实源 tintin/config.json server.url(视频剪辑/总助手同源,后端路由
 *  /tintin/cover/api/server-config 读写);「获取 MCP 服务」对 <地址>/mcp 走
 *  initialize+tools/list 自动发现并列出服务端货架(/tintin/cover/api/mcp/discover)。
 *  MCP 挂载本身仍在封面/剪辑会话创建时自动完成,此处是可视与验货,不是第二份配置。
 *  2026-10-29 二次裁决:①重开弹层要回显已保存的地址与 MCP 清单(发现成功后端缓存
 *  mcp-discover-cache.json,GET server-config 带回;打开时静默自动刷新一次,失败留缓存)
 *  ②左右布局=左表单右清单(同视频剪辑设置),整体限高,清单内部滚动不撑破弹层。 */
export const ServerSettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [url, setUrl] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)
  const [busy, setBusy] = React.useState<'save' | 'discover' | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [messageOk, setMessageOk] = React.useState(false)
  const [tools, setTools] = React.useState<Array<{ name: string; description: string }>>([])
  const [mcpUrl, setMcpUrl] = React.useState('')

  const discoverInto = (target: string, quiet: boolean): Promise<void> =>
    new Promise((resolve) => {
      fetch('/tintin/cover/api/mcp/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverUrl: target }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j?.ok) {
            setTools(Array.isArray(j.tools) ? j.tools : [])
            setMcpUrl(String(j.mcpUrl ?? ''))
            setMessageOk(true)
            setMessage(`已连接 ${j.mcpUrl}，自动发现 ${j.count} 个 MCP 服务。`)
          } else if (!quiet) {
            setMessageOk(false)
            setMessage(`获取失败：${j?.error ?? '未知错误'}`)
          } else {
            setMessageOk(true)
            setMessage(`已显示上次发现的结果（${tools.length} 条）——自动刷新失败：${j?.error ?? '未知错误'}`)
          }
        })
        .catch((e) => {
          if (!quiet) { setMessageOk(false); setMessage(`获取失败：${e instanceof Error ? e.message : String(e)}`) }
        })
        .finally(resolve)
    })

  React.useEffect(() => {
    void fetch('/tintin/cover/api/server-config')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          const savedUrl = String(j.serverUrl ?? '')
          setUrl(savedUrl)
          // 缓存回显(2026-10-29 二次裁决):上次发现的服务清单立即上墙
          const cache = j.mcpCache
          if (cache && Array.isArray(cache.tools) && cache.tools.length) {
            setTools(cache.tools)
            setMcpUrl(String(cache.mcpUrl ?? ''))
          }
          // 静默自动刷新一次(不打断输入;失败保留缓存清单)
          if (savedUrl) {
            setRefreshing(true)
            void discoverInto(savedUrl, true).finally(() => setRefreshing(false))
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const save = (): void => {
    setBusy('save'); setMessage('')
    fetch('/tintin/cover/api/server-config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverUrl: url }),
    })
      .then((r) => r.json())
      .then((j) => {
        setMessageOk(j?.ok === true)
        setMessage(j?.ok ? '已保存。之后新开的封面/剪辑/总助手会话即用新地址，正在运行中的会话不变。' : `保存失败：${j?.error ?? '请求失败'}`)
      })
      .catch((e) => { setMessageOk(false); setMessage(`保存失败：${e instanceof Error ? e.message : String(e)}`) })
      .finally(() => setBusy(null))
  }

  const discover = (): void => {
    setBusy('discover'); setMessage(''); setTools(tools)
    void discoverInto(url, false).finally(() => setBusy(null))
  }

  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: '#141416', color: '#e8e8e6',
    border: '1px solid #3a3a3e', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none',
  }
  const btn = (tone: 'primary' | 'ghost'): React.CSSProperties => ({
    flex: 1, padding: '8px 0', borderRadius: 8, border: tone === 'primary' ? 0 : '1px solid #3a3a3e',
    cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 700,
    background: tone === 'primary' ? '#4f7cff' : 'transparent', color: tone === 'primary' ? '#fff' : '#c8c8c6',
    opacity: busy ? 0.6 : 1,
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      {/* 左右布局+整体限高(2026-10-29 二次裁决,同视频剪辑设置):左=地址表单,右=服务清单(内部滚动) */}
      <div style={{ width: 840, maxWidth: '94vw', height: 560, maxHeight: '82vh', display: 'flex', background: '#1e1e20', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 300, flexShrink: 0, padding: 22, borderRight: '1px solid #2c2c30', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e8e8e6', marginBottom: 6 }}>服务设置</div>
          <div style={{ fontSize: 11, lineHeight: 1.6, color: '#8b8b88', marginBottom: 16 }}>服务端地址与视频剪辑/总助手共用一份配置；封面与剪辑会话的 MCP 工具在会话创建时按此地址自动挂载。</div>
          <div style={{ fontSize: 12, color: '#c8c8c6', fontWeight: 700, marginBottom: 6 }}>服务端地址</div>
          <input
            value={url}
            placeholder="http://192.168.x.x:8000"
            disabled={!loaded || busy !== null}
            onChange={(e) => setUrl(e.target.value)}
            style={{ ...input, marginBottom: 12 }}
          />
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <button onClick={save} disabled={busy !== null || !url.trim()} style={btn('primary')}>{busy === 'save' ? '保存中…' : '保存地址'}</button>
            <button onClick={discover} disabled={busy !== null || !url.trim()} style={btn('ghost')}>{busy === 'discover' ? '获取中…' : '获取 MCP 服务'}</button>
          </div>
          {message ? (
            <div style={{ fontSize: 12, lineHeight: 1.6, color: messageOk ? '#7ee2a8' : '#ff8f8f', background: messageOk ? 'rgba(126,226,168,0.08)' : 'rgba(255,143,143,0.08)', borderRadius: 8, padding: '8px 10px' }}>
              {message}
            </div>
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0, padding: 22, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
          <div style={{ fontSize: 12, color: '#c8c8c6', fontWeight: 700, marginBottom: 8 }}>
            发现的 MCP 服务（{tools.length}）{refreshing ? <span style={{ color: '#8b8b88', fontWeight: 400 }}> · 正在刷新…</span> : null}
            {mcpUrl ? <span style={{ color: '#8b8b88', fontWeight: 400 }}> · {mcpUrl}</span> : null}
          </div>
          {tools.length > 0 ? (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
              {tools.map((t) => (
                <div key={t.name} style={{ background: '#141416', border: '1px solid #2c2c30', borderRadius: 8, padding: '6px 10px', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd' }}>{t.name}</div>
                  {t.description ? <div style={{ fontSize: 11, color: '#8b8b88', marginTop: 2 }}>{t.description}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, fontSize: 12, color: '#8b8b88', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1.8 }}>
              {loaded ? '还没有发现记录——填好服务端地址后点「获取 MCP 服务」。' : '正在加载…'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
