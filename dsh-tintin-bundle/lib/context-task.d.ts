export interface ContextTaskApiDeps {
  resolveWorkspaceDir?: () => string
  log?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

/** 创建 context:writeTask 通道（上下文条 → 工作区 task.json，WP-5b） */
export function createContextTaskApi(deps?: ContextTaskApiDeps): {
  'context:writeTask': (args: unknown[]) => { ok?: boolean; path?: string; error?: string }
}

/** 工作区目录派生（TINTIN_WORKSPACE_DIR 可覆盖；默认 Documents\tintin-workspace） */
export function defaultWorkspaceDir(env?: NodeJS.ProcessEnv): string
