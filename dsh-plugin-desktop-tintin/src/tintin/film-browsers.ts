// 影片智能体 Playwright 浏览器——首跑按需下载(2026-11-13 用户裁决方案 A 瘦包):
// 安装包不再内置 690MB 浏览器(chromium + headless shell),升级下载体积直接减半。
// 解析顺序:旧安装包的 resources 副本(升级机器零下载) → 仓库 tintin-resources 副本
// (开发机,fetch:openfilm 已装) → 通道 home 首跑下载(playwright-core CLI,幂等,
// 缺哪版补哪版)。环境变量解析方(main-hook)只认 PLAYWRIGHT_BROWSERS_PATH,
// studio-runtime 等子进程的兜底仅在 env 未设时生效——这里设了就全链生效。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diagnosticLog } from '../developer-logging.ts'
import type { LogFields } from '../diagnostic-record.ts'
import { DESKTOP_PRODUCT_IDENTITY, type DesktopProductIdentity } from '../product-identity.ts'
import { resolveDesktopChannelHome } from '../desktop-channel-home.ts'

/** npmmirror 的 playwright 二进制镜像(1012/1015 阻断先例:主源失败时回退)。 */
const PLAYWRIGHT_FALLBACK_DOWNLOAD_HOST = 'https://cdn.npmmirror.com/binaries/playwright'

/** 旧安装包内置位置(方案 A 之前的安装里存在;新安装包不再带)。 */
export function stagedFilmBrowsersDir(resourcesPath: string = process.resourcesPath ?? ''): string {
  return join(resourcesPath, 'playwright-browsers')
}

/** 开发机 staging(fetch:openfilm 产出的 tintin-resources 副本)。 */
export function devFilmBrowsersDir(moduleUrl: string | URL = import.meta.url): string {
  // 调用方传 import.meta.url(file:// URL)或测试注入的普通路径,两者都收。
  const modulePath = moduleUrl instanceof URL
    ? fileURLToPath(moduleUrl)
    : /^file:\/\//iu.test(moduleUrl)
      ? fileURLToPath(new URL(moduleUrl))
      : moduleUrl
  return resolve(dirname(modulePath), '../../../tintin-resources/playwright-browsers')
}

/** 首跑下载目标(通道 home,与影片智能体数据同盘;升级/卸载不清,装一次管所有版本)。 */
export function runtimeFilmBrowsersDir(
  options: { identity?: DesktopProductIdentity; environment?: NodeJS.ProcessEnv; homeDirectory?: string } = {},
): string {
  return join(
    resolveDesktopChannelHome({
      identity: options.identity ?? DESKTOP_PRODUCT_IDENTITY,
      environment: options.environment ?? process.env,
      homeDirectory: options.homeDirectory ?? homedir(),
    }).homeDir,
    'playwright-browsers',
  )
}

/** 目录非空 = 已有一版浏览器(具体 revision 由 CLI 对着 playwright-core 的清单校验)。 */
function hasBrowsers(directory: string): boolean {
  try {
    return existsSync(directory) && readdirSync(directory).length > 0
  } catch {
    return false
  }
}

/** 解析生效的浏览器目录:staged 优先,否则通道 home(首跑下载落点)。 */
export function resolveFilmBrowsersDir(
  paths: { resourcesPath?: string; moduleUrl?: string | URL; homeDirectory?: string } = {},
): string {
  const staged = stagedFilmBrowsersDir(paths.resourcesPath ?? process.resourcesPath ?? '')
  if (hasBrowsers(staged)) return staged
  const dev = devFilmBrowsersDir(paths.moduleUrl ?? import.meta.url)
  if (hasBrowsers(dev)) return dev
  return runtimeFilmBrowsersDir(paths.homeDirectory === undefined ? {} : { homeDirectory: paths.homeDirectory })
}

