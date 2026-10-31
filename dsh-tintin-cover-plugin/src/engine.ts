// 封面渲染引擎(WP-1):{templateId, props} → PNG 落 <客户端默认工作目录>/cover/。
// 铁律 8:独立插件包;与 UI 的接缝只有本模块 + src/registry.ts(WP-1 收尾可整体上提 bundle,调用面不变)。
// 依赖:@remotion/bundler + @remotion/renderer(renderStill;Chromium 随包已裁决——
// renderer 会在首次调用时定位/下载 headless shell,打包核验纳入 check 链)。
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTemplate, listTemplates, validateProps } from './registry.ts'

// 面导出(cover-plugin-route.js 经 dist/engine.mjs 动态加载);目录/渲染函数在下方声明处导出
export { listTemplates }

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Remotion 入口(templates/remotion-entry.tsx)与静态资源目录(public/) */
const entryPoint = join(pluginRoot, 'templates', 'remotion-entry.tsx')
const publicDir = join(pluginRoot, 'public')

/** 客户端默认工作目录口径 = 既有 TINTIN_WORKSPACE_DIR/~/Documents/tintin-workspace(与下载/素材同源) */
export function resolveWorkspaceDir(): string {
  return process.env.TINTIN_WORKSPACE_DIR || join(homedir(), 'Documents', 'tintin-workspace')
}

/** 封面项目制(2026-10-30 用户裁决):一个封面=一个项目=一个目录,
 *  会话随项目绑定(cwd=项目目录)。目录形态=<工作区>/cover/projects/<项目名>/;
 *  当前项目指针=<cover>/current.json;无指针时首访建日期时间空项目。
 *  2026-10-30 二次裁决:**不做旧文件迁移**——旧 cover\ 根目录散文件原地保留
 *  (不删不藏,不进任何项目),素材与项目严格对齐:项目目录里只有本项目自己的文件。
 *  TINTIN_COVER_DIR 覆盖(测试用)时保持旧的单目录行为。 */
const PROJECTS_DIRNAME = 'projects'
const POINTER_FILENAME = 'current.json'

const pad2 = (n: number): string => String(n).padStart(2, '0')
const defaultProjectName = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

