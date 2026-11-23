import React from 'react'

/** 服务设置弹层(2026-10-29 用户裁决:封面工作本内可配服务端地址+MCP 自动发现)。
 *  地址=共享单一事实源 tintin/config.json server.url(视频剪辑/总助手同源,后端路由
 *  /tintin/ipc/cover/server-config 读写);「获取 MCP 服务」对 <地址>/mcp 走
 *  initialize+tools/list 自动发现并列出服务端货架(/tintin/ipc/cover/mcp/discover)。
 *  MCP 挂载本身仍在封面/剪辑会话创建时自动完成,此处是可视与验货,不是第二份配置。
 *  2026-10-29 二次裁决:①重开弹层要回显已保存的地址与 MCP 清单(发现成功后端缓存
 *  mcp-discover-cache.json,GET server-config 带回;打开时静默自动刷新一次,失败留缓存)
 *  ②左右布局=左表单右清单(同视频剪辑设置),整体限高,清单内部滚动不撑破弹层。
 *  2026-11-03 三次裁决:弹层尺寸=技能弹窗同款(min(1200px,100vw-64)×min(800px,100vh-80)),
 *  标题行右上角关闭钮(✕ 同款);内容保持左右布局。
 *  2026-11-15 四次裁决(用户问询「增加的即梦配置呢」):左栏加「即梦 CLI」区=状态卡
 *  (安装/版本/登录态/积分)+设备码两段式登录(与创作模式「即梦 CLI」卡片同门)+退出;
 *  引擎不做选择——已登录即梦时生成自动优先即梦 CLI(路由在 cover-background.js)。 */
type DreaminaStatus = {
  available?: boolean
  bin?: string
  version?: string
  loggedIn?: boolean
  credit?: number
  vipLevel?: string
  userId?: string
  error?: string
}
type DreaminaLoginFlow = { verificationUri: string; userCode: string; expiresAt?: string; checking: boolean; doneOk?: boolean; failed?: string }

/** 系统浏览器外开(2026-11-19 即梦登录事故):桌面壳 Studio 视图的 window.open 恒 deny,
 *  target=_blank 授权链接点击被吞——授权流程「无法打开」。编辑器 iframe(同源 loopback)
 *  与 Studio 主框架同 webContents,preload 注入的 openfilmNative 两个 frame 都可见;
 *  self ?? parent 双查取桥(panels.tsx 的 FolderPicker 同口径),非桌面环境返回 null
 *  (此时 anchor 走浏览器默认跳转,行为不变)。 */
type OpenfilmNativeWithExternal = { openExternal?: (url: string) => Promise<void> }
function resolveOpenExternal(): ((url: string) => Promise<void>) | null {
  const self = window as unknown as { openfilmNative?: OpenfilmNativeWithExternal }
  const parent = window.parent !== window ? (window.parent as unknown as { openfilmNative?: OpenfilmNativeWithExternal }) : null
  return self.openfilmNative?.openExternal ?? parent?.openfilmNative?.openExternal ?? null
}
/** 经系统浏览器桥打开;无桥(纯浏览器环境)不导航——iframe 顶层导航会顶掉编辑器,
 *  此时由 anchor 默认跳转与「复制链接」兜底。 */
function openVerificationUri(url: string): void {
  resolveOpenExternal()?.(url).catch(() => {})
}

