/**
 * 影片智能体 dsh 固化(2026-10-25 用户裁决: 所有打包档位都要把修复打进包):
 * 打包副本的 dsh 构建在 session/prompt 后挂死(原始 ACP 探针实证, 见
 * docs/tintin-openfilm-port.md §16), 用已验证的工作区构建覆盖产物中的
 * @deepseek-ai/dsh/lib —— 随包分发, 可复现。
 *
 * 用法: node scripts/pin-tintin-dsh.mjs
 * 前置: dsh-plugin-desktop-tintin/resources/dsh-cli-lib(已验证构建入库)
 *       + dsh-plugin-desktop-tintin/dist/win-unpacked(打包产物)。
 */
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dsh-plugin-desktop-tintin')
const verifiedLib = join(pluginRoot, 'resources', 'dsh-cli-lib')
const targetLib = join(pluginRoot, 'dist', 'win-unpacked', 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib')

if (!existsSync(join(verifiedLib, 'bin.js'))) {
  throw new Error('已验证 dsh 构建缺失(dsh-plugin-desktop-tintin/resources/dsh-cli-lib/bin.js)——先构建工作区 harness')
}
if (!existsSync(targetLib)) {
  throw new Error('打包产物缺少 @deepseek-ai/dsh/lib——打包步骤异常')
}
rmSync(targetLib, { recursive: true, force: true })
cpSync(verifiedLib, targetLib, { recursive: true })
console.log('[pin-tintin-dsh] 影片智能体 dsh 已固化为已验证构建(resources/dsh-cli-lib)')
