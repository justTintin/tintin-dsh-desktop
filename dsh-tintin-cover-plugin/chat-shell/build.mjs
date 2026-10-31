// 封面会话页构建(2026-10-28 用户裁决:源码共享,构建隔离):官方聊天组件树独立成页,
// 产物留在本目录 dist/,由 bundle 的 /tintin/cover/chat 路由伺服(封面插件 extraResources
// 随包带走 chat-shell/dist)。与视频剪辑 shell(openfilm-shell)零构建耦合——
// 双入口实验已裁决回退:rollup 共享 chunk 会重排影片页的模块时序,两个产品必须各建各的。
// 安装走 npm(此目录不在 yarn workspaces 内,依赖版本与官方聊天一致,与桌面包隔离)。
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/* 本环境的系统 TEMP 偶发拒绝 esbuild 清理其临时目录(权限/AV 竞争)—— 构建期改用本地 TEMP。 */
const buildTemp = join(here, '.tmp')
mkdirSync(buildTemp, { recursive: true })
process.env.TEMP = buildTemp
process.env.TMP = buildTemp
const run = (command, args, options = {}) => {
  const res = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (res.status !== 0) {
    console.error(`build: ${command} ${args.join(' ')} failed (${res.status})`)
    process.exit(1)
  }
}

const sources = resolve(here, '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src')
for (const tree of ['openfilm', 'chat', 'shared']) {
  if (!existsSync(join(sources, tree))) {
    console.error(`build: missing vendored sources openfilm-shell-src/${tree} — run fetch-openfilm-shell.mjs first`)
    process.exit(1)
  }
}

if (!existsSync(join(here, 'node_modules'))) {
  console.log('build: installing chat-shell dependencies (pinned to the official chat\'s versions)')
  /* Windows 的 npm 是 .cmd(Node 安全限制:无 shell 拉起 .cmd 报 EINVAL)→ 经 cmd.exe;镜像与 fetch 脚本同源 */
  const npmArgs = ['install', '--no-fund', '--no-audit', '--loglevel=error', '--registry=https://registry.npmmirror.com']
  if (process.platform === 'win32') run('cmd.exe', ['/c', 'npm', ...npmArgs], { cwd: here })
  else run('npm', npmArgs, { cwd: here })
}

console.log('build: vite build (cover chat page)')
/* vendor 树里的源码要解析本工位的依赖(React 19 等版本与桌面包隔离): 在 vendor 根放一个
   node_modules junction 指向本工位依赖(与 openfilm-shell/build.mjs 同法;junction 免管理员权限)。 */
const vendorModules = join(sources, 'node_modules')
if (!existsSync(vendorModules)) {
  if (process.platform === 'win32') symlinkSync(join(here, 'node_modules'), vendorModules, 'junction')
  else symlinkSync(join(here, 'node_modules'), vendorModules, 'dir')
}
run(process.execPath, [join(here, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: here })
console.log(`build: cover chat page ready at ${join(here, 'dist')}`)
