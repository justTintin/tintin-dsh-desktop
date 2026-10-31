/**
 * 封面会话页的桥(2026-10-28 会话移植,需求文档 §十一;chat-shell 独立构建):
 * 实现官方聊天组件读取的 `window.openfilmDesktop`(chat/app-bridge.ts 的 AppBridge +
 * lib/desktop-bridge.ts 的 agents/localAgents 子集),后端是 bundle 的
 * /tintin/cover/api/acp/* 路由族——真实 ACP agent 会话(cover-acp-bridge.js,
 * dsh --profile acp 子进程)经 HTTP/SSE 流出。同款界面、同款架构,业务对接不同:
 * comfygen 生图 / PhotoCraft / 封面图层(props 对流)。
 *
 * 与影片 shell(bridge.ts)的差异:没有 Studio——编辑器是父页 iframe。编辑器经
 * postMessage 供给实时上下文(tintin-cover:context),发送时注入 <cover_context> 使
 * agent 知道模板与图层取值;编辑器点「引用到会话」(tintin-cover:refer)走与 Studio
 * 「Reference in chat」同一条 pill 通路。
 */
import type { Project, StudioRef } from '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src/chat/app-bridge';
import type {
  LocalAgentEvent,
  LocalAgentId,
  LocalAgentSessionInfo,
  LocalAgentState,
  LocalAgentTurnMeta,
  PromptImage,
  RosterAgent,
} from '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src/chat/lib/desktop-bridge';

const API = '/tintin/cover/api/acp';

interface CoverLayer {
  id: string;
  label: string;
  type: string;
  propsKey?: string;
  value?: unknown;
}

interface CoverContext {
  templateId: string;
  orientation: string;
  layers: CoverLayer[];
  size?: { w: number; h: number };
}

let context: CoverContext = { templateId: '', orientation: 'landscape', layers: [] };
let cachedHello: { coverDir: string; dshBin: boolean } | null = null;

function signal<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    on(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(value: T) {
      for (const listener of [...listeners]) {
        try { listener(value); } catch { /* 单订阅者故障不杀通道 */ }
      }
    },
  };
}
const refer = signal<StudioRef>();

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/${path}`, init);
  return (await res.json()) as T;
}
const postJson = (path: string, body: unknown): Promise<unknown> =>
  j(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

/* ── 编辑器(postMessage)→ 会话:实时上下文与图层引用 ─────────────────────── */

const displayValue = (value: unknown): string =>
  Array.isArray(value) ? value.map((v) => String(v)).join(' / ') : typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);

function layerRef(layer: CoverLayer): StudioRef {
  return {
    kind: 'layer',
    clipId: 'cover',
    loc: null,
    label: layer.label,
    text: displayValue(layer.value) || null,
    tag: layer.propsKey ?? layer.id,
    source: null,
  } as StudioRef;
}

window.addEventListener('message', (event) => {
  const data = event.data as
    | { type?: string; templateId?: string; orientation?: string; layers?: CoverLayer[]; size?: { w: number; h: number } }
    | { type?: string; layer?: CoverLayer }
    | null;
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
  if (data.type === 'tintin-cover:context' && 'layers' in data) {
    context = {
      templateId: String(data.templateId ?? ''),
      orientation: String(data.orientation ?? 'landscape'),
      layers: Array.isArray(data.layers) ? data.layers : [],
      ...(data.size ? { size: data.size } : {}),
    };
  }
  if (data.type === 'tintin-cover:refer' && 'layer' in data && data.layer) refer.set(layerRef(data.layer));
  if (data.type === 'tintin-cover:refer-file' && 'name' in data && data.name) {
    void helloMeta().then((meta) => {
      const path = `${meta.coverDir.replace(/\\/g, '/')}/${String(data.name).replace(/^public\//, '')}`;
      refer.set({ kind: 'file', path, fileKind: 'image' } as StudioRef);
    });
  }
});

