/**
 * 选择产品(2026-10-24 用户要求: 把仿视频流程的选择产品移植到视频剪辑会话):
 * composer 底部行的「📦 产品」按钮 → 产品库面板(搜索/列表) → 点选产品 →
 * 产品资料(品牌/型号/品类/货号/性能/卖点)以结构化文本注入会话输入框(@ 引用形态)。
 * 数据经 openfilmNative.products(主进程代理服务端 /api/product-library/*, 实测形状)。
 */
import { bootFail } from './boot';
import { requestShowSkills } from './bridge';

type ProductRow = { id?: unknown; category?: unknown; brand?: unknown; model?: unknown; goods_no?: unknown; features?: unknown; selling_points?: unknown };

const STYLE = [
  '.tintin-pd-fab{z-index:2147483000}',
  /* 弹窗跟随聊天列(2026-11-07 用户裁决: 0.3 聊天列在左, 弹窗不得写死屏幕右侧) ——
     打开时按 #of-chat 的实位 JS 定位贴其右缘, 这里的 left:8px 只是列不在时的兜底。 */
  '.tintin-pd-panel{position:fixed;left:8px;bottom:120px;width:400px;max-height:480px;z-index:2147483001;background:#101114;border:1px solid #26272b;border-radius:12px;display:flex;flex-direction:column;font:13px/1.5 system-ui;color:#e2e2e6;box-shadow:0 12px 32px rgba(0,0,0,.5)}',
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
    fab.textContent = '📦'; fab.title = '选择产品(资料注入会话)';
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

    /* 技能入口(2026-11-07 用户裁决「按原来的图标和原来的窗口」): 0.2.7 的 Blocks 图标(lucide,
       与官方工具行按钮同款 16px/stroke 1.75) + show-skills 命令开恢复的技能弹窗(发现/服务端/我的)。 */
    const skillFab = document.createElement('button');
    skillFab.className = 'openfilm-composer-tool';
    skillFab.title = '技能库(发现/服务端/我的)';
    skillFab.setAttribute('data-tintin-skills', '1');
    skillFab.setAttribute('aria-label', '技能库');
    skillFab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="14" y="3" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/></svg>';
    skillFab.onclick = () => requestShowSkills();
    const attachSkill = (): boolean => {
      const official = document.querySelector('.openfilm-composer-tool')
      const row = official?.parentElement
      if (!row) return false
      if (row.querySelector('[data-tintin-skills]')) return true
      row.append(skillFab)
      return true
    }
    let skillTries = 0
    const skillTick = (): void => {
      if (attachSkill()) return
      skillTries += 1
      if (skillTries < 80) setTimeout(skillTick, 250)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(skillTick, 0))
    else setTimeout(skillTick, 0)

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

    const inject = (text: string): void => {
      const editor = document.querySelector('[data-lexical-editor="true"]');
      if (!editor) { status.textContent = '未找到会话输入框'; return }
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      status.textContent = '已注入产品资料到会话输入框';
      panel.style.display = 'none';
    };

    const contextOf = (item: Record<string, unknown>): string => {
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
      /* 资料补全(2026-10-25 报障: 部分产品 features/selling_points 为空): notes/keywords/
         规格/条码/仓库一并带上, 智能体拿到的上下文尽量全。 */
      const notes = str(['notes']);
      if (notes) lines.push(`备注：${notes}`);
      const keywords = item.keywords;
      if (Array.isArray(keywords) && keywords.length) lines.push(`关键词：${keywords.map(String).join('、')}`);
      const barcode = str(['barcode']);
      if (barcode) lines.push(`条码：${barcode}`);
      const warehouse = str(['warehouse']);
      if (warehouse) lines.push(`仓库：${warehouse}`);
      return lines.join('\n');
    };
    const name0 = (item: Record<string, unknown>): string => {
      const parts = [item.brand, item.model, item.category].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
      return parts.length ? parts.join(' ') : '未命名产品';
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
        /* 注入 = 产品资料结构化文本进会话输入框(粘贴事件, Lexical 原生接住) */
        void (async () => {
          try {
            const detail = await native.products.call({ op: 'detail', id: item.id });
            const item0 = (detail && typeof detail === 'object' && 'item' in detail ? (detail as { item?: Record<string, unknown> }).item : detail) ?? item;
            inject(contextOf(item0));
          } catch (error) {
            status.textContent = '产品资料获取失败：' + (error instanceof Error ? error.message : String(error));
          }
        })();
      };
      return row;
    };
    const name0Of = (item: Record<string, unknown>): string => name0(item);
    void name0Of;

    const load = async (q: string): Promise<void> => {
      status.textContent = '搜索产品…';
      list.replaceChildren();
      try {
        const out = await native.products.call({ op: 'search', q, limit: 50 });
        const items = (out && typeof out === 'object' && Array.isArray((out as { items?: unknown[] }).items))
          ? (out as { items: Array<Record<string, unknown>> }).items
          : [];
        if (!items.length) {
          const empty = document.createElement('div'); empty.style.cssText = 'color:#8a8a90;font-size:12px;padding:8px 2px';
          empty.textContent = '没有匹配的产品。';
          list.append(empty);
          return;
        }
        for (const item of items) list.append(rowOf(item));
        status.textContent = '';
      } catch (error) {
        status.textContent = '产品加载失败：' + (error instanceof Error ? error.message : String(error));
      }
    };
    const open = (): void => {
      panel.style.display = 'flex';
      /* 贴聊天列右缘: 0.3 聊天列在左, 弹窗落在列右边(列收起/不在=屏幕左侧兜底) */
      const columnRect = document.getElementById('of-chat')?.getBoundingClientRect();
      if (columnRect && columnRect.width > 40) panel.style.left = `${Math.min(Math.round(columnRect.right) + 8, Math.max(8, innerWidth - 408))}px`;
      else panel.style.left = '8px';
      if (!list.childElementCount && !status.textContent) void load('');
    };
    fab.onclick = open;
    close.onclick = () => { panel.style.display = 'none' };
    let timer = 0;
    search.oninput = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void load(search.value.trim()) }, 350) };
  } catch (error) {
    bootFail('选择产品挂载失败: ' + String(error));
  }
};

function name0(item: Record<string, unknown>): string {
  const parts = [item.brand, item.model, item.category].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  return parts.length ? parts.join(' ') : '未命名产品';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else setTimeout(mount, 0);
