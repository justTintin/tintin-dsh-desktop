window.__ModuleLoader__.load({
  id: 'tintin-bundle',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    // TinTin business entry points in the conversation header (运营工具/媒体工具).
    // Final placement裁决 2026-09-23: conversation.session.header.actions slot
    // (the row holding 标准模式), same seam jobs/schedule use. The panels are
    // placeholders — WP-3 mounts 文案混剪/剪映模板 inside 媒体工具.
    const zh = {
      opsTools: '运营工具',
      mediaTools: '媒体工具',
      opsHint: '运营工具入口（产品资料、提示词反推、视频运营等，随 P3 逐步接入）',
      mediaHint: '媒体工具入口（文案混剪、剪映模板等，WP-3 接入）',
      close: '关闭',
    }
    const en = {
      opsTools: 'Ops tools',
      mediaTools: 'Media tools',
      opsHint: 'Operations tools entry (product library, prompt reverse, video ops; land in P3).',
      mediaHint: 'Media tools entry (copywriting montage, JianYing templates; land in WP-3).',
      close: 'Close',
    }

    function ToolEntry({ label, hint, t, accent }) {
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)
      React.useEffect(() => {
        if (!open) return
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])
      return h('span', { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button',
          onClick: () => setOpen((v) => !v),
          'aria-expanded': open,
          style: {
            appearance: 'none', font: 'inherit', fontSize: '13px', lineHeight: 1.5,
            padding: '4px 10px', borderRadius: '8px', cursor: 'pointer',
            border: '0.5px solid var(--dsw-alias-border-l4, currentColor)',
            background: open ? 'var(--dsw-alias-bg-layer-2, transparent)' : 'transparent',
            color: 'var(--dsw-alias-label-secondary, inherit)',
            fontWeight: 500,
          },
        }, label),
        open && h('div', {
          role: 'dialog',
          'aria-label': label,
          style: {
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 1000,
            minWidth: '280px', maxWidth: '360px', padding: '14px 16px',
            background: 'var(--dsw-alias-bg-layer-2, #1e1e20)',
            border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))',
            borderRadius: '12px', boxShadow: '0 8px 28px rgba(0,0,0,.28)',
            color: 'var(--dsw-alias-label-primary, inherit)', fontSize: '13px', lineHeight: 1.6,
          },
        },
          h('div', { style: { fontWeight: 600, marginBottom: '6px', color: accent || 'inherit' } }, label),
          h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-tertiary, inherit)' } }, hint),
        ),
      )
    }

    function TintinOpsEntry(props) {
      return h(ToolEntry, { ...props, label: props.t ? props.t('opsTools') : zh.opsTools, hint: props.t ? props.t('opsHint') : zh.opsHint })
    }
    function TintinMediaEntry(props) {
      return h(ToolEntry, { ...props, label: props.t ? props.t('mediaTools') : zh.mediaTools, hint: props.t ? props.t('mediaHint') : zh.mediaHint })
    }

    // ── WP-2 window.tintin polyfill ─────────────────────────────────────────
    // Rebuild the old client's preload bridge with identical signatures so the
    // ported Vue views run unmodified. server.* forwards to /tintin/ipc/*;
    // event-style subscriptions (progress) become jobId polling (主方案 §3.1).
    function installTintinBridge() {
      if (window.tintin && window.tintin.__dshPolyfill) return // idempotent
      const call = (channel, payload) =>
        // 通道名（server:get）的冒号是路径的一部分，不编码——host 按
        // /tintin/ipc/server:get 匹配（encodeURIComponent 会把 : 编成 %3A 失配）。
        fetch(`/tintin/ipc/${channel}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        }).then(async (r) => {
          const j = await r.json().catch(() => ({}))
          if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status })
          return j.result
        })
      const server = {
        get: (path, params) => call('server:get', { path, params }),
        post: (path, body, headers, timeout) => call('server:post', { path, body, headers, timeout }),
        put: (path, body, headers) => call('server:put', { path, body, headers }),
        delete: (path, params) => call('server:delete', { path, params }),
        // upload/sse land in WP-2 follow-up (multipart + job progress channel).
        upload: () => Promise.reject(new Error('tintin upload not yet bridged (WP-2)')),
        sse: () => Promise.reject(new Error('tintin sse not yet bridged (WP-2)')),
      }
      window.tintin = {
        __dshPolyfill: true,
        server,
        // dialog/shell/app and the rest are stubbed to explicit errors so an
        // unbridged call surfaces loudly instead of failing silently (铁律 7).
        dialog: new Proxy({}, { get: () => () => Promise.reject(new Error('tintin dialog not yet bridged (WP-2)')) }),
        shell: new Proxy({}, { get: () => () => Promise.reject(new Error('tintin shell not yet bridged (WP-2)')) }),
      }
      console.info('[tintin] window.tintin polyfill installed')
    }

    return {
      name: 'tintin-bundle',
      inject: ['slots', 'locale'],
      apply(ctx) {
        installTintinBridge()
        ctx.effect(() => ctx.locale.register('tintin', { zh, en }), 'tintin: dictionaries')
        ctx.slots.inject('conversation.session.header.actions', () => {
          const reg1 = ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'tintin-ops-tools', order: 30, locale: 'tintin' },
            TintinOpsEntry,
          )
          const reg2 = ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'tintin-media-tools', order: 31, locale: 'tintin' },
            TintinMediaEntry,
          )
          return () => { reg1(); reg2() }
        })

        // P0-V3 probe: proves this client module executed inside the workbench
        // renderer and that same-origin host routing answers it.
        fetch('/tintin/ping')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then(
            (j) => console.info('[tintin] host ping ok', j),
            (e) => console.error('[tintin] host ping fail', e),
          )
      },
    }
  },
})
