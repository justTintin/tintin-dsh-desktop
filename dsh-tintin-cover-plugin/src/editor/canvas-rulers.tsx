// canvas-rulers — 画布标尺组件(2026-11-11 §6.4 R8,自 edit-canvas 提取付账:千行门禁)。
// 顶/左两条画布 px 刻度(密度随缩放分档 25/50/100);刻度层由父级 ref 平移对齐
// (syncRulers);十字标 ref 跟随指针;标尺本身可拖出参考线(R9b,onPointerDown 由父级给)。
import React from 'react'

export function CanvasRulers({ tpl, scale, rulerXRef, rulerYRef, markerXRef, markerYRef, onStartGuideDrag }: {
  tpl: { width: number; height: number }
  scale: number
  rulerXRef: React.RefObject<HTMLDivElement>
  rulerYRef: React.RefObject<HTMLDivElement>
  markerXRef: React.RefObject<HTMLDivElement>
  markerYRef: React.RefObject<HTMLDivElement>
  onStartGuideDrag: (axis: 'h' | 'v', e: React.PointerEvent) => void
}): React.ReactElement {
  const minor = scale < 0.25 ? 100 : scale < 0.6 ? 50 : 25
  const major = minor * 4
  const ticksX: React.ReactNode[] = []
  const ticksY: React.ReactNode[] = []
  for (let c = 0; c <= tpl.width; c += minor) {
    const isMajor = c % major === 0
    ticksX.push(
      <div key={'x' + c} style={{ position: 'absolute', left: c * scale, bottom: 0, width: 1, height: isMajor ? 9 : 4, background: 'var(--border-strong)' }}>
        {isMajor && c > 0 ? <span style={{ position: 'absolute', left: 2, bottom: 8, fontSize: 8, lineHeight: 1, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{c}</span> : null}
      </div>,
    )
  }
  for (let c = 0; c <= tpl.height; c += minor) {
    const isMajor = c % major === 0
    ticksY.push(
      <div key={'y' + c} style={{ position: 'absolute', top: c * scale, right: 0, height: 1, width: isMajor ? 9 : 4, background: 'var(--border-strong)' }}>
        {isMajor && c > 0 ? <span style={{ position: 'absolute', top: 2, right: 9, fontSize: 8, lineHeight: 1, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{c}</span> : null}
      </div>,
    )
  }
  return (
    <>
      <div
        onPointerDown={(e) => onStartGuideDrag('h', e)}
        title="拖出水平参考线(拖回标尺/画布外删除)"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 18, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', zIndex: 60, overflow: 'hidden', cursor: 'row-resize' }}
      >
        <div ref={rulerXRef} style={{ position: 'absolute', top: 0, left: 0, width: Math.round(tpl.width * scale), height: '100%', pointerEvents: 'none' }}>{ticksX}</div>
        <div ref={markerXRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 1, background: 'var(--accent)', display: 'none', pointerEvents: 'none' }} />
      </div>
      <div
        onPointerDown={(e) => onStartGuideDrag('v', e)}
        title="拖出垂直参考线(拖回标尺/画布外删除)"
        style={{ position: 'absolute', top: 18, left: 0, bottom: 0, width: 18, background: 'var(--bg-panel)', borderRight: '1px solid var(--border)', zIndex: 60, overflow: 'hidden', cursor: 'col-resize' }}
      >
        <div ref={rulerYRef} style={{ position: 'absolute', top: 0, left: 0, height: Math.round(tpl.height * scale), width: '100%', pointerEvents: 'none' }}>{ticksY}</div>
        <div ref={markerYRef} style={{ position: 'absolute', top: 0, left: 0, height: 1, background: 'var(--accent)', display: 'none', pointerEvents: 'none' }} />
      </div>
      {/* 原点角块 */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 18, height: 18, background: 'var(--bg-panel)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', zIndex: 61, pointerEvents: 'none' }} />
    </>
  )
}
