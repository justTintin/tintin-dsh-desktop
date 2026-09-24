// Executes at script-eval time — every module factory (including
// tintin-media-bundle's window.__tintinViews registration) runs only after
// ALL bootstrap scripts' top levels, so installing the chrome and polyfill
// here is deterministic; apply()-time installation raced that registration
// and lost non-deterministically (observed dev17 ok / dev18 missing).
const tintinClient = (() => {
    // ── TinTin 顶部 Tab 栏 + 视图切换（2026-09-23 用户实测修正）─────────────
    // 原 conversation.session.header.actions 挂法有三个缺陷：仅会话内存在、
    // 靠右不居中、点击只弹小面板不切换视图。改为常驻居中 Tab 栏 + 主区视图
    // 覆盖层：工作台=harness 会话原生视图；运营/媒体=覆盖层内由视图提供方
    // （window.__tintinViews 注册，media-bundle 挂 Vue 子应用）渲染。
    function installTintinChrome() {
      if (document.getElementById('tintin-top-tabs')) return
      const BAR_H = '38px'
      const VIEWS = [
        { id: 'workbench', label: '工作台' },
        { id: 'ops', label: '运营工具' },
        { id: 'media', label: '媒体工具' },
      ]
      const providers = new Map()
      let activeId = 'workbench'
      let mountedProvider = null

      window.__tintinViews = {
        register(id, provider) {
          providers.set(id, provider)
          if (activeId === id) mountActive()
        },
        unregister(id) { providers.delete(id) },
      }

      const bar = document.createElement('div')
      bar.id = 'tintin-top-tabs'
      bar.setAttribute('role', 'tablist')
      bar.style.cssText =
        `position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;` +
        `display:flex;gap:2px;align-items:flex-end;height:${BAR_H};padding:0 6px;`
      document.body.appendChild(bar)

      const overlay = document.createElement('div')
      overlay.id = 'tintin-view-overlay'
      overlay.style.cssText =
        `position:fixed;inset:${BAR_H} 0 0 0;z-index:9998;display:none;` +
        `background:var(--dsw-alias-bg-layer-1,#141416);` +
        `color:var(--dsw-alias-label-primary,#e8e8e6);overflow:auto;`
      const container = document.createElement('div')
      container.style.cssText = 'width:100%;min-height:100%;box-sizing:border-box;'
      overlay.appendChild(container)
      document.body.appendChild(overlay)

      function mountActive() {
        if (mountedProvider) {
          try { mountedProvider.unmount?.() } catch (e) { console.error('[tintin] view unmount failed', e) }
          mountedProvider = null
        }
        container.textContent = ''
        if (activeId === 'workbench') {
          overlay.style.display = 'none'
          return
        }
        overlay.style.display = 'block'
        const provider = providers.get(activeId)
        if (provider) {
          try {
            provider.mount(container)
            mountedProvider = provider
          } catch (e) {
            console.error('[tintin] view mount failed', e)
            container.textContent = ''
            renderPending('视图加载失败，请重试切换')
          }
        } else {
          renderPending(activeId === 'media'
            ? '媒体工具界面搬运中（视图提供方未注册）'
            : '运营工具随 P3 接入（产品资料、反推提示词、视频运营）')
        }
      }

      function renderPending(text) {
        const p = document.createElement('div')
        p.style.cssText = 'padding:48px 32px;color:var(--dsw-alias-label-tertiary,#8b8b88);font-size:14px;'
        p.textContent = text
        container.appendChild(p)
      }

      function render() {
        for (const b of Array.from(bar.querySelectorAll('button'))) {
          const on = b.dataset.view === activeId
          b.style.background = on ? 'var(--dsw-alias-bg-layer-2,#1e1e20)' : 'transparent'
          b.style.color = on ? 'var(--dsw-alias-label-primary,#e8e8e6)' : 'var(--dsw-alias-label-tertiary,#8b8b88)'
          b.style.borderBottom = on ? '2px solid var(--dsw-alias-brand-primary,#4f7cff)' : '2px solid transparent'
          b.setAttribute('aria-selected', String(on))
        }
        mountActive()
      }

      for (const v of VIEWS) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.role = 'tab'
        btn.dataset.view = v.id
        btn.textContent = v.label
        btn.style.cssText =
          'appearance:none;font:inherit;font-size:13px;line-height:1;cursor:pointer;' +
          'padding:9px 16px;border:0;background:transparent;'
        btn.onclick = () => { activeId = v.id; render() }
        bar.appendChild(btn)
      }
      render()
    }

    // ── WP-2 window.tintin polyfill ─────────────────────────────────────────
    // Rebuild the old client's preload bridge with identical signatures so the
    // ported Vue views run unmodified. server.* forwards to /tintin/ipc/*;
    // event-style subscriptions (progress) become jobId polling (主方案 §3.1).
    // WP-3 growth: the 文案混剪 closure also drives the preload's named
    // channels — server.montageSplit/llmChat/downloadResult/…, ffmpeg.*,
    // liveclip.* and the dialog/shell surfaces. Namespaces are Proxies over a
    // base object: known members carry browser-capable implementations, any
    // other member forwards to /tintin/ipc/<ns>:<method> so an unbridged call
    // fails loudly with its exact channel name (铁律 7) instead of
    // "not a function"; the host whitelist grows channel by channel.
    function installTintinBridge() {
      if (window.tintin && window.tintin.__dshPolyfill) return // idempotent
      const call = (channel, payload) =>
        // 通道名（server:get）的冒号是路径的一部分，不编码——host 按
        // /tintin/ipc/server:get 匹配（encodeURIComponent 会把 : 编成 %3A 失配）。
        fetch(`/tintin/ipc/${channel}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        }).then(async (r) => {
          const j = await r.json().catch(() => ({}))
          if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status })
          return j.result
        })
      // ipcRenderer.invoke 是位置参数；宿主 IPC 走单 JSON body，约定包成 { args }。
      // 回调参数（进度等）不可序列化且按主方案走轮询，置 undefined 剔除。
      const forwardArgs = (args) => Array.from(args, (a) => (typeof a === 'function' ? undefined : a))
      const namespaced = (ns, base) => new Proxy(base, {
        get: (target, prop) => {
          if (typeof prop !== 'string' || prop === 'then') return undefined
          const hit = target[prop]
          if (hit !== undefined) return hit
          return (...args) => call(`${ns}:${prop}`, { args: forwardArgs(args) })
        },
      })
      // Multipart upload: XHR gives native FormData multipart + real
      // upload progress (fetch cannot); host route /tintin/upload forwards
      // the body verbatim to the service. onProgress(ratio 0..1) optional.
      const serverUpload = (path, fields, onProgress) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/tintin/upload?path=${encodeURIComponent(path)}`)
        if (typeof onProgress === 'function') {
          xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
        }
        xhr.onload = () => {
          let j = null
          try { j = JSON.parse(xhr.responseText) } catch { /* non-json */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(j ? j.result : j)
          else reject(Object.assign(new Error((j && j.error) || `HTTP ${xhr.status}`), { status: xhr.status }))
        }
        xhr.onerror = () => reject(new Error('upload network error'))
        xhr.send(fields)
      })
      const server = namespaced('server', {
        get: (path, params) => call('server:get', { path, params }),
        post: (path, body, headers, timeout) => call('server:post', { path, body, headers, timeout }),
        put: (path, body, headers) => call('server:put', { path, body, headers }),
        delete: (path, params) => call('server:delete', { path, params }),
        upload: serverUpload,
        // sse lands when a ported card needs it (job polling covers progress).
        sse: () => Promise.reject(new Error('tintin sse not yet bridged (WP-2)')),

        // ── 命名通道（对照源 preload server 域逐个映射，2026-09-23 WP-1 续）──
        // 三类：HTTP 封装（方法+路径）、multipart 上传封装（File/Blob 进
        // FormData）、本地原生通道（lib/montage/ 已接线——命名方法 → 冒号
        // 通道，args 按源 invoke 的位置参数包一层）。未映射的本地通道
        // （montage:clearCache 等本地 fs 操作未搬）走 Proxy 转发 404，
        // 调用点 catch 降级。
        // ── 本地原生（lib/montage）──
        finalMix: (p, onProgress) => call('final:mix', { args: [p, undefined, onProgress] }),
        finalCollectOutputs: (dir) => call('final:collectOutputs', { args: [dir] }),
        finalFindSrt: (p) => call('final:findSrt', { args: [p] }),
        finalListResults: (dir) => call('final:listResults', { args: [dir] }),
        finalReadTiming: (p) => call('final:readTiming', { args: [p] }),
        jianyingExport: (p) => call('jianying:export', { args: [p] }),
        lutList: () => call('lut:list', { args: [] }),
        jyTemplatesList: (p) => call('jytpl:list', { args: [p] }),
        jyTemplatesSync: (p) => call('jytpl:sync', { args: [p] }),
        jyTemplatesDeleteServer: (p) => call('jytpl:deleteServer', { args: [p] }),
        // 剪映模板页「字体（剪映）」分类（SRC preload jyfonts 域，2026-09-24 随卡片启用补映射）
        jyfontsScan: () => call('jyfonts:scan', { args: [] }),
        jyfontsServerList: () => call('jyfonts:serverList', { args: [] }),
        jyfontsUpload: (p) => call('jyfonts:upload', { args: [p] }),
        editorExportJianyingPackage: (p) => call('editor:exportJianyingPackage', { args: [p] }),
        bgmDownloadUrl: (p) => call('bgm:downloadUrl', { args: [p] }),
        voiceScanDir: (p) => call('voice:scanDir', { args: [p] }),
        voiceCloneBatch: (p, onProgress) => call('voice:cloneBatch', { args: [p, undefined, onProgress] }),
        voiceCloneBatchStop: (p) => call('voice:cloneBatchStop', { args: [p] }),
        voiceDubVideos: (p, onProgress) => call('voice:dubVideos', { args: [p, undefined, onProgress] }),
        voiceFonts: () => call('voice:fonts', { args: [] }),
        voiceFontFile: (p) => call('voice:fontFile', { args: [p] }),
        voiceSubtitleStyles: () => call('voice:subtitleStyles', { args: [] }),
        voiceExportAudio: (p) => call('voice:exportAudio', { args: [p] }),
        fancyListTemplates: () => call('fancy:listTemplates', { args: [] }),
        fancyServerTemplates: () => call('fancy:serverTemplates', { args: [] }),
        fancyEnsurePreviews: (p, onProgress) => call('fancy:ensurePreviews', { args: [p, undefined, onProgress] }),
        textfxServerTemplates: () => call('textfx:serverTemplates', { args: [] }),
        jyAudioSyncNow: () => call('jyaudio:syncNow', { args: [] }),
        jyAudioSyncStatus: () => call('jyaudio:status', { args: [] }),
        jyAudioSetEnabled: (enabled) => call('jyaudio:setEnabled', { args: [enabled] }),
        // ── HTTP 封装 ──
        llmChat: (payload) => call('server:post', { path: '/llm/chat/completions', body: payload }),
        llmModels: () => call('server:get', { path: '/llm/models' }),
        llmAdjustCopywriting: (payload) => call('server:post', { path: '/script/adjust-copywriting', body: payload }),
        copywritingVoiceover: (payload) => call('server:post', { path: '/copywriting/voiceover', body: payload }),
        // 声音样本域（2026-09-24 补链：此前 ttsVoicesSamples 未映射 → Step2
        // 永远「无样本可选」）。列表/音色是纯 GET 走通用通道；上传与转写的
        // 载荷含 {path} 本地文件包装，浏览器读不了盘，转发宿主原生通道
        // （tts:uploadSample / asr:transcribe 由宿主读盘组 multipart）。
        ttsVoicesSamples: (params) => call('server:get', { path: '/voice/samples', params: params ?? {} }),
        ttsQwen3Voices: () => call('server:get', { path: '/indextts/qwen3/voices' }),
        ttsUploadSample: (p, _onProgress) => call('tts:uploadSample', { args: [p] }),
        asrTranscribe: (p, _onProgress) => call('asr:transcribe', { args: [p] }),
        tasksUnifiedItem: (id) => call('server:get', { path: `/tasks/unified/${encodeURIComponent(String(id ?? ''))}` }),
        materialList: (params) => call('server:get', { path: '/material/list', params: params ?? {} }),
        materialStockSearch: (payload) => call('server:post', { path: '/material/stock_search', body: payload }),
        audioGenBgm: (payload) => call('server:post', { path: '/audio/gen/bgm', body: payload }),
        audioGenSfx: (payload) => call('server:post', { path: '/audio/gen/sfx', body: payload }),
        viralCloneAnalyze: (payload) => call('server:post', { path: '/viral/clone/analyze', body: payload }),
        viralClonePlan: (payload) => call('server:post', { path: '/viral/clone/plan', body: payload }),
        viralCloneFlow: (payload) => call('server:post', { path: '/viral/clone/flow', body: payload }),
        viralCloneGenerate: (payload) => call('server:post', { path: '/viral/clone/generate', body: payload }),
        viralCloneMontage: (payload) => call('server:post', { path: '/viral/clone/montage', body: payload }),
        viralCloneReview: (payload) => call('server:post', { path: '/viral/clone/review', body: payload }),
        listServerWorkflows: (scope) => call('server:get', { path: '/workflows', params: { scope } }),
        serverWorkflowStatus: (taskId) => call('server:get', { path: `/workflows/task/${encodeURIComponent(taskId)}` }),
        // multipart 上传族：payload 字段 → FormData（File/Blob 原样，标量转字符串）
        ...(() => {
          const uploadNamed = (path) => (payload, onProgress) => {
            const fd = new FormData()
            const p = payload ?? {}
            for (const [k, v] of Object.entries(p)) {
              if (v === undefined || v === null) continue
              if (typeof File !== 'undefined' && v instanceof File) fd.append(k, v)
              else if (typeof Blob !== 'undefined' && v instanceof Blob) fd.append(k, v, k)
              else fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
            }
            return serverUpload(path, fd, onProgress)
          }
          return {
            montageSplit: uploadNamed('/montage/split'),
            montageConcat: uploadNamed('/montage/concat'),
            montageBgm: uploadNamed('/montage/bgm'),
            promptVideo: uploadNamed('/prompt/video'),
            materialOcr: uploadNamed('/material/ocr'),
          }
        })(),
        // 进度事件订阅不落桥（主方案 §3.1：进度走 jobId 轮询）。返回 no-op
        // 退订函数，保持源调用点 offXxx?.() 清理语义；无事件到达时调用方
        // 按各自兜底路径（轮询/完成态回写）推进。
        onVoiceProgress: () => () => {},
        fancyOnPreviewProgress: () => () => {},
      })

      // ── dialog：浏览器原生 <input type=file> 重建 ─────────────────────────
      // 在 Electron 渲染进程里 File.path 携带真实绝对路径，选择器行为与源
      // preload 一致（main.js dialog:* 契约：取消→null，否则路径/数组）；
      // 纯浏览器里路径不可得 → canceled(null) 退化。
      const pickInputFiles = (opts) => new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        if (opts?.multiple) input.multiple = true
        if (opts?.directory) input.setAttribute('webkitdirectory', '')
        const filters = opts?.filters
        if (Array.isArray(filters) && filters.length) {
          input.accept = filters.flatMap((f) => (f?.extensions || [])
            .map((e) => (String(e).startsWith('.') ? String(e) : '.' + String(e)))).join(',')
        }
        input.style.display = 'none'
        const done = (files) => { input.remove(); resolve(files) }
        input.addEventListener('change', () => done(Array.from(input.files || [])), { once: true })
        input.addEventListener('cancel', () => done([]), { once: true })
        document.body.appendChild(input)
        input.click()
      })
      const pickedPath = (f) => (f && f.path) || ''
      const dialog = namespaced('dialog', {
        openFile: async (params) => pickedPath((await pickInputFiles({ filters: params?.filters }))[0]) || null,
        openFiles: async (params) => {
          const paths = (await pickInputFiles({ multiple: true, filters: params?.filters })).map(pickedPath).filter(Boolean)
          return paths.length ? paths : null
        },
        openDir: async () => {
          const first = (await pickInputFiles({ directory: true }))[0]
          const rel = first && String(first.webkitRelativePath || '').replace(/\\/g, '/')
          let abs = pickedPath(first).replace(/\\/g, '/')
          if (!abs) return null
          // 根目录 = 首文件绝对路径剥掉 webkitRelativePath 尾段
          if (rel && abs.endsWith('/' + rel)) abs = abs.slice(0, abs.length - rel.length - 1)
          return abs || null
        },
        // 浏览器无保存对话框：恒 null（=取消）。a[download] 拿不到用户选择的
        // 目标路径，消费端按路径继续本地 ffmpeg 流程，假路径只会后移失败点。
        saveFile: async () => null,
        // 渲染层无 fs 遍历能力：恒 []（调用方提示“未找到视频文件”）。
        // 目录递归收集随宿主文件系统通道落地后改为转发。
        collectVideos: async () => [],
      })

      // ── shell：浏览器可承载的轻量动作；本地路径类动作无等价能力 ──────────
      // 源调用点均为 try/catch fire-and-forget 的锦上添花动作，这里不 reject，
      // 避免 void 调用点产生 unhandled rejection 噪音。
      const shell = namespaced('shell', {
        openExternal: (url) => { if (/^https?:\/\//i.test(String(url))) window.open(url, '_blank', 'noopener') },
        openItem: (path) => { if (/^https?:\/\//i.test(String(path))) window.open(path, '_blank', 'noopener') },
        revealInFolder: () => {},
        showNotification: (title, body) => {
          try {
            if (typeof Notification === 'function') void new Notification(String(title ?? ''), { body: String(body ?? '') })
          } catch { /* 通知被拒/不可用：静默；错误另有 clientLog console 通道 */ }
        },
      })

      // ── ffmpeg / liveclip：宿主媒体/文件通道转发（WP-1 TINTIN_BIN_DIR 链路
      // 的消费端）。探测/抽帧/写文件在宿主落地前按 404 显式失败，调用点既有
      // catch/兜底显示（时长列 —、缩略图占位等），不阻断向导。
      const ffmpeg = namespaced('ffmpeg', {})
      const liveclip = namespaced('liveclip', {})

      // ── env.log：渲染层业务日志回流 host（C-6 闭环，2026-09-23 补）──────
      // 源链路 clientError → env:log IPC → logger.logError → 落盘+服务端上报；
      // 无 env 命名空间时 clientLog 退化 console.*（浏览器 DevTools，不落盘）。
      // 这里把 env.log 指到宿主 env:log 通道：host ctx.logger.error 落
      // harness.log（log-bridge），error 级再由 host 自动 POST /api/logs/upload。
      const env = namespaced('env', {
        log: (entry) => call('env:log', {
          args: [{
            level: entry?.level ?? 'info',
            tag: entry?.tag ?? 'renderer',
            message: entry?.message ?? '',
            ...(entry?.stack ? { stack: entry.stack } : {}),
          }],
        }),
        // 2026-09-24 补链：serverPing（SRC env-ipc.js pingServer 契约）——
        // context.ts/useAudioGen 等经它取服务端地址做媒体直连基址。
        serverPing: () => call('env:serverPing', { args: [] }),
      })

      window.tintin = {
        __dshPolyfill: true,
        server,
        dialog,
        shell,
        ffmpeg,
        liveclip,
        env,
      }
      console.info('[tintin] window.tintin polyfill installed')
    }

    // Generic settings RPC for the card below (same-origin fetch carries the
    // harness session cookie; settings/describe + settings/mutate are public).
    const settingsRpc = (method, args) => fetch(method === 'settings/describe' ? '/api/settings/describe' : '/api/settings/mutate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `tintin-card-${Date.now()}`, method, payload: { args } }),
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (j?.result?.ok === false) throw new Error(j.result.error?.message ?? method)
      return j?.result?.value
    })

    // Install now (see header comment): the media bundle's factory registers
    // its view provider against __tintinViews, which must already exist.
    installTintinChrome()
    installTintinBridge()

    return { settingsRpc }
})()

