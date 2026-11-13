/** 封面插件载荷完成性(2026-11-13 用户裁决「打包应该包括所有的功能,并能正确安装到
 *  不同的设备上」)。electron-builder 收集依赖时把每个包提升到 app 根级、给插件留
 *  **空的**嵌套 node_modules 壳——无主数据目录(.remotion 浏览器缓存=非包下载缓存)
 *  从此永远不被收集,装到任何机器渲染必挂 180s(1112-1113 事故链,详见 doc §7.9)。
 *
 *  本模块是**所有**打包产链(--dir / --win nsis / 未来新增)共用的完成性步骤:
 *  把 staging 的生产 node_modules 整树(stage.mjs 按 lockfile --omit=dev 安装,
 *  .remotion 浏览器缓存+@remotion/renderer 都在内)拷进载荷插件嵌套 node_modules,
 *  并双校验(exe+renderer)——staging 缺货或拷贝失败**抛错=打包失败**,绝不静默
 *  产出缺功能的包。经 electron-builder afterPack 钩子调用(NSIS 压缩前),目录构建
 *  结束后同样直接调用(--dir 无钩子场景)。
 *
 *  可注入 stagingPlugins/distPlugins 供测试。
 */

const { cpSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const EXE_REL = join('chrome-headless-shell', 'win64', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')

/**
 * 补齐并校验封面插件的生产 node_modules。
 * @param {{
 *   appOutDir: string,
 *   packageRoot: string,
 *   stagingPlugins?: string,
 *   distPlugins?: string,
 *   cp?: typeof cpSync,
 *   exists?: typeof existsSync,
 * }} input appOutDir=electron-builder 装配目录(.../win-unpacked);packageRoot=
 * dsh-plugin-desktop-tintin;stagingPlugins/distPlugins=测试注入口。
 * @returns {{copied: boolean, pluginsDir: string}} copied=false=载荷已完整无需拷。
 */
function completeCoverPayload(input) {
  const { appOutDir, packageRoot } = input
  const exists = input.exists ?? existsSync
  const cp = input.cp ?? cpSync
  const stagingPlugins = input.stagingPlugins ?? join(packageRoot, 'tintin-resources', 'cover-plugin', 'node_modules')
  const distPlugins = input.distPlugins ?? join(appOutDir, 'resources', 'app', 'node_modules', 'dsh-tintin-cover-plugin')
  /* stagingPlugins/distPlugins 都是「插件目录」口径;缓存与渲染库住插件目录下的
     node_modules(嵌套树)——拷贝目标与校验基准都必须带 node_modules 段。 */
  const distModules = join(distPlugins, 'node_modules')

  const exeAt = (base) => join(base, '.remotion', EXE_REL)
  const rendererAt = (base) => join(base, '@remotion', 'renderer')
  if (!exists(exeAt(stagingPlugins))) {
    throw new Error('staging 缺 .remotion 浏览器缓存(渲染必需)——先跑 stage.mjs 并保留缓存,再打包')
  }
  if (!exists(rendererAt(stagingPlugins))) {
    throw new Error('staging 缺 @remotion/renderer(引擎渲染必需)——先跑 stage.mjs 重建生产 node_modules')
  }
  const payloadComplete = exists(exeAt(distModules)) && exists(rendererAt(distModules))
  if (!payloadComplete) {
    cp(stagingPlugins, distModules, { recursive: true })
  }
  if (!exists(exeAt(distModules))) {
    throw new Error('载荷浏览器缓存拷贝后仍缺失——检查 dist 载荷目录权限')
  }
  if (!exists(rendererAt(distModules))) {
    throw new Error('载荷 @remotion/renderer 拷贝后仍缺失——检查 dist 载荷目录权限')
  }
  return { copied: !payloadComplete, pluginsDir: distPlugins }
}

module.exports = { completeCoverPayload, EXE_REL }
