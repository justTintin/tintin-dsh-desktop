// 字体选择(2026-11-02 用户裁决:对齐 PhotoCraft——全量枚举本机已装字体,可搜索,
// 中文名显示,最近使用置顶;另配「字体样式」下拉=字面/字重)。数据源=/tintin/ipc/cover:fonts。
import React from 'react'

export interface FontStyleInfo { name: string; label?: string; weight: number; italic: boolean }
export interface FontFamilyInfo { family: string; local: string; styles: FontStyleInfo[] }

export interface FontChoice { weight?: number; italic?: boolean }

let cache: FontFamilyInfo[] | null = null
let pending: Promise<FontFamilyInfo[]> | null = null
function loadFonts(): Promise<FontFamilyInfo[]> {
  if (cache) return Promise.resolve(cache)
  if (!pending) {
    pending = fetch('/tintin/ipc/cover:fonts')
      .then((r) => r.json())
      .then((j) => {
        const list: FontFamilyInfo[] = Array.isArray(j?.families) ? j.families : []
        cache = list
        return list
      })
      .catch((): FontFamilyInfo[] => { const out = cache ?? []; cache = out; return out })
  }
  return pending
}

const RECENT_KEY = 'tintin.cover.recentFonts'
export function recentFonts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : []
  } catch { return [] }
}
function pushRecent(family: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([family, ...recentFonts().filter((f) => f !== family)].slice(0, 10))) } catch { /* 私有模式等 */ }
}

const box: React.CSSProperties = { flex: 1, minWidth: 0, position: 'relative' }
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#101012', border: '1px solid #444', borderRadius: 6, color: '#e8e8e6', fontSize: 12, padding: '4px 7px', outline: 'none' }
const listStyle: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 1200, maxHeight: 280, overflowY: 'auto',
  background: '#1a1a1e', border: '1px solid #3a3a3e', borderRadius: 8, padding: 4, boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
}
const groupHead: React.CSSProperties = { fontSize: 10, color: '#8b8b88', padding: '5px 7px 2px' }
const rowStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 7px', borderRadius: 6, cursor: 'pointer',
  background: active ? 'rgba(79,124,255,0.18)' : 'transparent',
})

const displayOf = (f: FontFamilyInfo | undefined, fallback: string): string => (f ? (f.local || f.family) : fallback)

function Row({ active, main, sub, onPick }: { active: boolean; main: string; sub: string; onPick: () => void }): React.ReactElement {
  return (
    <div className="tintin-cover-font-row" data-pick={main} onMouseDown={(e) => e.preventDefault()} onClick={onPick} style={rowStyle(active)}>
      <span style={{ fontSize: 12, color: active ? '#cfe0ff' : '#e8e8e6', whiteSpace: 'nowrap' }}>{main}</span>
      <span style={{ fontSize: 10.5, color: '#8b8b88', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
    </div>
  )
}

/** 字体族下拉(可搜索;最近使用置顶;首项「默认」=清空)。value=英文族名,空=模板默认黑体系。 */
export function FontFamilyPicker({ value, onChange }: { value?: string; onChange: (family: string | undefined) => void }): React.ReactElement {
  const [families, setFamilies] = React.useState<FontFamilyInfo[]>(cache ?? [])
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  React.useEffect(() => { void loadFonts().then(setFamilies) }, [])
  const byFamily = React.useMemo(() => new Map(families.map((f) => [f.family, f])), [families])
  const q = query.trim().toLowerCase()
  const hit = (f: FontFamilyInfo): boolean => !q || f.family.toLowerCase().includes(q) || f.local.toLowerCase().includes(q)
  const recents = recentFonts().filter((name) => byFamily.has(name) && hit(byFamily.get(name)!))
  const rest = families.filter((f) => hit(f) && !recents.includes(f.family))
  const current = value ? byFamily.get(value) : undefined
  const close = (): void => { setOpen(false); setQuery('') }
  const pick = (family: string | undefined): void => { if (family) pushRecent(family); onChange(family); close() }
  return (
    <div style={box}>
      <input
        value={open ? query : displayOf(current, value ?? '默认(黑体系)')}
        placeholder="搜索字体…"
        onFocus={(e) => { setOpen(true); setQuery(''); e.currentTarget.select() }}
        onClick={() => { if (!open) { setOpen(true); setQuery('') } }} // 已聚焦时再点=重新展开(否则第二次点击无反应)
        onBlur={() => close()}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
        style={field}
      />
      {open ? (
        <div style={listStyle}>
          {!q ? <Row active={!value} main="默认(黑体系)" sub="模板原字体" onPick={() => pick(undefined)} /> : null}
          {recents.length > 0 ? <div style={groupHead}>最近使用</div> : null}
          {recents.map((name) => {
            const f = byFamily.get(name)!
            return <Row key={`r:${name}`} active={value === name} main={f.local || f.family} sub={f.local ? f.family : ''} onPick={() => pick(name)} />
          })}
          {rest.length > 0 ? <div style={groupHead}>{q ? `搜索结果 ${rest.length}` : '全部字体'}</div> : null}
          {rest.map((f) => <Row key={f.family} active={value === f.family} main={f.local || f.family} sub={f.local ? f.family : ''} onPick={() => pick(f.family)} />)}
          {recents.length === 0 && rest.length === 0 ? <div style={{ ...groupHead, padding: 8 }}>没有匹配的字体</div> : null}
        </div>
      ) : null}
    </div>
  )
}

const styleLabel = (s: FontStyleInfo): string => {
  const base = s.label && s.label !== s.name ? `${s.label} ${s.name}` : s.name
  return `${base}${s.italic ? ' 斜体' : ''} · ${s.weight}`
}

/** 字体样式下拉(该字体的全部字面:常规/粗细/斜体;PhotoCraft Character 面板 Style 对应物)。 */
export function FontStylePicker({ font, weight, italic, onChange }: {
  font: string
  weight?: number
  italic?: boolean
  onChange: (choice: FontChoice | undefined) => void
}): React.ReactElement {
  const [families, setFamilies] = React.useState<FontFamilyInfo[]>(cache ?? [])
  React.useEffect(() => { void loadFonts().then(setFamilies) }, [])
  const styles = families.find((f) => f.family === font)?.styles ?? []
  const current = styles.find((s) => s.weight === weight && s.italic === italic)
  return (
    <select
      value={current ? `${current.weight}:${current.italic ? 1 : 0}` : ''}
      onChange={(e) => {
        const v = e.target.value
        if (!v) { onChange(undefined); return }
        const s = styles.find((x) => `${x.weight}:${x.italic ? 1 : 0}` === v)
        if (s) onChange({ weight: s.weight, italic: s.italic })
      }}
      style={{ flex: 1, minWidth: 0, background: '#101012', border: '1px solid #444', borderRadius: 6, color: '#e8e8e6', fontSize: 12, padding: '4px 6px', outline: 'none' }}
    >
      <option value="">默认字面</option>
      {styles.map((s) => <option key={`${s.weight}:${s.italic ? 1 : 0}`} value={`${s.weight}:${s.italic ? 1 : 0}`}>{styleLabel(s)}</option>)}
    </select>
  )
}
