/**
 * Under the agent's reply: what the turn changed in the project's files (lib/file-changes), as a coding agent's app
 * lists them. One card, a row per file: its name, its lines added and removed, and on a click its changed lines. The
 * first few rows show; the rest open from the last row. Settings → Developer turns it off.
 */
import React from 'react';
import { ChevronRight, Download, Eye, File, FileAudio, FileCode, FileImage, FileJson, FileText, FileVideo } from 'lucide-react';
import { useT } from '@/i18n';
import type { FileChange, FileHunk } from '@/lib/file-changes';
import { StickToBottomContext } from './useStickToBottom';

/** rows shown before "N more files" */
const ROWS_SHOWN = 4;

const ICONS: Array<[RegExp, typeof File]> = [
  [/\.(html?|css|[cm]?js|jsx|tsx?|py|sh)$/i, FileCode],
  [/\.json$/i, FileJson],
  [/\.(md|txt|srt|vtt|csv|ya?ml|toml|xml)$/i, FileText],
  [/\.(png|jpe?g|gif|webp|avif|svg)$/i, FileImage],
  [/\.(mp3|m4a|wav|aac|ogg|flac|opus)$/i, FileAudio],
  [/\.(mp4|mov|webm|mkv|m4v)$/i, FileVideo],
];
const iconOf = (path: string) => ICONS.find(([test]) => test.test(path))?.[1] ?? File;

/* TinTin(2026-11-24 用户报障「返回的视频/图片/音频无法查看、无法下载引用到剪辑里」):
   媒体产物行没有 hunks=纯展示行。补预览(base64 播放器)与另存到电脑;
   openfilmNative.projectFile 由影片壳 studio-preload 暴露,封面聊天页无此桥=按钮不渲染。 */
const MEDIA_RE = /\.(mp4|mov|webm|mkv|m4v|png|jpe?g|webp|gif|mp3|wav|m4a|aac|ogg|flac)$/i;
const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.m4v': 'video/x-m4v',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
};
type ProjectFileNative = {
  projectFile?: {
    read: (payload: { project: string; path: string }) => Promise<{ ok?: boolean; base64?: string; mime?: string; error?: string }>;
    saveAs: (payload: { project: string; path: string }) => Promise<{ ok?: boolean; path?: string; canceled?: boolean; error?: string }>;
  };
  tintinFilmDir?: () => Promise<string>;
};
const projectFileNative = (): ProjectFileNative | null => {
  const w = window as unknown as { openfilmNative?: ProjectFileNative };
  return w.openfilmNative && typeof w.openfilmNative.projectFile?.read === 'function' ? w.openfilmNative : null;
};

export function FileChangesList({ changes }: { changes: FileChange[] }) {
  const t = useT();
  const thread = React.useContext(StickToBottomContext);
  const [all, setAll] = React.useState(false);
  const shown = all ? changes : changes.slice(0, ROWS_SHOWN);
  const hidden = changes.length - shown.length;
  /* opening a row or the rest makes the reply taller: the thread stays where it is, as it does for the work summary */
  const keepPlace = () => thread?.skipNextPin();

  return (
    <div className="min-w-0 overflow-hidden rounded-[10px] border border-[var(--border)]">
      {shown.map((change, i) => (
        <FileRow key={change.path} change={change} first={i === 0} onToggle={keepPlace} />
      ))}
      {hidden > 0 || changes.length > ROWS_SHOWN ? (
        <button
          type="button"
          onClick={() => { keepPlace(); setAll((value) => !value); }}
          className="flex h-9 w-full items-center border-t border-[var(--border)] px-3 text-left text-[12.5px] text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          {hidden > 0 ? t('fileChanges.more').replace('{n}', String(hidden)) : t('fileChanges.fewer')}
        </button>
      ) : null}
    </div>
  );
}

