/**
 * 封面模板面板(2026-11-13 用户裁决「会话底栏产品右边加模板图标,弹出服务端封面模板,
 * 注入上下文供服务端快速模仿」): composer 底部工具行的「模板」按钮 → 服务端封面模板
 * (/templates 体系 type=cover)面板 → 点选模板 → 模板定义(参数版式)注入会话输入框。
 * 数据经 /tintin/cover/api/acp/templates(bundle 代理服务端 /templates?type=cover)。
 *
 * 形态与选择产品面板(cover-chat-products.ts)同构:停靠/互斥/注入三件套;三方互斥
 * (在线素材/选择产品/封面模板同区停靠,一个开着就别开另一个)。
 */

type TemplateRow = { id?: unknown; name?: unknown; category?: unknown; canvas?: { width?: unknown; height?: unknown }; params?: Array<{ name?: unknown; label?: unknown; default?: unknown; type?: unknown }> }

const STYLE = [
  '.tintin-tpl-panel{position:fixed;left:0;right:0;top:0;bottom:120px;z-index:70;background:var(--surface-2, #232326);border-bottom:1px solid var(--border, #3a3a3e);display:none;flex-direction:column;font:12.5px/1.5 system-ui;color:var(--text, #e8e8e6);box-sizing:border-box}',
  '.tintin-tpl-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border, #3a3a3e)}',
  '.tintin-tpl-title{flex:1;font-weight:600;font-size:12.5px}',
  '.tintin-tpl-close{border:0;background:transparent;color:var(--text-muted, #b8b8b6);font-size:14px;cursor:pointer;padding:0 2px;line-height:1}',
  '.tintin-tpl-list{flex:1;min-height:0;overflow:auto;padding:8px 12px;display:flex;flex-direction:column;gap:8px}',
  '.tintin-tpl-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border, #3a3a3e);border-radius:9px;background:var(--surface, #1c1c1e);cursor:pointer}',
  '.tintin-tpl-row:hover{border-color:#3b6fd4;background:var(--surface-3, #1b2030)}',
  '.tintin-tpl-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
  '.tintin-tpl-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tintin-tpl-meta{color:var(--text-faint, #77787e);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tintin-tpl-status{padding:6px 12px 12px;color:var(--text-faint, #8a8a90);font-size:11px;min-height:18px;white-space:pre-wrap}',
].join('\n')

const API = '/tintin/cover/api/acp'

const templateName = (item: TemplateRow): string => (typeof item.name === 'string' && item.name.trim()) || (typeof item.id === 'string' ? item.id : '未命名模板')

const contextOf = (item: TemplateRow): string => {
  const lines: string[] = []
  lines.push(`【封面模板】${templateName(item)}（模板 id：${String(item.id ?? '')}）`)
  const canvas = item.canvas
  if (canvas && typeof canvas === 'object') {
    const w = Number((canvas as { width?: unknown }).width)
    const h = Number((canvas as { height?: unknown }).height)
    if (w > 0 && h > 0) lines.push(`画幅：${w}×${h}`)
  }
  const params = Array.isArray(item.params) ? item.params : []
  if (params.length) {
    lines.push('版式参数（按此风格模仿）：' + params.map((p) => `${String(p.label ?? p.name ?? '')}=${String(p.default ?? '')}`).filter((s) => s.split('=')[1]?.trim()).join('；'))
  }
  lines.push('说明：这是服务端封面模板（/templates 体系），请按上述版式风格快速生成/模仿封面。')
  return lines.join('\n')
}

declare global {
  interface Window {
    __tintinCoverCloseTemplates?: () => void
  }
}

