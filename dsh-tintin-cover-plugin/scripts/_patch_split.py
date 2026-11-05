# -*- coding: utf-8 -*-
# 千行付账:App.tsx → ui.ts(样式常量+画布帧)+ panels.tsx(AssetsPanel+ExportModal)
import io

app = 'src/editor/App.tsx'
with io.open(app, encoding='utf-8') as f:
    text = f.read()

# ── 1) 摘出样式常量块 ──
style_start = 'const panelStyle: React.CSSProperties = {'
style_end = '/** 导出选项模态'
si = text.index(style_start)
ei = text.index(style_end)

# ── 2) 摘出画布帧引用块 ──
frame_start = 'const chatFrameRef: { current: HTMLIFrameElement | null } = { current: null }'
refer_end = 'const referableValue'
fsi = text.index(frame_start)
rei = text.index(refer_end)
frame_block = text[fsi:rei]

styles_block = text[si:ei]

# ui.ts 组装
DQ = chr(34)
SQ = chr(39)
ui_ts = (
    "// 编辑器共享 UI 常量与画布帧引用(2026-10-28 千行付账:从 App.tsx 下沉)。\n"
    "import type React from 'react'\n\n"
    "export const panelStyle: React.CSSProperties = {\n"
    "  width: 252, flexShrink: 0, background: '#1a1a1c', borderRight: '1px solid #333',\n"
    "  padding: 12, display: 'flex', flexDirection: 'column', overflowY: 'auto',\n"
    "}\n"
    "export const headStyle: React.CSSProperties = { fontSize: 11, color: '#8b8b88', margin: '4px 0 8px', fontWeight: 700, letterSpacing: 1 }\n"
    "export const iconBtn: React.CSSProperties = { border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, padding: 0, width: 22 }\n"
    "export const ghostBtn: React.CSSProperties = {\n"
    "  width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #444',\n"
    "  background: 'transparent', color: '#e8e8e6', fontSize: 12, cursor: 'pointer',\n"
    "}\n"
    "export const inputStyle = (extra: React.CSSProperties = {}): React.CSSProperties => ({\n"
    "  width: '100%', background: '#101012', border: '1px solid #444', borderRadius: 6,\n"
    "  color: '#e8e8e6', fontSize: 12, padding: '6px 8px', outline: 'none', ...extra,\n"
    "})\n\n"
    + frame_block.replace('const chatFrameRef', 'export const chatFrameRef', 1)
                 .replace('interface ReferableLayer', 'export interface ReferableLayer', 1)
                 .replace('function referLayerToChat', 'export function referLayerToChat', 1)
    + "\nexport const referableValue = (value: unknown): unknown => (Array.isArray(value) ? value.map(String).join("
    + DQ + " / " + DQ + ") : value)\n"
)

with io.open('src/editor/ui.ts', 'w', encoding='utf-8', newline='\n') as f:
    f.write(ui_ts)
print('ui.ts written')

# ── 3) App.tsx 删除已下沉块,改为导入 ──
text = text[:fsi] + text[rei:]          # 移除帧引用块
text = text[:si] + text[ei:]            # 移除样式常量块
# referableValue 本体移除(已下沉)
rv = ("const referableValue = (value: unknown): unknown => (Array.isArray(value) ? value.map(String).join("
      + SQ + " / " + SQ + ") : value)\n")
assert rv in text
text = text.replace(rv, '', 1)

old = "import { customLayersOf, effectiveOrder, undo, useEditor } from './store'"
new = ("import { customLayersOf, effectiveOrder, undo, useEditor } from './store'\n"
       "import { chatFrameRef, ghostBtn, headStyle, iconBtn, inputStyle, panelStyle, referableValue, referLayerToChat } from './ui'\n"
       "import { AssetsPanel, ExportModal } from './panels'")
assert old in text
text = text.replace(old, new, 1)

with io.open(app, 'w', encoding='utf-8', newline='\n') as f:
    f.write(text)
print('App.tsx trimmed; lines =', len(text.splitlines()))