/** 发送时注入:模板+图层清单+当前取值(agent 据此改 cover.props.json 的对应键) */
function coverContextBlock(): string {
  if (!context.layers.length) return '';
  const rows = context.layers.map((layer) => {
    const key = layer.propsKey ?? layer.id;
    return `- ${layer.id}(${layer.label}, ${layer.type}, props 键 \`${key}\`)当前值: ${JSON.stringify(displayValue(layer.value))}`;
  });
  const size = context.size ? ` size="${context.size.w}x${context.size.h}"` : '';
  return `\n\n<cover_context template="${context.templateId}"${size}>\n图层清单(@引用即此词汇;改文字/样式=写 cover.props.json 对应键,保存后画布即刷新):\n${rows.join('\n')}\n</cover_context>`;
}

/* ── ACP 语义事件流(SSE;断线由 EventSource 带 Last-Event-ID 自动重放) ────── */

const eventListeners = new Set<(event: LocalAgentEvent) => void>();
let stream: EventSource | null = null;

function ensureStream(): void {
  if (stream) return;
  const source = new EventSource(`${API}/events`);
  source.addEventListener('agent', (event) => {
    let parsed: LocalAgentEvent;
    try { parsed = JSON.parse((event as MessageEvent).data) as LocalAgentEvent; } catch { return; }
    for (const listener of [...eventListeners]) {
      try { listener(parsed); } catch { /* 单订阅者故障不杀流 */ }
    }
  });
  stream = source;
}

/* ── agents 名册与 localAgents 会话协议 ──────────────────────────────────── */

async function helloMeta(): Promise<{ coverDir: string; dshBin: boolean }> {
  if (!cachedHello) {
    const r = await j<{ coverDir?: string; dshBin?: boolean }>('hello').catch(() => ({}));
    cachedHello = { coverDir: String(r.coverDir ?? ''), dshBin: r.dshBin === true };
  }
  return cachedHello;
}

const rosterAgent = async (): Promise<RosterAgent> => {
  const meta = await helloMeta().catch(() => ({ coverDir: '', dshBin: false }));
  /* id=tintin-agent(2026-10-30 用户裁决:选择器要机器人图标+「TinTin智能体」,不要 deepseek
     鲸鱼标——id 落在聊天壳已登记的 tintin-agent 上,ChatAgentIcon 即映射 Bot 图标;
     驱动=ACP(dsh CLI)+模型=TinTin 服务端,会话协议与 id 无关 */
  return { id: 'tintin-agent' as LocalAgentId, name: 'TinTin智能体', shown: true, status: meta.dshBin ? 'ready' : 'missing', install: null };
};

const agentState = async (): Promise<LocalAgentState> => {
  const meta = await helloMeta().catch(() => ({ coverDir: '', dshBin: false }));
  return {
    id: 'tintin-agent',
    label: 'TinTin智能体',
    cli: meta.dshBin ? { path: 'dsh', source: 'app' } : null,
    signedIn: true,
    install: 'https://github.com/deepseek-ai/deepseek-harness',
  };
};

const sessionInfoOf = (info: Record<string, unknown>): LocalAgentSessionInfo => ({
  sessionId: String(info.sessionId ?? ''),
  resumed: info.resumed === true,
  ...(info.steering === true ? { steering: true } : {}),
  agentInfo: (info.agentInfo ?? null) as LocalAgentSessionInfo['agentInfo'],
  authMethods: [],
  mcp: false,
  models: (info.models ?? null) as LocalAgentSessionInfo['models'],
  modes: null,
  configOptions: (info.configOptions ?? null) as LocalAgentSessionInfo['configOptions'],
});

