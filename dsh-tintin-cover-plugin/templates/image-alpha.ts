// 主体图装饰的形态自适应(2026-11-12 用户报障「白背景和人混在一起」根治):
// 主体图层的产品聚光装饰(白辉光盘/径向渐隐遮罩/-8° 倾斜)只为不透明产品照设计;
// 人物抠图(matting 透明 PNG)放进来会被套上白盘+边缘溶解(实撞: 保人方案人物
// 被白盘罩住)。本探针按图片 alpha 判形态: 带透明像素(抠图)=免装饰只留投影;
// 不透明(产品照)=保留原聚光样式。
// 探针结果按文件名缓存;Remotion 渲染中 delayRender 挂起首帧直到探针回值
// (不挂起则首帧按旧样式落盘,导出永远慢一拍);编辑器画布为普通异步态——
// 先按现状画,探完即换,对用户表现为一次短暂闪变。
import React from 'react'
import { continueRender, delayRender, getRemotionEnvironment, staticFile } from 'remotion'

const cache = new Map<string, boolean>()
const pending = new Map<string, Promise<boolean>>()

const probeAlpha = (name: string): Promise<boolean> => {
  const hit = pending.get(name)
  if (hit) return hit
  const p = new Promise<boolean>((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        // 缩到 64px 探足够:抠图四角/边缘大比例透明,产品照 0 透明——2% 阈值两态分明
        const c = document.createElement('canvas')
        const w = (c.width = Math.min(img.naturalWidth || 64, 64))
        const h = (c.height = Math.min(img.naturalHeight || 64, 64))
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx || !w || !h) { resolve(false); return }
        ctx.drawImage(img, 0, 0, w, h)
        const d = ctx.getImageData(0, 0, w, h).data
        let transparent = 0
        const total = w * h
        for (let i = 3; i < d.length; i += 4) { const a = d[i]; if (a !== undefined && a < 250) transparent++ }
        resolve(transparent / total > 0.02)
      } catch { resolve(false) }
    }
    img.onerror = () => resolve(false)
    img.src = staticFile(name)
  })
  pending.set(name, p)
  return p
}

/** 主体图素材是否带透明像素(=抠图形态)。未设置/加载失败/无 alpha → false(按产品照装饰)。 */
export function useImageHasAlpha(name: unknown): boolean {
  const key = typeof name === 'string' && name ? name : ''
  const [hasAlpha, setHasAlpha] = React.useState(() => cache.get(key) ?? false)
  React.useEffect(() => {
    if (!key) return
    const hit = cache.get(key)
    if (hit !== undefined) { setHasAlpha(hit); return }
    let live = true
    const handle = getRemotionEnvironment().isRendering ? delayRender(`image-alpha-${key}`) : null
    void probeAlpha(key).then((v) => {
      cache.set(key, v)
      pending.delete(key)
      if (live) setHasAlpha(v)
      if (handle !== null) continueRender(handle)
    })
    return () => { live = false }
  }, [key])
  return hasAlpha
}