// ── 插件定义（factory 期执行；React 只在此处可用）────────────────────────
// 设置卡走 settings.plugin.item slot（ConfigurablePluginsTab 契约：列表只
// 分发 key，卡片组件由插件 client 贡献——image-generation 同款注册式样）。
window.__ModuleLoader__.load({
  id: 'tintin-bundle',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    function TintinSettingsCard() {
      const [url, setUrl] = React.useState('')
      const [state, setState] = React.useState('loading') // loading|ready|saving|saved|error
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        tintinClient.settingsRpc('settings/describe', {}).then((all) => {
          const ns = (all?.namespaces ?? []).find((n) => n.ns === 'tintin-bundle')
          setUrl(String(ns?.value?.server?.url ?? ''))
          setState('ready')
        }).catch((e) => { setError(String(e?.message ?? e)); setState('error') })
      }, [])
      const save = () => {
        setState('saving'); setError('')
        tintinClient.settingsRpc('settings/mutate', {
          ns: 'tintin-bundle',
          ops: [{ op: 'set', path: ['server', 'url'], value: url.replace(/\/$/u, '') }],
        })
          .then(() => setState('saved'))
          .catch((e) => { setError(String(e?.message ?? e)); setState('error') })
      }
      return h('div', { style: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { style: { fontSize: '15px', fontWeight: 600 } }, 'TinTin 服务器'),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('input', {
            value: url,
            onChange: (e) => { setUrl(e.target.value); setState('ready') },
            placeholder: 'http://192.168.0.10:8000',
            style: {
              flex: 1, minWidth: 0, height: '34px', padding: '0 12px', font: 'inherit',
              border: '0.5px solid var(--dsw-alias-border-l4, #555)', borderRadius: '8px',
              background: 'var(--dsw-alias-bg-layer-3, transparent)', color: 'inherit',
            },
          }),
          h('button', {
            type: 'button', onClick: save, disabled: state === 'saving' || state === 'loading',
            style: {
              appearance: 'none', font: 'inherit', padding: '0 16px', height: '34px', cursor: 'pointer',
              border: '0.5px solid transparent', borderRadius: '8px',
              background: 'var(--dsw-alias-label-primary, #4f7cff)', color: 'var(--dsw-alias-bg-layer-3, #fff)',
            },
          }, state === 'saving' ? '保存中…' : '保存'),
        ),
        state === 'saved' && h('span', { style: { fontSize: '12px', color: '#4ade80' } }, '已保存'),
        state === 'error' && h('span', { style: { fontSize: '12px', color: '#f87171' } }, `保存失败：${error}`),
        h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
          'AI 推理服务地址（FastAPI）。修改后模型提供方的 API 地址需在「设置 → 模型 → TinTin」同步更新。'),
      )
    }

    return {
      name: 'tintin-bundle',
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
          name: 'settings.plugin.item', key: 'tintin-bundle', order: -90,
        }, TintinSettingsCard))

        // First-boot setup wizard (2026-09-24 user ruling): prompt for the
        // SERVER ADDRESS (host:port), not an API key — probe it host-side
        // (browser→LAN is cross-origin), fetch the model list, then configure
        // the tintin-server provider and default model from the answer.
        void maybeShowSetupWizard()

        // P0-V3 probe: proves this client module executed inside the workbench
        // renderer and that same-origin host routing answers it.
        fetch('/tintin/ping')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then(
            (j) => console.info('[tintin] host ping ok', j),
            (e) => console.error('[tintin] host ping fail', e),
          )
      },
    }
  },
})

