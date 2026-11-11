// layer-icons — PhotoCraft 图层面板图标(2026-11-11 用户裁决「按钮/图标一比一复制 PhotoCraft」):
// 路径逐字拷贝自 D:\Project\photocraft\assets\icons\*.svg(Lucide 24 栅格),effective
// stroke 1.75(icon_data.rs 加载时 2→1.75),round cap/join,currentColor 按用途着色。
import React from 'react'

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Lucide eye(图层可见;隐藏=不画,同 PhotoCraft layer_row.rs:399) */
export const IconEye: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

/** Lucide lock(锁定指示;12×12,text_faint,layer_row_ui.rs:195-196) */
export const IconLock: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

/** Lucide folder(图层组缩略芯片;18×18 于 field 底 radius 6,layer_row.rs:639-642) */
export const IconFolder: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
)

/** Lucide type(文字层缩略芯片;20×20 于 #DEDEDE 芯片,#282828,layer_row.rs:644-648) */
export const IconType: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 4v16" />
    <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
    <path d="M9 20h6" />
  </svg>
)

/** Lucide trash(页脚删除;26 按钮内 14pt,layers.rs:402-528) */
export const IconTrash: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

/** Lucide square-plus(页脚新建/复制;行拖到此=复制,layer_drag.rs:32-37) */
export const IconSquarePlus: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </svg>
)

/** Lucide chevron-down(下拉/数值字段 ▾ 区,fields.rs:398-401) */
export const IconChevronDown: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/** 组展开三角(非 Lucide;实心多边形 s=3.5,layer_tree_ui.rs:65-71,展开朝下/折叠朝右) */
export const IconDisclosure: React.FC<{ size: number; expanded: boolean }> = ({ size, expanded }) => (
  <svg width={size} height={size} viewBox="0 0 8 8" fill="currentColor">
    {expanded
      ? <polygon points="0.5,1.9 7.5,1.9 4,6.1" />
      : <polygon points="1.9,0.5 6.1,4 1.9,7.5" />}
  </svg>
)

/** Lucide align-*(字符面板对齐/分布行;路径逐字) */
export const IconAlignLeft: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M21 5H3" /><path d="M15 12H3" /><path d="M17 19H3" />
  </svg>
)
export const IconAlignCenter: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M21 5H3" /><path d="M17 12H7" /><path d="M19 19H5" />
  </svg>
)
export const IconAlignRight: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M21 5H3" /><path d="M21 12H9" /><path d="M21 19H7" />
  </svg>
)
export const IconAlignJustify: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M3 5h18" /><path d="M3 12h18" /><path d="M3 19h18" />
  </svg>
)
export const IconEdgeLeft: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M4 3v18" /></svg>
)
export const IconEdgeHCenter: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M12 3v18" /></svg>
)
export const IconEdgeRight: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M20 3v18" /></svg>
)
export const IconEdgeTop: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M3 4h18" /></svg>
)
export const IconEdgeVCenter: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M3 12h18" /></svg>
)
export const IconEdgeBottom: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M3 20h18" /></svg>
)
export const IconDistributeHorizontal: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M3 4v16" /><path d="M21 4v16" />
  </svg>
)
export const IconDistributeVertical: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M4 3h16" /><path d="M4 21h16" />
  </svg>
)
export const IconLink2: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" />
  </svg>
)

/** Lucide link-2-off(宽高未链接态;路径逐字) */
export const IconLink2Off: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M9 17H7A5 5 0 0 1 7 7" />
    <path d="M15 7h2a5 5 0 0 1 4 8" />
    <line x1="8" x2="12" y1="12" y2="12" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
)