function FileRow({ change, first, onToggle }: { change: FileChange; first: boolean; onToggle: () => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState('');
  const Icon = iconOf(change.path);
  const slash = change.path.lastIndexOf('/');
  const name = change.path.slice(slash + 1);
  const folder = slash > 0 ? change.path.slice(0, slash) : '';
  const lines = change.added != null || change.removed != null;
  const canOpen = Boolean(change.hunks?.length);
  const isMedia = MEDIA_RE.test(change.path) && change.change !== 'removed';
  const native = projectFileNative();
  const mediaReady = isMedia && Boolean(native);
  /* 媒体行动作:预览(base64 播放器)/另存到电脑;路径=影片项目目录(tintinFilmDir)+变更相对路径 */
  const mediaAction = async (kind: 'preview' | 'save'): Promise<void> => {
    if (!native?.projectFile) return;
    setBusy(kind);
    try {
      const project = (await native.tintinFilmDir?.()) ?? '';
      const payload = { project, path: change.path };
      if (kind === 'preview') {
        const out = await native.projectFile.read(payload);
        if (!out?.ok || !out.base64) throw new Error(out?.error ?? '读取失败');
        const mime = out.mime ?? MEDIA_MIME[change.path.slice(change.path.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
        setPreviewUrl(`data:${mime};base64,${out.base64}`);
      } else {
        const out = await native.projectFile.saveAs(payload);
        if (out?.canceled) return;
        if (!out?.ok) throw new Error(out?.error ?? '保存失败');
        setPreviewUrl(null);
        window.setTimeout(() => { window.alert(`已保存到 ${out.path}`) }, 50);
      }
    } catch (error) {
      window.setTimeout(() => { window.alert(`${kind === 'preview' ? '预览失败' : '保存失败'}：${error instanceof Error ? error.message : String(error)}`) }, 50);
    } finally {
      setBusy('');
    }
  };
  const row = (
    <>
      <Icon size={14} aria-hidden className="shrink-0 text-[var(--text-faint)]" />
      <span className={`min-w-0 truncate text-[13px] text-[var(--text)] ${change.change === 'removed' ? 'line-through opacity-70' : ''}`} title={change.path}>
        {name}
        {folder ? <span className="ml-1.5 text-[12px] text-[var(--text-faint)]">{folder}</span> : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 font-mono text-[12px] tabular-nums">
        {mediaReady ? (
          <span className="mr-1 flex shrink-0 items-center gap-1 font-sans">
            <button type="button" title="预览" disabled={busy !== ''} onClick={(e) => { e.stopPropagation(); void mediaAction('preview') }}
              className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50">
              <Eye size={13} aria-hidden />
            </button>
            <button type="button" title="下载到电脑" disabled={busy !== ''} onClick={(e) => { e.stopPropagation(); void mediaAction('save') }}
              className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50">
              <Download size={13} aria-hidden />
            </button>
          </span>
        ) : null}
        {lines ? (
          <>
            {change.added ? <span className="text-[var(--ok)]">+{change.added}</span> : null}
            {change.removed ? <span className="text-[var(--err)]">−{change.removed}</span> : null}
          </>
        ) : (
          <span className="font-sans text-[var(--text-faint)]">{busy || t(`fileChanges.${change.change}`)}</span>
        )}
      </span>
      <ChevronRight size={13} aria-hidden className={`shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''} ${canOpen ? '' : 'invisible'}`} />
    </>
  );
  const shell = `flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left ${first ? '' : 'border-t border-[var(--border)]'}`;
  const mediaPreview = (() => {
    if (!previewUrl) return null;
    const ext = change.path.slice(change.path.lastIndexOf('.') + 1).toLowerCase();
    const isImage = /^(png|jpg|jpeg|webp|gif)$/.test(ext);
    const isAudio = /^(mp3|wav|m4a|aac|ogg|flac)$/.test(ext);
    return (
      <div className="fixed inset-0 z-[2147483003] flex items-center justify-center bg-black/70" onClick={() => setPreviewUrl(null)}>
        <div className="flex max-h-[86vh] max-w-[86vw] flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-muted)]">{change.path}</span>
            <button type="button" onClick={() => setPreviewUrl(null)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">×</button>
          </div>
          {isImage
            ? <img src={previewUrl} alt={name} className="max-h-[72vh] max-w-[80vw]" />
            : isAudio
              ? <audio src={previewUrl} controls autoPlay className="w-[420px] max-w-[80vw]" />
              : <video src={previewUrl} controls autoPlay className="max-h-[72vh] max-w-[80vw]" />}
        </div>
      </div>
    );
  })();
  return (
    <div className="min-w-0">
      {canOpen ? (
        <button type="button" aria-expanded={open} onClick={() => { onToggle(); setOpen((value) => !value); }}
          className={`${shell} transition-colors hover:bg-[var(--bg-hover)]`}>
          {row}
        </button>
      ) : <div className={shell}>{row}</div>}
      {open && change.hunks ? <Hunks hunks={change.hunks} cut={change.cut === true} /> : null}
      {mediaPreview}
    </div>
  );
}

/* the changed lines as git shows them: each hunk's place, then its lines, removed (−) and added (+) */
function Hunks({ hunks, cut }: { hunks: FileHunk[]; cut: boolean }) {
  const t = useT();
  return (
    <div className="max-h-[360px] min-w-0 overflow-auto border-t border-[var(--border)] font-mono text-[11.5px] leading-[18px]">
      {hunks.map((hunk, i) => (
        <React.Fragment key={i}>
          <div className="w-max min-w-full whitespace-pre px-3 text-[var(--text-faint)] opacity-80">
            @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          {hunk.lines.map((line, j) => {
            const sign = line[0];
            return (
              <div key={j} className={`flex w-max min-w-full whitespace-pre pr-3 ${sign === '-' ? 'bg-[var(--err)]/15 text-[var(--err)]' : sign === '+' ? 'bg-[var(--ok)]/15 text-[var(--ok)]' : 'text-[var(--text-faint)]'}`}>
                <span aria-hidden className="w-6 shrink-0 select-none text-center opacity-80">{sign === '-' ? '−' : sign === '+' ? '+' : ''}</span>
                <span>{line.slice(1)}</span>
              </div>
            );
          })}
        </React.Fragment>
      ))}
      {cut ? <div className="px-3 py-1 font-sans text-[12px] text-[var(--text-faint)]">{t('fileChanges.cut')}</div> : null}
    </div>
  );
}
