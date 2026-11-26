/**
 * 选择产品(2026-10-24 用户要求: 把仿视频流程的选择产品移植到视频剪辑会话):
 * composer 底部行的「📦 产品」按钮 → 产品库面板(搜索/列表) → 点选产品 →
 * 产品资料(品牌/型号/品类/货号/性能/卖点)以结构化文本注入会话输入框(@ 引用形态)。
 * 数据经 openfilmNative.products(主进程代理服务端 /api/product-library/*, 实测形状)。
 */
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  type LexicalEditor,
} from 'lexical';
import { bootFail } from './boot';

type LexicalDom = HTMLElement & { __lexicalEditor?: LexicalEditor | null };

const STYLE = [
  '.tintin-pd-fab{z-index:2147483000}',
  /* 素材式嵌入(2026-11-09 用户裁决): 面板占聊天列的会话区域(列顶→输入框上缘), 不再浮在
     Studio 画布上 —— 四边由打开时按 #of-chat 的实位 JS 设定, 这里只是形状兜底。 */
  '.tintin-pd-panel{position:fixed;left:0;top:32px;width:420px;max-height:70vh;z-index:2147483001;background:#101114;border:1px solid #26272b;border-radius:12px;display:flex;flex-direction:column;font:13px/1.5 system-ui;color:#e2e2e6;box-shadow:0 12px 32px rgba(0,0,0,.5);box-sizing:border-box}',
  '.tintin-pd-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1c1d21}',
  '.tintin-pd-title{flex:1;font-weight:700;font-size:14px}',
  '.tintin-pd-close{background:#1a1b1f;border:1px solid #2a2b31;border-radius:8px;color:#c9c9cf;font-size:14px;cursor:pointer;min-width:28px;height:28px}',
  '.tintin-pd-search{margin:10px 12px;background:#16171a;border:1px solid #26272b;border-radius:8px;color:#e8e8e6;font:12px system-ui;padding:6px 10px;outline:none}',
  '.tintin-pd-list{flex:1;min-height:0;overflow:auto;padding:0 12px;display:flex;flex-direction:column;gap:8px}',
  '.tintin-pd-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #26272b;border-radius:9px;background:#16171a;cursor:pointer}',
  '.tintin-pd-row:hover{border-color:#3b6fd4;background:#1b2030}',
  '.tintin-pd-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
  '.tintin-pd-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tintin-pd-meta{color:#77787e;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tintin-pd-status{padding:6px 12px 12px;color:#8a8a90;font-size:11px;min-height:18px;white-space:pre-wrap}',
].join('\n');

type ProductRow = { id?: unknown; category?: unknown; brand?: unknown; model?: unknown; goods_no?: unknown; spec_no?: unknown; features?: unknown; selling_points?: unknown; notes?: unknown; keywords?: unknown; barcode?: unknown; warehouse?: unknown };

/** 产品资料的结构化文本(品牌·型号·品类·货号 + 性能参数 + 卖点逐条 + 备注/关键词)。
   面板注入与 @ 引用(壳桥 products.texts)共用这一份, 智能体拿到的上下文同源。 */
export function productContextOf(item: Record<string, unknown>): string {
  const str = (keys: string[]): string => {
    for (const k of keys) { const v = item[k]; if (typeof v === 'string' && v.trim()) return v.trim() }
    return ''
  };
  const lines: string[] = [];
  const head4 = [str(['brand']), str(['model']), str(['category']), str(['goods_no']), str(['spec_no'])].filter(Boolean).join(' · ');
  lines.push(`【产品】${head4 || name0(item)}`);
  const features = str(['features']);
  if (features) lines.push(`性能参数：${features}`);
  const selling = str(['selling_points']);
  if (selling) for (const line of selling.split('\n')) if (line.trim()) lines.push(`卖点：${line.trim()}`);
  /* 资料补全(2026-10-25 报障: 部分产品 features/selling_points 为空): notes/keywords/规格。 */
  const notes = str(['notes']);
  if (notes) lines.push(`备注：${notes}`);
  const keywords = item.keywords;
  if (Array.isArray(keywords) && keywords.length) lines.push(`关键词：${keywords.map(String).join('、')}`);
  return lines.join('\n');
}

