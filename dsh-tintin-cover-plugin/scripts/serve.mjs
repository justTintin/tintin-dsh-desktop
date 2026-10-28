// 封面制作本地服务(WP-6 MVP 托管形态;WP-1 收尾时上提 bundle 并接通道菜单):
//   GET  /                  → 编辑器(dist/editor/editor.html)
//   GET  /api/templates     → 模板注册表(含图层定义)
//   POST /api/render        → {templateId, props, fileName?} → renderCover → {ok, file|error}
// 产物目录:<TINTIN_WORKSPACE_DIR|~/Documents/tintin-workspace>/cover/(G5)
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { listTemplates, validateProps } from '../src/registry.ts'
import { renderCover, resolveCoverDir } from '../src/engine.ts'

const dist = join(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', 'dist', 'editor')
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }

const server = createServer((req, res) => {
  const url = req.url || '/'
  if (url === '/api/templates') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, templates: listTemplates() }))
    return
  }
  if (url === '/api/upload-image' && req.method === 'POST') {
    // 调试服对等端点:与 bundle 路由同名同义(文件名白名单+双写 public)
    const name = String(new URL(req.url, 'http://localhost').searchParams.get('name') || '')
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || !/\.(?:jpe?g|png|webp)$/i.test(name)) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: '文件名仅限字母数字与 ._- ,扩展名 jpg/png/webp' }))
      return
    }
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size <= 15 * 1024 * 1024) chunks.push(c) })
    req.on('end', () => {
      try {
        const bytes = Buffer.concat(chunks)
        for (const target of [join(pluginRoot, 'public'), join(pluginRoot, 'dist', 'remotion-bundle', 'public')]) {
          mkdirSync(target, { recursive: true })
          writeFileSync(join(target, name), bytes)
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, name }))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return
  }
  if (url === '/api/render' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      try {
        const p = JSON.parse(body || '{}')
        const check = validateProps(String(p.templateId || ''), p.props ?? {})
        if (!check.ok) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: check.error }))
          return
        }
        renderCover({ templateId: String(p.templateId), props: p.props, fileName: p.fileName }).then((r) => {
          res.writeHead(r.ok ? 200 : 500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(r))
        })
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return
  }
  // 静态:editor dist(默认 editor.html;兼容 base 前缀 /tintin/cover/editor/*)
  const PREFIX = '/tintin/cover/editor'
  let rel = url === '/' ? '/editor.html' : url.split('?')[0]
  if (rel.startsWith(PREFIX)) rel = rel.slice(PREFIX.length) || '/editor.html'
  const file = normalize(join(dist, rel))
  if (!file.startsWith(normalize(dist)) || !existsSync(file)) {
    res.writeHead(404); res.end('not found'); return
  }
  res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})

const port = Number(process.env.TINTIN_COVER_PORT || 3927)
server.listen(port, '127.0.0.1', () => {
  console.log(`[cover-plugin] 编辑器 http://127.0.0.1:${port}/  产物目录 ${resolveCoverDir()}`)
})
