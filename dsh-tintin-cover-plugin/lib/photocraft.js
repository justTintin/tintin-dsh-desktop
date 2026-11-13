// photocraft.js — PhotoCraft 集成宿主门(2026-10-27 用户裁决:封面编辑器改用
// PhotoCraft——开源 PS 式 Rust 图像编辑器,500+ 引擎命令,UI/CLI/JSON 控制通道/MCP
// 四通道同引擎;vendored 于 tintin-resources/photocraft,openfilm 同款先例)。
//
// 定位链(2026-11-13 用户裁决「photocraft 是集成到客户端的,与 localprogram 无关」——
// 旧链里的 D:\localprogram 便携版回退是开发机残留,已删除):
//   ①env TINTIN_PHOTOCRAFT_DIR(显式覆盖/测试)
//   ②env TINTIN_RESOURCES_DIR/photocraft
//   ③打包态集成位:<安装>/resources/photocraft——extraResources 把 vendored 拷到资源根,
//     从插件包根(app/node_modules/dsh-tintin-cover-plugin)上溯三级定位,cwd 无关
//   ④开发态:<cwd>/dsh-plugin-desktop-tintin/tintin-resources/photocraft(仓内 vendored)
// 两个可执行:photocraft.exe(原生窗口,--control 起环回控制通道)、photocraft-cli.exe(无头 run/batch/mcp)。
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerExternalChild } from 'dsh-tintin-shared/lib/external-child-reaper.js'

const errText = (e) => (e instanceof Error ? e.message : String(e))

/** 插件包根(lib/photocraft.js → .../node_modules/dsh-tintin-cover-plugin) */
const pluginPkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 目录候选:env 覆盖 > env 资源根 > 打包态集成位 > 开发态仓内 vendored */
export function resolvePhotocraftDir(env = process.env) {
  const candidates = [
    env.TINTIN_PHOTOCRAFT_DIR,
    env.TINTIN_RESOURCES_DIR ? join(env.TINTIN_RESOURCES_DIR, 'photocraft') : null,
    // 打包态集成位:app/node_modules/<pkg> 上溯三级=resources/photocraft(extraResources 落点)
    join(pluginPkgRoot, '..', '..', '..', 'photocraft'),
    join(process.cwd(), 'dsh-plugin-desktop-tintin', 'tintin-resources', 'photocraft'),
  ].filter(Boolean)
  for (const dir of candidates) {
    if (existsSync(join(dir, 'photocraft-cli.exe')) || existsSync(join(dir, 'photocraft-cli'))) return dir
  }
  return null
}

export function resolveCli(env = process.env) {
  const dir = resolvePhotocraftDir(env)
  if (!dir) return null
  const win = process.platform === 'win32'
  const cli = join(dir, win ? 'photocraft-cli.exe' : 'photocraft-cli')
  return existsSync(cli) ? cli : null
}

export function resolveApp(env = process.env) {
  const dir = resolvePhotocraftDir(env)
  if (!dir) return null
  const win = process.platform === 'win32'
  const app = join(dir, win ? 'photocraft.exe' : 'photocraft')
  return existsSync(app) ? app : null
}

/**
 * 无头执行:photocraft-cli run [--new JSON] [--cmd C --params P]... --out F
 * @returns {{ok, code, stdout, stderr}} — stdout 每行一个命令的 JSON 结果
 */
