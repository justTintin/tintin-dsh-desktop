// cover-asset — 封面素材落笔助手(会话移植批,2026-10-28):一处写入,三处可见。
// 编辑器预览(vite 构建把 public/ 拷进 dist/editor;运行期新素材必须补写这里)、
// Remotion staticFile 服务根(dist/remotion-bundle/public/,导出用)、源(public/)。
// 此前上传/AI 底图只双写后两处,运行期生成的图片在编辑器预览里 404 —— 本模块统一收口。
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const ASSET_NAME_RE = /^[A-Za-z0-9._-]{1,120}$/
export const ASSET_EXT_RE = /\.(?:jpe?g|png|webp)$/i

/** 素材三写位:public/(源)/ dist/editor/(编辑器预览)/ dist/remotion-bundle/public/(导出) */
export function coverAssetTargets(pluginDir) {
  return [join(pluginDir, 'public'), join(pluginDir, 'dist', 'editor'), join(pluginDir, 'dist', 'remotion-bundle', 'public')]
}

/** 写入一个素材(三写);返回写入的文件名。非法名直接抛错(调用方显式报给用户)。 */
export function writeCoverAsset(pluginDir, name, bytes) {
  if (!ASSET_NAME_RE.test(name) || !ASSET_EXT_RE.test(name)) throw new Error(`素材名不合法:${name}`)
  for (const target of coverAssetTargets(pluginDir)) {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, name), bytes)
  }
  return name
}

/** 从 cover 工作目录把图片收进素材位(agent 生成/下载的图先落 cwd,再经此进画布) */
export function adoptCoverAsset(pluginDir, coverDir, name) {
  if (typeof name !== 'string' || !ASSET_NAME_RE.test(name) || !ASSET_EXT_RE.test(name)) return false
  const src = join(coverDir, name)
  if (!existsSync(src) || !statSync(src).isFile()) return false
  for (const target of coverAssetTargets(pluginDir)) {
    const dest = join(target, name)
    if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue
    mkdirSync(target, { recursive: true })
    copyFileSync(src, dest)
  }
  return true
}

/** props 里被引用的图片(image/bgImage)若在工作目录,收进素材位;返回收进的名字清单 */
export function ensureCoverAssets(pluginDir, coverDir, props) {
  const adopted = []
  if (!pluginDir || !props || typeof props !== 'object') return adopted
  for (const key of ['image', 'bgImage']) {
    const name = props[key]
    if (typeof name === 'string' && name && adoptCoverAsset(pluginDir, coverDir, name)) adopted.push(name)
  }
  return adopted
}
