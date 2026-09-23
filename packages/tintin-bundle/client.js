window.__ModuleLoader__.load({
  id: 'tintin-bundle',
  factory: () => {

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
        // 两类：HTTP 封装（方法+路径，与源 preload 同参）与 multipart 上传封装
        // （源 handler 把 payload 字段转 FormData——File/Blob 直接进 FormData，
        // 标量转字符串；对照 server-proxy.js montage:split L845-871 的字段表）。
        // 本地原生通道（final:mix/jianying:export/voice:dubVideos 等）不在
        // 此列——它们走 Proxy 转发 /tintin/ipc，待宿主路由落地。
        llmChat: (payload) => call('server:post', { path: '/llm/chat/completions', body: payload }),
        llmModels: () => call('server:get', { path: '/llm/models' }),
        llmAdjustCopywriting: (payload) => call('server:post', { path: '/script/adjust-copywriting', body: payload }),
        copywritingVoiceover: (payload) => call('server:post', { path: '/copywriting/voiceover', body: payload }),
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

      // env/config 故意不装：clientLog 的 t?.env?.log 判空后退化 console.*
      // （预览无桥同路径），ensureServerUrl 对 env.serverPing 可选链后按相对
      // URL 下载，hasConfig() 为 false 时 readCfg 走默认值——与源项目
      // “预览/无桥环境”的降级分支一致，避免半通通道制造静默错误数据。
      window.tintin = {
        __dshPolyfill: true,
        server,
        dialog,
        shell,
        ffmpeg,
        liveclip,
      }
      console.info('[tintin] window.tintin polyfill installed')
    }

    return {
      name: 'tintin-bundle',
      inject: [],
      apply(ctx) {
        installTintinChrome()
        installTintinBridge()

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