const localAgents = {
  list: async (): Promise<LocalAgentState[]> => [await agentState()],
  disconnect: async (): Promise<{ ok: boolean }> => postJson('close', {}),
  signIn: async (): Promise<{ ok: false; error: string }> => ({ ok: false, error: 'TinTin智能体无需登录: 模型由 TinTin 服务端提供' }),
  probe: async (): Promise<{ ok: true; info: LocalAgentSessionInfo } | { ok: false; error: string; code?: string }> => {
    const r = await postJson('start', {}) as { ok: boolean; info?: Record<string, unknown>; error?: string };
    return r.ok && r.info ? { ok: true, info: sessionInfoOf(r.info) } : { ok: false, error: String(r.error ?? '会话启动失败') };
  },
  start: async (_agent: LocalAgentId, cwd: string, _resume?: string | null, _meta?: LocalAgentTurnMeta) => {
    const r = await postJson('start', { cwd }) as { ok: boolean; key?: string; info?: Record<string, unknown>; error?: string };
    return r.ok && r.info
      ? { ok: true as const, key: String(r.key ?? 'cover'), info: sessionInfoOf(r.info) }
      : { ok: false as const, error: String(r.error ?? '会话启动失败') };
  },
  prompt: async (key: string, text: string, meta?: LocalAgentTurnMeta, images?: PromptImage[]) => {
    /* 2026-10-30 用户裁决:模式切换按钮删除 —— 会话固定走 TinTin智能体(带参考图也随消息
       进会话, 由智能体经服务端工具箱处理);此前的「直连生图」旁路随该按钮一并移除。 */
    ensureStream();
    const injected = text + coverContextBlock();
    return (await postJson('prompt', { key, text: injected, meta, images })) as { ok: true; stopReason: string } | { ok: false; error: string };
  },
  running: async () => {
    const r = await j<{ running?: Array<Record<string, unknown>> }>('running').catch(() => ({ running: [] }));
    return Array.isArray(r.running) ? r.running : [];
  },
  ack: async (_key: string, turnId: string) => postJson('ack', { turnId }),
  steer: async (_key: string, text: string, images?: PromptImage[]) =>
    postJson('steer', { text: text + coverContextBlock(), images }) as Promise<{ ok: boolean; outcome: string }>,
  cancel: async (_key: string) => postJson('cancel', {}) as Promise<{ ok: boolean }>,
  setOption: async (_key: string, configId: string, value: unknown) => postJson('set-option', { configId, value }) as Promise<{ ok: boolean; error?: string }>,
  answerPermission: async (_key: string, requestId: string, optionId: string | null) => postJson('permission', { requestId, optionId }) as Promise<{ ok: boolean }>,
  answerQuestion: async (_key: string, requestId: string, answers: unknown) => postJson('question', { requestId, answers }) as Promise<{ ok: boolean }>,
  close: async (_key: string) => postJson('close', {}) as Promise<{ ok: true }>,
  onEvent(listener: (event: LocalAgentEvent) => void): () => void {
    ensureStream();
    eventListeners.add(listener);
    return () => { eventListeners.delete(listener); };
  },
};

/* ── window.openfilmDesktop ─────────────────────────────────────────────── */

const noopStop = (): (() => void) => () => {};
const NO_ASKS: never[] = [];

/* ── 在线素材抽屉(2026-10-28 用户裁决:封面会话里只有图片,不要视频/音频)──
   与影片素材库同源(/material/*,media_type 钉死 image,文件名再过滤一道);
   缩略图经 bundle 代理(同源,免跨域);点击 = 领养进素材位(三写)+ 以文件引用插入会话。 */

let assetsDrawerOpen = false;
let composerHeight = 120;
let drawerEl: HTMLDivElement | null = null;
const assetsSignal = signal<boolean>();

const libraryPage = { page: 0, search: '', loading: false, done: false }

async function libraryFetch(reset: boolean): Promise<Array<Record<string, unknown>>> {
  if (reset) { libraryPage.page = 0; libraryPage.done = false }
  if (libraryPage.loading || libraryPage.done) return []
  libraryPage.loading = true
  libraryPage.page += 1
  const q = `library?page=${libraryPage.page}&size=24${libraryPage.search ? `&search=${encodeURIComponent(libraryPage.search)}` : ''}`
  const body = await j<{ ok?: boolean; items?: Array<Record<string, unknown>>; error?: string }>(q).catch(() => ({ ok: false, error: '加载失败' }))
  libraryPage.loading = false
  if (body.ok !== true) throw new Error(String(body.error ?? '加载失败'))
  const items = Array.isArray(body.items) ? body.items : []
  if (items.length < 24) libraryPage.done = true
  return items
}

