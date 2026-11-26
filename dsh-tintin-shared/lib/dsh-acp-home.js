/**
 * dsh acp profile 的 home 物化判定(2026-11-24 实测)。
 *
 * dsh 第一次在某个 home 里以 `--profile acp` 启动时,会在该 home 下物化 profiles/acp/
 * (cordis.yml / cordis.patch.yml / package.json / pnpm-workspace.yaml)。**就是这第一次启动**,
 * DeepSeek 官方路由的模型发现跑在凭据服务就绪之前(dsh 内部启动时序:llm-deepseek 用可选注入
 * ctx.get('credentials') 读密钥,未就绪=当作没有密钥,清单只剩默认模型一个);同一 home 从第二次
 * 启动起即报完整目录。dsh 子模块只读,这里不改它 —— 消费方在 home 尚未物化时先做一次丢弃式
 * 预热启动,再拉正式会话(每个 home 只发生一次)。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 该 home 是否已物化过 acp profile。
 * @param {string} dshHome 即将传给 dsh 子进程的 DSH_HOME
 * @returns {boolean}
 */
export function acpProfileMaterialized(dshHome) {
  return existsSync(join(dshHome, 'profiles', 'acp', 'cordis.yml'))
}
