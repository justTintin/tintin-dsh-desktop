// cover-photocraft-routes.js — PhotoCraft 路由族(/tintin/cover/api/pc/*;2026-11-13
// 从 cover-plugin-route.js 拆出——门禁 1000 行:该文件是全封面路由大杂烩,PhotoCraft
// 领域自成一个边界)。路由:launch(启动/未装检测)、config+save-config(安装目录持久化)、
// tpl-list/tpl-preview/tpl-delete(服务端封面模板管理,preview=PNG 字节直出)、
// psd-import(PSD 上传建模板:cli convert 优先,内置纯 JS 解析兜底)、
// inspect/screenshot/execute(控制通道)、export(导出)。
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { mergeTintinConfigStore } from 'dsh-tintin-shared/lib/tintin-config-store.js'
import { cliConvert, configuredDir, connectControl, launchApp, resolveCli, resolvePhotocraftDir } from './photocraft.js'

/** 注册 PhotoCraft 路由族,返回 disposables(与主路由 cleanup 合并)。
 *  deps 与主路由同款原语:registeringWebServer/isTrustedRequest/sendJson(主路由同款)、
 *  loadEngine(引擎单例)、getServerUrl(服务端地址解析)。 */
export function registerCoverPhotocraftRoutes({ registeringWebServer, isTrustedRequest, sendJson, loadEngine, getServerUrl }) {
  const pcDisposes = []
  const pcRoute = (sub, method, handler) => pcDisposes.push(registeringWebServer.register({
    kind: 'exact', path: `/tintin/cover/api/pc/${sub}`,
    handler: async (req, res) => {
      if (req.method !== method || !isTrustedRequest(req, method !== 'GET')) {
        sendJson(res, req.method === method ? 403 : 405, { error: 'Request rejected.' })
        return
      }
      let body = ''
      if (method === 'POST') {
        req.on('data', (c) => { body += c })
        await new Promise((done) => req.on('end', done))
      }
      try {
        const p = body ? JSON.parse(body) : {}
        sendJson(res, 200, await handler(p))
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  }))

  /* 打开精修(2026-10-31 用户报障「打开后是空的」):原实现只裸启动不装内容。
     现在=按当前模板+props 先构建图层底稿(.pcraft,图层全保留),随文档路径启动 GUI
     (实测 GUI 接受文档参数,document.inspect 可见全部图层);构建失败如实报错,不开空窗。
     2026-11-13 起按钮已从编辑器移除(脱包裁决:PhotoCraft 不随客户端集成),路由保留
     供后续入口使用;未安装时返回结构化 notInstalled(下载地址+选择目录引导)。 */
  pcRoute('launch', 'POST', async (p) => {
    if (!resolvePhotocraftDir()) {
      return {
        ok: false,
        notInstalled: true,
        downloadUrl: 'https://getartcraft.com/',
        releasesUrl: 'https://github.com/storytold/photocraft/releases/latest',
        hint: '请下载 windows-x64-portable 版并解压到任意目录,然后在下方选择该目录(内含 photocraft-cli.exe)。',
      }
    }
    let docPath
    if (p && p.templateId) {
      const engine = await loadEngine()
      const built = await engine.buildLayeredDraft({
        templateId: String(p.templateId),
        props: p.props && typeof p.props === 'object' ? p.props : undefined,
      })
      if (!built.ok || !built.file) return { ok: false, error: built.error ?? '底稿构建失败' }
      docPath = built.file
    }
    return launchApp({ port: Number(process.env.TINTIN_PHOTOCRAFT_PORT || 7878), docPath })
  })
  /* 配置读写(2026-11-13 用户裁决):GET=当前生效目录;POST=保存用户选定的安装目录
     (允许选到目录或直接选 photocraft-cli.exe,取其所在目录),落 config.json
     photocraft.dir,下次启动直接命中。 */
  pcRoute('config', 'GET', async () => {
    return { ok: true, dir: resolvePhotocraftDir() ?? '', configuredDir: configuredDir() ?? '' }
  })
  pcRoute('save-config', 'POST', async (p) => {
    let dir = String(p?.dir ?? '').trim().replace(/^["']|["']$/g, '')
    if (!dir) return { ok: false, error: '目录为空——请选择/粘贴 PhotoCraft 安装目录' }
    if (/\.exe$/i.test(dir)) dir = dirname(dir) // 选到 exe 文件=取其所在目录
    if (!existsSync(join(dir, 'photocraft-cli.exe'))) {
      return { ok: false, error: `该目录下没有 photocraft-cli.exe:${dir}` }
    }
    try {
      mergeTintinConfigStore(process.env.DSH_HOME, { photocraft: { dir } })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    return { ok: true, dir }
  })
  /* 模板管理(2026-11-13 用户裁决「右上角模板管理图标+上传 PSD 作封面模板」):列表/预览/
     删除/PSD 导入。PSD 不上服务端——photocraft-cli convert 无头转 PNG,PNG 走
     product-upload 进服务端,模板记录(templates 体系)挂底图引用。 */
  pcRoute('tpl-list', 'GET', async () => {
    const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
    if (!serverUrl) return { ok: false, error: '服务端未配置' }
    const upstream = await fetch(`${serverUrl}/templates?type=cover`, { signal: AbortSignal.timeout(15_000) })
    const doc = await upstream.json().catch(() => null)
    return { ok: upstream.ok && !!doc, templates: Array.isArray(doc?.templates) ? doc.templates : [], total: Number(doc?.total) || 0, error: upstream.ok ? '' : `HTTP ${upstream.status}` }
  })
  /* 预览直出 PNG 字节流(服务端 /templates/preview 原样透传)——不能走 pcRoute 的 JSON 包装 */
  pcDisposes.push(registeringWebServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/pc/tpl-preview',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
      if (!serverUrl) { sendJson(res, 500, { ok: false, error: '服务端未配置' }); return }
      let body = ''
      await new Promise((done) => {
        req.on('data', (c) => { body += c })
        req.on('end', done)
      })
      let p = {}
      try { p = body ? JSON.parse(body) : {} } catch { p = {} }
      try {
        const upstream = await fetch(`${serverUrl}/templates/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ template_id: String(p?.template_id || ''), params: p?.params && typeof p.params === 'object' ? p.params : {}, type: 'cover' }),
          signal: AbortSignal.timeout(180_000),
        })
        if (!upstream.ok) {
          const text = (await upstream.text().catch(() => '')).slice(0, 200)
          sendJson(res, upstream.status, { ok: false, error: `预览渲染失败 HTTP ${upstream.status} ${text}` })
          return
        }
        const bytes = Buffer.from(await upstream.arrayBuffer())
        res.writeHead(200, { 'content-type': upstream.headers.get('content-type') || 'image/png', 'cache-control': 'no-store' })
        res.end(bytes)
      } catch (err) {
        sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  }))
  pcRoute('tpl-delete', 'POST', async (p) => {
    const id = String(p?.id || '').replace(/[^A-Za-z0-9_\-]/g, '')
    if (!id) return { ok: false, error: '缺少模板 id' }
    const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
    if (!serverUrl) return { ok: false, error: '服务端未配置' }
    const upstream = await fetch(`${serverUrl}/templates/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(15_000) })
    if (!upstream.ok) return { ok: false, error: `删除失败 HTTP ${upstream.status}` }
    return { ok: true, id }
  })
  pcDisposes.push(registeringWebServer.register({
    kind: 'exact',
    path: '/tintin/cover/api/pc/psd-import',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return
      }
      const name = decodeURIComponent(String(new URL(req.url, 'http://localhost').searchParams.get('name') || 'template.psd')).slice(-120)
      const engine = await loadEngine()
      const coverDir = await engine.resolveCoverDir()
      mkdirSync(coverDir, { recursive: true })
      const slug = (name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tpl') + '-' + Date.now().toString(36)
      const psdFile = join(coverDir, `.psd-import-${Date.now()}.psd`)
      const pngFile = join(coverDir, `${slug}.png`)
      const chunks = []
      await new Promise((done) => {
        req.on('data', (c) => chunks.push(c))
        req.on('end', done)
      })
      try { writeFileSync(psdFile, Buffer.concat(chunks)) } catch (err) { sendJson(res, 500, { ok: false, error: 'PSD 落盘失败:' + (err instanceof Error ? err.message : String(err)) }); return }
      try {
        if (!existsSync(psdFile) || statSync(psdFile).size === 0) { sendJson(res, 400, { ok: false, error: 'PSD 文件为空' }); return }
        /* PNG 生成不依赖 PhotoCraft(2026-11-13 用户质问「没集成就打不开 psd?」——PSD 是
           标准格式): ①本机配置了 PhotoCraft→cli convert(Rust 渲染,字体/效果保真最优);
           ②否则内置纯 JS 解析(ag-psd 读 Photoshop 存盘内嵌的合成位图 + psd-png 编码)。
           两条都失败(如 PSD 未含合成位图)才如实报错。 */
        let pngReady = false
        if (resolveCli()) {
          const conv = cliConvert({ src: psdFile, out: pngFile })
          pngReady = conv.ok
        }
        if (!pngReady) {
          const { readPsd } = await import('ag-psd')
          const psd = readPsd(readFileSync(psdFile), { useImageData: true })
          const img = psd.imageData
          if (!img || !img.data || !img.width) {
            sendJson(res, 500, { ok: false, error: 'PSD 内未含合成图像(Photoshop 存储需开启「最大兼容」),无法生成模板底图' })
            return
          }
          const { encodeRgbaPng } = await import('./psd-png.js')
          writeFileSync(pngFile, encodeRgbaPng(img.width, img.height, img.data))
          pngReady = true
        }
        const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
        if (!serverUrl) { sendJson(res, 500, { ok: false, error: '服务端未配置' }); return }
        const form = new FormData()
        form.append('files', new Blob([readFileSync(pngFile)]), basename(pngFile))
        const up = await fetch(serverUrl + '/api/storyboard/scripts/product-upload', { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
        if (!up.ok) { sendJson(res, 502, { ok: false, error: `底图上传服务端失败 HTTP ${up.status}` }); return }
        const upJson = await up.json().catch(() => null)
        const serverPath = Array.isArray(upJson?.paths) ? String(upJson.paths[0] ?? '') : ''
        if (!serverPath) { sendJson(res, 502, { ok: false, error: '底图上传返回异常:' + JSON.stringify(upJson).slice(0, 160) }); return }
        const tplId = 'psd_' + slug.replace(/-/g, '_').slice(0, 50)
        const tpl = {
          id: tplId,
          name: name.replace(/\.[^.]+$/, ''),
          category: 'custom',
          type: 'cover',
          canvas: { width: 1080, height: 1920, fps: 30 },
          duration: 3,
          params: [
            { name: 'title', type: 'string', default: '', label: '主标题' },
            { name: 'subtitle', type: 'string', default: '', label: '副标题' },
          ],
          effects: {},
          cover: { image: serverPath, source: 'psd', psd: name },
        }
        const cr = await fetch(serverUrl + '/templates', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(tpl), signal: AbortSignal.timeout(30_000),
        })
        const crText = await cr.text().catch(() => '')
        if (!cr.ok) { sendJson(res, 502, { ok: false, error: `模板创建失败 HTTP ${cr.status} ${crText.slice(0, 200)}` }); return }
        sendJson(res, 200, { ok: true, templateId: tplId, coverImage: serverPath, png: pngFile })
      } finally {
        try { rmSync(psdFile, { force: true }) } catch { /* 尽力清理 */ }
      }
    },
  }))
  pcRoute('inspect', 'GET', async () => {
    const conn = await connectControl()
    if (!conn.ok) return conn
    const r = await conn.request('engine.execute', { command: 'document.inspect' })
    return { ok: !!r.ok, doc: r.result ?? null, error: r.error }
  })
  pcRoute('screenshot', 'GET', async () => {
    const conn = await connectControl()
    if (!conn.ok) return conn
    const r = await conn.request('ui.screenshot', {})
    return { ok: !!r.ok, data: r.result?.data ?? null, error: r.error }
  })
  pcRoute('execute', 'POST', async (p) => {
    const conn = await connectControl()
    if (!conn.ok) return conn
    const r = await conn.request('engine.execute', { command: String(p.command || ''), params: p.params ?? {} })
    return { ok: !!r.ok, result: r.result ?? null, error: r.error }
  })
  pcRoute('export', 'POST', async (p) => {
    const conn = await connectControl()
    if (!conn.ok) return conn
    const engine = await loadEngine()
    const file = join(engine.resolveCoverDir(), String(p.fileName || `cover-${Date.now()}.png`))
    const r = await conn.request('engine.execute', { command: 'file.export', params: { path: file, format: 'png' } })
    return { ok: !!r.ok, file, error: r.error }
  })
  return pcDisposes
}
