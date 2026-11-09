/**
 * The skills dialog (TinTin 2026-11-07 用户裁决「按原来的图标和原来的窗口集成技能」):
 * 0.2.7 的 SkillsLibrary 弹窗(发现/服务端/我的, 含 TinTin 服务端技能 tab)在 0.3 树上以
 * 独立浮层恢复 —— 容器照 0.2.7 ExamplesDialog 的居中大卡, 技能数据照 0.2.7 ExamplesGallery
 * 的 state 形态(seenSkills 先显示, watchSkills 读活)。打开走 host.ts 的新命令 show-skills
 * (壳桥的技能按钮), Try now 经 studioHost.useSkill 开新会话命名该技能。
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { seenSkills, watchSkills, type SkillEntry } from '@/lib/project-sources';
import { SkillsLibrary } from './SkillsLibrary';

export function SkillsDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const t = useT();
  /* what was read before shows at once; what is read now replaces it (0.2.7 ExamplesGallery 同款) */
  const [skills, setSkills] = React.useState<SkillEntry[]>(() => seenSkills(projectId) ?? []);
  const [opened, setOpened] = React.useState<SkillEntry | null>(null);
  React.useEffect(() => {
    let alive = true;
    const stop = watchSkills(projectId, (list) => { if (alive) setSkills(list); });
    return () => { alive = false; stop(); };
  }, [projectId]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (opened) { e.preventDefault(); e.stopPropagation(); setOpened(null); } else { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [opened, onClose]);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[10040] bg-black/60" onMouseDown={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('skills.button')}
        className="fixed left-1/2 top-1/2 z-[10050] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--app-content-bg,var(--bg-panel))] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
        style={{ width: 'min(880px, calc(100vw - 64px))', height: 'min(720px, calc(100vh - 80px))' }}>
        <SkillsLibrary skills={skills} setSkills={setSkills} projectId={projectId}
          opened={opened} onOpen={setOpened} onBack={() => setOpened(null)}
          onTry={(skill) => { studioHost?.useSkill?.({ name: skill.name, description: skill.description, newConversation: true }); onClose(); }} />
      </div>
    </>,
    document.body,
  );
}
