// cover-acp-routes — 封面会话路由族(CA-2,需求文档 §11.3):/tintin/cover/api/acp/*。
// 会话生命周期(start/prompt/steer/cancel/permission/question/close/set-option)、
// 语义事件流(SSE,Last-Event-ID 断线重放)、轮次回执(running/ack)、聊天记录
// (load/sessions/turn/附件/引用图)、技能清单与文本、图层文件清单(@ 菜单)、
// props 同步(编辑器写/agent 写,双方经 cover.props.json 对流)。
// 信任:浏览器走 isTrustedRequest(loopback+Origin);agent 子进程走会话令牌头
// x-tintin-cover-agent(令牌只进 agent 环境,不经浏览器)。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { agentToken } from './cover-acp-bridge.js'

const ACP = '/tintin/cover/api/acp'

/** 聊天记录/附件/引用图的磁盘位(cover 工作目录下,与导出产物同源) */
const chatRecordFile = (coverDir) => join(coverDir, '.cover-chat', 'record.json')
const chatTurnsFile = (coverDir) => join(coverDir, '.cover-chat', 'turns.json')
const chatAttachDir = (coverDir) => join(coverDir, '.cover-chat', 'attachments')
const propsFile = (coverDir) => join(coverDir, 'cover.props.json')

/** 读 JSON(不存在/坏文件返回 null;调用方自定缺省) */
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** POST 体收集(JSON) */
async function readBodyJson(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks)
  if (!raw.length) return {}
  const text = raw.toString('utf8')
  try { return JSON.parse(text) } catch { throw new Error(`请求体不是合法 JSON(${text.slice(0, 80)}…)`) }
}