async function libraryAdopt(item: Record<string, unknown>): Promise<{ name: string; path: string }> {
  const r = await postJson('library-adopt', {
    materialId: String(item.material_id ?? item.id ?? ''),
    filename: String(item.filename || item.name || ''),
  }) as { ok?: boolean; name?: string; path?: string; error?: string };
  if (r.ok !== true || !r.name || !r.path) throw new Error(String(r.error ?? '领养失败'));
  return { name: r.name, path: r.path };
}

function destroyLibraryDrawer(): void {
  drawerEl?.remove();
  drawerEl = null;
  assetsDrawerOpen = false;
}

function positionLibraryDrawer(): void {
  if (!drawerEl) return;
  drawerEl.style.bottom = `${Math.min(Math.max(composerHeight + 6, 60), window.innerHeight - 60)}px`;
}

function renderLibraryDrawer(): void {
  drawerEl?.remove(); // 防孤儿:标志位异常时的重复打开不应堆叠旧抽屉(旧抽屉关不掉)
  const el = document.createElement('div');
  el.id = 'tintin-cover-library';
  el.style.cssText = [
    'position:fixed', 'left:0', 'top:0', 'right:0', 'z-index:70', 'display:flex', 'flex-direction:column', 'overflow:hidden',
    'background:var(--surface-2, #232326)', 'border-top:1px solid var(--border, #3a3a3e)', 'font-size:12.5px', 'color:var(--text, #e8e8e6)',
  ].join(';');
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border, #3a3a3e)">
      <span style="font-weight:600">在线素材</span>
      <span style="flex:1"></span>
      <span class="tintin-lib-state" style="color:var(--text-faint, #8b8b88);font-size:11.5px">加载中…</span>
      <button class="tintin-lib-close" title="关闭" style="border:0;background:transparent;color:var(--text-muted, #b8b8b6);cursor:pointer;font-size:14px;padding:0 2px;line-height:1">✕</button>
    </div>
    <div style="display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--border, #3a3a3e)">
      <span class="tintin-lib-tab" style="padding:4px 12px;border-radius:6px;background:rgba(79,124,255,0.22);color:#bfdbfe;font-size:12px;font-weight:600">图片</span>
    </div>
    <div style="padding:8px 12px;border-bottom:1px solid var(--border, #3a3a3e)">
      <input class="tintin-lib-search" placeholder="搜索素材名" style="width:100%;box-sizing:border-box;background:var(--surface, #1c1c1e);border:1px solid var(--border, #3a3a3e);border-radius:8px;color:var(--text, #e8e8e6);font-size:12px;padding:6px 10px;outline:none" />
    </div>
    <div class="tintin-lib-list" style="overflow-y:auto;flex:1 1 auto;min-height:0"></div>
    <button class="tintin-lib-more" style="display:none;margin:0 12px 8px;padding:7px 0;border-radius:8px;border:1px solid var(--border, #3a3a3e);cursor:pointer;background:transparent;color:var(--text-muted, #b8b8b6);font-size:12px">加载更多</button>
    <button class="tintin-lib-close2" style="margin:0 12px 10px;padding:8px 0;border-radius:8px;border:1px solid var(--border, #3a3a3e);cursor:pointer;background:transparent;color:var(--text-muted, #b8b8b6);font-size:12.5px">关闭</button>`;
  document.body.appendChild(el);
  drawerEl = el;
  positionLibraryDrawer();
  el.querySelector('.tintin-lib-close')?.addEventListener('click', () => setLibraryDrawer(false));
  el.querySelector('.tintin-lib-close2')?.addEventListener('click', () => setLibraryDrawer(false));
  const state = el.querySelector('.tintin-lib-state') as HTMLElement;
  const list = el.querySelector('.tintin-lib-list') as HTMLElement;
  const more = el.querySelector('.tintin-lib-more') as HTMLButtonElement;
  const adoptRow = (row: HTMLElement, item: Record<string, unknown>): void => {
    const btn = row.querySelector('.tintin-lib-dl') as HTMLElement;
    const id = String(item.material_id ?? item.id ?? '');
    row.style.pointerEvents = 'none';
    btn.textContent = '下载中…';
    void libraryAdopt(item).then((adopted) => {
      btn.textContent = '✓ 已下载';
      state.textContent = `已下载 ${adopted.name}(可在 @ 素材与图层素材面板使用)`;
    }).catch((err) => {
      row.style.pointerEvents = '';
      btn.textContent = '下载到素材';
      state.textContent = String(err instanceof Error ? err.message : err);
    });
  };
  const appendItems = (items: Array<Record<string, unknown>>): void => {
    for (const item of items) {
      const id = String(item.material_id ?? item.id ?? '');
      const name = String(item.filename || item.name || `material-${id}`);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer';
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-hover, rgba(255,255,255,0.06))'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      const img = document.createElement('img');
      img.src = `/tintin/cover/api/acp/library-thumb?material_id=${encodeURIComponent(id)}`;
      img.loading = 'lazy';
      img.style.cssText = 'width:56px;height:32px;object-fit:cover;border-radius:5px;background:#0b0c0f;flex:none';
      img.onerror = () => { img.style.visibility = 'hidden'; };
      const nameEl = document.createElement('span');
      nameEl.textContent = name;
      nameEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px';
      const btn = document.createElement('button');
      btn.className = 'tintin-lib-dl';
      btn.textContent = '下载到素材';
      btn.style.cssText = 'flex:none;padding:5px 12px;border-radius:8px;border:1px solid rgba(79,124,255,0.55);cursor:pointer;background:rgba(79,124,255,0.14);color:#bfdbfe;font-size:11.5px;font-weight:600';
      row.append(img, nameEl, btn);
      const doAdopt = (): void => adoptRow(row, item);
      btn.addEventListener('click', (e) => { e.stopPropagation(); doAdopt(); });
      row.addEventListener('click', doAdopt);
      list.appendChild(row);
    }
  };
  const loadPage = async (reset: boolean): Promise<void> => {
    try {
      state.textContent = reset ? '加载中…' : '追加加载中…';
      const items = await libraryFetch(reset);
      if (reset) list.innerHTML = '';
      appendItems(items);
      const total = list.children.length;
      state.textContent = `${total} 张${libraryPage.done ? '' : ' · 滚动或点击加载更多'}`;
      more.style.display = libraryPage.done || total === 0 ? 'none' : 'block';
    } catch (error) {
      state.textContent = String(error instanceof Error ? error.message : error);
    }
  };
  more.addEventListener('click', () => { more.textContent = '加载中…'; void loadPage(false).then(() => { more.textContent = '加载更多'; }); });
  const search = el.querySelector('.tintin-lib-search') as HTMLInputElement;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { libraryPage.search = search.value.trim(); void loadPage(true); }, 400);
  });
  list.addEventListener('scroll', () => {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 60 && !libraryPage.loading && !libraryPage.done) void loadPage(false);
  });
  void loadPage(true);
}

function setLibraryDrawer(open: boolean): void {
  if (open === assetsDrawerOpen) return;
  /* 标志位必须先落账:它从未置 true 时,关闭路径 open(false)===flag(false) 被守卫
     拦截 → ✕/关闭全部静默失效(2026-10-29 用户实报,列表版抽屉 day-one 缺陷) */
  assetsDrawerOpen = open;
  if (open) renderLibraryDrawer();
  else destroyLibraryDrawer();
  assetsSignal.set(assetsDrawerOpen);
}

(window as unknown as { openfilmDesktop: unknown }).openfilmDesktop = {
  version: 'tintin-cover-1',
  bridgeVersion: '1',
  platform: navigator.platform.startsWith('Win') ? 'win32' : navigator.platform.startsWith('Mac') ? 'darwin' : 'linux',
  pathForFile: (_file: File): string => '',
  revealPath: async (_path: string) => {
    await fetch('/tintin/cover/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
  },
  chooseFolder: async (): Promise<string | null> => null,
  agents: {
    list: async (): Promise<RosterAgent[]> => [await rosterAgent()],
    connect: async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
    onChange(listener: (agents: RosterAgent[]) => void): () => void {
      void rosterAgent().then((agent) => listener([agent])).catch(() => {});
      return noopStop();
    },
  },
  localAgents,
  openSettings: () => {},
  async hello() {
    const meta = await helloMeta().catch(() => ({ coverDir: '', dshBin: false }));
    const project: Project = { id: 'cover', name: '封面制作', path: meta.coverDir };
    return {
      platform: 'win32', flavor: 'tintin-cover', theme: 'dark' as const, language: 'zh-CN', chatOpen: true,
      project, selection: null, ffmpeg: true as const, version: '0.1.0', chatMin: 260,
    };
  },
  onTheme: noopStop,
  onLanguage: noopStop,
  onProject: (listener: (project: Project) => void): (() => void) => {
    void helloMeta().then((meta) => listener({ id: 'cover', name: '封面制作', path: meta.coverDir })).catch(() => {});
    return noopStop();
  },
  onChatOpen: noopStop,
  onStudioBrowser: noopStop,
  onStudioFailed: noopStop,
  onRefer: refer.on,
  onSelection: noopStop,
  onFfmpeg: noopStop,
  showInStudio: (ref: StudioRef) => {
    (window.parent as Window).postMessage({ type: 'tintin-cover:show', ref }, '*');
  },
  exampleFolder: async (): Promise<string> => { throw new Error('封面编辑器没有示例库'); },
  /* ▦ 按钮(2026-10-30 用户裁决):原 OpenFilm「社区/示例」位,封面插件化后改为打开
     封面自己的技能管理面板(cover-chat-skills.ts 监听本事件;装完 / 菜单即可引用)。 */
  showExamples: () => { window.dispatchEvent(new Event('tintin-cover:skills-open')); },
  onUseSkill: noopStop,
  onAddSkill: noopStop,
  useSkill: () => {},
  withPicture: async (ref: StudioRef) => ref,
  highlightInStudio: (ref: StudioRef | null) => {
    (window.parent as Window).postMessage({ type: 'tintin-cover:highlight', ref }, '*');
  },
  draftRefsInStudio: (refs: StudioRef[]) => {
    (window.parent as Window).postMessage({ type: 'tintin-cover:draft-refs', refs }, '*');
  },
  onStudioHover: noopStop,
  projectFiles: async () => j<{ files?: Array<{ path: string; kind: string; size: number }> }>('files').then((r) => ({ files: r.files ?? [] })).catch(() => ({ files: [] })),
  /* @ 菜单的「图层」组数据源:编辑器 postMessage 推来的实时图层清单(含当前取值)。
     清单为空时向编辑器拉一次(推送可能丢进未就绪的 iframe),1.2s 超时兜底返回。 */
  coverLayers: async () => {
    if (context.layers.length) return context.layers;
    const win = window.parent as Window;
    const wait = new Promise<void>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; layers?: CoverLayer[] } | null;
        if (data && data.type === 'tintin-cover:context' && Array.isArray(data.layers)) {
          window.removeEventListener('message', onMessage);
          resolve();
        }
      };
      window.addEventListener('message', onMessage);
      setTimeout(resolve, 1200);
    });
    win.postMessage({ type: 'tintin-cover:context-request' }, '*');
    await wait;
    return context.layers;
  },
  /* 无影片时间轴:@ 菜单去掉 时刻/当前时间/当前选中 组(影片侧无此属性,不受影响) */
  timelineDisabled: true,
  /* @ 只做引用:技能归 /(2026-10-29 用户裁决;影片侧 @ 菜单含技能不受影响) */
  hideSkillsInMentions: true,
  /* 空会话的 starters(2026-10-28 用户裁决:封面域,图片/封面类;影片侧无此方法保持内置视频例) */
  starters: async () => [
    '生成一张赛博朋克风格的产品底图',
    '把主标题改成「0.2ms 超快光轴」并放大',
    '给这个产品出一张竖版带货封面',
    '换一张深夜霓虹的氛围底图',
    '为这首单曲做一张封面图',
    '生成一张极简白底的商品图',
    '做一张开箱实测风格的视频缩略图',
    '把品牌条改成 TINTIN STUDIO',
    '帮我想三个更抓眼球的标题',
    '导出当前封面的 PNG',
    '用这张照片做一张杂志风封面',
    '生成日系暖色调的氛围底图',
    '把卖点字号加大、颜色换成明黄',
    '切成竖屏布局并保留内容',
    '生成一张星空下露营的场景图',
  ],
  /* composer 占位符(封面域措辞;影片侧无此方法保持「描述你的影片」) */
  composerPlaceholder: async () => ({
    blank: '描述你要的封面。输入 @ 可引用图层或素材',
    followUp: '说说要改什么。输入 @ 可引用图层、素材或某次导出',
  }),
  setChatWidth: () => {},
  setChatOpen: () => {},
  assetsOpen: () => assetsDrawerOpen,
  setAssetsOpen: (open: boolean) => setLibraryDrawer(open === true),
  onAssets: assetsSignal.on,
  setComposerHeight: (px: number) => {
    const h = Math.round(px);
    if (!Number.isFinite(h) || h < 40) return;
    composerHeight = h;
    if (assetsDrawerOpen) positionLibraryDrawer();
  },
  setMenuOpen: () => {},
  chat: {
    load: async () => j<{ sessions?: unknown[]; last?: string | null; turns?: unknown[] }>('chat-record').then((r) => ({ sessions: r.sessions ?? [], last: r.last ?? null, turns: r.turns ?? [] })).catch(() => ({ sessions: [], last: null, turns: [] })),
    saveSessions: (project: string, sessions: unknown[], last: string | null) => postJson('chat-sessions', { project, sessions, last }),
    saveTurn: (project: string, turn: unknown, items: unknown[]) => postJson('chat-turn', { project, turn, items }),
    log: async (): Promise<null> => null,
    reveal: async (): Promise<null> => null,
    saveRefImage: async (project: string, turnId: string, n: number, bytes: ArrayBuffer) => {
      const res = await fetch(`${API}/chat-ref-image?turnId=${encodeURIComponent(turnId)}&n=${encodeURIComponent(String(n))}`, { method: 'POST', body: bytes });
      return res.json();
    },
    saveAttachment: async (project: string, name: string, bytes: ArrayBuffer) => {
      const res = await fetch(`${API}/chat-attachment?name=${encodeURIComponent(name)}`, { method: 'POST', body: bytes });
      return res.json();
    },
    describePaths: (paths: string[]) => postJson('describe-paths', { paths }),
    unsaved: async (): Promise<never[]> => [],
    snapshot: async (): Promise<null> => null,
    changes: async (): Promise<null> => null,
  },
  /* useSyncExternalStore 的 get 必须返回稳定引用(新数组会触发无限重渲染, React #185) */
  asks: { get: (): never[] => NO_ASKS, onChange: noopStop, answer: () => {} },
  skills: {
    list: (project: string, agent: string) => j('skills').catch(() => ({ openfilm: [], own: { agent, filtered: false, skills: [] }, mine: '' })),
    texts: (project: string, agent: string, names: string[]) => postJson('skills-texts', { project, agent, names }).catch(() => []),
    allow: async (): Promise<{ ok: boolean }> => ({ ok: true }),
    changed: async (): Promise<null> => null,
    preview: async (): Promise<{ ok: false; error: string }> => ({ ok: false, error: '封面技能随插件分发,不支持从地址安装' }),
    previewFolder: async (): Promise<{ ok: false; cancelled: boolean }> => ({ ok: false, cancelled: true }),
    commit: async (): Promise<{ ok: true; skills: never[] }> => ({ ok: true, skills: [] }),
    discard: async (): Promise<null> => null,
    reveal: async (): Promise<null> => null,
  },
  developer: { get: async (): Promise<{ logs: boolean; changes: boolean }> => ({ logs: false, changes: false }), onChange: noopStop },
};

/* 模式切换按钮已删除(2026-10-30 用户裁决):composer 不再有「直连生图/Agent」切换钮 ——
   会话固定走 TinTin智能体;该按钮与 prompt 直连旁路一并移除(见上方 prompt)。 */