/** 项目名清洗:文件系统非法字符与首尾空白;空则回落日期时间默认名 */
export function sanitizeProjectName(raw: string): string {
  const cleaned = String(raw ?? '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60)
  return cleaned || defaultProjectName()
}

function projectsDirOf(root: string): string {
  return join(root, PROJECTS_DIRNAME)
}

function readCurrentProject(root: string, projectsDir: string): string | null {
  try {
    const doc = JSON.parse(readFileSync(join(root, POINTER_FILENAME), 'utf8'))
    const name = typeof doc?.name === 'string' ? doc.name : ''
    if (name && existsSync(join(projectsDir, name))) return name
  } catch { /* 无指针/坏指针: 回落 */ }
  return null
}

/** 当前封面项目目录 = projects/<current.json 指向>;无指针/首访时建日期时间空项目。
 *  不做旧文件迁移(2026-10-30 二次裁决):旧 cover\ 根目录散文件原地保留。 */
export function resolveCoverDir(): string {
  if (process.env.TINTIN_COVER_DIR) return process.env.TINTIN_COVER_DIR
  const root = join(resolveWorkspaceDir(), 'cover')
  const projectsDir = projectsDirOf(root)
  const current = readCurrentProject(root, projectsDir)
  if (current) return join(projectsDir, current)
  try {
    const name = defaultProjectName()
    mkdirSync(join(projectsDir, name), { recursive: true })
    writeFileSync(join(root, POINTER_FILENAME), JSON.stringify({ name }, null, 2), 'utf8')
    return join(projectsDir, name)
  } catch { return root }
}

/** 项目清单(目录名+修改时间,近期在前) */
export function listCoverProjects(): Array<{ name: string; mtimeMs: number }> {
  const root = join(resolveWorkspaceDir(), 'cover')
  const projectsDir = projectsDirOf(root)
  if (!existsSync(projectsDir)) return []
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, mtimeMs: statSync(join(projectsDir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 新建项目(缺省名=日期时间;重名自动加 -2/-3 尾号)并设为当前 */
export function createCoverProject(rawName?: string): { name: string } {
  const root = join(resolveWorkspaceDir(), 'cover')
  const projectsDir = projectsDirOf(root)
  mkdirSync(projectsDir, { recursive: true })
  let name = sanitizeProjectName(rawName || defaultProjectName())
  let unique = name
  for (let i = 2; existsSync(join(projectsDir, unique)); i++) unique = `${name}-${i}`
  mkdirSync(join(projectsDir, unique), { recursive: true })
  writeFileSync(join(root, POINTER_FILENAME), JSON.stringify({ name: unique }, null, 2), 'utf8')
  return { name: unique }
}

/** 切换当前项目(目录必须存在) */
export function switchCoverProject(rawName: string): { name: string } {
  const root = join(resolveWorkspaceDir(), 'cover')
  const name = sanitizeProjectName(rawName)
  const target = join(projectsDirOf(root), name)
  if (!existsSync(target)) throw new Error(`项目不存在: ${name}`)
  writeFileSync(join(root, POINTER_FILENAME), JSON.stringify({ name }, null, 2), 'utf8')
  return { name }
}

/** 重命名项目(目录改名;当前指针同步跟随) */
export function renameCoverProject(from: string, to: string): { name: string } {
  const root = join(resolveWorkspaceDir(), 'cover')
  const projectsDir = projectsDirOf(root)
  const cleanFrom = sanitizeProjectName(from)
  const cleanTo = sanitizeProjectName(to)
  if (cleanFrom === cleanTo) return { name: cleanTo }
  const source = join(projectsDir, cleanFrom)
  const target = join(projectsDir, cleanTo)
  if (!existsSync(source)) throw new Error(`项目不存在: ${cleanFrom}`)
  if (existsSync(target)) throw new Error(`项目名已存在: ${cleanTo}`)
  const wasCurrent = readCurrentProject(root, projectsDir)
  renameSync(source, target)
  if (wasCurrent === cleanFrom) {
    writeFileSync(join(root, POINTER_FILENAME), JSON.stringify({ name: cleanTo }, null, 2), 'utf8')
  }
  return { name: cleanTo }
}

export interface RenderCoverInput {
  templateId: string
  props?: Record<string, unknown>
  /** 输出文件名(不含路径,非法字符自动清洗);缺省 cover-<templateId>-<时间戳>.png */
  fileName?: string
  /** 输出目录覆盖(WP-4 联动:封面落成片旁等场景;缺省 <工作目录>/cover/) */
  outDir?: string
}

export interface RenderCoverResult {
  ok: boolean
  file?: string
  error?: string
}

/** bundle 产物缓存:同入口(按 mtime)进程内只打一次 */
let cachedBundle: { serveUrl: string; key: string } | null = null

function bundleKey(): string {
  try {
    return `${entryPoint}:${statSync(entryPoint).mtimeMs}`
  } catch {
    return `${entryPoint}:missing`
  }
}

/** 渲染总超时兜底(1029 事故:ensureBrowser 静默下载无超时→/api/render 永不应答→UI「渲染中」永挂):
 *  超时后路由必回错误,UI 必有反馈。可用 TINTIN_COVER_RENDER_TIMEOUT_MS 覆盖(测试用)。 */
const RENDER_TIMEOUT_MS = Number(process.env.TINTIN_COVER_RENDER_TIMEOUT_MS) || 90_000

/** 给渲染工作套总超时;超时返回可读错误(底层 Chrome 进程由 Remotion 自理,不强制杀) */
export function withRenderTimeout<T>(work: Promise<T>, ms: number = RENDER_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`渲染超时(${Math.round(ms / 1000)}s)——已停止等待,请重试;反复出现请反馈`)), ms)
    }),
  ])
}

/** 包内 headless 浏览器(打包随插件 node_modules 分发;与 cwd 无关——Remotion 默认按
 *  process.cwd() 向上找缓存,应用内 cwd 解析到不存在路径→明明带着却触发 120MB 下载,1029 事故根因)。
 *  命中返回 exe 绝对路径(传 browserExecutable 即跳过下载判定);缺失返回 null(回退 ensureBrowser)。 */
