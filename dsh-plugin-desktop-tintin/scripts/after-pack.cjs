/** electron-builder afterPack 钩子(--dir 与 --win nsis 共用)。
 *  封面制作删除后只保留 lite 包标记与载荷清理:
 *  DSH_PACKAGE_LITE=1 时把标记直接写进产物 resources/,供 installer.nsh 决定装后下载段;
 *  同时剔除 x64 包永不使用、白背 172MB 的 libreoffice-kit arm64。 */
const { mkdirSync, existsSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir
  const resources = join(appOutDir, 'resources')
  if (process.env.DSH_PACKAGE_LITE !== '1') return

  mkdirSync(resources, { recursive: true })
  writeFileSync(join(resources, '.tintin-lite'), 'lite package: media binaries and OpenFilm runtime download after install\n')

  const loArm = join(resources, 'app', 'node_modules', '@deepseek-ai', 'libreoffice-kit-win32-arm64')
  if (existsSync(loArm)) {
    rmSync(loArm, { recursive: true, force: true })
    console.log('[lite] 载荷剔除: libreoffice-kit-win32-arm64')
  }
}
