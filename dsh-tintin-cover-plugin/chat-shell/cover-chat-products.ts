/**
 * 选择产品(2026-10-29 用户要求: 视频剪辑会话的选择产品移植到封面会话):
 * composer 底部工具行的「产品」按钮 → 产品库面板(搜索/列表) → 点选产品 →
 * 产品资料(品牌/型号/品类/货号/性能/卖点)以结构化文本注入会话输入框(Lexical 粘贴)。
 * 数据经 /tintin/cover/api/acp/products*(bundle 代理服务端 /api/product-library/*)。
 *
 * 2026-11-12 用户裁决三处对齐视频剪辑(影片 shell tintin-products.ts 同款):
 * ①图标= lucide Package SVG(16px/stroke 1.75, 与官方工具行同画法;原 📦 emoji 不成套);
 * ②fab 再点一次=关闭(aria-pressed 走官方按下态), 点选产品后列表必关;
 * ③面板**停靠**在会话区(列顶→输入框上缘, [data-prompt-shell] 锚, 无缝无浮卡)——
 *   与影片的素材/库面板同形态(composer 常驻底部, 面板铺满其上方区域), 不再浮动。
 */

type ProductRow = { id?: unknown; category?: unknown; brand?: unknown; model?: unknown; goods_no?: unknown; features?: unknown; selling_points?: unknown }

const STYLE = [
  /* 停靠形态(2026-11-12): 铺满聊天列的会话区, 底=输入框上缘(open 时按实位 JS 设), 无圆角无投影 */
  '.tintin-pd-panel{position:fixed;left:0;right:0;top:0;bottom:120px;z-index:70;background:var(--surface-2, #232326);border-bottom:1px solid var(--border, #3a3a3e);display:none;flex-direction:column;font:12.5px/1.5 system-ui;color:var(--text, #e8e8e6);box-sizing:border-box}',
  '.tintin-pd-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border, #3a3a3e)}',
  '.tintin-pd-title{flex:1;font-weight:600;font-size:12.5px}',
  '.tintin-pd-close{border:0;background:transparent;color:var(--text-muted, #b8b8b6);font-size:14px;cursor:pointer;padding:0 2px;line-height:1}',
  '.tintin-pd-search{margin:8px 12px;background:var(--surface, #1c1c1e);border:1px solid var(--border, #3a3a3e);border-radius:8px;color:var(--text, #e8e8e6);font:12px system-ui;padding:6px 10px;outline:none}',
  '.tintin-pd-list{flex:1;min-height:0;overflow:auto;padding:0 12px;display:flex;flex-direction:column;gap:8px}',
  '.tintin-pd-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border, #3a3a3e);border-radius:9px;background:var(--surface, #1c1c1e);cursor:pointer}',
  '.tintin-pd-row:hover{border-color:#3b6fd4;background:var(--surface-3, #1b2030)}',
  '.tintin-pd-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
  '.tintin-pd-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tintin-pd-meta{color:var(--text-faint, #77787e);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tintin-pd-status{padding:6px 12px 12px;color:var(--text-faint, #8a8a90);font-size:11px;min-height:18px;white-space:pre-wrap}',
].join('\n')

const API = '/tintin/cover/api/acp'

const productName = (item: ProductRow): string => {
  const parts = [item.brand, item.model, item.category].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
  return parts.length ? parts.join(' ') : '未命名产品'
}

