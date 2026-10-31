// cover-background — 封面 AI 底图(WP-3):服务端文生图 → 落插件素材三写位
// (public/ + dist/editor/ + dist/remotion-bundle/public/,见 cover-asset.js)。生成语义复用
// openfilm-tools 的服务端契约
// (POST /generate/image → 任务轮询 /tasks/unified/:id → output_url 下载),
// 纯函数(taskIdOf/taskStatusOf/absoluteUrl)直接引同仓实现,不复制维护。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { absoluteUrl, taskStatusOf, taskIdOf } from 'dsh-tintin-shared/lib/server-gen.js'
import { createDreaminaApi, dreaminaDownloadRoot, extractMediaUrls } from 'dsh-tintin-shared/lib/dreamina.js'

const errText = (e) => (e instanceof Error ? e.message : String(e))
const DONE = new Set(['completed', 'succeeded', 'success', 'done'])
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled'])
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 生成一张封面底图(无文字氛围图;文字层永远走代码排版——需求文档 §一)。
 * @returns {Promise<{ok:true, bytes:Buffer, name:string, engine:string, url:string}|{ok:false,error:string}>}
 *   name = bg-<时间戳>.png(已写入插件 public/ 与 dist/remotion-bundle/public/)
 */
export async function generateCoverBackground(
  { prompt, aspect = '16:9', engine = 'server', timeoutMs = 900_000 },
  { httpRequest, getServerUrl, resolveDir, log = () => {}, warn = () => {} } = {},
) {
  try {
    const text = String(prompt || '').trim()
    if (!text || text.length > 2000) return { ok: false, error: 'prompt 必填(1..2000 字符)' }
    // 双通道裁决(2026-10-27):即梦 = text2image(比例随横竖屏);缺省 = 服务端文生图。
    // 检查顺序:通道可用性 → 落盘目录。
    if (engine !== 'jimeng' && (typeof httpRequest !== 'function' || typeof getServerUrl !== 'function')) {
      return { ok: false, error: '服务端出图通道不可用(缺 httpRequest/getServerUrl)' }
    }
    const dir = typeof resolveDir === 'function' ? resolveDir() : null
    if (!dir) return { ok: false, error: '封面插件目录不存在,无法保存底图' }
    if (engine === 'jimeng') {
      return runJimengGeneration(
        { command: 'text2image', prompt: text, ratio: aspect === '9:16' ? '9:16' : '16:9' },
        { resolveDir, namePrefix: 'bg', engineLabel: 'dreamina-text2image', log, warn },
      )
    }
    const submitted = await httpRequest('POST', '/generate/image', {
      body: { prompt: text, aspect: String(aspect || '16:9') },
      timeout: 30_000,
    })
    // 任务轮询(与 openfilm-tools maybeTask 同口径)
    let body = submitted?.data
    const id = taskIdOf(body)
    if (id && !DONE.has(taskStatusOf(body))) {
      log('cover-background task queued:', id)
      const deadline = Date.now() + timeoutMs
      for (;;) {
        if (Date.now() > deadline) return { ok: false, error: `出图任务 ${id} 超时;稍后可重试` }
        const response = await httpRequest('GET', `/tasks/unified/${encodeURIComponent(id)}`, { timeout: 30_000 })
        body = response?.data
        const state = taskStatusOf(body)
        if (DONE.has(state)) break
        if (FAILED.has(state)) {
          const detail = body?.error ?? body?.message ?? state
          return { ok: false, error: `出图任务 ${id} ${state}:${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }
        }
        await sleep(1500)
      }
    }
    const result = body?.result ?? {}
    const url = String(result.output_url || result.output_path || '')
    if (!url) return { ok: false, error: '生成完成但服务端未返回产物地址' }
    const absolute = absoluteUrl(String(getServerUrl() || '').replace(/\/+$/, ''), url)
    if (!absolute) return { ok: false, error: '服务端产物地址不可解析' }
    const response = await fetch(absolute, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) return { ok: false, error: `底图下载失败 HTTP ${response.status}` }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) return { ok: false, error: `底图大小异常(${bytes.length}B)` }

    // 三写素材位(源/编辑器预览/导出 staticFile 根,见 cover-asset.js)+ 来源留痕
    const name = `bg-${Date.now()}.png`
    const { writeCoverAsset } = await import('./cover-asset.js')
    writeCoverAsset(dir, name, bytes)
    try {
      const { appendAssetProvenance } = await import('./cover-provenance.js')
      appendAssetProvenance(dir, { name, source: 'ai', ts: Date.now(), prompt: text, engine: String(result.engine || ''), url })
    } catch { /* 留痕失败不影响产物 */ }
    log(`cover-background → ${name} (${(bytes.length / 1024).toFixed(0)}KB)`)
    return { ok: true, name, engine: String(result.engine || ''), url }
  } catch (e) {
    warn('cover-background failed:', errText(e))
    return { ok: false, error: errText(e) }
  }
}

/**
 * 产品图生成(2026-10-27 双通道裁决):engine 缺省 'jimeng' = 即梦 image2image
 * (当前产品图为参考,真·图生图);engine 'server' = 服务端文生图(按描述出全新
 * 产品图,不用参考——服务端暂无图生图端点,铁律 2 显式说明不静默)。
 */
export async function generateCoverProductImage(
  { prompt, image, engine = 'jimeng', timeoutMs = 240_000 },
  { resolveDir, httpRequest, getServerUrl, log = () => {}, warn = () => {} } = {},
) {
  try {
    const text = String(prompt || '').trim()
    if (!text || text.length > 2000) return { ok: false, error: 'prompt 必填(1..2000 字符)' }
    const dir = typeof resolveDir === 'function' ? resolveDir() : null
    if (!dir) return { ok: false, error: '封面插件目录不存在' }
    if (engine === 'server') {
      const bg = await generateCoverBackground(
        { prompt: text, aspect: '1:1', engine: 'server', timeoutMs },
        { httpRequest, getServerUrl, resolveDir, log, warn },
      )
      if (!bg.ok) return bg
      // 服务端产物名改 product- 前缀(与图层语义一致)
      const src = join(dir, 'public', bg.name)
      const name = `product-${Date.now()}.png`
      const { writeCoverAsset } = await import('./cover-asset.js')
      writeCoverAsset(dir, name, readFileSync(src))
      return { ok: true, name, engine: bg.engine, url: bg.url }
    }
    const source = join(dir, 'public', String(image || ''))
    if (!image || !existsSync(source)) {
      return { ok: false, error: '当前没有产品图可作参考——先在产品图图层上传一张,再让会话换背景/场景' }
    }
    return runJimengGeneration(
      { command: 'image2image', prompt: text, images: [source] },
      { resolveDir, namePrefix: 'product', engineLabel: 'dreamina-image2image', log, warn },
    )
  } catch (e) {
    warn('cover-product failed:', errText(e))
    return { ok: false, error: errText(e) }
  }
}

/** 即梦生成公共管线:提交(CLI 自轮询)→ query 补收(download)→ 双写 public + provenance */
async function runJimengGeneration(
  { command, prompt, images = [], ratio },
  { resolveDir, namePrefix, engineLabel, timeoutMs = 240_000, log = () => {}, warn = () => {} } = {},
) {
  const dir = typeof resolveDir === 'function' ? resolveDir() : null
  if (!dir) return { ok: false, error: '封面插件目录不存在' }
  const api = createDreaminaApi({ log, warn })
  const gen = await api['dreamina:generate']([{ command, prompt, images, ratio, poll: 110 }])
  if (gen.error) return { ok: false, error: `即梦通道不可用:${gen.error}` }
  let urls = extractMediaUrlsSafe(gen.parsed)
  let localDir = ''
  const submitId = String(gen.submitId || '')
  const deadline = Date.now() + timeoutMs
  while ((!urls || urls.length === 0) && submitId && Date.now() < deadline) {
    if (gen.failReason) return { ok: false, error: `即梦生成失败:${gen.failReason}` }
    const q = await api['dreamina:query']([{ submitId, download: true }])
    if (q.mediaUrls?.length) { urls = q.mediaUrls; localDir = String(q.localDir || '') }
    if (q.failReason) return { ok: false, error: `即梦任务失败:${q.failReason}` }
    if (!urls.length) await sleep(8000)
  }
  if (!urls.length) return { ok: false, error: '即梦未返回产物(可能未登录——到创作模式「即梦 CLI」卡片登录后重试)' }
  let bytes = null
  if (localDir && existsSync(localDir)) {
    const hit = readdirSync(localDir).find((f) => /\.(png|jpe?g|webp)$/i.test(f))
    if (hit) bytes = readFileSync(join(localDir, hit))
  }
  if (!bytes) {
    const response = await fetch(absoluteUrl('', urls[0]) || urls[0], { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) return { ok: false, error: `产物下载失败 HTTP ${response.status}` }
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (!bytes || bytes.length === 0 || bytes.length > 15 * 1024 * 1024) return { ok: false, error: `产物大小异常(${bytes ? bytes.length : 0}B)` }
  const name = `${namePrefix}-${Date.now()}.png`
  const { writeCoverAsset } = await import('./cover-asset.js')
  writeCoverAsset(dir, name, bytes)
  try {
    const { appendAssetProvenance } = await import('./cover-provenance.js')
    appendAssetProvenance(dir, { name, source: 'ai', ts: Date.now(), prompt: String(prompt), engine: engineLabel, url: urls[0] })
  } catch { /* 留痕失败不影响产物 */ }
  log(`cover-${namePrefix}(${engineLabel}) → ${name}`)
  return { ok: true, name, engine: engineLabel, url: urls[0] }
}

function extractMediaUrlsSafe(value) {
  try { return extractMediaUrls(value) } catch { return [] }
}
