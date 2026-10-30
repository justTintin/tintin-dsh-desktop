// 封面编辑器入口。remotion 的 staticFile 缺省产出根绝对路径(/<name>),而本页伺服于
// /tintin/cover/editor 前缀、运行期素材(上传/AI/领养)也在该前缀的 dist/editor 三写位——
// 必须在渲染前声明静态基址,否则拖入图片/AI 底图的预览全部 404(2026-10-28 探针实测)。
declare global {
  interface Window {
    remotion_staticBase: string
  }
}
window.remotion_staticBase = '/tintin/cover/editor'

import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditorApp } from './App'

createRoot(document.getElementById('root')!).render(<EditorApp />)
