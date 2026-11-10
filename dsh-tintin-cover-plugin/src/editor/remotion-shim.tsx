// 编辑器侧 remotion shim(2026-11-10 用户裁决:编辑态弃 Remotion Player 改自持画布——
// 操作手感的上限由「几何/像素归谁管」决定,Player 壳只保留在导出侧)。模板源码零改动:
// 本文件经 esbuild alias 在编辑器 bundle 内顶替 'remotion' 解析;导出路径
// (dist/remotion-bundle → renderStill)仍用真 remotion,两条路径渲染同一份模板组件。
// 覆盖面=模板编辑器运行时实际触达的导出(2026-11-10 grep 审计:6 模板只用 AbsoluteFill,
// CoverImg 另用 Img/staticFile/useRemotionEnvironment):
// · AbsoluteFill — 默认样式对齐上游 AbsoluteFillElement(absolute inset 0/100%×100%/flex column);
// · Img — 纯 <img>(上游 Img 挂 delayRender/Sequence 上下文,离开 Player 不可依赖);
// · staticFile — 语义对齐上游:window.remotion_staticBase(bundle-entry 声明
//   /tintin/cover/editor 三写位)+ 逐段 encodeURIComponent(中文名素材,宿主 serveStatic 解码);
// · useRemotionEnvironment — 预览恒 {isPlayer:false,isRendering:false}(CoverImg 走预览分支)。
import React from 'react'

const ABSOLUTE_FILL_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
}

export const AbsoluteFill: React.FC<{ style?: React.CSSProperties; className?: string; children?: React.ReactNode }> = ({ style, className, children }) => (
  <div className={className} style={{ ...ABSOLUTE_FILL_STYLE, ...style }}>{children}</div>
)

type ImgProps = {
  src: string
  style?: React.CSSProperties
  onError?: React.ReactEventHandler<HTMLImageElement>
  draggable?: boolean
} & Record<string, unknown>

export const Img: React.FC<ImgProps> = ({ src, style, onError, ...rest }) => (
  <img src={src} style={style} onError={onError} {...rest} />
)

/** 上游语义子集:非法输入显式抛错(CoverImg 预分类后才会调到这里);逐段百分号编码。 */
export function staticFile(path: string): string {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError(`staticFile() 不能接收空值: ${String(path)}`)
  if (path.startsWith('http://') || path.startsWith('https://')) throw new TypeError('staticFile() 不接收远端 URL')
  if (path.startsWith('..') || path.startsWith('./') || path.startsWith('/')) throw new TypeError(`staticFile() 只收 public/ 内的文件名: ${path}`)
  if (path.startsWith('public/')) throw new TypeError('staticFile() 不带 public/ 前缀')
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const base = typeof window !== 'undefined' ? (window as { remotion_staticBase?: string }).remotion_staticBase ?? '' : ''
  return `${base}/${encoded}`
}

export function useRemotionEnvironment(): { isPlayer: boolean; isRendering: boolean } {
  return { isPlayer: false, isRendering: false }
}
