// TinTin web chrome (Spike B scope).
//
// Ported shape from tintin-dsh-desktop packages/tintin-bundle/client.js
// (0.1.7-rc.2): this file's TOP LEVEL runs at bootstrap script-eval time,
// before any module factory. It must install `window.__tintinViews` and the
// `window.tintin` polyfill there — the media bundle's factory registers view
// providers against `__tintinViews` and assumes both already exist
// (deterministic ordering guarantee, see the source header comment).
//
// Spike B differences from the source chrome (deferred to Phase 2):
// - entry buttons are a fixed top-right bar instead of cloned sidebar rows,
//   because the source injects by `[data-dsh-sidebar-root]` markers that come
//   from tintin's dsh-client-ui-sidebar patch, which this repo does not apply
//   (its own patch provides `data-sidebar-header-controls` instead);
// - the `window.tintin` bridge is a logging stub — Spike A host routes cover
//   only /tintin/ping and /tintin/spawn-probe.

const tintinSpikeChrome = (() => {
  const providers = new Map()
  const viewEls = new Map()
  let activeId = 'workbench'

  window.__tintinViews = {
    register(id, provider) {
      providers.set(id, provider)
    },
    unregister(id) { providers.delete(id) },
  }

  // Minimal window.tintin stub: every namespace answers with async no-ops that
  // log once, so the Vue bundle's feature probes stay alive instead of throwing.
  const stub = (label) => new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      return async (...args) => {
        console.info(`[tintin-spike] ${String(label)}.${String(prop)} called`, args.length > 0 ? args[0] : '')
        return { ok: false, error: 'spike stub' }
      }
    },
  })
  window.tintin = {
    __dshPolyfill: true,
    server: stub('server'),
    dialog: stub('dialog'),
    shell: stub('shell'),
    ffmpeg: stub('ffmpeg'),
    liveclip: stub('liveclip'),
    ytdlp: stub('ytdlp'),
    env: stub('env'),
    media: stub('media'),
    context: stub('context'),
    config: {
      get: async () => ({ value: {} }),
      merge: async () => console.info('[tintin-spike] config.merge called'),
    },
  }

  function ensureChrome() {
    if (document.getElementById('tintin-spike-bar') !== null) return
    const bar = document.createElement('div')
    bar.id = 'tintin-spike-bar'
    bar.style.cssText = 'position:fixed;top:10px;right:12px;z-index:2147483000;display:flex;gap:6px;font:12px system-ui;'
    const workbenchBtn = document.createElement('button')
    workbenchBtn.textContent = '工作台'
    const mediaBtn = document.createElement('button')
    mediaBtn.textContent = '媒体工具'
    for (const b of [workbenchBtn, mediaBtn]) {
      b.style.cssText = 'padding:6px 12px;border-radius:8px;border:1px solid #666;background:#222;color:#fff;cursor:pointer;'
    }
    bar.append(workbenchBtn, mediaBtn)

    const overlay = document.createElement('div')
    overlay.id = 'tintin-spike-overlay'
    overlay.style.cssText = 'position:fixed;inset:44px 0 0 0;z-index:2147482000;display:none;background:#141414;overflow:auto;'
    const container = document.createElement('div')
    container.style.cssText = 'width:100%;height:100%;box-sizing:border-box;padding:12px;'
    overlay.appendChild(container)

    function setActive(id) {
      activeId = id
      workbenchBtn.style.background = id === 'workbench' ? '#4f7cff' : '#222'
      mediaBtn.style.background = id === 'media' ? '#4f7cff' : '#222'
      if (id === 'workbench') {
        overlay.style.display = 'none'
        return
      }
      overlay.style.display = 'block'
      let el = viewEls.get(id)
      if (el === undefined) {
        el = document.createElement('div')
        el.style.cssText = 'width:100%;min-height:100%;box-sizing:border-box;'
        container.appendChild(el)
        viewEls.set(id, el)
        const provider = providers.get(id)
        if (provider !== undefined) {
          try {
            provider.mount(el)
          } catch (error) {
            console.error('[tintin-spike] view mount failed', error)
            el.textContent = '视图加载失败,请重试切换'
          }
        } else {
          el.textContent = '视图提供方尚未注册(id=' + String(id) + ')'
        }
      }
    }

    workbenchBtn.onclick = () => setActive('workbench')
    mediaBtn.onclick = () => setActive('media')
    document.documentElement.append(bar, overlay)
    setActive('workbench')
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureChrome, { once: true })
  } else {
    ensureChrome()
  }
  return { setActiveWorkbench: () => window.location.reload() }
})()

// Register this package's client module in the web module system. The factory
// must return a CommonJS-style exports object carrying a cordis plugin shape
// (`apply`, optional `inject`) — same contract as dsh-community-market's built
// client and the tintin-media-bundle dist.
window.__ModuleLoader__.load({
  id: 'dsh-tintin-bundle',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    exports.inject = []
    exports.apply = () => {
      console.info('[tintin-spike] dsh-tintin-bundle client module activated')
    }
    return module.exports
  },
})