/** 打包态 CLI(vendored openfilm 里的 playwright-core)与 dev 态 CLI(仓库 staging)。 */
function cliCandidates(): string[] {
  const candidates = [
    join(process.resourcesPath ?? '', 'openfilm', 'node_modules', 'playwright-core', 'cli.js'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../tintin-resources/openfilm/node_modules/playwright-core/cli.js'),
  ]
  return candidates.filter(candidate => existsSync(candidate))
}

/** 运行 node:优先 vendored openfilm node.exe,退回 Electron 本体(RUN_AS_NODE)。 */
function nodeCommand(): { command: string; runAsNode: boolean } {
  const vendored = join(process.resourcesPath ?? '', 'openfilm', 'bin', 'node.exe')
  if (existsSync(vendored)) return { command: vendored, runAsNode: false }
  return { command: process.execPath, runAsNode: true }
}

function log(event: string, fields: LogFields = {}, level: 'info' | 'error' = 'info'): void {
  diagnosticLog({ source: 'tintin-film-browsers', event, level, developer: false, fields })
}

let ensureTask: Promise<boolean> | undefined

/**
 * 启动期单飞:确保生效目录里有一版匹配当前 playwright-core 的浏览器。
 * 目录已非空(旧安装/上次下载/开发 staging)立即返回;否则跑 CLI 下载(幂等,
 * 主源失败回退 npmmirror 镜像)。应用退出不杀子进程——半截下载留着,下次启动续。
 */
export function ensureFilmBrowsersAsync(): Promise<boolean> {
  ensureTask ??= runEnsure().catch(cause => {
    log('ensure-failed', { error: cause instanceof Error ? cause.message : String(cause) }, 'error')
    ensureTask = undefined
    return false
  })
  return ensureTask
}

async function runEnsure(): Promise<boolean> {
  const directory = resolveFilmBrowsersDir()
  if (hasBrowsers(directory)) {
    log('browsers-present', { directory })
    return true
  }
  const cli = cliCandidates()[0]
  if (cli === undefined) {
    log('cli-missing', { resourcesPath: process.resourcesPath }, 'error')
    return false
  }
  const { command, runAsNode } = nodeCommand()
  mkdirSync(directory, { recursive: true })
  const attempts: Array<Record<string, string>> = [{}, { PLAYWRIGHT_DOWNLOAD_HOST: PLAYWRIGHT_FALLBACK_DOWNLOAD_HOST }]
  log('download-start', { directory, cli, attempts: attempts.length })
  const startedAt = Date.now()
  for (let index = 0; index < attempts.length; index += 1) {
    const exitCode = await runInstall(command, cli, directory, runAsNode, attempts[index]!)
    if (exitCode === 0 && hasBrowsers(directory)) {
      log('download-done', { directory, seconds: Math.round((Date.now() - startedAt) / 1000), attempt: index })
      return true
    }
    log('download-attempt-failed', { attempt: index, exitCode, directory }, 'error')
  }
  return false
}

function runInstall(
  command: string,
  cli: string,
  directory: string,
  runAsNode: boolean,
  extraEnv: Record<string, string>,
): Promise<number> {
  return new Promise((resolvePromise) => {
    let tail = ''
    try {
      const child = spawn(command, [cli, 'install', 'chromium'], {
        cwd: dirname(directory),
        env: {
          ...process.env,
          ...(runAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
          PLAYWRIGHT_BROWSERS_PATH: directory,
          ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const capture = (chunk: Buffer): void => { tail = (tail + String(chunk)).slice(-8_000) }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      child.once('error', cause => {
        log('install-spawn-error', { error: cause instanceof Error ? cause.message : String(cause) }, 'error')
        resolvePromise(-1)
      })
      child.once('exit', code => {
        if (code !== 0) log('install-output-tail', { tail: tail.slice(-1_500) }, 'error')
        resolvePromise(code ?? -1)
      })
    } catch (cause) {
      log('install-throw', { error: cause instanceof Error ? cause.message : String(cause) }, 'error')
      resolvePromise(-1)
    }
  })
}
