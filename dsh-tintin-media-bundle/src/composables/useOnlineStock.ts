// useOnlineStock — 在线免版权素材搜索（POST /material/stock_search）与条目归一化。
// 素材库「在线搜索」与文案混剪「选择素材 → 在线搜索」共用这一份；契约实测
// 响应 {items[{id,type,thumb,url,width,height,duration_sec,author,provider}],page,provider}，
// 无 total——满页才继续翻，空页视为到底。下载走 window.tintin.server.downloadResult。
import { API_PATHS } from '../types/server-api'

export interface OnlineItem {
  id?: string
  type?: string
  thumb?: string
  url?: string
  width?: number
  height?: number
  duration_sec?: number
  author?: string
  provider?: string
}

export interface OnlineStockPage {
  items: OnlineItem[]
  page: number
}

export const ONLINE_STOCK_PER = 30

export function onlineKey(it: OnlineItem): string {
  return String(it.url || it.id || '')
}

export function onlineSafeName(it: OnlineItem): string {
  const raw = String(it.author || it.provider || '')
  const tail = String(it.id || it.url || '').split(/[?&#/]/).filter(Boolean).pop() || 'online'
  return `${raw}-${tail}`.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 80)
}

export async function searchOnlineStock(
  query: string,
  kind: 'video' | 'image',
  page: number,
  per = ONLINE_STOCK_PER,
): Promise<OnlineStockPage> {
  const res = await window.tintin.server.post<{ items?: unknown; page?: number }>(
    API_PATHS.material.stockSearch,
    { query, kind, page, per },
    {},
    60_000,
  )
  if (res === null) throw new Error('服务端不可达')
  if (res && typeof res === 'object' && 'error' in res) throw new Error(String((res as { error: unknown }).error || '搜索失败'))
  const items = Array.isArray(res?.items) ? (res.items as OnlineItem[]) : []
  return { items, page: Number(res?.page) || page }
}

export function onlineToClipUrl(it: OnlineItem): string {
  return String(it.url || '')
}

export function onlineServerPath(it: OnlineItem): string {
  return `stock:${onlineKey(it)}`
}
