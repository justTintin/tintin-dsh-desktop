# -*- coding: utf-8 -*-
# 预览区:参考线渲染 + 网格覆盖 + 对齐工具条;中栏显示开关
import io

p = 'src/editor/App.tsx'
with io.open(p, encoding='utf-8') as f:
    text = f.read()

# ── 1) playerWrap:relative + 网格/参考线/对齐工具条渲染 ──
old = r'''          <div ref={playerWrapRef} style={{ width: '100%', display: 'flex', justifyContent: 'center', minHeight: 0 }}>'''
new = r'''          <div ref={playerWrapRef} style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center', minHeight: 0 }}>'''
assert old in text
text = text.replace(old, new, 1)

# Player 收尾 </div> 后插入三个覆盖层+工具条(Player 块的收尾是唯一的三个连续 </div> 前导)
old = r'''              style={tpl.height > tpl.width
                ? { height: '76vh', width: 'auto', aspectRatio: `${tpl.width}/${tpl.height}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }
                : { width: '100%', maxWidth: 920, borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }}
            />
          </div>'''
new = r'''              style={tpl.height > tpl.width
                ? { height: '76vh', width: 'auto', aspectRatio: `${tpl.width}/${tpl.height}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }
                : { width: '100%', maxWidth: 920, borderRadius: 10, overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }}
            />
            {/* 画布网格(显示开关;编辑器视觉辅助,不进导出) */}
            {showGrid && !pcRunning ? (
              <div data-preview-grid style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40, backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 40px), repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 40px)' }} />
            ) : null}
            {/* 拖动吸附参考线(青色十字) */}
            {showGuides && guideLines.v !== null ? (
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(guideLines.v / tpl.width) * 100}%`, width: 1, background: '#22d3ee', pointerEvents: 'none', zIndex: 95 }} />
            ) : null}
            {showGuides && guideLines.h !== null ? (
              <div style={{ position: 'absolute', left: 0, right: 0, top: `${(guideLines.h / tpl.height) * 100}%`, height: 1, background: '#22d3ee', pointerEvents: 'none', zIndex: 95 }} />
            ) : null}
            {/* 对齐工具条(选中图层时出现;相对画布六向) */}
            {selectedLayer && !pcRunning ? (
              <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: 'rgba(30,30,32,0.92)', border: '1px solid #3a3a3e', borderRadius: 8, padding: '3px 5px', zIndex: 80 }}>
                {([
                  ['left', '⇤', '左对齐画布'],
                  ['centerX', '⇔', '水平居中'],
                  ['right', '⇥', '右对齐画布'],
                  ['top', '⇧', '顶对齐画布'],
                  ['centerY', '⇕', '垂直居中'],
                  ['bottom', '⇩', '底对齐画布'],
                ] as const).map(([mode, glyph, titleText]) => (
                  <button
                    key={mode}
                    title={titleText}
                    onClick={() => selectedLayer && alignLayer(selectedLayer, mode)}
                    style={{ width: 26, height: 24, borderRadius: 6, border: 0, cursor: 'pointer', background: 'transparent', color: '#c9c9c7', fontSize: 13, lineHeight: 1 }}
                  >{glyph}</button>
                ))}
              </div>
            ) : null}
          </div>'''
assert old in text
text = text.replace(old, new, 1)

# ── 2) 中栏设置:显示开关(参考线/网格)──
old = r'''          {midTab === 'layers' ? (
            <>
              <div style={headStyle}>设置</div>
              <OrientationToggle />
              <LayersPanel />
            </>
          ) : (
            <AssetsPanel />
          )}'''
new = r'''          {midTab === 'layers' ? (
            <>
              <div style={headStyle}>设置</div>
              <OrientationToggle />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '2px 0 10px', padding: '8px 10px', borderRadius: 8, background: 'rgba(127,127,127,0.07)', border: '1px solid #2c2c30' }}>
                <div style={{ fontSize: 11, color: '#8b8b88', fontWeight: 700, letterSpacing: 1 }}>预览显示</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#c9c9c7', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showGuides} onChange={(e) => setGuides(e.target.checked)} style={{ accentColor: '#4f7cff' }} />
                  拖动对齐参考线
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#c9c9c7', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showGrid} onChange={(e) => setCanvasGrid(e.target.checked)} style={{ accentColor: '#4f7cff' }} />
                  画布网格
                </label>
              </div>
              <LayersPanel />
            </>
          ) : (
            <AssetsPanel />
          )}'''
assert old in text
text = text.replace(old, new, 1)

old = r'''  const [midTab, setMidTab] = React.useState<'layers' | 'assets'>('layers')
  useChatContextPush()
  useAgentPropsSync()'''
new = r'''  const [midTab, setMidTab] = React.useState<'layers' | 'assets'>('layers')
  const showGuides = useEditor((s) => s.guides)
  const showGrid = useEditor((s) => s.canvasGrid)
  const setGuides = useEditor((s) => s.setGuides)
  const setCanvasGrid = useEditor((s) => s.setCanvasGrid)
  useChatContextPush()
  useAgentPropsSync()'''
assert old in text
text = text.replace(old, new, 1)

with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
    f.write(text)
print('preview overlays + switches done; lines =', len(text.splitlines()))
