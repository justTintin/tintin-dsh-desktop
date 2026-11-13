// external-child-reaper.js — 外部子进程收割器（主进程内模块级单例）: 登记应用派生的
// 外部工具进程（photocraft GUI / openfilm studio 服务端等），退出时整树收割。
// (2026-11-12 用户裁决「退出的时候应该退出」+ 实机实证: TinTin_DSH_Release_Builder/
//  releases 里 1106/1110 两个旧构建目录删不掉 = photocraft.exe 与剪映(由服务端派生)
//  孤儿的工作目录钉死在 win-unpacked 里，openfilm node 服务端孤儿还会再生子进程。)
// 口径: 只杀登记过的 pid（我们自己 spawn 的），不做全盘路径扫描——剪映/PhotoCraft
// 也可能是用户自装的，按路径裸杀会误伤（与 main-hook 开机对账的 openfilm-node
// 甄别互补: 那边管崩溃残留，这边管正常退出）。
import { spawnSync } from 'node:child_process'

/** pid → label（登记即活，收割即清） */
const tracked = new Map()

export function registerExternalChild(pid, label = '') {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return
  tracked.set(id, label)
}

function killTree(pid) {
  if (process.platform === 'win32') {
    // /T=整树（服务端再生的子进程/服务端拉起的剪映一并收掉） /F=强制
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    process.kill(pid)
  }
}

/** 同步收割全部登记 pid（幂等）；同步口径与 main-hook teardownStudioSync 一致——
 *  process 'exit'（failLoud 类崩溃路径）阶段也能跑完。 */
export function reapExternalChildren() {
  for (const [pid, label] of tracked) {
    tracked.delete(pid)
    try { killTree(pid) } catch { /* 进程已不在: 无需处理 */ }
    void label
  }
}

let quitHookInstalled = false

/** 幂等挂退出钩子（will-quit 管正常退出，process 'exit' 管崩溃兜底）。 */
export function installReapOnQuit(appLike) {
  if (quitHookInstalled) return
  quitHookInstalled = true
  const reap = () => reapExternalChildren()
  try { appLike?.on?.('will-quit', reap) } catch { /* 无 app 语境（纯单测） */ }
  process.on('exit', reap)
}

/** 测试缝：清登记与钩子态（生产勿用）。 */
export function resetReaperForTest() {
  tracked.clear()
  quitHookInstalled = false
}