async function maybeShowSetupWizard() {
  // Settings may still be loading when plugins activate; retry briefly.
  let ns
  for (let i = 0; i < 10 && !ns; i++) {
    try {
      const all = await tintinClient.settingsRpc('settings/describe', {})
      ns = (all?.namespaces ?? []).find((n) => n.ns === 'tintin-bundle')
    } catch { /* retry */ }
    if (!ns) await new Promise((r) => setTimeout(r, 1500))
  }
  if (!ns || ns.value?.server?.provisioned === true) return

  const el = document.createElement('div')
  el.id = 'tintin-setup-wizard'
  el.style.cssText = 'position:fixed;inset:0;z-index:13000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);'
  el.innerHTML = [
    '<div style="width:min(460px,92vw);padding:28px;border-radius:16px;background:var(--dsw-alias-bg-layer-2,#1e1e20);color:var(--dsw-alias-label-primary,#e8e8e6);box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:inherit">',
    '  <div style="font-size:20px;font-weight:700;margin-bottom:6px">欢迎使用 TinTin</div>',
    '  <div style="font-size:13px;color:var(--dsw-alias-label-tertiary,#8b8b88);margin-bottom:18px">配置 TinTin 服务端地址（AI 推理服务，含端口），将自动拉取可用模型。</div>',
    '  <input id="tintin-setup-url" style="width:100%;box-sizing:border-box;height:40px;padding:0 14px;font:inherit;font-size:14px;border:.5px solid var(--dsw-alias-border-l4,#555);border-radius:10px;background:var(--dsw-alias-bg-layer-3,transparent);color:inherit" placeholder="http://192.168.0.10:8000" />',
    '  <div id="tintin-setup-status" style="min-height:20px;margin-top:10px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#8b8b88)"></div>',
    '  <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">',
    '    <button id="tintin-setup-skip" style="appearance:none;font:inherit;font-size:13px;padding:8px 14px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l4,#555);background:transparent;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer">暂不配置</button>',
    '    <button id="tintin-setup-go" style="appearance:none;font:inherit;font-size:13px;font-weight:600;padding:8px 20px;border-radius:8px;border:0;background:var(--dsw-alias-label-primary,#4f7cff);color:#fff;cursor:pointer">测试并配置</button>',
    '  </div>',
    '</div>',
  ].join('')
  document.body.appendChild(el)
  const input = el.querySelector('#tintin-setup-url')
  const status = el.querySelector('#tintin-setup-status')
  const go = el.querySelector('#tintin-setup-go')
  const skip = el.querySelector('#tintin-setup-skip')
  input.value = String(ns.value?.server?.url ?? '')

  const setBusy = (busy, text, isError) => {
    go.disabled = busy
    go.textContent = busy ? '连接中…' : '测试并配置'
    status.textContent = text ?? ''
    status.style.color = isError ? '#f87171' : (text && text.includes('✓') ? '#4ade80' : 'var(--dsw-alias-label-tertiary,#8b8b88)')
  }
  const finish = async (url, models, preferred) => {
    const ops = [{ op: 'set', path: ['server', 'url'], value: url }, { op: 'set', path: ['server', 'provisioned'], value: true }]
    await tintinClient.settingsRpc('settings/mutate', { ns: 'tintin-bundle', ops })
    await tintinClient.settingsRpc('settings/mutate', {
      ns: 'llm-pi-ai',
      ops: [{
        op: 'set', path: ['providers', 'tintin-server'], value: {
          displayName: 'TinTin', apiKeyEnv: 'TINTIN_SERVER_API_KEY', api: 'openai-completions',
          baseURL: `${url}/llm`, models: models.map((m) => ({ id: m.id, name: m.name })),
        },
      }],
    })
    await tintinClient.settingsRpc('settings/mutate', {
      ns: 'agent-default-model',
      ops: [{ op: 'set', path: [], value: { provider: 'tintin-server', model: preferred.id } }],
    })
  }

  skip.onclick = async () => {
    try { await tintinClient.settingsRpc('settings/mutate', { ns: 'tintin-bundle', ops: [{ op: 'set', path: ['server', 'provisioned'], value: true }] }) } catch { /* keep default */ }
    el.remove()
  }
  go.onclick = async () => {
    const url = input.value.trim().replace(/\/+$/u, '')
    if (!/^https?:\/\/[^\s/]+/i.test(url)) { setBusy(false, '地址需形如 http://<主机>:<端口>', true); return }
    setBusy(true, `正在连接 ${url} …`)
    try {
      const r = await fetch('/tintin/setup/probe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? `HTTP ${String(r.status)}`)
      const { models, preferred } = j.result
      setBusy(true, `✓ 连接成功，发现 ${String(models.length)} 个模型，正在配置…`)
      await finish(url, models, preferred)
      status.textContent = `✓ 配置完成（默认模型 ${preferred.name}），即将刷新…`
      status.style.color = '#4ade80'
      setTimeout(() => location.reload(), 900)
    } catch (e) {
      setBusy(false, e instanceof Error ? e.message : String(e), true)
    }
  }
}
