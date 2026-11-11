// align-row — 六向对齐画布按钮行 + 图标小钮(2026-11-11 R15:自 text-properties 提取复用,
// 画布浮动对齐条按用户裁决删除,对齐入口统一收进属性面板=PhotoCraft 落点)。
// 图标=Lucide align-edge 族逐字(layer-icons);按钮 24×22,active=field 底 accent 字。
import React from 'react'
import {
  IconEdgeBottom, IconEdgeHCenter, IconEdgeLeft, IconEdgeRight, IconEdgeTop, IconEdgeVCenter,
} from './layer-icons'

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'

/** 图标小钮(26px 视觉缩至 24×22;active=field 底) */
export function IconBtn({ children, onClick, disabled, active, title }: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title: string
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 24, height: 22, border: 0, borderRadius: 3, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? '#242424' : 'transparent',
        color: disabled ? '#808080' : active ? '#378EF0' : '#C8C8C8',
      }}
    >
      {children}
    </button>
  )
}

/** 六向对齐(相对画布): 左/水平居中/右/顶/垂直居中/底 */
export function AlignButtons({ onAlign, disabled }: {
  onAlign: (mode: AlignMode) => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      <IconBtn title="左对齐画布" onClick={() => onAlign('left')} disabled={disabled}><IconEdgeLeft size={14} /></IconBtn>
      <IconBtn title="水平居中画布" onClick={() => onAlign('centerX')} disabled={disabled}><IconEdgeHCenter size={14} /></IconBtn>
      <IconBtn title="右对齐画布" onClick={() => onAlign('right')} disabled={disabled}><IconEdgeRight size={14} /></IconBtn>
      <IconBtn title="顶对齐画布" onClick={() => onAlign('top')} disabled={disabled}><IconEdgeTop size={14} /></IconBtn>
      <IconBtn title="垂直居中画布" onClick={() => onAlign('centerY')} disabled={disabled}><IconEdgeVCenter size={14} /></IconBtn>
      <IconBtn title="底对齐画布" onClick={() => onAlign('bottom')} disabled={disabled}><IconEdgeBottom size={14} /></IconBtn>
    </div>
  )
}