export function cliRun({ newDoc, cmds = [], out, timeoutMs = 300_000, env = process.env }) {
  const cli = resolveCli(env)
  if (!cli) return { ok: false, code: -1, stdout: '', stderr: '未找到 photocraft-cli(检查 TINTIN_PHOTOCRAFT_DIR)' }
  const args = ['run']
  if (newDoc) args.push('--new', JSON.stringify(newDoc))
  for (const c of cmds) {
    args.push('--cmd', c.command)
    if (c.params !== undefined) args.push('--params', JSON.stringify(c.params))
  }
  if (out) args.push('--out', out)
  const r = spawnSync(cli, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
  return { ok: r.status === 0, code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** 启动 PhotoCraft 原生窗口(带环回控制通道 + token 文件);docPath=随启动打开的文档
 *  (2026-10-31 用户报障「打开后是空的」:GUI 接受文档路径参数,实测 document.inspect 可见全部图层);
 *  返回 {port, tokenFile} */
export function launchApp({ docPath, port = 7878, tokenFile, env = process.env } = {}) {
  const app = resolveApp(env)
  if (!app) return { ok: false, error: '未找到 photocraft.exe' }
  const tf = tokenFile ?? join(env.TINTIN_PHOTOCRAFT_DIR ?? join(homedir(), '.photocraft'), 'control.token')
  mkdirSync(dirname(tf), { recursive: true })
  const args = []
  if (docPath) args.push(docPath)
  args.push('--control', String(port), '--control-token-file', tf)
  const child = spawn(app, args, {
    detached: true, stdio: 'ignore', windowsHide: false,
  })
  child.unref()
  // 退出即收(2026-11-12 用户裁决「退出的时候应该退出」+ 实机实证: detached 孤儿
  // 的工作目录钉死构建目录, releases 旧目录删不掉)——登记进共享收割器, 应用退出
  // 时整树 taskkill; detached 语义保留(不随父进程控制台句柄走)。
  registerExternalChild(child.pid, 'photocraft')
  return { ok: true, port, tokenFile: tf, pid: child.pid }
}

/** 控制通道默认位(与 launchApp 写入一致) */
export function controlTarget(env = process.env) {
  const port = Number(env.TINTIN_PHOTOCRAFT_PORT || 7878)
  const tokenFile = env.TINTIN_PHOTOCRAFT_CONTROL_FILE || join(env.TINTIN_PHOTOCRAFT_DIR ?? join(homedir(), '.photocraft'), 'control.token')
  return { port, tokenFile }
}

/**
 * 环回控制通道客户端(协议:docs/control-protocol.md)。
 * 连接 → 首帧 auth(token) → 暴露 request(method, params)。
 * 每次调用新建连接(环回开销可忽略;常驻桥接走官方 `photocraft-cli mcp --bridge`)。
 */
export function connectControl({ port, tokenFile, timeoutMs = 30_000 } = {}) {
  const target = controlTarget()
  const usePort = port ?? target.port
  const useTokenFile = tokenFile ?? target.tokenFile
  return new Promise((resolvePromise) => {
    let token = ''
    try { token = readFileSync(useTokenFile, 'utf8').trim() } catch { /* 缺失按空 */ }
    if (!/^[0-9a-fA-F]{64}$/.test(token)) {
      resolvePromise({ ok: false, error: `控制令牌缺失/非法:${useTokenFile}(先「启动 PhotoCraft」)` })
      return
    }
    const socket = net.createConnection({ host: '127.0.0.1', port: usePort })
    let buffer = ''
    let ready = false
    const pending = new Map()
    let nextId = 1
    const finish = (fn, error) => {
      try { socket.destroy() } catch { /* ignore */ }
      resolvePromise(fn ? { ok: true, request } : { ok: false, error })
    }
    const fail = (error) => finish(null, error)
    socket.setTimeout(timeoutMs, () => fail(`控制通道超时(${Math.round(timeoutMs / 1000)}s)——窗口可能被遮挡/休眠`))
    socket.on('error', (e) => fail(`PhotoCraft 控制通道未就绪:${errText(e)}(先「启动 PhotoCraft」)`))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (!line) continue
        let frame
        try { frame = JSON.parse(line) } catch { continue }
        if (!ready) {
          if (!frame.ok) { fail(`鉴权失败:${frame.error || '?'}`); return }
          ready = true
          resolvePromise({
            ok: true,
            request: (m, prm) => new Promise((res) => {
              const id = `r${nextId++}`
              pending.set(id, res)
              socket.write(JSON.stringify({ id, method: m, params: prm ?? {} }) + '\n')
            }),
          })
          continue
        }
        const res = pending.get(frame.id)
        if (res) { pending.delete(frame.id); res(frame) }
      }
    })
    socket.on('connect', () => socket.write(JSON.stringify({ id: 'auth', method: 'auth', params: { token } }) + '\n'))
  })
}
