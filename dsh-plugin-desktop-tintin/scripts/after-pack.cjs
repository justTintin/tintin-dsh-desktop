/** electron-builder afterPack 钩子(--dir 与 --win nsis 共用):装配完成、NSIS 压缩
 *  之前执行封面载荷完成性补齐+校验。一处门禁,所有打包产物(目录/安装包/发布链)
 *  同一保证——缺浏览器/渲染库直接失败,不产出缺功能的包(1113 用户裁决)。 */
const { completeCoverPayload } = require('./payload-complete.cjs')
const { dirname, join } = require('node:path')

module.exports = async function afterPack(context) {
  const packageRoot = join(dirname(__dirname))
  const result = completeCoverPayload({ appOutDir: context.appOutDir, packageRoot })
  console.log(`[payload-complete] 插件生产 node_modules 就绪${result.copied ? '(已补拷)' : '(本已完整)'}: ${result.pluginsDir}`)
}
