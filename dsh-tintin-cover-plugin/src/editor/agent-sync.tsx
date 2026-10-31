// agent-sync — 封面编辑器↔会话集成(2026-10-31 方案 B;2026-11-01 自 App.tsx 提取付账:千行门禁)。
// pushChatContextNow=会话上下文推送;CoverChatPanel=右栏聊天 iframe 宿主;
// useChatContextPush=编辑器改动推会话(300ms 防抖);useAgentPropsSync=agent 改字回流(2s 轮询,拖动中冻结)。
import React from 'react'
import { getTemplate } from '../registry'
import { useEditor, sanitizeCustomLayers } from './store'
import { chatFrameRef, referableValue } from './ui'


/** 立即推送当前上下文(模块级取 store 快照,供 iframe load 时机与防抖 effect 共用) */
function pushChatContextNow(): void {
  const s = useEditor.getState()
  const tpl = getTemplate(s.templateId)
  const layers = tpl.layerDefs.map((l) => {
    const key = l.propsKey ?? l.id
    return { id: l.id, label: l.label, type: l.type, propsKey: key, value: referableValue(s.props[key]) }
  })
  chatFrameRef.current?.contentWindow?.postMessage(
    { type: 'tintin-cover:context', templateId: s.templateId, orientation: tpl.orientation, layers, size: { w: tpl.width, h: tpl.height } },
    '*',
  )
}

/** 项目切换后的编辑器状态回读(2026-10-30 项目制):套用新项目目录的 props 快照。
 *  新项目尚无 props 文件时**必须重置为模板默认**(空白画布)——直接 return 会让
 *  画布/图层停留在旧项目内容(实撞:切到新建项目画布还是上一张的图)。 */
async function reloadProjectState(): Promise<void> {
  try {
    const r = await fetch('/tintin/cover/api/acp/props').then((x) => x.json())
    const record = r?.record as { templateId?: string; props?: Record<string, unknown>; hiddenLayers?: string[] } | null
    const tid = useEditor.getState().templateId
    if (record && typeof record.templateId === 'string' && record.templateId && record.props && typeof record.props === 'object') {
      if (record.templateId !== tid) useEditor.getState().setTemplate(record.templateId)
      const defaults = getTemplate(useEditor.getState().templateId).defaultProps
      useEditor.setState({
        props: { ...defaults, ...record.props },
        hiddenLayers: Array.isArray(record.hiddenLayers) ? [...record.hiddenLayers] : [],
        selectedLayer: null,
      })
    } else {
      // 新建/空白项目(2026-10-30 用户裁决:画布什么也没有)——模板结构保留但内容
      // 全清空、固定图层全隐藏(图层面板可手动开启),绝不含演示内容
      const t = getTemplate(tid)
      const cleared: Record<string, unknown> = { ...t.defaultProps }
      for (const k of Object.keys(cleared)) {
        const v = cleared[k]
        if (typeof v === 'string') cleared[k] = ''
        else if (Array.isArray(v)) cleared[k] = []
      }
      cleared.customLayers = []
      cleared.layerOrder = t.layerDefs.map((l) => l.id)
      useEditor.setState({ props: cleared, hiddenLayers: t.layerDefs.map((l) => l.id), selectedLayer: null })
    }
  } catch { /* 会话路由未起(旧包) */ }
}

function CoverChatPanel(): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const frame = document.createElement('iframe')
    frame.src = '/tintin/cover/chat'
    frame.title = '封面会话'
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent'
    chatFrameRef.current = frame
    /* 会话页每次(重)加载完成即补推上下文——首推 300ms 防抖常早于 iframe 加载完成,
       消息会丢进未就绪的初始 document(2026-10-28 探针实测:@ 菜单图层组空)。 */
    frame.addEventListener('load', pushChatContextNow)
    hostRef.current?.appendChild(frame)
    return () => {
      frame.removeEventListener('load', pushChatContextNow)
      if (chatFrameRef.current === frame) chatFrameRef.current = null
      frame.remove()
    }
  }, [])
  return <div ref={hostRef} style={{ flex: '1 1 auto', minHeight: 0, width: '100%', display: 'flex' }} />
}

