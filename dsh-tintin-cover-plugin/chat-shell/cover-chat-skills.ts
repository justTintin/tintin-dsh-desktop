/**
 * 封面技能管理入口(2026-10-30 用户裁决二次修订:形态=编辑器上的大居中弹窗,
 * 即视频剪辑 Skill 弹窗同款——不再是聊天列里的右下小面板)。
 * 本文件只剩转发职责:桥层(cover-chat-bridge showExamples,▦ 按钮)派发的
 * tintin-cover:skills-open 窗口事件在此转译为 parent postMessage,
 * 由编辑器(App.tsx)监听后打开整幅技能管理弹窗(skills-modal.tsx)。
 */

window.addEventListener('tintin-cover:skills-open', () => {
  window.parent?.postMessage({ type: 'tintin-cover:skills-open' }, '*')
})
