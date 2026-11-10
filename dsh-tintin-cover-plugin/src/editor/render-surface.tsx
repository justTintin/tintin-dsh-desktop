// render-surface — 编辑态自持画布(2026-11-11 WP-A2,用户裁决:编辑态弃 Remotion Player
// 改自持——几何/命中/手柄全归编辑器,操作手感上限;导出仍走 renderStill 同一模板,质量不变)。
// 直接渲染模板组件('remotion' 经 esbuild alias 解析到 remotion-shim,见 remotion-shim.tsx)。
// 错误边界契约移植原 CanvasPlayer: 出错后画面内容(模板+props)变化时自动重挂,
// 兜底页给出原因与手动「重新加载画布」;单图问题已在模板层隔离(templates/CoverImg.tsx)。
import React from 'react'

function SurfaceCrash({ error, onReload }: { error: Error; onReload: () => void }): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: '80%', padding: 16, color: 'var(--text)', fontSize: 13, textAlign: 'center' }}>
      <div style={{ fontWeight: 600 }}>⚠ 画布渲染出错,修改内容后会自动重试</div>
      <div style={{ color: 'var(--text-faint)', fontSize: 11, wordBreak: 'break-all' }}>{error.message}</div>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onReload}
        style={{ background: 'var(--bg-raised)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
      >重新加载画布</button>
    </div>
  )
}

class SurfaceBoundary extends React.Component<
  { children: React.ReactNode; onCrash: (e: Error) => void },
  { error: Error | null }
> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  override componentDidCatch(error: Error): void {
    this.props.onCrash(error)
  }
  override render(): React.ReactNode {
    if (this.state.error) return null // 兜底由外层按 crash 态渲染(出错快照由 onCrash 记录)
    return this.props.children
  }
}

export function RenderSurface({ component: Comp, inputProps, width, height, scale, style }: {
  component: React.ComponentType<any>
  inputProps: Record<string, unknown>
  width: number
  height: number
  /** 容器→合成坐标缩放比(fitScale×zoom;容器与合成同比例,等比缩放) */
  scale: number
  style?: React.CSSProperties
}): React.ReactElement {
  const [crashed, setCrashed] = React.useState<Error | null>(null)
  const [epoch, setEpoch] = React.useState(0)
  const signature = `${Comp.displayName ?? Comp.name}|${JSON.stringify(inputProps)}`
  const latest = React.useRef(signature)
  latest.current = signature
  const crashedAt = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (crashedAt.current !== null && crashedAt.current !== signature) {
      crashedAt.current = null
      setCrashed(null)
      setEpoch((e) => e + 1)
    }
  }, [signature])
  return (
    <div style={style}>
      {crashed ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SurfaceCrash error={crashed} onReload={() => { crashedAt.current = null; setCrashed(null); setEpoch((e) => e + 1) }} />
        </div>
      ) : (
        /* 合成坐标系:模板组件按原生 px 布局,外层等比缩放(变换原点=左上)。
           key=epoch:手动重载/自动重试时整树重建,错误边界状态一并复位。 */
        <SurfaceBoundary key={epoch} onCrash={(e) => { crashedAt.current = latest.current; setCrashed(e) }}>
          <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
            <Comp {...inputProps} />
          </div>
        </SurfaceBoundary>
      )}
    </div>
  )
}
