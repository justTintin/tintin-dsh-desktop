// check-handoff — 交付前机械核对门(铁律 20,2026-11-24 用户裁决「每次打包都出现遗漏,到底有没有好的规则」)。
// 把当晚踩过的每类遗漏固化成一道门,一次跑完;任何一项红=不许宣称「修好了/可打包」。
//
// 门清单(每项对应一类真实事故):
//   1. verify-tintin-gate(锚/行数/载荷) —— 运行时字串搬家后锚点没随迁
//   2. verify-desktop-variants(变体白名单)—— 新增 tintin-only 文件没登记(1119/1124 两次同款红)
//   3. preload↔main 通道对账            —— preload 暴露了 invoke 但主进程没注册(反向亦然)
//   4. 外部工具解析器装配审计           —— 有 resolve*Bin 解析器但无 ensure*/装配链(新设备即梦 CLI 全灭)
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const run = (label, command, args) => {
  const res = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
  if (res.status !== 0) {
    failures.push(label)
    const tail = (res.stdout ?? '').split('\n').slice(-6).join('\n')
    console.error(`[handoff] ${label} FAILED (exit ${res.status})\n${tail}`)
  } else {
    console.log(`[handoff] ${label} ok`)
  }
}

/* 1-2: 两道既有门 */
run('verify-tintin-gate', process.execPath, [join(root, 'scripts', 'verify-tintin-gate.mjs')])
run('verify-desktop-variants', process.execPath, [join(root, 'scripts', 'verify-desktop-variants.mjs')])

/* 4: preload↔main 通道对账(逐字面提取,防「暴露了但主进程没注册/注册了没暴露」) */
const preloadSrc = readFileSync(join(root, 'dsh-plugin-desktop-tintin', 'src', 'tintin', 'studio-preload.ts'), 'utf8')
const invoked = new Set([...preloadSrc.matchAll(/(?:agentInvoke|nativeInvoke)\('([^']+)'/g)].map((m) => m[1]))
const handled = new Set()
const mainDir = join(root, 'dsh-plugin-desktop-tintin', 'src', 'tintin')
for (const name of readdirSync(mainDir)) {
  if (!name.endsWith('.ts') || name.endsWith('.d.ts') || name.endsWith('.test.ts')) continue
  const src = readFileSync(join(mainDir, name), 'utf8')
  for (const m of src.matchAll(/ipcMain\.handle\('([^']+)'/g)) handled.add(m[1])
}
for (const channel of invoked) {
  if (!handled.has(channel)) {
    failures.push(`preload 通道 ${channel} 在 studio-preload 暴露了 invoke,但主进程没有对应 ipcMain.handle`)
    console.error(`[handoff] channel-audit: ${channel} invoked but not handled`)
  }
}
for (const channel of handled) {
  if (channel.startsWith('openfilm:') && !invoked.has(channel)) {
    /* 主进程注册但 preload 从不调用的通道:只提示不拦(可能供外部客户端用) */
    console.warn(`[handoff] channel-audit note: ${channel} handled but never invoked in preload`)
  }
}

/* 5: 外部工具解析器装配审计——登记表里每个解析器必须存在配对的装配函数 */
const RESOLVER_TABLE = [
  { file: 'dsh-tintin-shared/lib/dreamina.js', resolver: 'resolveDreaminaBin', provision: 'ensureDreaminaCli' },
]
for (const row of RESOLVER_TABLE) {
  const src = readFileSync(join(root, row.file), 'utf8')
  if (!src.includes(`export function ${row.resolver}`)) failures.push(`${row.file} 缺解析器 ${row.resolver}(登记表与实现不同步)`)
  if (!src.includes(`export async function ${row.provision}`) && !src.includes(`export function ${row.provision}`)) {
    failures.push(`${row.file} 有外部工具解析器 ${row.resolver} 但没有装配函数 ${row.provision}——新设备会"工具不存在"(1124 即梦 CLI 事故同款)`)
    console.error(`[handoff] resolver-audit: ${row.resolver} has no provision fn ${row.provision}`)
  }
}
/* 全库扫描:任何新的 resolve*Bin 解析器都必须登记进上表,否则视为未审计 */
for (const dir of ['dsh-tintin-shared/lib', 'dsh-tintin-bundle/lib']) {
  for (const name of readdirSync(join(root, dir))) {
    if (!name.endsWith('.js') || name.endsWith('.test.js')) continue
    const src = readFileSync(join(root, dir, name), 'utf8')
    for (const m of src.matchAll(/export function (resolve[A-Za-z]*Bin)\(/g)) {
      const registered = RESOLVER_TABLE.some((row) => row.file === `${dir}/${name}` && row.resolver === m[1])
      if (!registered) {
        failures.push(`外部工具解析器 ${m[1]}(${dir}/${name})未登记进 check-handoff 的 RESOLVER_TABLE——先补装配函数再登记`)
        console.error(`[handoff] resolver-audit: unregistered resolver ${m[1]} in ${dir}/${name}`)
      }
    }
  }
}

if (failures.length) {
  console.error(`\ncheck-handoff: FAILED — ${failures.length} 项\n${failures.map((f) => `- ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('check-handoff: 全部核对门通过(载荷/锚行数/变体白名单/通道对账/装配审计)')
