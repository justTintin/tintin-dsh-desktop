/**
 * TinTinServerSkills.tsx — TinTin 服务端技能组随 0.4 升级迁移（2026-11-19 用户裁决
 * 「技能转到新的社区界面管理中」）。0.3 时代挂在 SkillsPane 的 ServerLine（库面板技能页）
 * 随上游 0.4 的 Community 重构（PluginsPane/SkillPage）迁移至此：Mine 页里独立 Shelf，
 * 数据走 openfilmNative.skills.list 原桥（发现/安装不经 openfilmDesktop 包装 —— 0.3.1
 * 裁决「技能弹窗服务端 tab 直用原桥」延续），装/删走 install/remove 原桥后自刷新。
 * 行为语义与 0.3 ServerLine 一致：未装=获取按钮；已装=删除按钮 + 版本账本/内容兜底的
 * 「有新版」徽标（更新=重装覆盖）；点击行内展开服务端详情（版本/执行方/标签/注册者/时间）。
 */
import * as React from 'react';
import { Server, Trash2 } from 'lucide-react';
import { useT } from '@/i18n';

interface NativeSkillsBridge {
  openfilmNative?: {
    skills?: {
      list?: (project: string, agent: string) => Promise<{ openfilm?: Array<Record<string, unknown>> } | undefined>;
      install?: (name: string) => Promise<unknown>;
      remove?: (name: string) => Promise<unknown>;
    };
  };
}

export interface ServerSkill {
  name: string; description: string;
  installed: boolean; installedVersion: string; update: boolean;
  detail: Record<string, unknown>;
}

interface NativeSkillsLike {
  openfilmNative?: {
    skills?: {
      list?: (project: string, agent: string) => Promise<{ openfilm?: Array<Record<string, unknown>> } | undefined>;
      install?: (name: string) => Promise<unknown>;
      remove?: (name: string) => Promise<unknown>;
    };
  };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** 服务端技能清单（原生桥），装/删后自刷新。shown=false 时不拉（隐藏页省请求）。 */
export function useServerSkills(shown: boolean): { skills: ServerSkill[]; act: (op: 'install' | 'remove', name: string) => void } {
  const [skills, setSkills] = React.useState<ServerSkill[]>([]);
  const read = React.useCallback(() => {
    const native = (window as unknown as NativeSkillsBridge).openfilmNative;
    if (!native?.skills?.list) return;
    void native.skills.list('', 'deepseek').then((listing) => {
      const rows = Array.isArray(listing?.openfilm) ? listing.openfilm : [];
      setSkills(rows
        .filter((s) => String(s.source ?? '') === 'server')
        .map((s) => ({
          name: String(s.name ?? ''), description: String(s.description ?? ''),
          installed: s.installed === true,
          installedVersion: String(s.installedVersion ?? ''), update: s.update === true,
          detail: (s.detail ?? {}) as Record<string, unknown>,
        }))
        .filter((s) => s.name));
    }, () => setSkills([]));
  }, []);
  React.useEffect(() => {
    if (!shown) return;
    read();
    const changed = (): void => read();
    window.addEventListener('openfilm:skills-changed', changed);
    return () => window.removeEventListener('openfilm:skills-changed', changed);
  }, [shown, read]);
  const act = (op: 'install' | 'remove', name: string): void => {
    const native = (window as unknown as NativeSkillsLike).openfilmNative;
    void native?.skills?.[op]?.(name)?.catch(() => {}).finally(() => read());
  };
  return { skills: shown ? skills : [], act };
}

const PANEL_ROUND = 'grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--bg-field)]';

/** A TinTin server skill row in the Community's Mine shelf (0.3 ServerLine 1:1 移植). */
export function ServerLine({ skill, onInstall, onRemove }: {
  skill: ServerSkill; onInstall: () => void; onRemove: () => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const run = (op: () => void): void => { setBusy(true); op(); window.setTimeout(() => setBusy(false), 1500); };
  const detail = skill.detail ?? {};
  const words = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : Array.isArray(v) && v.length ? v.map(String).join('、') : '');
  const serverVersion = words(detail.version);
  const fields: Array<[string, string]> = [
    [t('gallery.serverVersion'), serverVersion],
    ...(skill.installed ? [[t('gallery.serverInstalledVersion'), skill.installedVersion || '—'] as [string, string]] : []),
    [t('gallery.serverExecutor'), words(detail.executor)],
    [t('gallery.serverTags'), words(detail.tags)],
    [t('gallery.serverOwner'), words(detail.registered_by)],
    [t('gallery.serverTime'), words(detail.created_at)],
  ].filter(([, v]) => v) as Array<[string, string]>;
  return (
    <div className="rounded-[8px] px-1 py-1.5">
      <div role="button" tabIndex={0} onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen(!open); }}
        title={skill.description}
        className="group flex cursor-pointer items-center gap-2.5 rounded-[8px] outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--bg-field)] text-[var(--text-muted)]"><Server size={16} strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium leading-[17px] text-[var(--text)]">{skill.name}</span>
            {skill.update && serverVersion ? (
              <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-1.5 py-[1px] text-[10px] font-semibold text-[var(--warn)]">
                ⟳ {t('gallery.updateOut').replace('{version}', serverVersion)}
              </span>
            ) : null}
          </div>
          <div className="truncate text-[11px] leading-[15px] text-[var(--text-faint)]">{skill.description}</div>
        </div>
        {skill.installed ? (
          <button type="button" title={t('gallery.serverRemoveHint')} aria-label={t('gallery.serverRemove')} disabled={busy}
            onClick={(e) => { e.stopPropagation(); run(onRemove); }}
            className={`${PANEL_ROUND} text-[var(--text-muted)] hover:text-[var(--text)]`}><Trash2 size={13} /></button>
        ) : null}
        <button type="button" disabled={busy}
          onClick={(e) => { e.stopPropagation(); run(skill.installed ? onInstall : onInstall); }}
          aria-label={skill.installed ? t('assetDrawer.update') : t('assetDrawer.get')}
          className="inline-flex h-7 min-w-[64px] items-center justify-center rounded-full bg-[var(--bg-pressed)] px-3.5 text-[13px] font-semibold text-[var(--accent)] transition hover:brightness-125 active:scale-[0.97] disabled:opacity-50">
          {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : skill.installed ? (skill.update ? t('assetDrawer.update') : t('gallery.serverInstalled'))
            : t('assetDrawer.get')}
        </button>
      </div>
      {open ? (
        <div className="mb-1 ml-[46px] rounded-[8px] bg-[var(--bg-field)] px-3 py-2">
          {fields.length ? (
            <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11.5px] leading-[17px]">
              {fields.map(([k, v]) => (
                <React.Fragment key={k}>
                  <span className="text-[var(--text-faint)]">{k}</span>
                  <span className="truncate text-[var(--text-muted)]">{v}</span>
                </React.Fragment>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