const INSTALL_HINT = 'curl -s https://jimeng.jianying.com/cli | bash'
export const ServerSettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [url, setUrl] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)
  const [busy, setBusy] = React.useState<'save' | 'discover' | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [messageOk, setMessageOk] = React.useState(false)
  const [tools, setTools] = React.useState<Array<{ name: string; description: string }>>([])
  const [mcpUrl, setMcpUrl] = React.useState('')
  /* 即梦 CLI(2026-11-15 四次裁决):状态卡+设备码两段式登录+退出;引擎不选,已登录自动优先 */
  const [jm, setJm] = React.useState<DreaminaStatus | null>(null)
  const [jmLoaded, setJmLoaded] = React.useState(false)
  const [jmBusy, setJmBusy] = React.useState<'login' | 'logout' | null>(null)
  const [jmFlow, setJmFlow] = React.useState<DreaminaLoginFlow | null>(null)

  const dreaminaCall = (payload: Record<string, unknown>): Promise<Record<string, unknown>> =>
    fetch('/tintin/ipc/cover/dreamina', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }).then((r) => r.json())

  const loadDreamina = (): Promise<void> =>
    dreaminaCall({ action: 'status' })
      .then((j) => setJm(j as DreaminaStatus))
      .catch(() => setJm({ available: false, error: '即梦状态获取失败' }))
      .finally(() => setJmLoaded(true))

  const discoverInto = (target: string, quiet: boolean): Promise<void> =>
    new Promise((resolve) => {
      fetch('/tintin/ipc/cover/mcp/discover', {
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
    void fetch('/tintin/ipc/cover/server-config')
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
    void loadDreamina()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 即梦登录(2026-11-23 官方默认语义重写,§7.31):login-start 拉起一条阻塞
   *  `dreamina login`(官方默认="waits for authorization to complete"——CLI 自己每秒
   *  轮询,网页授权完成瞬间自己收 token 退出),材料到手先回 UI+自动拉浏览器;此后
   *  每 3s login-status 问一次直到进程退出。**无 checklogin/无补收/无 UI 轮询窗**
   *  ——此前 headless+checklogin+90s/600s 窗口三连报障全是偏离默认的代偿。
   *  材料仍经 openfilmNative.openExternal 拉系统浏览器(桌面壳 window.open 恒 deny)。 */
  const dreaminaLogin = (): void => {
    setJmBusy('login')
    dreaminaCall({ action: 'login-start' })
      .then((j) => {
        const verificationUri = String(j?.verificationUri ?? '')
        const userCode = String(j?.userCode ?? '')
        if (!j?.ok || !verificationUri || !userCode) throw new Error(String(j?.error ?? '登录进程未输出授权材料'))
        setJmFlow({ verificationUri, userCode, expiresAt: String(j?.expiresAt ?? ''), checking: true })
        openVerificationUri(verificationUri)
        // 轮询登录进程状态:授权完成=CLI 进程自己退出 0;失败=透传 stderr 首行
        const tick = (): Promise<void> =>
          dreaminaCall({ action: 'login-status' }).then(async (st) => {
            const m = st?.materials as { verificationUri?: string; userCode?: string; expiresAt?: string } | undefined
            if (m?.verificationUri) {
              setJmFlow((f) => (f ? { ...f, verificationUri: String(m.verificationUri), userCode: String(m.userCode ?? ''), expiresAt: String(m.expiresAt ?? '') } : f))
            }
            const d = st?.done as { ok?: boolean; error?: string } | undefined
            if (!d) return // 仍在等待授权:继续轮询
            if (!d.ok) throw new Error(String(d.error || '登录未完成'))
            // 授权完成:先亮成功态再读账户(status=两次 CLI 调用需数秒,先清卡会闪回「未登录+登录即梦按钮」空窗)
            setJmFlow((f) => (f ? { ...f, checking: false, doneOk: true } : f))
            await loadDreamina()
            setJmFlow(null)
          })
        const poll = (): void => {
          void tick()
            .then(() => { if (jmAliveRef.current) setTimeout(poll, 3000) })
            .catch((e) => {
              setJmFlow((f) => (f ? { ...f, checking: false, failed: e instanceof Error ? e.message : String(e) } : f))
            })
        }
        poll()
      })
      .catch((e) => {
        setJmFlow((f) => (f ? { ...f, checking: false, failed: e instanceof Error ? e.message : String(e) } : null))
      })
      .finally(() => setJmBusy(null))
  }
  /** 弹窗卸载即取消登录会话(进程 16min 自灭兜底;logout 亦先取消) */
  const dreaminaCancelLogin = (): void => { void dreaminaCall({ action: 'login-cancel' }).catch(() => {}) }
  const jmAliveRef = React.useRef(true)
  React.useEffect(() => {
    jmAliveRef.current = true
    return () => { jmAliveRef.current = false; dreaminaCancelLogin() } // 弹窗卸载=取消登录会话(进程 16min 自灭兜底)
  }, [])
  const dreaminaLogout = (): void => {
    setJmBusy('logout')
    dreaminaCancelLogin()
    dreaminaCall({ action: 'logout' })
      .then(() => loadDreamina())
      .finally(() => setJmBusy(null))
  }

  const save = (): void => {
    setBusy('save'); setMessage('')
    fetch('/tintin/ipc/cover/server-config', {
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
    width: '100%', boxSizing: 'border-box', background: 'var(--bg-field)', color: 'var(--text)',
    border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none',
  }
  const btn = (tone: 'primary' | 'ghost'): React.CSSProperties => ({
    flex: 1, padding: '8px 0', borderRadius: 8, border: tone === 'primary' ? 0 : '1px solid var(--border-strong)',
    cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 700,
    background: tone === 'primary' ? 'var(--primary)' : 'transparent', color: tone === 'primary' ? 'var(--on-primary)' : 'var(--text-muted)',
    opacity: busy ? 0.6 : 1,
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      {/* 弹层尺寸=技能弹窗同款+右上角关闭钮(2026-11-03 三次裁决);内容保持左右布局
          (2026-10-29 二次裁决):左=地址表单,右=服务清单(内部滚动不撑破弹层) */}
      <div data-tintin-cover-scope="" style={{ fontFamily: 'var(--font-sans)', width: 'min(1200px, calc(100vw - 64px))', height: 'min(800px, calc(100vh - 80px))', display: 'flex', flexDirection: 'column', background: 'var(--bg-raised)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}>
        {/* 头部: 标题行(右上角关闭钮=技能弹窗同款排版) */}
        <div style={{ padding: '14px 18px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>服务设置</span>
            <span style={{ flex: 1 }} />
            <button onClick={onClose} title="关闭" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 14, lineHeight: 1, color: 'var(--text-faint)', background: 'transparent', border: 0, cursor: 'pointer' }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ width: 300, flexShrink: 0, padding: '12px 22px 22px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflowY: 'auto' }}>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-faint)', marginBottom: 16 }}>服务端地址与视频剪辑/总助手共用一份配置；封面与剪辑会话的 MCP 工具在会话创建时按此地址自动挂载。</div>
          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, marginBottom: 6 }}>服务端地址</div>
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
            <div style={{ fontSize: 12, lineHeight: 1.6, color: messageOk ? 'var(--ok)' : 'var(--err)', background: messageOk ? 'rgba(76,194,122,0.1)' : 'rgba(242,102,95,0.1)', borderRadius: 8, padding: '8px 10px' }}>
              {message}
            </div>
          ) : null}
          {/* 即梦 CLI(2026-11-15 四次裁决):状态卡+设备码两段式登录+退出;引擎不做选择——
              已登录即梦时封面生图/图片编辑自动优先即梦 CLI(路由在 cover-background.js) */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, marginBottom: 6 }}>即梦 CLI</div>
            {!jmLoaded ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>正在检测即梦 CLI…</div>
            ) : jmFlow ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text)' }}>在网页输入授权码完成授权即可——客户端正在等待并<b>自动完成登录</b>（官方设备码流程，无需其他操作；设备码 15 分钟内有效）。</div>
                <a href={jmFlow.verificationUri} target="_blank" rel="noreferrer"
                  onClick={(e) => {
                    // 桌面壳 window.open 恒 deny(Studio 视图),点击改走系统浏览器桥;
                    // 无桥环境(纯浏览器)保留默认跳转。
                    const open = resolveOpenExternal()
                    if (open) { e.preventDefault(); open(jmFlow.verificationUri).catch(() => {}) }
                  }}
                  style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>{jmFlow.verificationUri}</a>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2, fontFamily: 'var(--font-mono)', color: 'var(--text)', background: 'var(--bg-field)', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>{jmFlow.userCode}</div>
                {jmFlow.expiresAt ? (() => {
                  const exp = Date.parse(jmFlow.expiresAt)
                  if (!Number.isFinite(exp)) return null
                  const left = Math.max(0, Math.round((exp - Date.now()) / 60000))
                  return (
                    <div style={{ fontSize: 11.5, color: left > 2 ? 'var(--text-faint)' : 'var(--err)' }}>
                      设备码有效期至 {new Date(exp).toLocaleTimeString('zh-Hans-CN', { hour12: false })}{left > 0 ? `（约剩 ${left} 分钟）` : '——已过期'}
                      {left <= 2 ? '；过期后网页授权结果无法兑换，请重新登录' : ''}
                    </div>
                  )
                })() : null}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openVerificationUri(jmFlow.verificationUri)} style={{ ...btn('ghost'), flex: 'none', padding: '5px 12px', fontSize: 12 }}>重新打开链接</button>
                  <button onClick={() => navigator.clipboard?.writeText(jmFlow.verificationUri).catch(() => {})} style={{ ...btn('ghost'), flex: 'none', padding: '5px 12px', fontSize: 12 }}>复制链接</button>
                </div>
                <div style={{ fontSize: 12, color: jmFlow.failed ? 'var(--err)' : 'var(--text-faint)' }}>
                  {jmFlow.failed ? `✗ ${jmFlow.failed}`
                    : jmFlow.doneOk ? '✓ 授权成功，正在读取账户信息…'
                    : jmFlow.checking ? '等待网页授权中…授权完成会自动登录（最长 15 分钟）' : ''}
                </div>
                {jmFlow.failed ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={dreaminaLogin} disabled={jmFlow.checking} style={{ ...btn('primary'), flex: 'none' }}>重新登录</button>
                  </div>
                ) : null}
              </div>
            ) : jm?.available === false ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--warn)' }}>未安装即梦创作 CLI。安装并登录后，封面生图/图片编辑自动优先走即梦。</div>
                <code style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', background: 'var(--bg-field)', borderRadius: 8, padding: '6px 10px', wordBreak: 'break-all' }}>{INSTALL_HINT}</code>
              </div>
            ) : jm?.loggedIn ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--ok)' }}>
                  已登录{jm.userId ? ` · ${jm.userId}` : ''}{typeof jm.credit === 'number' ? ` · 积分 ${jm.credit}` : ''}{jm.vipLevel ? ` · ${jm.vipLevel}` : ''}
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.6, color: 'var(--text-faint)' }}>封面生图与图片编辑已自动优先即梦 CLI；未登录时自动落服务端文生图。</div>
                <button onClick={dreaminaLogout} disabled={jmBusy !== null} style={{ ...btn('ghost'), flex: 'none' }}>{jmBusy === 'logout' ? '退出中…' : '退出登录'}</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--warn)' }}>已安装{jm?.version ? ` · ${jm.version}` : ''}，未登录</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>登录后，封面生图与图片编辑自动优先走即梦 CLI。</div>
                <button onClick={dreaminaLogin} disabled={jmBusy !== null} style={{ ...btn('primary'), flex: 'none' }}>{jmBusy === 'login' ? '取设备码…' : '登录即梦'}</button>
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, padding: '12px 22px 22px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, marginBottom: 8 }}>
            发现的 MCP 服务（{tools.length}）{refreshing ? <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · 正在刷新…</span> : null}
            {mcpUrl ? <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · {mcpUrl}</span> : null}
          </div>
          {tools.length > 0 ? (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
              {tools.map((t) => (
                <div key={t.name} style={{ background: 'var(--bg-field)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd' }}>{t.name}</div>
                  {t.description ? <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>{t.description}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1.8 }}>
              {loaded ? '还没有发现记录——填好服务端地址后点「获取 MCP 服务」。' : '正在加载…'}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
