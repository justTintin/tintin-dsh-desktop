/** electron-builder afterPack 钩子(--dir 与 --win nsis 共用):装配完成、NSIS 压缩
 *  之前执行封面载荷完成性补齐+校验。一处门禁,所有打包产物(目录/安装包/发布链)
 *  同一保证——缺浏览器/渲染库直接失败,不产出缺功能的包(1113 用户裁决)。 */
const { completeCoverPayload } = require('./payload-complete.cjs')
const { dirname, join } = require('node:path')

const { existsSync, rmSync } = require('node:fs')

module.exports = async function afterPack(context) {
  const packageRoot = join(dirname(__dirname))
  const result = completeCoverPayload({ appOutDir: context.appOutDir, packageRoot })
  console.log(`[payload-complete] 插件生产 node_modules 就绪${result.copied ? '(已补拷)' : '(本已完整)'}: ${result.pluginsDir}`)

  /* lite 包载荷清理(2026-11-16 用户裁决): .tintin-lite 标记在 = 精简包。
     electron-builder 从工作区提升树自行收集这两件, staging 剔除无效——
     只能在载荷级删: libreoffice-kit arm64(x64 包白背 172MB)、
     cover-plugin/.tmp(stage 冒烟残渣泄漏 55MB)。full 包无标记, 原样保留。 */
  const appOutDir = context.appOutDir
  const liteMarker = join(appOutDir, 'resources', 'cover-plugin', '.tintin-lite')
  if (existsSync(liteMarker)) {
    const loArm = join(appOutDir, 'resources', 'app', 'node_modules', '@deepseek-ai', 'libreoffice-kit-win32-arm64')
    if (existsSync(loArm)) { rmSync(loArm, { recursive: true, force: true }); console.log('[lite] 载荷剔除: libreoffice-kit-win32-arm64') }
    const tmpDir = join(appOutDir, 'resources', 'app', 'node_modules', 'dsh-tintin-cover-plugin', '.tmp')
    if (existsSync(tmpDir)) { rmSync(tmpDir, { recursive: true, force: true }); console.log('[lite] 载荷剔除: cover-plugin/.tmp') }
  }
}