export function resolveBundledBrowser(): string | null {
  for (const platform of ['win64', 'mac-arm64', 'mac-x64', 'linux64', 'linux-arm64']) {
    const exe = join(pluginRoot, 'node_modules', '.remotion', 'chrome-headless-shell', platform, `chrome-headless-shell-${platform}`,
      platform === 'win64' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
    if (existsSync(exe)) return exe
  }
  return null
}

export async function renderCover(input: RenderCoverInput): Promise<RenderCoverResult> {
  try {
    const check = validateProps(input.templateId, input.props ?? {})
    if (!check.ok) return { ok: false, error: check.error }
    const tpl = getTemplate(input.templateId)

    const outDir = input.outDir && existsSync(input.outDir) ? input.outDir : resolveCoverDir()
    mkdirSync(outDir, { recursive: true })
    const fileName = input.fileName?.replace(/[\\/:*?"<>|]/g, '_') || `cover-${tpl.id}-${Date.now()}.png`
    const outFile = join(outDir, fileName)

    // 静态资源(public/)同步进输出目录旁的 bundle 静态根:staticFile 只认 bundle 的 public/
    const { ensureBrowser, renderStill, selectComposition } = await import('@remotion/renderer')

    const inputProps = { ...check.value }
    // serveUrl 解析:优先预构建 bundle(打包链产物,免运行时 webpack 与 bundler 依赖);
    // 无预构建时(dev)现场 bundle 并进程内缓存(按入口 mtime)。
    const prebuilt = join(pluginRoot, 'dist', 'remotion-bundle')
    let serveUrl: string
    if (existsSync(join(prebuilt, 'index.html'))) {
      serveUrl = prebuilt
    } else {
      const { bundle } = await import('@remotion/bundler')
      const key = bundleKey()
      if (!cachedBundle || cachedBundle.key !== key) {
        const bundled = await bundle({
          entryPoint,
          onProgress: () => { /* 打包进度(编辑器接订阅点) */ },
          webpackOverride: (config) => config,
        })
        cachedBundle = { serveUrl: bundled, key }
      }
      serveUrl = cachedBundle.serveUrl
    }
    // 浏览器钉死(2026-10-29 裁决):优先包内缓存(cwd 无关,传 browserExecutable 即跳过下载判定);
    // 缺失才回退 ensureBrowser 的 cwd 口径(老行为,开发态)。
    const bundled = resolveBundledBrowser()
    if (!bundled) await ensureBrowser()

    // 文档流:selectComposition({serveUrl, id, inputProps}) → renderStill({composition, ...})
    // (selectComposition 的入参字段是 id;实测 4.0.539 对象形态 composition 会丢 props)
    // 全程套总超时:任何环节(下载/启动/渲染)卡死都转为可读错误响应,不再永挂。
    await withRenderTimeout((async () => {
      const composition = await selectComposition({
        serveUrl,
        id: tpl.id,
        inputProps,
        browserExecutable: bundled ?? undefined,
      })
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        frame: 0,
        output: outFile,
        browserExecutable: bundled ?? undefined,
      })
    })())
    // 导出侧车:<产物>.json = props 快照(可复现)+ 素材来源(§七 provenance;
    // bundle 侧 cover-assets.json 由上传/AI 生成通道写入,此处只读摘取)
    try {
      const provenanceFile = join(pluginRoot, 'cover-assets.json')
      let records: Array<{ name: string }> = []
      if (existsSync(provenanceFile)) {
        const data = JSON.parse((await import('node:fs')).readFileSync(provenanceFile, 'utf8')) as { records?: Array<{ name: string }> }
        records = Array.isArray(data?.records) ? data.records : []
      }
      const usedNames = [check.value.image, check.value.bgImage].filter((n): n is string => typeof n === 'string' && !!n)
      const assets = records.filter((r) => usedNames.includes(r.name))
      ;(await import('node:fs')).writeFileSync(`${outFile}.json`, `${JSON.stringify({
        template: tpl.id,
        props: check.value,
        assets,
        exportedAt: new Date().toISOString(),
      }, null, 2)}\n`, 'utf8')
    } catch { /* 侧车失败不影响成品 */ }
    if (existsSync(publicDir)) {
      // public 静态件随图归档(素材可复现;尽力而为,不阻断出图)
      try {
        const { readdirSync, copyFileSync: cp } = await import('node:fs')
        for (const f of readdirSync(publicDir)) {
          const src = join(publicDir, f)
          if (existsSync(src) && f === String(check.value.image ?? check.value.bgImage ?? '')) {
            cp(src, join(outDir, f))
          }
        }
      } catch { /* 归档失败不影响成品 */ }
    }
    return { ok: true, file: outFile }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.message}` : String(err) }
  }
}

// ── 图层底稿(2026-10-27 用户裁决:中间产物 = 图层文件(.pcraft),PNG 只允许最终导出)──

/** Photocraft CLI 定位:env > 通道包 vendored > 打包 resources/photocraft */
export function resolvePhotocraftCli(): string | null {
  for (const dir of [
    process.env.TINTIN_PHOTOCRAFT_DIR,
    join(pluginRoot, '..', 'dsh-plugin-desktop-tintin', 'tintin-resources', 'photocraft'),
    join(pluginRoot, '..', 'photocraft'),
  ]) {
    if (dir && existsSync(join(dir, 'photocraft-cli.exe'))) return join(dir, 'photocraft-cli.exe')
    if (dir && existsSync(join(dir, 'photocraft-cli'))) return join(dir, 'photocraft-cli')
  }
  return null
}

export interface LayeredDraftInput {
  templateId: string
  props?: Record<string, unknown>
  /** 环境底图文件名(插件 public/ 内;comfygen 生成或上传) */
  bgImage?: string
  fileName?: string
}

const str = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v : d)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** 按模板族产出引擎命令序列(图层底稿配方;装饰细节精修期在 PhotoCraft 内调整) */
function draftCommands(family: string, p: Record<string, unknown>, bgAbs?: string): Array<{ command: string; params: Record<string, unknown> }> {
  const cmds: Array<{ command: string; params: Record<string, unknown> }> = []
  if (bgAbs) cmds.push({ command: 'file.placeEmbedded', params: { path: bgAbs } })
  if (family === 'video') {
    cmds.push(
      { command: 'edit.fill', params: { color: [0.027, 0.043, 0.094, 1], target: 'layer' } },
      { command: 'type.create', params: { text: str(p.hookLinesText, '钩子文案'), x: 56, y: 150, size: num(p.titleSize, 110), color: '#ffffff' } },
      { command: 'type.create', params: { text: str(p.subTag, '栏目'), x: 56, y: 48, size: 26, color: '#22d3ee' } },
      { command: 'type.create', params: { text: str(p.brand, '品牌'), x: 56, y: 640, size: 20, color: '#e2e8f0' } },
    )
    return cmds
  }
  if (family === 'product') {
    cmds.push(
      { command: 'edit.fill', params: { color: [0.933, 0.945, 0.969, 1], target: 'layer' } },
      { command: 'type.create', params: { text: str(p.title, '产品名'), x: 84, y: 120, size: num(p.titleSize, 76), color: '#0f172a' } },
      { command: 'type.create', params: { text: str(p.subtitle, '副题'), x: 84, y: 220, size: 28, color: '#475569' } },
      { command: 'type.create', params: { text: str(p.featuresText, '卖点'), x: 84, y: 300, size: 24, color: '#1e293b' } },
      { command: 'type.create', params: { text: str(p.badge, '角标'), x: 84, y: 640, size: 22, color: '#ffffff' } },
    )
    return cmds
  }
  cmds.push(
    { command: 'edit.fill', params: { color: [0.043, 0.063, 0.149, 1], target: 'layer' } },
    { command: 'type.create', params: { text: str(p.title, '标题'), x: 84, y: 240, size: num(p.titleSize, 88), color: '#ffffff' } },
    { command: 'type.create', params: { text: str(p.subtitle, '副标题'), x: 84, y: 360, size: 34, color: '#93c5fd' } },
    { command: 'type.create', params: { text: str(p.badge, '角标'), x: 84, y: 620, size: 22, color: '#bfdbfe' } },
  )
  return cmds
}

/**
 * 构建图层底稿(.pcraft,图层全保留可精修):comfygen 底图置入 + 文字图层重建。
 * 中间交付物;PNG 仅最终导出(exportPngFromDraft)。
 */
export async function buildLayeredDraft(
  input: LayeredDraftInput,
): Promise<{ ok: boolean; file?: string; error?: string }> {
  try {
    const tpl = getTemplate(input.templateId)
    const check = validateProps(input.templateId, input.props ?? {})
    if (!check.ok) return { ok: false, error: check.error }
    const p = check.value
    const cli = resolvePhotocraftCli()
    if (!cli) return { ok: false, error: '未找到 photocraft-cli(vendored tintin-resources/photocraft)' }

    const outDir = resolveCoverDir()
    mkdirSync(outDir, { recursive: true })
    const base = (typeof input.fileName === 'string' && input.fileName.trim()) || `${tpl.id}-draft-${Date.now()}`
    const file = join(outDir, `${base.replace(/[\\/:*?"<>|]/g, '_')}.pcraft`)

    /* 底图解析(2026-10-31 修):素材跟项目后 bgImage 在项目目录,public/ 仅旧素材兜底 */
    let bgAbs: string | undefined
    if (typeof input.bgImage === 'string' && input.bgImage) {
      for (const candidate of [join(outDir, input.bgImage), join(publicDir, input.bgImage)]) {
        if (existsSync(candidate)) { bgAbs = candidate; break }
      }
    }
    const cmds = draftCommands(tpl.family, p, bgAbs)

    const args = ['run', '--new', JSON.stringify({ width: tpl.width, height: tpl.height })]
    for (const c of cmds) args.push('--cmd', c.command, '--params', JSON.stringify(c.params))
    args.push('--out', file)
    const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 300_000, windowsHide: true })
    if (r.status !== 0) return { ok: false, error: `底稿构建失败:${(r.stderr || r.stdout || '').slice(-300)}` }
    return { ok: true, file }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 最终导出:图层底稿(.pcraft)→ 拍平 PNG(唯一允许的 PNG 产出点) */
export async function exportPngFromDraft(
  { pcraftFile, fileName }: { pcraftFile: string; fileName?: string },
): Promise<{ ok: boolean; file?: string; error?: string }> {
  try {
    const cli = resolvePhotocraftCli()
    if (!cli || !existsSync(cli)) return { ok: false, error: '未找到 photocraft-cli' }
    if (!existsSync(pcraftFile)) return { ok: false, error: `底稿不存在:${pcraftFile}` }
    const outDir = resolveCoverDir()
    mkdirSync(outDir, { recursive: true })
    const png = join(outDir, (fileName ?? basename(pcraftFile).replace(/\.pcraft$/i, '')) + '.png')
    const r = spawnSync(cli, ['run', pcraftFile, '--out', png], { encoding: 'utf8', timeout: 300_000, windowsHide: true, cwd: outDir })
    if (r.status !== 0) return { ok: false, error: `导出失败:${(r.stderr || r.stdout || '').slice(-300)}` }
    return { ok: true, file: png }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 直接执行时作为 CLI(node src/engine.ts <templateId> [propsJSON|@props.json] [fileName])——供 WP-5 批量与冒烟
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [, , templateId, propsArg, fileName] = process.argv
  if (!templateId) {
    console.error('用法: node src/engine.ts <templateId> [propsJSON|@props.json] [fileName]')
    process.exit(2)
  }
  let props: RenderCoverInput['props']
  if (propsArg) {
    const raw = propsArg.startsWith('@') ? (await import('node:fs')).readFileSync(propsArg.slice(1), 'utf8') : propsArg
    props = JSON.parse(raw) as RenderCoverInput['props']
  }
  renderCover({ templateId, props, fileName }).then((r) => {
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.ok ? 0 : 1)
  })
}