const mount = (): void => {
  try {
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.append(style)

    const fab = document.createElement('button')
    fab.className = 'openfilm-composer-tool'
    fab.setAttribute('aria-pressed', 'false')
    /* 图标=lucide layout-template(与素材/产品按钮同画法 16px/stroke 1.75) */
    fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="9" x="3" y="14" rx="1"/><path d="M21 15v2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-2"/></svg>'
    fab.title = '封面模板:注入服务端模板版式(快速模仿)'
    fab.setAttribute('data-tintin-templates', '1')
    /* 挂在「产品」按钮右边(裁决位置)——产品 fab 先就位再插入 */
    const attachFab = (): boolean => {
      const productFab = document.querySelector('[data-tintin-products]')
      if (!productFab) return false
      const row = productFab.parentElement
      if (!row) return false
      if (row.querySelector('[data-tintin-templates]')) return true
      productFab.after(fab)
      return true
    }
    let fabTries = 0
    const fabTick = (): void => {
      if (attachFab()) return
      fabTries += 1
      if (fabTries < 80) setTimeout(fabTick, 250)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(fabTick, 0))
    else setTimeout(fabTick, 0)

    const panel = document.createElement('div')
    panel.className = 'tintin-tpl-panel'
    const head = document.createElement('div'); head.className = 'tintin-tpl-head'
    const title = document.createElement('div'); title.className = 'tintin-tpl-title'; title.textContent = '封面模板（服务端）'
    const close = document.createElement('button'); close.className = 'tintin-tpl-close'; close.textContent = '✕'
    head.append(title, close)
    const list = document.createElement('div'); list.className = 'tintin-tpl-list'
    const status = document.createElement('div'); status.className = 'tintin-tpl-status'
    panel.append(head, list, status)
    document.body.append(panel)

    const isOpen = (): boolean => panel.style.display === 'flex'
    const setOpen = (on: boolean): void => {
      panel.style.display = on ? 'flex' : 'none'
      fab.setAttribute('aria-pressed', on ? 'true' : 'false')
      if (on) {
        /* 三方互斥(素材/产品/模板同区停靠) */
        window.__tintinCoverCloseAssets?.()
        window.__tintinCoverCloseProducts?.()
        const shellRect = document.querySelector('[data-prompt-shell]')?.getBoundingClientRect()
        if (shellRect && shellRect.top > 40) panel.style.bottom = `${Math.round(innerHeight - shellRect.top)}px`
        else panel.style.bottom = '120px'
        if (!list.childElementCount && !status.textContent) void load()
      }
    }
    /* 桥层关模板(在线素材/选择产品打开时调用) */
    window.__tintinCoverCloseTemplates = () => setOpen(false)

    const inject = (text: string): void => {
      const editor = document.querySelector('[data-lexical-editor="true"]') as HTMLElement | null
      if (!editor) { status.textContent = '未找到会话输入框'; return }
      editor.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection?.removeAllRanges()
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }

    const rowOf = (item: TemplateRow): HTMLElement => {
      const row = document.createElement('div'); row.className = 'tintin-tpl-row'
      const main = document.createElement('div'); main.className = 'tintin-tpl-main'
      const name = document.createElement('div'); name.className = 'tintin-tpl-name'
      name.textContent = templateName(item)
      const meta = document.createElement('div'); meta.className = 'tintin-tpl-meta'
      const canvas = item.canvas
      const size = canvas && Number(canvas.width) > 0 ? `${Number(canvas.width)}×${Number(canvas.height)}` : ''
      meta.textContent = [String(item.category ?? ''), size, `${Array.isArray(item.params) ? item.params.length : 0} 参数`].filter((s) => s && s !== '0 参数').join(' · ')
      main.append(name, meta); row.append(main)
      row.onclick = () => {
        inject(contextOf(item))
        setOpen(false)
      }
      return row
    }

    const load = async (): Promise<void> => {
      status.textContent = '加载模板…'
      try {
        const res = await fetch(`${API}/templates`)
        const out = (await res.json()) as { templates?: TemplateRow[]; error?: string }
        if (out && typeof out === 'object' && typeof out.error === 'string') { status.textContent = out.error; return }
        const items = Array.isArray(out?.templates) ? out.templates : []
        list.replaceChildren()
        if (!items.length) {
          const empty = document.createElement('div'); empty.style.cssText = 'color:#8a8a90;font-size:12px;padding:8px 2px'
          empty.textContent = '服务端暂无封面模板。'
          list.append(empty)
          status.textContent = ''
          return
        }
        for (const item of items) list.append(rowOf(item))
        status.textContent = `${items.length} 套模板 · 点选注入版式`
      } catch (error) {
        status.textContent = '模板加载失败：' + (error instanceof Error ? error.message : String(error))
      }
    }
    close.onclick = () => setOpen(false)
    void load()
  } catch (error) {
    console.warn('[cover-chat] 封面模板面板挂载失败:', error)
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
else setTimeout(mount, 0)