/** 编辑器 → 会话上下文推送(模板/横竖/图层+当前取值;输入即推,300ms 防抖;
    另响应会话页的 context-request 拉取——推送丢进未就绪 iframe 时由 @ 菜单打开时补取) */
function useChatContextPush(): void {
  const templateId = useEditor((s) => s.templateId)
  const props = useEditor((s) => s.props)
  const hiddenLayers = useEditor((s) => s.hiddenLayers)
  React.useEffect(() => {
    const timer = setTimeout(pushChatContextNow, 300)
    const onRequest = (event: MessageEvent): void => {
      const data = event.data as { type?: string } | null
      if (data && data.type === 'tintin-cover:context-request') pushChatContextNow()
    }
    window.addEventListener('message', onRequest)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', onRequest)
    }
  }, [templateId, props, hiddenLayers])
}

/** agent 改字回流:轮询 /acp/props(2s;origin=agent 才套用),编辑器自己的修改
    防抖 600ms 反向推送(origin=editor,agent 的 cover.props.json 即新值)。 */
function useAgentPropsSync(isBusy: () => boolean): void {
  React.useEffect(() => {
    let stop = false
    let lastAgentTs = 0
    let lastOwnWrite = 0
    let pushing = false
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch('/tintin/cover/api/acp/props').then((x) => x.json())
        if (stop) return
        const record = r?.record as { origin?: string; updatedAt?: number; templateId?: string; props?: Record<string, unknown>; hiddenLayers?: string[] } | null
        if (record && record.origin === 'agent' && typeof record.updatedAt === 'number'
          && record.updatedAt > lastAgentTs && record.updatedAt > lastOwnWrite) {
          lastAgentTs = record.updatedAt
          pushing = true
          try {
            if (typeof record.templateId === 'string' && record.templateId && record.templateId !== useEditor.getState().templateId) {
              useEditor.getState().setTemplate(record.templateId)
            }
            // 套用时并入模板默认值:agent 的旧快照缺新图层键(如后加的 subtitle)不致空白(同 setOrientation 合并语义)
            if (record.props && typeof record.props === 'object') {
              // agent 自下载的新图片只落 cover 目录,staticFile 解析不到——先补三写完成再套用,
              // 否则 Img 按 404 渲染且不再重试(2026-10-28 探针实测)
              const custom = Array.isArray(record.props.customLayers) ? record.props.customLayers : []
              const unsynced = custom
                .map((layer) => String(layer?.image ?? ''))
                .filter((image) => image && !image.startsWith('public/'))
              await Promise.all(unsynced.map((image) =>
                fetch('/tintin/cover/api/acp/asset-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: image }) }).catch(() => {}),
              ))
              const defaults = getTemplate(useEditor.getState().templateId).defaultProps
              const merged = { ...defaults, ...record.props }
              // 组归属净化(2026-10-31 阶段2):智能体写的 customLayers[].group 只认图片组槽位
              merged.customLayers = sanitizeCustomLayers(useEditor.getState().templateId, merged.customLayers)
              useEditor.setState({ props: merged })
            }
            if (Array.isArray(record.hiddenLayers)) useEditor.setState({ hiddenLayers: [...record.hiddenLayers] })
          } finally {
            setTimeout(() => { pushing = false }, 650) // 盖过 600ms 推送防抖,防回流打转
          }
        }
      } catch { /* 会话路由未起(旧包) */ }
    }
    const timer = setInterval(() => { void tick() }, 2000)
    void tick()
    let pushTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useEditor.subscribe(() => {
      if (pushing) return
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(() => {
        const s = useEditor.getState()
        lastOwnWrite = Date.now()
        pushing = true
        void fetch('/tintin/cover/api/acp/props', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId: s.templateId, props: s.props, hiddenLayers: s.hiddenLayers }),
        }).catch(() => {}).finally(() => { pushing = false })
      }, 600)
    })
    return () => { stop = true; clearInterval(timer); unsubscribe(); if (pushTimer) clearTimeout(pushTimer) }
  }, [])
}

export { pushChatContextNow, reloadProjectState, CoverChatPanel, useAgentPropsSync, useChatContextPush }
