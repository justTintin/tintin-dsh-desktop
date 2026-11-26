/**
 * FilmDreaminaSkill.tsx — 视频剪辑「即梦 CLI」技能的两块独立界面:
 * · DreaminaToggle = 「我的」页货架标题右侧的默认开关(独立键 dreamina.preferInFilm);
 * · DreaminaLine   = 「技能」页的详情卡(登录/退出、8 项能力、账户积分/VIP)。
 * 设置流程与封面制作一致;已登录且开关打开时,CLI 能力优先于 create_* MCP。
 */
import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { SettingsSwitch } from '../settings/ui';

interface DreaminaCall {
  (payload: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
}
interface NativeBridge {
  openfilmNative?: {
    dreamina?: { call?: DreaminaCall };
    openExternal?: (url: string) => Promise<void>;
  };
}
const call = (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const fn = (window as unknown as NativeBridge).openfilmNative?.dreamina?.call;
  if (!fn) return Promise.resolve({ ok: false, error: '宿主未开放即梦 CLI 通道' });
  return fn(payload).then((r) => r ?? { ok: false, error: '空响应' }, (e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
};

export interface DreaminaCapability { command: string; kind: string; ratios: string[] }
export interface DreaminaView {
  status: Record<string, unknown>;
  pref: boolean;
  skill: Record<string, unknown>;
  capabilities: DreaminaCapability[];
}

export function useFilmDreamina(shown: boolean): {
  view: DreaminaView;
  refresh: () => void;
  act: (action: string, extra?: Record<string, unknown>) => Promise<Record<string, unknown>>;
} {
  const [view, setView] = React.useState<DreaminaView>({
    status: {}, pref: true, skill: {}, capabilities: [],
  });
  const refresh = React.useCallback(() => {
    if (!shown) return;
    void Promise.all([
      call({ action: 'status' }),
      call({ action: 'get-pref' }),
      call({ action: 'skill-get' }),
      call({ action: 'capabilities' }),
    ]).then(([status, pref, skill, caps]) => {
      setView({
        status: status ?? {},
        pref: pref?.preferInFilm !== false,
        skill: skill ?? {},
        capabilities: Array.isArray(caps?.commands)
          ? (caps.commands as Array<Record<string, unknown>>).map((c) => ({
            command: String(c.command ?? ''),
            kind: String(c.kind ?? ''),
            ratios: Array.isArray(c.ratios) ? c.ratios.map(String) : [],
          })).filter((c) => c.command)
          : [],
      });
    }, () => setView({ status: {}, pref: true, skill: {}, capabilities: [] }));
  }, [shown]);
  React.useEffect(() => { refresh(); }, [refresh]);
  const act = React.useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const result = await call({ action, ...extra });
    refresh();
    return result;
  }, [refresh]);
  return { view, refresh, act };
}

/** 「我的」页货架标题行右侧的开关:只控制优先偏好,不含登录状态。 */
export function DreaminaToggle() {
  const { view, act } = useFilmDreamina(true);
  const [busy, setBusy] = React.useState(false);
  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true);
    try { await act('set-pref', { preferInFilm: on }); } finally { setBusy(false); }
  };
  return <SettingsSwitch checked={view.pref} disabled={busy} onChange={toggle} label="即梦 CLI 优先" />;
}

