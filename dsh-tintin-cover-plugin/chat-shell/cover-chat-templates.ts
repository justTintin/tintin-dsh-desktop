/**
 * 封面模板注入通道(2026-11-14 用户裁决:composer 底栏=注入选择器专用——「模板管理」
 * 入口图标从底栏撤除,管理入口=编辑器顶栏图标(App.tsx,弹窗内「注入版式」回注会话)。
 * 本文件只剩通道职责:①旧停靠面板关面板钩子保留为 no-op(素材/产品面板仍会调);
 * ②编辑器模板管理弹窗「注入版式」→ 把模板版式文本贴进会话输入框(经
 * tintin-cover:inject-text,原面板能力迁移,能力不丢)。
 */

declare global {
  interface Window {
    __tintinCoverCloseTemplates?: () => void
  }
}

const mount = (): void => {
  try {
    /* 旧停靠面板已并入编辑器弹窗:保留关面板钩子为 no-op(素材/产品面板仍会调) */
    window.__tintinCoverCloseTemplates = () => {}

    /* 编辑器模板管理弹窗「注入版式」→ 把模板版式文本贴进会话输入框(原面板能力迁移) */
    const inject = (text: string): void => {
      const editor = document.querySelector('[data-lexical-editor="true"]') as HTMLElement | null
      if (!editor) return
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
    window.addEventListener('message', (event) => {
      const data = event.data as { type?: string; text?: unknown } | null
      if (!data || data.type !== 'tintin-cover:inject-text') return
      if (event.source !== window.parent) return // 只认编辑器回传
      if (typeof data.text === 'string' && data.text.trim()) inject(data.text)
    })
  } catch (error) {
    console.warn('[cover-chat] 模板注入通道挂载失败:', error)
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
else setTimeout(mount, 0)