const contextOf = (item: Record<string, unknown>): string => {
  const str = (keys: string[]): string => {
    for (const k of keys) { const v = item[k]; if (typeof v === 'string' && v.trim()) return v.trim() }
    return ''
  }
  const lines: string[] = []
  const head = [str(['brand']), str(['model']), str(['category']), str(['goods_no']), str(['spec_no'])].filter(Boolean).join(' · ')
  lines.push(`【产品】${head || productName(item)}`)
  const features = str(['features'])
  if (features) lines.push(`性能参数：${features}`)
  const selling = str(['selling_points'])
  if (selling) for (const line of selling.split('\n')) if (line.trim()) lines.push(`卖点：${line.trim()}`)
  /* 资料补全(同影片侧:部分产品 features/selling_points 为空) */
  const notes = str(['notes'])
  if (notes) lines.push(`备注：${notes}`)
  const keywords = item.keywords
  if (Array.isArray(keywords) && keywords.length) lines.push(`关键词：${keywords.map(String).join('、')}`)
  const barcode = str(['barcode'])
  if (barcode) lines.push(`条码：${barcode}`)
  const warehouse = str(['warehouse'])
  if (warehouse) lines.push(`仓库：${warehouse}`)
  return lines.join('\n')
}

/** 页级互斥钩子: 在线素材抽屉(cover-chat-bridge)与产品面板同区停靠, 一个开着就别开另一个 */
declare global {
  interface Window {
    __tintinCoverCloseAssets?: () => void
    __tintinCoverCloseProducts?: () => void
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
    /* 图标(2026-11-12 用户裁决:与在线素材按钮同款样式风格)= lucide Package, 16px/stroke 1.75 */
    fab.setAttribute('aria-pressed', 'false')
    fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/></svg>'
    fab.title = '选择产品:资料注入会话(@ 引用)'
    fab.setAttribute('data-tintin-products', '1')
    /* 挂进官方 composer 工具条(与素材/技能按钮同行同款) —— 等工具条出现后注入 */
    const attachFab = (): boolean => {
      const official = document.querySelector('.openfilm-composer-tool')
      const row = official?.parentElement
      if (!row) return false
      if (row.querySelector('[data-tintin-products]')) return true
      row.append(fab)
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
    panel.className = 'tintin-pd-panel'
    const head = document.createElement('div'); head.className = 'tintin-pd-head'
    const title = document.createElement('div'); title.className = 'tintin-pd-title'; title.textContent = '选择产品'
    const close = document.createElement('button'); close.className = 'tintin-pd-close'; close.textContent = '✕'
    head.append(title, close)
    const search = document.createElement('input'); search.className = 'tintin-pd-search'; search.placeholder = '搜索产品(品类/品牌/型号)…'
    const list = document.createElement('div'); list.className = 'tintin-pd-list'
    const status = document.createElement('div'); status.className = 'tintin-pd-status'
    panel.append(head, search, list, status)
    document.body.append(panel)

    /* 显隐收口(2026-11-12): fab 开→关同款开关语义; aria-pressed 走官方按下态 */
    const isOpen = (): boolean => panel.style.display === 'flex'
    const setOpen = (on: boolean): void => {
      panel.style.display = on ? 'flex' : 'none'
      fab.setAttribute('aria-pressed', on ? 'true' : 'false')
      if (on) {
        /* 互斥(同区停靠, 叠着没意义): 产品开了就关在线素材+封面模板(桥层/模板层挂钩子) */
        window.__tintinCoverCloseAssets?.()
        window.__tintinCoverCloseTemplates?.()
        /* 停靠定位: 底=输入框上缘([data-prompt-shell]=composer 卡片根), 铺满其上方会话区 */
        const shellRect = document.querySelector('[data-prompt-shell]')?.getBoundingClientRect()
        if (shellRect && shellRect.top > 40) panel.style.bottom = `${Math.round(innerHeight - shellRect.top)}px`
        else panel.style.bottom = '120px'
        if (!list.childElementCount && !status.textContent) void load('')
      }
    }
    /* 桥层关产品(在线素材打开时调用) */
    window.__tintinCoverCloseProducts = () => setOpen(false)

    const inject = (text: string): void => {
      const editor = document.querySelector('[data-lexical-editor="true"]') as HTMLElement | null
      if (!editor) { status.textContent = '未找到会话输入框'; return }
      /* Lexical 的粘贴要编辑器内已有光标选区:用户没点过输入框就直接开面板选产品时
         选区为空,合成粘贴会被整个丢弃(2026-10-29 用户实报「没有注入」)。
         先聚焦并把光标放到输入框末尾,再派发粘贴。 */
      editor.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }

    const rowOf = (item: ProductRow): HTMLElement => {
      const row = document.createElement('div'); row.className = 'tintin-pd-row'
      const main = document.createElement('div'); main.className = 'tintin-pd-main'
      const name = document.createElement('div'); name.className = 'tintin-pd-name'
      name.textContent = [item.brand, item.model].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(' ') || productName(item)
      const meta = document.createElement('div'); meta.className = 'tintin-pd-meta'
      meta.textContent = [item.category, item.goods_no ? `货号 ${item.goods_no}` : ''].map((v) => String(v)).filter(Boolean).join(' · ')
      main.append(name, meta); row.append(main)
      row.onclick = () => {
        /* 注入后**列表必关**(2026-11-12 用户裁决「点击选择后,此产品列表应该关闭」) */
        void (async () => {
          try {
            const res = await fetch(`${API}/products-detail?id=${encodeURIComponent(String(item.id ?? ''))}`)
            const detail = (await res.json()) as Record<string, unknown>
            const item0 = detail && typeof detail === 'object' && 'item' in detail ? (detail as { item?: Record<string, unknown> }).item : detail
            inject(contextOf(item0 ?? (item as Record<string, unknown>)))
          } catch { /* 资料拉取失败也照常注入行内已有字段并关闭 */ }
          setOpen(false)
        })()
      }
      return row
    }

    /* 分页装载(2026-11-13 用户裁决「滚动时自动翻页」): 服务端 /product-library/search
       契约只有 q+limit(openapi 实证,offset 不存在)——累计 limit 增量拉取:每次请求
       已载数+PAGE,只追加尾部新条目;返回数 < 请求数=到底。PAGE=50 同旧单页量。 */
    const PAGE = 50
    let loadedCount = 0
    let currentQuery = ''
    let loading = false
    let exhausted = false
    const loadMore = async (): Promise<void> => {
      if (loading || exhausted) return
      loading = true
      const wanted = loadedCount + PAGE
      status.textContent = loadedCount ? '加载更多…' : '搜索产品…'
      try {
        const res = await fetch(`${API}/products?q=${encodeURIComponent(currentQuery)}&limit=${wanted}`)
        const out = (await res.json()) as { items?: ProductRow[]; error?: string }
        if (out && typeof out === 'object' && typeof out.error === 'string') { status.textContent = out.error; return }
        const items = Array.isArray(out?.items) ? out.items : []
        if (loadedCount === 0) list.replaceChildren()
        const fresh = items.length > loadedCount ? items.slice(loadedCount) : []
        for (const item of fresh) list.append(rowOf(item))
        loadedCount = Math.max(loadedCount, items.length)
        exhausted = items.length < wanted
        if (!loadedCount) {
          const empty = document.createElement('div'); empty.style.cssText = 'color:#8a8a90;font-size:12px;padding:8px 2px'
          empty.textContent = '没有匹配的产品。'
          list.append(empty)
        }
        status.textContent = loadedCount ? `${loadedCount} 条${exhausted ? '' : ' · 滚动加载更多'}` : '没有匹配的产品。'
      } catch (error) {
        status.textContent = '产品加载失败：' + (error instanceof Error ? error.message : String(error))
      } finally {
        loading = false
      }
    }
    const load = (q: string): void => {
      currentQuery = q
      loadedCount = 0
      exhausted = false
      void loadMore()
    }
    fab.onclick = () => setOpen(!isOpen())
    close.onclick = () => setOpen(false)
    let timer = 0
    search.oninput = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { load(search.value.trim()) }, 350) }
    list.addEventListener('scroll', () => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 60) void loadMore()
    })
  } catch (error) {
    console.warn('[cover-chat] 选择产品挂载失败:', error)
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
else setTimeout(mount, 0)
