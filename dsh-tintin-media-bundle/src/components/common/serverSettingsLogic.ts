// serverSettingsLogic — 服务设置弹层纯逻辑（2026-11-14 用户裁决：素材创作/运营
// 工具/媒体工具三面各配独立服务端地址）。三包字节副本（TButton 先例）。
// normalize：trim + 去尾部斜杠；空串合法（=清空、回落全局 server.url）；
// 其余必须是 http(s)://主机[:端口][/路径] 整体形态（主机段后只允许 / 开头的
// 路径，不能夹空白），非法返回 null。
export function normalizeServerUrl(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/u, '')
  if (!s) return ''
  return /^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(s) ? s : null
}

/** config:get 合并视图里取本面地址（缺段/非串=未配置，返回空串）。 */
export function surfaceServerUrl(configValue: unknown, surface: string): string {
  const v = (configValue as Record<string, Record<string, unknown>> | null | undefined)?.[surface]?.serverUrl
  return typeof v === 'string' ? v : ''
}

/** config:get 合并视图里取全局地址（未配置返回空串，仅用于回显提示）。 */
export function globalServerUrl(configValue: unknown): string {
  const v = (configValue as Record<string, Record<string, unknown>> | null | undefined)?.server?.url
  return typeof v === 'string' ? v : ''
}
