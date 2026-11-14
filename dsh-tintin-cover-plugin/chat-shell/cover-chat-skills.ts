/**
 * 封面技能管理事件桥(2026-11-14 用户裁决:composer 底栏=注入选择器专用——技能/模板
 * 的「管理」图标从底栏撤除,管理入口=编辑器顶栏图标(App.tsx)。本文件只剩桥层职责:
 * 桥层(cover-chat-bridge showExamples,官方 ▦/菜单入口)派发的 tintin-cover:skills-open
 * 窗口事件转译为 parent postMessage,由编辑器(App.tsx)监听后打开技能管理弹窗。)
 */

window.addEventListener('tintin-cover:skills-open', () => {
  window.parent?.postMessage({ type: 'tintin-cover:skills-open' }, '*')
})
