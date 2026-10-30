// stage.mjs — 封面插件生产载荷一键构建+同步(2026-10-27,消灭手工三步+相对路径陷阱)。
// 做什么:
//   1) build:bundle + build:engine + build:editor(插件 dist 三件套)
//      + chat-shell 构建(2026-10-28 会话页:官方聊天组件独立成页,构建隔离裁决)
//   2) 清空并同步 dist/、public/、chat-shell/dist/ → <repo>/dsh-plugin-desktop-tintin/tintin-resources/cover-plugin/
//   3) staging 内 npm install --omit=dev(生产 node_modules;保留 .remotion 浏览器缓存不被清)
//   4) --smoke 时以 staging engine 渲染一张竖版冒烟(同时校验打包形态可渲染)
// 用法:node scripts/stage.mjs [--smoke]
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(fileURLToPath(import.meta.url), '..', '..')
const staging = join(pluginRoot, '..', 'dsh-plugin-desktop-tintin', 'tintin-resources', 'cover-plugin')
const chatShell = join(pluginRoot, 'chat-shell')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (args, opts = {}) => {
  const r = spawnSync(npm, args, { cwd: pluginRoot, stdio: 'inherit', shell: true, ...opts })
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} 失败(${r.status})`)
}
const smoke = process.argv.includes('--smoke')

console.log('[stage] 1/3 构建三件套…')
run(['run', 'build:bundle'])
run(['run', 'build:engine'])
run(['run', 'build:editor'])
console.log('[stage] 1b/3 构建会话页(chat-shell)…')
{
  const r = spawnSync(process.execPath, [join(chatShell, 'build.mjs')], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`chat-shell 构建失败(${r.status})`)
}

console.log('[stage] 2/3 同步到', staging)
if (!existsSync(join(pluginRoot, 'dist', 'engine.mjs'))) throw new Error('engine.mjs 缺失')
if (!existsSync(join(chatShell, 'dist', 'cover-chat.html'))) throw new Error('chat-shell/dist/cover-chat.html 缺失')
mkdirSync(staging, { recursive: true })
// dist/public/chat-shell 全量替换(绝对路径,防相对路径陷阱);node_modules 与 .remotion 不动
rmSync(join(staging, 'dist'), { recursive: true, force: true })
rmSync(join(staging, 'public'), { recursive: true, force: true })
rmSync(join(staging, 'chat-shell'), { recursive: true, force: true })
cpSync(join(pluginRoot, 'dist'), join(staging, 'dist'), { recursive: true })
cpSync(join(pluginRoot, 'public'), join(staging, 'public'), { recursive: true })
cpSync(join(chatShell, 'dist'), join(staging, 'chat-shell', 'dist'), { recursive: true })
// skills 同步(/acp/skills 技能清单的数据源;漏同步 = 打包版 / 菜单空)
if (existsSync(join(pluginRoot, 'skills'))) cpSync(join(pluginRoot, 'skills'), join(staging, 'skills'), { recursive: true })
cpSync(join(pluginRoot, 'package.json'), join(staging, 'package.json'))

console.log('[stage] 3/3 staging 生产依赖…')
const inst = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: staging, stdio: 'inherit', shell: true })
if (inst.status !== 0) throw new Error(`staging npm install 失败(${inst.status})`)

if (smoke) {
  const outDir = mkdtempSync(join(tmpdir(), 'cover-stage-smoke-'))
  const propsFile = join(outDir, 'props.json')
  writeFileSync(propsFile, JSON.stringify({
    hookLines: ['竖版', '冒烟测试'],
    subTag: 'stage',
    brand: 'tintin',
    image: 'mouse.jpg',
  }))
  const r = spawnSync(process.execPath, ['dist/engine.mjs', 'video-portrait', `@${propsFile}`, 'stage-smoke.png'], {
    cwd: staging, stdio: 'inherit', env: { ...process.env, TINTIN_COVER_DIR: outDir },
  })
  const produced = existsSync(join(outDir, 'stage-smoke.png'))
  if (r.status !== 0 || !produced) throw new Error('staging 冒烟渲染失败')
  console.log('[stage] 冒烟 ✓', join(outDir, 'stage-smoke.png'))
}
console.log('[stage] 完成:staging 已就绪(打包链 extraResources 会带走)')
