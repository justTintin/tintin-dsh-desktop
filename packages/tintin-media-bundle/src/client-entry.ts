// tintin-media-bundle client entry — built by vite (IIFE, single file) into
// dist/client.js. The thin React shell owns the 媒体工具 header entry; the
// panel content is a Vue sub-application (App.vue) mounted into the panel
// container: the WP-3 "React 壳 + Vue 内容" seam, per the architecture doc.
//
// Built artifact; source of truth is src/. Rebuild: npm run tintin:media.
import { createApp, type App as VueApp } from 'vue'
import App from './App.vue'

declare global {
  interface Window {
    __ModuleLoader__?: {
      load: (def: {
        id: string
        factory: (require: (id: string) => unknown) => {
          name: string
          inject: string[]
          apply: (ctx: unknown) => void
        }
      }) => void
    }
  }
}

window.__ModuleLoader__!.load({
  id: 'tintin-media-bundle',
  factory: (require) => {
    // Minimal structural React surface (provided by the host module system).
    const React = require('react') as {
      createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown
      useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void
      useRef: <T>(initial: T) => { current: T }
      useState: <T>(initial: T) => [T, (v: T) => void]
    }
    const h = React.createElement

    // React shell: the 媒体工具 button + a panel whose body hosts the Vue app.
    // Slot contract identical to tintin-bundle's entries (header.actions).
    function MediaToolsEntry({ t }: { t?: (key: string) => string }) {
      const label = '媒体工具'
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef<HTMLElement | null>(null)

      React.useEffect(() => {
        if (!open) return
        const onDown = (e: PointerEvent) => {
          if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
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
          onClick: () => setOpen((v: boolean) => !v),
          'aria-expanded': open,
          style: {
            appearance: 'none', font: 'inherit', fontSize: '13px', lineHeight: 1.5,
            padding: '4px 10px', borderRadius: '8px', cursor: 'pointer',
            border: '0.5px solid var(--dsw-alias-border-l4, currentColor)',
            background: open ? 'var(--dsw-alias-bg-layer-2, transparent)' : 'transparent',
            color: 'var(--dsw-alias-label-secondary, inherit)', fontWeight: 500,
          },
        }, label),
        open && h(VueMount, null),
      )
    }

    // The Vue seam: mount on attach, unmount on detach — slot lifecycle clean.
    function VueMount() {
      const hostRef = React.useRef<HTMLElement | null>(null)
      React.useEffect(() => {
        const el = hostRef.current
        if (!el) return
        const app: VueApp = createApp(App)
        app.mount(el)
        return () => app.unmount()
      }, [])
      return h('div', {
        ref: hostRef,
        style: {
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 1000,
          padding: '14px 16px',
          background: 'var(--dsw-alias-bg-layer-2, #1e1e20)',
          border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))',
          borderRadius: '12px', boxShadow: '0 8px 28px rgba(0,0,0,.28)',
          color: 'var(--dsw-alias-label-primary, inherit)',
        },
      })
    }

    const module = { exports: {} as Record<string, unknown> }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    exports.inject = ['slots']
    exports.apply = (ctx: {
      slots: {
        inject: (name: string, register: () => () => void) => void
        register: (config: Record<string, unknown>, component: unknown) => () => void
      }
    }) => {
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          { name: 'conversation.session.header.actions', id: 'tintin-media-tools', order: 31 },
          MediaToolsEntry,
        ),
      )
    }
    return module.exports as {
      inject: string[]
      apply: (ctx: unknown) => void
    }
  },
})
