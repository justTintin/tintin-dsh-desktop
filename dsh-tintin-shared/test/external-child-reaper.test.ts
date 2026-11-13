// test/external-child-reaper.test.ts — 外部子进程收割器回归（2026-11-12 用户裁决
// 「退出的时候应该退出」：派生的外部工具在应用退出时整树收割，不再孤儿化钉死
// 构建目录）。kill 动作经 vi.mock 的 spawnSync 断言，不真杀进程。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnSyncMock = vi.hoisted(() => vi.fn(() => ({ status: 0 })))
vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}))

import {
  installReapOnQuit,
  reapExternalChildren,
  registerExternalChild,
  resetReaperForTest,
} from '../lib/external-child-reaper.js'

describe('external-child-reaper(退出即收,2026-11-12 用户裁决)', () => {
  beforeEach(() => {
    resetReaperForTest()
    spawnSyncMock.mockClear()
  })

  it('register 过滤非法 pid（非整数/非正数/非数字）', () => {
    registerExternalChild(0)
    registerExternalChild(-3)
    registerExternalChild(Number.NaN)
    registerExternalChild('abc' as unknown as number)
    reapExternalChildren()
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  it('reap 对每个登记 pid 走 taskkill /T /F（整树+强制）并幂等清登记', () => {
    registerExternalChild(111, 'photocraft')
    registerExternalChild(222, 'studio-server')
    reapExternalChildren()
    const calls = spawnSyncMock.mock.calls.map((c) => c[1] as string[])
    expect(calls).toContainEqual(['/PID', '111', '/T', '/F'])
    expect(calls).toContainEqual(['/PID', '222', '/T', '/F'])
    // 幂等：二次收割不再杀（登记已清）
    reapExternalChildren()
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
  })

  it('killTree 在 win32 之外回退 process.kill（平台口径）', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      registerExternalChild(333, 'gui-tool')
      reapExternalChildren()
      expect(killSpy).toHaveBeenCalledWith(333)
      expect(spawnSyncMock).not.toHaveBeenCalled()
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('installReapOnQuit 幂等：重复安装只挂一次，will-quit 触发收割', () => {
    const listeners = new Map<string, () => void>()
    const appLike = {
      on: (event: string, fn: () => void) => { listeners.set(event, fn) },
    }
    installReapOnQuit(appLike)
    installReapOnQuit(appLike)
    registerExternalChild(444, 'photocraft')
    listeners.get('will-quit')?.()
    expect(spawnSyncMock.mock.calls.map((c) => c[1])).toContainEqual(['/PID', '444', '/T', '/F'])
    // 收割后登记已清：再触发不重复杀
    spawnSyncMock.mockClear()
    listeners.get('will-quit')?.()
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })
})
