// external-child-reaper.d.ts — 外部子进程收割器（lib/external-child-reaper.js 的类型面）
/** 登记一个应用派生的外部工具 pid（非正整数/非数字忽略）。 */
export declare function registerExternalChild(pid: number, label?: string): void
/** 同步整树收割全部登记 pid（taskkill /T /F；非 win32 回退 process.kill），幂等清登记。 */
export declare function reapExternalChildren(): void
/** 幂等挂退出钩子（will-quit + process 'exit'）；appLike 为最小 Electron App 面
 *  （结构化最小接口，Electron App 的 on 方法型重载天然兼容）。 */
export declare function installReapOnQuit(
  appLike?: {
    on(event: 'will-quit' | 'before-quit', listener: () => void): unknown
  } | null,
): void
/** 测试缝：清登记与钩子态（生产勿用）。 */
export declare function resetReaperForTest(): void
