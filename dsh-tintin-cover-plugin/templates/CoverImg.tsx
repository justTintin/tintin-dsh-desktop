// 模板图片的安全渲染(2026-11-01 用户裁决:一张图出问题只标出这一层,不让整张画布崩)。
// staticFile() 遇 null/undefined/网址/相对或绝对路径/public/ 前缀会在渲染中同步抛错,
// 预览里这会把 Remotion 播放器整块打成 ⚠ 且不再恢复(实撞:产品图被置 undefined)。
// · 未设置(空值):不渲染;
// · 预览:值不是素材文件名、或加载失败 → 只在本层画警示框,其余图层照常;
// · 导出(isRendering):保持 Remotion 原行为——非法值/加载失败让导出报错,不静默产出缺图封面。
import React from 'react'
import { Img, staticFile, useRemotionEnvironment } from 'remotion'

/** 素材名口径同宿主 lib/cover-asset.js 的 ASSET_NAME_RE(只有裸文件名进得了素材位);
 *  '..' 开头另拒(staticFile 按相对路径抛错) */
const ASSET_NAME_RE = /^[A-Za-z0-9._-]{1,120}$/

export type ImageNameKind = 'unset' | 'invalid' | 'ok'

export function classifyImageName(value: unknown): ImageNameKind {
  if (value === undefined || value === null || value === '') return 'unset'
  return typeof value === 'string' && ASSET_NAME_RE.test(value) && !value.startsWith('..') ? 'ok' : 'invalid'
}

const markerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
  padding: 12, border: '3px dashed rgba(250,204,21,0.9)', background: 'rgba(250,204,21,0.1)',
  color: '#facc15', fontSize: 22, fontWeight: 700, lineHeight: 1.4, textAlign: 'center', wordBreak: 'break-all',
}

export const CoverImg: React.FC<{ name: unknown; style?: React.CSSProperties; layerId?: string }> = ({ name, style, layerId }) => {
  const { isRendering } = useRemotionEnvironment()
  const [failed, setFailed] = React.useState<unknown>(null)
  const kind = classifyImageName(name)
  if (kind === 'unset') return null
  if (isRendering) return <Img draggable={false} data-cover-layer={layerId} src={staticFile(name as string)} style={style} />
  if (kind === 'invalid' || failed === name) {
    // 警示框只取几何:蒙版/滤镜会把边框和文字吃掉;无显式高度的(自定义图层)按 4:3 撑开
    const geometry: React.CSSProperties = { ...style }
    delete geometry.WebkitMaskImage
    delete geometry.maskImage
    delete geometry.filter
    delete geometry.objectFit
    if (geometry.height === undefined) geometry.aspectRatio = '4 / 3'
    return (
      <div data-cover-layer={layerId} data-cover-image-error="" style={{ ...geometry, ...markerStyle }}>
        ⚠ 图片无法显示:{typeof name === 'string' ? name : `(${typeof name})`}
      </div>
    )
  }
  return <Img draggable={false} data-cover-layer={layerId} src={staticFile(name as string)} style={style} onError={() => setFailed(name)} />
}
