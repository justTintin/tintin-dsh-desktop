// context-task — 会话上下文条 → 工作区 task.json（WP-5b，2026-09-25 用户裁决：
// 不改 dsh 底层，业务上下文经 UI 层注入）。conversation.input.accessory 上下文
// 条选中产品/素材/脚本后调用；agent 用自带 read 工具读取（V10 已实证工作区
// 路径可读写）。渲染层只传条目载荷，路径由宿主派生函数注入（TINTIN_WORKSPACE_DIR
// 可覆盖，与 /tintin/media 白名单根同源同值）。
// 载荷防御解析与 media-bundle contextTaskLogic.sanitizeTaskContext 同步维护
// （条目超限截断、非法降级默认）；写入失败如实返 {error}，不打断会话回路。
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const ITEM_CAP = 200
const arr = (v) => (Array.isArray(v) ? v.filter(isObj).slice(0, ITEM_CAP) : [])

/** 工作区目录派生（TINTIN_WORKSPACE_DIR 可覆盖；默认 Documents\tintin-workspace） */
export function defaultWorkspaceDir(env = process.env) {
  return env.TINTIN_WORKSPACE_DIR
    || join(env.USERPROFILE || env.HOME || '.', 'Documents', 'tintin-workspace')
}

export function createContextTaskApi({ resolveWorkspaceDir, log = () => {}, warn = () => {} } = {}) {
  if (typeof resolveWorkspaceDir !== 'function') throw new Error('createContextTaskApi requires resolveWorkspaceDir')
  return {
    'context:writeTask': (args) => {
      try {
        const payload = args?.[0] ?? {}
        const raw = payload?.task ?? payload
        const task = {
          version: 1,
          updatedAt: new Date().toISOString(),
          product: isObj(raw?.product) ? raw.product : null,
          materials: arr(raw?.materials),
          scripts: arr(raw?.scripts),
          audios: arr(raw?.audios),
        }
        const dir = resolveWorkspaceDir()
        mkdirSync(dir, { recursive: true })
        const file = join(dir, 'task.json')
        writeFileSync(file, JSON.stringify(task, null, 2), 'utf8')
        log('context', 'task.json written:', file)
        return { ok: true, path: file }
      } catch (e) {
        warn('context', 'writeTask failed:', e instanceof Error ? e.message : String(e))
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