/** 「技能」页的详情卡:登录/退出 + 展开的 8 项能力与账户积分信息。 */
export function DreaminaLine() {
  const { view, refresh, act } = useFilmDreamina(true);
  const [busy, setBusy] = React.useState(false);
  const [materials, setMaterials] = React.useState<Record<string, string> | null>(null);
  const [error, setError] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    void call({ action: 'login-cancel' });
  }, []);

  const run = async (action: string, extra: Record<string, unknown> = {}): Promise<void> => {
    setBusy(true); setError('');
    try {
      const r = await act(action, extra);
      if (r.ok === false && r.error) setError(String(r.error));
      if (action === 'login-start' && r.alreadyLoggedIn === true) return;
      if (action === 'login-start' && r.ok) {
        setMaterials({ verificationUri: String(r.verificationUri ?? ''), userCode: String(r.userCode ?? ''), expiresAt: String(r.expiresAt ?? '') });
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = window.setInterval(async () => {
          const st = await call({ action: 'login-status' });
          if (st.done || !st.active) {
            if (timer.current !== null) window.clearInterval(timer.current);
            timer.current = null;
            setMaterials(null);
            refresh();
          }
        }, 3000);
      }
    } finally { setBusy(false); }
  };

  const loggedIn = view.status.loggedIn === true;
  const available = view.status.available !== false;
  const installed = view.skill.installed === true;
  const summary = !available
    ? '未安装即梦 CLI(将自动从官方源装配)'
    : loggedIn
      ? `已登录 · ${view.capabilities.length} 项生成能力` : '未登录';

  return (
    <div className="rounded-[8px] px-1 py-1.5">
      <div className="flex items-start gap-2.5 rounded-[8px] px-1 py-1">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--bg-field)] text-[var(--text-muted)]"><Sparkles size={16} strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium leading-[17px] text-[var(--text)]">即梦 CLI</div>
          <div className="truncate text-[11px] leading-[15px] text-[var(--text-faint)]" title={summary}>{summary}</div>
          {error ? <div className="mt-1 text-[11px] leading-[15px] text-[var(--warn)]">{error}</div> : null}
          {materials ? (
            <div className="mt-2 rounded-[8px] bg-[var(--bg-field)] px-3 py-2 text-[11.5px] leading-[17px]">
              <div>在浏览器完成授权后自动继续</div>
              {materials.userCode ? <div className="font-mono text-[13px] font-semibold text-[var(--accent)]">{materials.userCode}</div> : null}
              {materials.verificationUri ? (
                <button type="button" className="mt-1 underline text-[var(--accent)]"
                  onClick={() => { void (window as unknown as NativeBridge).openfilmNative?.openExternal?.(materials.verificationUri); }}>{materials.verificationUri}</button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {loggedIn ? (
            <button type="button" disabled={busy} onClick={() => { void run('logout'); }}
              className="inline-flex h-7 min-w-[64px] items-center justify-center rounded-full bg-[var(--bg-pressed)] px-3.5 text-[13px] font-semibold text-[var(--accent)] disabled:opacity-50">
              退出登录
            </button>
          ) : (
            <button type="button" disabled={busy || !available} onClick={() => { void run('login-start'); }}
              className="inline-flex h-7 min-w-[64px] items-center justify-center rounded-full bg-[var(--bg-pressed)] px-3.5 text-[13px] font-semibold text-[var(--accent)] disabled:opacity-50">
              {busy ? '…' : '登录即梦'}
            </button>
          )}
          {installed ? null : (
            <button type="button" disabled={busy || !available} onClick={() => { void run('skill-install'); }}
              className="inline-flex h-7 min-w-[64px] items-center justify-center rounded-full bg-[var(--bg-pressed)] px-3.5 text-[13px] font-semibold text-[var(--accent)] disabled:opacity-50">
              安装技能
            </button>
          )}
          {loggedIn ? (
            <button type="button" onClick={() => setExpanded(!expanded)}
              className="inline-flex h-7 items-center justify-center rounded-full border border-[var(--border)] px-3 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">
              {expanded ? '收起' : '详情'}
            </button>
          ) : null}
        </div>
      </div>
      {expanded && loggedIn ? (
        <div className="mb-1 ml-[46px] rounded-[8px] bg-[var(--bg-field)] px-3 py-2 text-[11.5px] leading-[17px]">
          <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[var(--text-muted)]">
            <span>积分余额：<span className="font-semibold text-[var(--accent)]">{String(view.status.credit ?? '—')}</span></span>
            <span>VIP：<span className="text-[var(--text)]">{String(view.status.vipLevel || '—')}</span></span>
            <span>用户：<span className="text-[var(--text)]">{String(view.status.userId || '—')}</span></span>
          </div>
          <div className="mb-1 font-semibold text-[var(--text)]">生成能力（{view.capabilities.length}）</div>
          <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
            {view.capabilities.map((c) => (
              <React.Fragment key={c.command}>
                <span className="font-mono text-[var(--text)]">{c.command}</span>
                <span className="text-[var(--text-muted)]">{c.kind === 'image' ? '图片' : '视频'}{c.ratios.length ? ` · ${c.ratios.join('/')}` : ''}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