function name0(item: ProductRow): string {
  const parts = [item.brand, item.model, item.category].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  return parts.length ? parts.join(' ') : '未命名产品';
}

const mount = (): void => {
  try {
    const native = (window as unknown as {
      openfilmNative?: { products?: { call: (p: unknown) => Promise<Record<string, unknown> & { error?: string }> } }
    }).openfilmNative;
    if (typeof native?.products?.call !== 'function') return; // 非本形态页面: 不挂

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);

    const fab = document.createElement('button');
    fab.className = 'openfilm-composer-tool';
    /* 图标(2026-11-11 用户裁决:与在线素材按钮同款样式)= lucide Package,16px/stroke 1.75,
       与官方工具行(LibraryBig/Plus)同一画法;原 📦 emoji 与官方 SVG 并排不成套 */
    fab.setAttribute('aria-pressed', 'false');
    fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/></svg>';
    fab.title = '选择产品:资料注入会话(@ 引用)';
    /* 挂进官方 composer 工具条(与素材/技能按钮同行同款) —— 等工具条出现后注入 */
    const attachFab = (): void => {
      const official = document.querySelector('.openfilm-composer-tool')
      const row = official?.parentElement
      if (!row) return false
      if (row.querySelector('[data-tintin-products]')) return true
      fab.setAttribute('data-tintin-products', '1')
      row.append(fab)
      return true
    }
    let fabTries = 0
    const fabTick = (): void => {
      if (attachFab()) return
      fabTries += 1
      if (fabTries < 80) setTimeout(fabTick, 250)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(fabTick, 0))
    else setTimeout(fabTick, 0)

    /* 技能入口 FAB 已删除（2026-11-19 用户裁决「最后一个也是进入的相同的吧。把最后一个删除」）：
       0.4 官方 composer 工具行的 Community 按钮（App.tsx showExamples{kind:'plugins'}）与
       本注入按钮（requestShowSkills=show-examples{kind:'skill'}）开的是同一个 Community
       窗口，保留官方一个入口即可。requestShowSkills 本身保留（桥 API 面，takeLink 等
       深链路径仍在用）。 */

    /* 在线素材的入口已移入 0.3 库面板素材侧栏(「收藏」下的「在线素材」, 2026-11-07 用户裁决) ——
       输入框旁的注入按钮退役。 */

    const panel = document.createElement('div');
    panel.className = 'tintin-pd-panel';
    panel.style.display = 'none';
    const head = document.createElement('div'); head.className = 'tintin-pd-head';
    const title = document.createElement('div'); title.className = 'tintin-pd-title'; title.textContent = '选择产品';
    const close = document.createElement('button'); close.className = 'tintin-pd-close'; close.textContent = '×';
    head.append(title, close);
    const search = document.createElement('input'); search.className = 'tintin-pd-search'; search.placeholder = '搜索产品(品类/品牌/型号)…';
    const list = document.createElement('div'); list.className = 'tintin-pd-list';
    const status = document.createElement('div'); status.className = 'tintin-pd-status';
    panel.append(head, search, list, status);
    document.body.append(panel);

    let editorDom: LexicalDom | null = null;
    let caretSelection: BaseSelection | null = null;
    const findEditor = (): LexicalDom | null => {
      if (editorDom?.isConnected && editorDom.__lexicalEditor) return editorDom;
      editorDom = document.querySelector<LexicalDom>('[data-lexical-editor="true"]');
      return editorDom;
    };
    document.addEventListener('selectionchange', () => {
      const dom = findEditor();
      const editor = dom?.__lexicalEditor;
      if (!editor || !dom || document.activeElement !== dom) return;
      editor.getEditorState().read(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) caretSelection = sel.clone();
      });
    });

    const inject = (text: string): void => {
      const dom = findEditor();
      const editor = dom?.__lexicalEditor;
      if (!editor) { status.textContent = '未找到会话输入框'; return }
      editor.update(() => {
        /* 插入点(2026-11-24 用户裁决「光标在插入点,不是最前面」): 优先用编辑器**当前实时选区**
           (Lexical 失焦也保留选区=用户光标就在那);旧实现先用记忆克隆,克隆过期(内容变过)会
           落到文档开头。克隆只作无实时选区时的兜底,且 try 包住(陈旧节点键=异常→落末尾)。 */
        let sel = $getSelection();
        if (!$isRangeSelection(sel) && caretSelection) {
          try { $setSelection(caretSelection.clone()); sel = $getSelection() } catch { /* 陈旧克隆: 落兜底 */ }
        }
        if (!$isRangeSelection(sel)) $getRoot().selectEnd();
        const empty = !$getRoot().getTextContent().trim();
        if (!empty) $insertNodes([$createParagraphNode()]);
        const lines = text.split('\n');
        for (const [i, line] of lines.entries()) {
          if (i > 0) $insertNodes([$createParagraphNode()]);
          if (line) $insertNodes([$createTextNode(line)]);
        }
        $insertNodes([$createParagraphNode()]);
      });
      editor.focus();
      caretSelection = null;
      status.textContent = '已注入产品资料到会话输入框';
      setOpen(false);
    };

    const rowOf = (item: Record<string, unknown>): HTMLElement => {
      const row = document.createElement('div'); row.className = 'tintin-pd-row';
      const main = document.createElement('div'); main.className = 'tintin-pd-main';
      const name = document.createElement('div'); name.className = 'tintin-pd-name';
      name.textContent = [item.brand, item.model].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(' ') || name0(item);
      const meta = document.createElement('div'); meta.className = 'tintin-pd-meta';
      meta.textContent = [item.category, item.goods_no ? `货号 ${item.goods_no}` : ''].map((v) => String(v)).filter(Boolean).join(' · ');
      main.append(name, meta); row.append(main);
      row.onclick = () => {
        void (async () => {
          let item0: Record<string, unknown>;
          try {
            const detail = await native.products.call({ op: 'detail', id: item.id });
            if (detail && typeof detail === 'object' && typeof (detail as { error?: unknown }).error === 'string') {
              throw new Error(String((detail as { error?: string }).error));
            }
            item0 = (detail && typeof detail === 'object' && 'item' in detail ? (detail as { item?: Record<string, unknown> }).item : detail) ?? item;
          } catch (error) {
            status.textContent = '产品资料获取失败：' + (error instanceof Error ? error.message : String(error));
            return;
          }
          /* 资料与注入分开归因(2026-11-24「hide is not defined」报障: 注入期异常带着出处,
             状态栏多给两行栈,出问题能定位到是哪段代码) */
          try {
            inject(productContextOf(item0));
          } catch (error) {
            const stack = error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 3).join(' ␤ ') : '';
            status.textContent = `资料已取到但注入失败：${error instanceof Error ? error.message : String(error)}${stack ? ` ｜ ${stack}` : ''}`;
          }
        })();
      };
      return row;
    };

    /* 分页(2026-11-13 用户问「产品选择是不是没有自动翻页,只有部分结果」实证): 服务端
       /api/product-library/search 无 offset、limit 上限 500(>500 直接 422), 全库 500 条时
       空搜索也正好触顶。旧实现一次 limit:50=只显示前 50 条且无从翻页。修=一次取服务端
       上限 500 条, 面板**滚动到底自动续渲染**(每批 60 行, DOM 渐进免一次插 500 行的卡顿),
       触顶时如实提示细化关键词; seq 防「输入新词覆盖旧响应」竞态。 */
    const BATCH = 60;
    const FETCH_LIMIT = 500;
    let remaining: Array<Record<string, unknown>> = [];
    let total = 0;
    let seq = 0;
    const renderMore = (): void => {
      if (!remaining.length) return;
      const batch = remaining.splice(0, BATCH);
      for (const item of batch) list.append(rowOf(item));
      const shown = list.querySelectorAll('.tintin-pd-row').length;
      if (remaining.length) status.textContent = `已显示 ${shown} / ${total} 条——继续滚动自动加载`;
      else status.textContent = total >= FETCH_LIMIT ? `已显示全部 ${total} 条（已达服务端单次上限，更多请细化关键词）` : '';
    };
    list.addEventListener('scroll', () => {
      if (remaining.length && list.scrollTop + list.clientHeight >= list.scrollHeight - 32) renderMore();
    });

    const load = async (q: string): Promise<void> => {
      const my = ++seq;
      status.textContent = '搜索产品…';
      list.replaceChildren();
      remaining = [];
      total = 0;
      try {
        const out = await native.products.call({ op: 'search', q, limit: FETCH_LIMIT });
        if (my !== seq) return; // 新搜索已接管: 丢弃旧响应
        const items = (out && typeof out === 'object' && Array.isArray((out as { items?: unknown[] }).items))
          ? (out as { items: Array<Record<string, unknown>> }).items
          : [];
        if (!items.length) {
          const empty = document.createElement('div'); empty.style.cssText = 'color:#8a8a90;font-size:12px;padding:8px 2px';
          empty.textContent = '没有匹配的产品。';
          list.append(empty);
          return;
        }
        total = items.length;
        remaining = items;
        renderMore();
      } catch (error) {
        if (my !== seq) return;
        status.textContent = '产品加载失败：' + (error instanceof Error ? error.message : String(error));
      }
    };
    /* 显隐(2026-11-11 用户裁决:与在线素材按钮同款开关语义): fab 再点一次=关闭;
       aria-pressed 走官方 .openfilm-composer-tool[aria-pressed=true] 按下态样式 */
    const setOpen = (on: boolean): void => {
      panel.style.display = on ? 'flex' : 'none';
      fab.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    const open = (): void => {
      setOpen(true);
      /* 素材式嵌入: 面板占聊天列的会话区域(列左缘→列宽, 列顶→**输入框上缘**)。
         2026-11-11 用户裁决:不留空隙——面板底=输入框顶(data-prompt-shell=composer
         卡片根, MentionMenuPlugin 同款锚);原 128px 固定预留=面板悬在输入框上方一段。
         锚缺失才退回 128px 兜底;列不在=屏幕左侧兜底。 */
      const columnRect = document.getElementById('of-chat')?.getBoundingClientRect();
      const shellRect = document.querySelector('[data-prompt-shell]')?.getBoundingClientRect();
      if (columnRect && columnRect.width > 40) {
        panel.style.left = `${Math.round(columnRect.left)}px`;
        panel.style.top = `${Math.round(columnRect.top)}px`;
        panel.style.width = `${Math.round(columnRect.width)}px`;
        if (shellRect && shellRect.top > columnRect.top + 40) {
          panel.style.height = `${Math.round(shellRect.top - columnRect.top)}px`;
          panel.style.maxHeight = 'none';
        } else {
          panel.style.height = '';
          panel.style.maxHeight = `${Math.max(240, Math.round(columnRect.height - 128))}px`;
        }
      } else {
        panel.style.left = '0px';
        panel.style.top = '32px';
        panel.style.width = '420px';
        panel.style.height = '';
        panel.style.maxHeight = '70vh';
      }
      if (!list.childElementCount && !status.textContent) void load('');
    };
    fab.onclick = () => { if (panel.style.display !== 'none') setOpen(false); else open() };
    close.onclick = () => setOpen(false);
    let timer = 0;
    search.oninput = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void load(search.value.trim()) }, 350) };
  } catch (error) {
    bootFail('选择产品挂载失败: ' + String(error));
  }
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else setTimeout(mount, 0);
}

/** The product row as the products.call channel returns it (TinTin panel + @ 引用同源). */
export type TinTinProduct = ProductRow;
