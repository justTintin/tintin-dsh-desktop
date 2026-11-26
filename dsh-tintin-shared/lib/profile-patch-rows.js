/**
 * dsh profile patch 的条目提取(2026-11-24,照上游 openfilm 的默认智能体处理方式)。
 *
 * 上游(apps/desktop/src/agents.mjs)把 DeepSeek Harness 当作「用户自己的 dsh」拉起:
 * `dsh --profile acp`,不带补丁,用用户自己的 home —— 登录态/API 密钥/模型配置原样可用,
 * 模型清单=该会话自己报的 configOptions(agent-catalogs.mjs 缓存),没有第二套来源。
 *
 * 客户端「设置→模型」等 Live Config 表单持久在**活动 profile 的用户 patch 层**
 * (`<home>/profiles/desktop/cordis.patch.yml`;harness base cordis.patch.yml:
 * "Live Config forms persist through the active profile patch")。智能体跑的是 `acp`
 * profile,读不到 desktop profile 的这层 —— 这里按 id 把指定条目原文提取出来,由调用方
 * 并进智能体补丁(顶层条目追加=后写覆盖,dsh loader patch 的既定语义)。
 *
 * 形状:顶层 `- ` 开头的条目行开块,更深缩进行归条目体。文本级提取——shared 保持零依赖
 * 叶子;文件缺失/形状不符 = [](调用方跳过,智能体用 dsh 自身默认)。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 顶层条目头:零列 `- key: value`(条目形状是 `- id: <值>`,id 在值的位置)。 */
const ITEM_HEAD = /^- ([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/
/** 条目体内某个配置键的行内值(`    model: deepseek-flash`)。 */
const configValue = (row, key) => {
  const hit = row.split('\n').find((line) => new RegExp(`^\\s+${key}:\\s*(\\S+)\\s*$`).exec(line))
  const match = hit ? new RegExp(`^\\s+${key}:\\s*(\\S+)\\s*$`).exec(hit) : null
  return match ? match[1].replace(/^['"]|['"]$/g, '') : null
}

/**
 * 提取 id 在 ids 内的顶层补丁条目(原文块,含条目头行),按文件顺序。
 * @param {string} sourcePath profile patch 文件路径
 * @param {string[]} ids 要提取的条目 id
 * @returns {string[]} 条目文本块;文件缺失/无匹配 = []。
 */
export function extractPatchRows(sourcePath, ids) {
  let text
  try {
    text = readFileSync(sourcePath, 'utf8')
  } catch {
    return [] // 该 profile 还没有用户 patch 层 = 客户端未自定义
  }
  const wanted = new Set(ids)
  const rows = []
  let current = null
  let currentId = ''
  const flush = () => {
    if (current !== null && wanted.has(currentId)) rows.push(current.join('\n'))
    current = null
    currentId = ''
  }
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) {
      if (current) current.push(line) // 条目体内的空行/注释保真
      continue
    }
    if (line.startsWith('- ')) {
      // 顶层条目头(insert 列表项的 `- id:` 都带缩进,不会误中)
      const head = line.match(ITEM_HEAD)
      flush()
      current = [line]
      currentId = head && head[1] === 'id' ? (head[2] ?? '').trim() : ''
      continue
    }
    if (line.startsWith(' ')) {
      if (!current) return [] // 无条目头的散缩进行:形状不符,放弃提取
      current.push(line)
    }
    // 其余(零缩进非条目行)忽略
  }
  flush()
  return rows
}

/**
 * 客户端(主 home 的 desktop profile)对 DeepSeek 官方路由的配置,供 DeepSeek Harness 智能体跟随:
 * - `defaultModel`:客户端默认模型 —— 取客户端保存的 `agent-default-model`(provider 须是
 *   deepseek-official),没保存过 = dsh 自身默认(harness base cordis.patch.yml 的
 *   agent-default-model: deepseek-flash;与 acp-app 包里给 ACP 钉的旧 id deepseek-v4-flash 不同,
 *   后者不在 dsh 的官方模型目录里)。
 * - `catalogRow`:客户端「设置→模型」自定义过的 DeepSeek 目录/地址(`llm-deepseek` 条目原文),
 *   没自定义过 = null(智能体用 dsh 内置目录)。
 * @param {string} channelHome 通道主 home(= 客户端自己的 DSH_HOME)
 * @param {{ dshDefaultModel?: string }} [options] dsh 自身默认模型
 */
export function readClientDeepseekConfig(channelHome, { dshDefaultModel = 'deepseek-flash' } = {}) {
  const rows = extractPatchRows(join(channelHome, 'profiles', 'desktop', 'cordis.patch.yml'), ['agent-default-model', 'llm-deepseek'])
  const defaultRow = rows.find((row) => /^- id: agent-default-model\s*$/m.exec(row) !== null)
  const savedProvider = defaultRow ? configValue(defaultRow, 'provider') : null
  const savedModel = defaultRow ? configValue(defaultRow, 'model') : null
  return {
    defaultModel: savedProvider === 'deepseek-official' && savedModel ? savedModel : dshDefaultModel,
    catalogRow: rows.find((row) => /^- id: llm-deepseek\s*$/m.exec(row) !== null) ?? null,
  }
}