/** POST 体收集(原始字节) */
async function readBodyBytes(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

/** props 记录读写(编辑器↔agent 对流点;revision 单调,origin 标记写入方) */
export function readCoverPropsRecord(coverDir) {
  const record = readJson(propsFile(coverDir))
  if (!record || typeof record !== 'object' || typeof record.props !== 'object' || record.props === null) return null
  return record
}

export function writeCoverPropsRecord(coverDir, record, origin) {
  writeJson(propsFile(coverDir), { ...record, origin, updatedAt: Date.now() })
}

/**
 * 注册 /tintin/cover/api/acp/* 路由族。
 * @param options.resolveCoverDir async () => string  封面工作目录(引擎口径)
 */
export function registerCoverAcpRoutes({ webServer, isTrustedRequest, sendJson, httpRequest, getServerUrl, resolveCoverDir, resolvePluginDir }) {
  const disposes = []
  /* 处理器统一兜底:坏请求体/内部错误回 400/500,不打穿 webServer */
  const register = (sub, handler) => disposes.push(webServer.register({
    kind: 'exact', path: `${ACP}/${sub}`,
    handler: async (req, res) => {
      try { await handler(req, res) } catch (err) {
        try { sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) }) } catch { /* 响应已开始 */ }
      }
    },
  }))

  /** GET 只需 loopback;POST 需 isTrustedRequest 或 agent 会话令牌(方法由各路由自查) */
  const guard = (req, res, mutation) => {
    if (mutation ? !(req.headers['x-tintin-cover-agent'] === agentToken || isTrustedRequest(req, true)) : !isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'Request rejected.' })
      return false
    }
    return true
  }

  const importBridge = () => import('./cover-acp-bridge.js')
  const coverDir = () => resolveCoverDir()

  // ── 会话生命周期 ──────────────────────────────────────────────────────
  register('hello', async (req, res) => {
    if (req.method !== 'GET' || !guard(req, res, false)) return
    const bridge = await importBridge()
    const dir = await coverDir()
    sendJson(res, 200, {
      ok: true,
      platform: process.platform,
      flavor: 'tintin-cover',
      language: 'zh-CN',
      version: '0.1.0',
      dshBin: bridge.dshBinExists(),
      project: { id: 'cover', name: '封面制作', path: dir },
      coverDir: dir,
    })
  })

  register('start', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    try {
      const p = await readBodyJson(req)
      const bridge = await importBridge()
      const host = req.headers.host
      if (typeof host === 'string' && host) bridge.setApiOrigin(`http://${host}`)
      const channelHome = process.env.TINTIN_COVER_AGENT_HOME
        || process.env.DSH_HOME
        || join(process.env.USERPROFILE || process.env.HOME || '.', 'Documents', 'tintin-workspace', '.tintin')
      const result = await bridge.startSession({
        cwd: typeof p.cwd === 'string' && p.cwd ? p.cwd : await coverDir(),
        serverUrl: getServerUrl(),
        channelHome,
      })
      sendJson(res, result.ok ? 200 : 500, result)
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  register('prompt', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    try {
      const p = await readBodyJson(req)
      const bridge = await importBridge()
      const result = await bridge.prompt(String(p.text || ''), p.meta, Array.isArray(p.images) ? p.images : undefined)
      sendJson(res, result.ok ? 200 : 500, result)
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  register('steer', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const bridge = await importBridge()
    sendJson(res, 200, await bridge.steer(String(p.text || ''), Array.isArray(p.images) ? p.images : undefined))
  })

  register('cancel', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const bridge = await importBridge()
    sendJson(res, 200, await bridge.cancel())
  })

  register('close', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const bridge = await importBridge()
    bridge.stopSession()
    sendJson(res, 200, { ok: true })
  })

  register('set-option', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const bridge = await importBridge()
    sendJson(res, 200, await bridge.setOption(String(p.configId || ''), p.value))
  })

  register('permission', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const bridge = await importBridge()
    sendJson(res, 200, await bridge.answerPermission(String(p.requestId || ''), typeof p.optionId === 'string' ? p.optionId : null))
  })

  register('question', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const bridge = await importBridge()
    sendJson(res, 200, await bridge.answerQuestion(String(p.requestId || ''), p.answers ?? null))
  })

  register('running', async (req, res) => {
    if (req.method !== 'GET' || !guard(req, res, false)) return
    const bridge = await importBridge()
    sendJson(res, 200, { ok: true, running: bridge.runningTurns() })
  })

  register('ack', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const bridge = await importBridge()
    bridge.ackTurn(String(p.turnId || ''))
    sendJson(res, 200, { ok: true })
  })

  // ── 语义事件流(SSE;EventSource 断线自动带 Last-Event-ID 重放) ────────
  register('events', async (req, res) => {
    if (req.method !== 'GET' || !isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'Request rejected.' })
      return
    }
    const bridge = await importBridge()
    const sinceHeader = Number(req.headers['last-event-id'])
    const sinceQuery = Number(new URL(req.url, 'http://localhost').searchParams.get('since'))
    const since = Number.isFinite(sinceHeader) && sinceHeader > 0 ? sinceHeader
      : Number.isFinite(sinceQuery) && sinceQuery > 0 ? sinceQuery : bridge.lastEventSeq()
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write(`retry: 2000\n\n`)
    const heartbeat = setInterval(() => {
      try { res.write(`: ping\n\n`) } catch { /* 已断开 */ }
    }, 15_000)
    const unsubscribe = bridge.subscribe((entry) => {
      try {
        res.write(`id: ${entry.seq}\nevent: agent\ndata: ${JSON.stringify(entry.event)}\n\n`)
      } catch { /* 已断开;退订由 close 兜底 */ }
    }, since)
    res.on('close', () => { clearInterval(heartbeat); unsubscribe() })
  })

  // ── 聊天记录(chat-store 契约:sessions/last + turns) ─────────────────
  register('chat-record', async (req, res) => {
    if (req.method !== 'GET' || !guard(req, res, false)) return
    const dir = await coverDir()
    const record = readJson(chatRecordFile(dir)) ?? {}
    const turns = readJson(chatTurnsFile(dir))
    sendJson(res, 200, {
      sessions: Array.isArray(record.sessions) ? record.sessions : [],
      last: typeof record.last === 'string' ? record.last : null,
      turns: Array.isArray(turns) ? turns : [],
    })
  })

  register('chat-sessions', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const dir = await coverDir()
    const record = readJson(chatRecordFile(dir)) ?? {}
    writeJson(chatRecordFile(dir), { ...record, sessions: Array.isArray(p.sessions) ? p.sessions : [], last: typeof p.last === 'string' ? p.last : null })
    sendJson(res, 200, { ok: true })
  })

  register('chat-turn', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const dir = await coverDir()
    const turns = readJson(chatTurnsFile(dir)) ?? []
    const next = [...(Array.isArray(turns) ? turns : []).filter((t) => t?.turn?.id !== p?.turn?.id), { turn: p.turn, items: Array.isArray(p.items) ? p.items : [] }]
    writeJson(chatTurnsFile(dir), next.slice(-400))
    sendJson(res, 200, { ok: true })
  })

  register('chat-attachment', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const name = String(new URL(req.url, 'http://localhost').searchParams.get('name') || '')
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) { sendJson(res, 400, { ok: false, error: '附件名不合法' }); return }
    const bytes = await readBodyBytes(req)
    if (!bytes.length) { sendJson(res, 400, { ok: false, error: '空附件' }); return }
    const dir = join(chatAttachDir(await coverDir()), name)
    mkdirSync(dirname(dir), { recursive: true })
    writeFileSync(dir, bytes)
    sendJson(res, 200, { ok: true, path: dir })
  })

  register('chat-ref-image', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const query = new URL(req.url, 'http://localhost')
    const turnId = String(query.searchParams.get('turnId') || '')
    const n = String(query.searchParams.get('n') || '0')
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(turnId) || !/^\d+$/.test(n)) { sendJson(res, 400, { ok: false, error: '参数不合法' }); return }
    const bytes = await readBodyBytes(req)
    const file = join(chatAttachDir(await coverDir()), `${turnId}-${n}.jpg`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
    sendJson(res, 200, { ok: true, path: file })
  })

  register('describe-paths', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const paths = Array.isArray(p.paths) ? p.paths.filter((x) => typeof x === 'string').slice(0, 64) : []
    const found = paths.map((path) => {
      try {
        const stat = statSync(path)
        return { path, folder: stat.isDirectory(), size: stat.isFile() ? stat.size : undefined }
      } catch {
        return { path, error: '不是文件' }
      }
    })
    sendJson(res, 200, found)
  })

  // ── 技能(聊天 Skills 按钮 + / 命令菜单 + @ 菜单) ─────────────────────
  const coverSkillDir = () => {
    for (const dir of [
      process.env.TINTIN_COVER_PLUGIN_DIR,
      join(import.meta.dirname, '..', '..', 'dsh-tintin-cover-plugin'),
      join(import.meta.dirname, '..', '..', '..', 'cover-plugin'),
    ]) {
      if (dir && existsSync(join(dir, 'skills', 'cover', 'SKILL.md'))) return join(dir, 'skills')
    }
    return null
  }
  /** 用户级技能装位(技能管理安装目录=<渠道主目录>/cover-skills;2026-10-31 收紧裁决:
   *  封面专属目录,旧通用装位 skills 由 migrateCoverSkillsHome 幂等迁移)。 */
  const channelSkillsDir = () => {
    const channelHome = process.env.TINTIN_COVER_AGENT_HOME
      || process.env.DSH_HOME
      || join(process.env.USERPROFILE || process.env.HOME || '.', 'Documents', 'tintin-workspace', '.tintin')
    const dir = join(channelHome, 'cover-skills')
    return existsSync(dir) ? dir : null
  }
  /** 解析技能名 → SKILL.md 路径(插件自带优先,其次用户级装位)。
   *  2026-10-30 用户裁决:菜单显示中文名(skill.json name)后,反查必须三层兼容——
   *  目录 id / skill.json 中文名 / SKILL.md frontmatter 名,任一都能命中同一文件夹。 */
  const resolveSkillFile = (name) => {
    const wanted = String(name ?? '').trim()
    if (!wanted || wanted.length > 120) return ''
    for (const dir of [coverSkillDir(), channelSkillsDir()]) {
      if (!dir || !existsSync(dir)) continue
      // ① 目录 id 直配(ASCII 快路径)
      if (/^[A-Za-z0-9._-]{1,80}$/.test(wanted)) {
        const direct = join(dir, wanted, 'SKILL.md')
        if (existsSync(direct)) return direct
      }
      // ② 中文显示名/清单名/frontmatter 名反查
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const folder = join(dir, entry.name)
        const skillMd = join(folder, 'SKILL.md')
        if (!existsSync(skillMd)) continue
        if (entry.name === wanted) return skillMd
        try {
          const manifest = JSON.parse(readFileSync(join(folder, 'skill.json'), 'utf8'))
          if (manifest && typeof manifest.name === 'string' && manifest.name.trim() === wanted) return skillMd
        } catch { /* 无清单: 跳过 */ }
        try {
          const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(skillMd, 'utf8'))?.[1] ?? ''
          const fmName = /^name:\s*(.+)$/m.exec(head)?.[1]?.trim()
          if (fmName === wanted) return skillMd
        } catch { /* 读不了 frontmatter: 跳过 */ }
      }
    }
    return ''
  }

  register('skills', async (req, res) => {
    if (req.method !== 'GET' || !guard(req, res, false)) return
    const openfilm = []
    const seen = new Set()
    for (const [dir, source] of [[coverSkillDir(), 'project'], [channelSkillsDir(), 'user']]) {
      if (!dir || !existsSync(dir)) continue
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || seen.has(entry.name)) continue
        const skillFile = join(dir, entry.name, 'SKILL.md')
        if (!existsSync(skillFile)) continue
        seen.add(entry.name)
        const text = readFileSync(skillFile, 'utf8')
        const nameMatch = /^name:\s*(.+)$/m.exec(text)
        const descMatch = /^description:\s*(.+)$/m.exec(text)
        /* 显示名(2026-10-30 用户裁决):技能包自带的 skill.json name=服务端注册表中文名
           (TinTin 生成图片 等),优先于 SKILL.md 的英文 id;注入/反查由 resolveSkillFile
           三层兼容兜底,菜单选中/发送链不受影响。 */
        let displayName = nameMatch ? nameMatch[1].trim() : entry.name
        try {
          const manifest = JSON.parse(readFileSync(join(dir, entry.name, 'skill.json'), 'utf8'))
          if (manifest && typeof manifest.name === 'string' && manifest.name.trim()) displayName = manifest.name.trim()
        } catch { /* 无清单: 用 frontmatter 名 */ }
        openfilm.push({
          name: displayName,
          description: descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, '') : '',
          source, folder: join(dir, entry.name), scripts: [],
        })
      }
    }
    // 兜底(2026-10-28):插件 skills 目录缺失/未同步时,内置一条 cover 技能——/ 菜单永不空
    if (openfilm.length === 0) {
      openfilm.push({
        name: 'cover',
        description: '封面制作技能:comfygen 生成底图与产品图、图层文字改写(cover.props.json)、PhotoCraft 精修、导出 PNG。',
        source: 'project', folder: '', scripts: [],
      })
    }
    sendJson(res, 200, { openfilm, own: { agent: 'deepseek', filtered: false, skills: [] }, mine: '' })
  })

  register('skills-texts', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const names = Array.isArray(p.names) ? p.names.filter((n) => typeof n === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(n)) : []
    const texts = []
    for (const name of names) {
      const file = resolveSkillFile(name)
      if (file) texts.push({ name, text: readFileSync(file, 'utf8') })
    }
    sendJson(res, 200, texts)
  })

  // ── 图层文件清单(@ 菜单/素材面板数据源:cover 目录 + 插件 public/,图片优先) ──
  // project 参数(2026-10-31 用户报障「导入成功却不显示」):素材条跟激活 tab 走 ——
  // 显式列 projects/<project>(裸目录名防穿越);缺省仍=指针项目。
  register('files', async (req, res) => {
    if (req.method !== 'GET' || !guard(req, res, false)) return
    const dir = await coverDir()
    const qProject = String(new URL(req.url, 'http://localhost').searchParams.get('project') || '').trim()
    let listDir = dir
    if (qProject && !/[\\/]/.test(qProject) && qProject !== '.' && qProject !== '..') {
      const candidate = join(dir, '..', 'projects', qProject)
      if (existsSync(candidate)) listDir = candidate
    }
    const files = []
    const push = (root, prefix, rel, size) => {
      const ext = rel.split('.').pop()?.toLowerCase() ?? ''
      files.push({ path: prefix + rel, kind: ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? 'image' : 'file', size })
    }
    const walk = (root, prefix, depth) => {
      let entries
      try { entries = readdirSync(root, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const rel = prefix + entry.name
        if (entry.isDirectory()) {
          if (depth > 0) walk(join(root, entry.name), `${rel}/`, depth - 1)
          continue
        }
        let size = 0
        try { size = statSync(join(root, entry.name)).size } catch { /* 忽略 */ }
        push(root, '', rel, size)
      }
    }
    walk(listDir, '', 2)
    // 插件 public/(模板自带/上传/领养素材;与 cover 目录同名时 cover 目录优先)
    const pluginDir = resolvePluginDir()
    if (pluginDir) {
      const pub = join(pluginDir, 'public')
      const known = new Set(files.map((f) => f.path))
      let entries
      try { entries = readdirSync(pub, { withFileTypes: true }) } catch { entries = [] }
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith('.')) continue
        if (known.has(entry.name)) continue
        let size = 0
        try { size = statSync(join(pub, entry.name)).size } catch { /* 忽略 */ }
        push(pub, 'public/', entry.name, size)
      }
    }
    files.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'image' ? -1 : 1))
    sendJson(res, 200, { files })
  })

  // ── 素材预览(素材面板缩略图;cover 目录优先,回退插件 public/) ─────────────
  register('asset', async (req, res) => {
    if (req.method !== 'GET' || !isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'Request rejected.' })
      return
    }
    const raw = String(new URL(req.url, 'http://localhost').searchParams.get('name') || '')
    const name = raw.replace(/^public\//, '')
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name) || !/\.(jpe?g|png|webp)$/i.test(name)) {
      sendJson(res, 400, { ok: false, error: '素材名不合法' })
      return
    }
    const dir = await coverDir()
    const pluginDir = resolvePluginDir()
    for (const file of [join(dir, name), pluginDir ? join(pluginDir, 'public', name) : '']) {
      if (file && existsSync(file) && statSync(file).isFile()) {
        const ext = name.split('.').pop()?.toLowerCase() ?? 'png'
        res.writeHead(200, { 'content-type': ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', 'cache-control': 'no-store' })
        res.end(readFileSync(file))
        return
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('asset not found')
  })

  // ── 素材同步(cover 目录图片→插件三写位;建自定义图层前必须,staticFile 才解析得到) ──
  register('asset-sync', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const name = String(p.name || '')
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name) || !/\.(jpe?g|png|webp)$/i.test(name)) {
      sendJson(res, 400, { ok: false, error: '素材名不合法' })
      return
    }
    const dir = await coverDir()
    const src = join(dir, name)
    if (!existsSync(src) || !statSync(src).isFile()) { sendJson(res, 404, { ok: false, error: `cover 目录无此素材:${name}` }); return }
    const pluginDir = resolvePluginDir()
    if (!pluginDir) { sendJson(res, 500, { ok: false, error: '封面插件目录不存在' }); return }
    const { writeCoverAsset } = await import('./cover-asset.js')
    writeCoverAsset(pluginDir, name, readFileSync(src))
    sendJson(res, 200, { ok: true, name })
  })

  // ── props 对流(编辑器写 origin:'editor';agent 写 origin:'agent') ──────
  register('props', async (req, res) => {
    const dir = await coverDir()
    if (req.method === 'GET') {
      if (!guard(req, res, false)) return
      const { ensureCoverAssets } = await import('./cover-asset.js')
      const pluginDir = resolvePluginDir()
      const record = readCoverPropsRecord(dir)
      if (record && pluginDir) {
        /* agent 生成图先落 cover 目录;进画布前收进素材三写位 */
        try { ensureCoverAssets(pluginDir, dir, record.props ?? {}) } catch { /* 收纳失败不阻断读取 */ }
      }
      sendJson(res, 200, { ok: true, record })
      return
    }
    if (req.method !== 'POST' || !guard(req, res, true)) return
    try {
      const p = await readBodyJson(req)
      if (!p || typeof p.templateId !== 'string' || typeof p.props !== 'object' || p.props === null) {
        sendJson(res, 400, { ok: false, error: 'props 记录形状不对(需 templateId + props)' })
        return
      }
      writeCoverPropsRecord(dir, { templateId: p.templateId, props: p.props, hiddenLayers: Array.isArray(p.hiddenLayers) ? p.hiddenLayers : [] }, 'editor')
      sendJson(res, 200, { ok: true })
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // ── 在线素材(2026-10-28 用户裁决:封面会话里只有图片,不要视频/音频) ──────
  // 服务端契约与影片素材库同源(/material/list|thumbnail|serve, 见 main-hook openfilm:library:*),
  // media_type 钉死 image;文件名再过滤一道(服务端 media_type 缺失时不误出视频/音频)。
  const VIDEO_AUDIO_RE = /\.(mp4|mov|avi|mkv|webm|mp3|wav|flac|aac|m4a|ogg)$/i

  register('library', async (req, res) => {
    if (req.method !== 'GET' || !guard(req, res, false)) return
    const query = new URL(req.url, 'http://localhost')
    const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
    if (!serverUrl) { sendJson(res, 200, { ok: false, error: '服务端未配置' }); return }
    const url = new URL(serverUrl + '/material/list')
    url.searchParams.set('page', String(Number(query.searchParams.get('page')) || 1))
    url.searchParams.set('size', String(Number(query.searchParams.get('size')) || 24))
    url.searchParams.set('media_type', 'image')
    const search = String(query.searchParams.get('search') || '').trim()
    if (search) url.searchParams.set('search', search)
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const body = await response.json()
    const raw = Array.isArray(body?.items) ? body.items : Array.isArray(body?.data?.items) ? body.data.items : []
    const items = raw.filter((item) => {
      const name = String(item?.filename || item?.name || '')
      return !VIDEO_AUDIO_RE.test(name)
    })
    sendJson(res, 200, { ok: true, serverUrl, items })
  })

  register('library-thumb', async (req, res) => {
    if (req.method !== 'GET' || !isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'Request rejected.' })
      return
    }
    const id = String(new URL(req.url, 'http://localhost').searchParams.get('material_id') || '')
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) { sendJson(res, 400, { ok: false, error: 'material_id 不合法' }); return }
    const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
    if (!serverUrl) { res.writeHead(404); res.end('no server'); return }
    const upstream = await fetch(`${serverUrl}/material/thumbnail?material_id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) })
    if (!upstream.ok) { res.writeHead(404); res.end('no thumb'); return }
    res.writeHead(200, { 'content-type': upstream.headers['content-type'] || 'image/jpeg', 'cache-control': 'no-store' })
    res.end(Buffer.from(await upstream.arrayBuffer()))
  })

  register('library-adopt', async (req, res) => {
    if (req.method !== 'POST' || !guard(req, res, true)) return
    const p = await readBodyJson(req)
    const id = String(p.materialId ?? '')
    const filename = String(p.filename || `material-${id}`).replace(/[/:*?"<>|]/g, '-').slice(0, 100)
    if (!id || !/^[A-Za-z0-9._-]{1,120}$/.test(id)) { sendJson(res, 400, { ok: false, error: 'materialId 不合法' }); return }
    const extMatch = filename.match(/\.(jpe?g|png|webp)$/i)
    if (!extMatch) { sendJson(res, 400, { ok: false, error: '只收图片素材(jpg/png/webp)' }); return }
    const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
    if (!serverUrl) { sendJson(res, 500, { ok: false, error: '服务端未配置' }); return }
    const upstream = await fetch(`${serverUrl}/material/serve?material_id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(120_000) })
    if (!upstream.ok) { sendJson(res, 500, { ok: false, error: `素材下载失败 HTTP ${upstream.status}` }); return }
    const bytes = Buffer.from(await upstream.arrayBuffer())
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) { sendJson(res, 500, { ok: false, error: `素材大小异常(${bytes.length}B)` }); return }
    const dir = await coverDir()
    const name = `lib-${id}-${Date.now()}${extMatch[0].toLowerCase()}`
    // 落两处:cover 工作目录(agent cwd,@ 引用/agent 直读)+ 插件素材三写位(编辑器预览/导出)
    writeFileSync(join(dir, name), bytes)
    try {
      const { writeCoverAsset } = await import('./cover-asset.js')
      const pluginDir = resolvePluginDir()
      if (pluginDir) writeCoverAsset(pluginDir, name, bytes)
    } catch { /* 三写失败不阻断;cover 目录里已有 */ }
    try {
      const { appendAssetProvenance } = await import('./cover-provenance.js')
      appendAssetProvenance(resolvePluginDir(), { name, source: 'library', ts: Date.now(), materialId: id, filename })
    } catch { /* 留痕失败不影响产物 */ }
    sendJson(res, 200, { ok: true, name, path: join(dir, name) })
  })

  // ── 选择产品(2026-10-29 用户要求:视频剪辑会话的选择产品移植 — 按钮弹窗+资料注入) ──
  // 代理服务端 /api/product-library/*(与 film 的 openfilm:products 主进程代理同源同形状)
  register('products', async (req, res) => {
    if (req.method !== 'GET' || !isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'Request rejected.' })
      return
    }
    const params = new URL(req.url, 'http://localhost').searchParams
    const q = String(params.get('q') || '').slice(0, 120)
    const limit = String(Number(params.get('limit')) || 50)
    const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
    if (!serverUrl) { sendJson(res, 200, { error: '服务端未配置' }); return }
    const url = new URL(serverUrl + '/api/product-library/search')
    url.searchParams.set('q', q)
    url.searchParams.set('limit', limit)
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    sendJson(res, upstream.ok ? 200 : 502, await upstream.json())
  })

  register('products-detail', async (req, res) => {
    if (req.method !== 'GET' || !isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'Request rejected.' })
      return
    }
    const id = String(new URL(req.url, 'http://localhost').searchParams.get('id') || '')
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) { sendJson(res, 400, { error: 'id 不合法' }); return }
    const serverUrl = String(getServerUrl() || '').replace(/\/+$/, '')
    if (!serverUrl) { sendJson(res, 200, { error: '服务端未配置' }); return }
    const upstream = await fetch(`${serverUrl}/api/product-library/items/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) })
    sendJson(res, upstream.ok ? 200 : 502, await upstream.json())
  })

  return () => { for (const dispose of disposes) { try { dispose() } catch { /* ignore */ } } }
}
