# -*- coding: utf-8 -*-
# panels.tsx:AssetsPanel + ExportModal(从 App.tsx 迁出,2026-10-28 千行付账)
import io

with io.open('src/editor/App.tsx', encoding='utf-8') as f:
    text = f.read()

a_start = '/** 工程素材面板'
a_end = '/** 导出选项模态'
e_end = 'export const EditorApp: React.FC = () => {'
asi = text.index(a_start)
aei = text.index(a_end)
eei = text.index(e_end)
moved = text[asi:eei]

text = text[:asi] + text[aei:]

panels = (
    "// 工程素材面板 + 导出模态(2026-10-28 从 App.tsx 迁出;千行付账)。\n"
    "import React from 'react'\n"
    "import { getTemplate } from '../registry'\n"
    "import { useEditor } from './store'\n"
    "import { chatFrameRef, ghostBtn, headStyle, inputStyle, panelStyle } from './ui'\n\n"
    + moved
)

with io.open('src/editor/panels.tsx', 'w', encoding='utf-8', newline='\n') as f:
    f.write(panels)

with io.open('src/editor/App.tsx', 'w', encoding='utf-8', newline='\n') as f:
    f.write(text)
print('panels.tsx written; App lines =', len(text.splitlines()))
