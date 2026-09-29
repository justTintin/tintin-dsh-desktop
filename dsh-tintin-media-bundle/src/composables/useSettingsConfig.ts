// ═══════════════════════════════════════════════════════════════
// useSettingsConfig — 设置页 IPC 配置读写（无状态纯函数工具层）
// 从 Settings.vue 原样迁出（行为不变，IRON-08）；供
// useSettingsGeneral / useAutoListing 共享导入。
// 注意：本模块不持有任何响应式状态，两个业务 composable 之间
// 不允许互相 import 内部状态，共享逻辑只收敛在这里。
// ═══════════════════════════════════════════════════════════════

/** 获取 preload 暴露的 tintin 桥（壳外纯浏览器预览时为 undefined） */
export function getTintin(): any {
  return (window as any).tintin
}

/** 是否具备 env IPC 能力 */
export function hasEnv(): boolean {
  return !!getTintin()?.env
}

/** 是否具备 config IPC 能力 */
export function hasConfig(): boolean {
  return !!getTintin()?.config
}

/** 读 electron-store 配置（无 IPC 返回默认） */
export async function readCfg(key: string, def: string | boolean): Promise<string | boolean> {
  if (!hasConfig()) return def
  try { return (await getTintin().config.get(key)) ?? def } catch (_) { return def }
}

/** 写配置到 electron-store（返回主进程确认结果；无 IPC / 异常 / success:false 均为 false，
 *  调用方可据此判断「是否真的持久化成功」——此前静默吞错导致保存失败仍提示已保存）
 *  2026-08-31 修复：对象值统一在此 JSON 深拷贝为纯对象再 invoke——Vue reactive
 *  Proxy 无法经 IPC 结构化克隆（An object could not be cloned），异常会被下方
 *  catch 静默吞掉且主进程零日志（会话列表持久化三天零 set 的实锤根因）。 */
export async function writeCfg(key: string, val: any): Promise<boolean> {
  if (!hasConfig()) return false
  try {
    const plain = val && typeof val === 'object' ? JSON.parse(JSON.stringify(val)) : val
    return (await getTintin().config.set(key, plain)) === true
  } catch (e) {
    console.warn(`[config] set '${key}' 失败：`, e)
    return false
  }
}

/** 读缓存目录（2026-09-24 用户裁决：恢复原客户端「更改」能力——通用设置·本地配置
 *  卡可改 local.cacheDir，默认本机工作区目录；由宿主 env:cacheDir 解析并保证目录
 *  存在。不缓存：设置卡更改后需立即生效）。返回空串 = 宿主不可达，调用方走各自
 *  的"路径无效"兜底。 */
export async function readCacheDir(): Promise<string> {
  try {
    const res = await getTintin()?.env?.cacheDir?.()
    return String(res?.dir || '')
  } catch (_) {
    return ''
  }
}
