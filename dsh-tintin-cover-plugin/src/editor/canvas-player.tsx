// 画布播放器(2026-11-01 用户裁决:画布出错不能一直 ⚠)。Remotion Player 的错误边界一旦触发
// 就永远渲染兜底、不再重试;这里在出错后画面内容(模板+props)再变化时重挂播放器,
// 兜底页给出原因与手动「重新加载画布」。单张图片的问题已在模板层隔离(templates/CoverImg.tsx),
// 走到这里的是模板代码本身的异常(如智能体写坏了文案数组)。
import React from 'react'
import { Player } from '@remotion/player'

function CanvasCrash({ error, onShown, onReload }: { error: Error; onShown: () => void; onReload: () => void }): React.ReactElement {
  // 只在挂载时记一次出错快照:回调每次重渲染都是新闭包,跟着它重跑会把「出错时的内容」覆盖成新内容
  const shownRef = React.useRef(onShown)
  React.useEffect(() => { shownRef.current() }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: '80%', padding: 16, color: '#e8e8e6', fontSize: 13, textAlign: 'center' }}>
      <div style={{ fontWeight: 600 }}>⚠ 画布渲染出错,修改内容后会自动重试</div>
      <div style={{ color: '#8b8b88', fontSize: 11, wordBreak: 'break-all' }}>{error.message}</div>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onReload}
        style={{ background: '#2a2a2e', color: '#e8e8e6', border: '1px solid #444', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
      >重新加载画布</button>
    </div>
  )
}

export function CanvasPlayer({ component, inputProps, width, height, style }: {
  component: React.ComponentType<any>
  inputProps: Record<string, unknown>
  width: number
  height: number
  style?: React.CSSProperties
}): React.ReactElement {
  const [epoch, setEpoch] = React.useState(0)
  const signature = `${component.displayName ?? component.name}|${JSON.stringify(inputProps)}`
  const latest = React.useRef(signature)
  latest.current = signature
  const crashedAt = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (crashedAt.current !== null && crashedAt.current !== signature) {
      crashedAt.current = null
      setEpoch((e) => e + 1)
    }
  }, [signature])
  return (
    <Player
      key={epoch}
      component={component}
      inputProps={inputProps}
      durationInFrames={1}
      compositionWidth={width}
      compositionHeight={height}
      fps={30}
      style={style}
      errorFallback={({ error }) => (
        <CanvasCrash
          error={error}
          onShown={() => { crashedAt.current = latest.current }}
          onReload={() => { crashedAt.current = null; setEpoch((e) => e + 1) }}
        />
      )}
    />
  )
}
