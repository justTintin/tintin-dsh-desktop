// machine-id-store — machine_id 的持久化 store 适配(2026-10-26 链路修复)。
// 背景: resolveMachineIdSync() 此前无 store, 每个 HTTP 请求都重跑 reg query +
// 网卡枚举, 且 mac 取「第一个非内部网卡」随 VPN/虚拟适配器漂移 → X-Machine-ID
// 不稳定, 服务端 license/限流间歇 401/403。
// 这里以 tintin 自有存储(<DSH_HOME>/tintin/config.json)做 cache-first 持久化:
// 首次派生写回, 之后所有请求与进程重启都用同一值; 再叠一层进程级 memo
// (machine-id.js 的契约: 进程内缓存由调用方做——store 命中也只是省掉 reg query,
// 仍是一次读盘, 解析一次后进程内复用)。
import { mergeTintinConfigStore, readTintinConfigStore } from './tintin-config-store.js'
import { resolveMachineIdSync } from './machine-id.js'

/** 返回进程内复用的 getMachineId(): 派生/读取一次, 持久化到 tintin store。 */
export function createMachineIdResolver() {
  const store = {
    get: (key) => readTintinConfigStore(process.env.DSH_HOME)?.[key],
    set: (key, value) => { mergeTintinConfigStore(process.env.DSH_HOME, { [key]: value }) },
  }
  let memo = null
  return () => {
    if (memo === null) memo = resolveMachineIdSync({ store })
    return memo
  }
}
