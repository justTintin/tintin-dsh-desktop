/**
 * Fail packaging when the vendored OpenFilm runtime is incomplete.
 *
 * `tintin-resources/openfilm` and `playwright-browsers` are populated by
 * `yarn workspace dsh-tintin-bundle fetch:openfilm` and are never committed,
 * so a build machine without them silently produced an installer whose
 * OpenFilm entry reported "runtime not installed" at click time.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resources = fileURLToPath(new URL('../tintin-resources/', import.meta.url))
const problems = []

const openfilmCli = join(resources, 'openfilm', 'node_modules', 'openfilm', 'bin', 'openfilm.mjs')
if (!existsSync(openfilmCli)) problems.push(`OpenFilm CLI: ${openfilmCli}`)
if (process.platform === 'win32') {
  const openfilmNode = join(resources, 'openfilm', 'bin', 'node.exe')
  if (!existsSync(openfilmNode)) problems.push(`vendored OpenFilm node: ${openfilmNode}`)
}
const browsers = join(resources, 'playwright-browsers')
if (!existsSync(browsers) || readdirSync(browsers).length === 0) problems.push(`Playwright browsers: ${browsers}`)

/* vendored PhotoCraft(2026-11-10 打包链补登记): exe 双双入库存,extraResources 现已带上——
   缺失时封面顶栏「PhotoCraft 精修」打开即报「未找到 photocraft-cli」。 */
const photocraftCli = join(resources, 'photocraft', 'photocraft-cli.exe')
if (!existsSync(photocraftCli)) problems.push(`vendored PhotoCraft CLI: ${photocraftCli}`)
const photocraftApp = join(resources, 'photocraft', 'photocraft.exe')
if (!existsSync(photocraftApp)) problems.push(`vendored PhotoCraft app: ${photocraftApp}`)

if (problems.length > 0) {
  process.stderr.write('verify-tintin-resources: the OpenFilm runtime is incomplete; packaging would ship a broken entry:\n')
  for (const problem of problems) process.stderr.write(`- ${problem}\n`)
  process.stderr.write('Run: yarn workspace dsh-tintin-bundle fetch:openfilm before packaging.\n')
  process.exitCode = 1
} else {
  process.stdout.write('verify-tintin-resources: OpenFilm runtime and Playwright browsers are packaged\n')
}
