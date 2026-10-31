'use client';

/**
 * The conversation column of an empty project, before anything has been said.
 *
 * It is for anyone, not people who write briefs, so it doesn't teach how to write a prompt: it offers complete
 * sentences. One click puts a sentence in the composer, Enter starts it, nothing to fill in. They are everyday
 * things (a shop promo, a birthday wish, a trip, a pet, a bedtime story…), not jargon. "Shuffle" shows another
 * group.
 *
 * The line below says files can simply be added: not only photos and videos, but audio, slides, PDFs, sheets, any
 * file. That is the one other way in besides typing.
 *
 * TinTin cover (2026-10-28): the host may serve its own domain's starters (`app.starters()` — the cover editor
 * serves image/cover sentences); absent there, the built-in video ones stand, unchanged for the film chat.
 */
import React from 'react';
import {
  ArrowUpRight, Atom, Briefcase, Cake, Camera, Cat, ChartColumn, ChefHat, Dumbbell, Flower2, Heart, Images,
  Mic, Moon, Orbit, PartyPopper, Palette, Plane, Presentation, RefreshCw, Rocket, Scissors, ShoppingBag,
  Sparkles, Type, Upload, Wand2, type LucideIcon,
} from 'lucide-react';
import { useT } from '@/i18n';
import { BrandLogo } from './BrandLogo';
import { app } from '../app-bridge';

/**
 * Four groups of five, most common first (a promo, an explainer, a social ad, cutting your own footage, slides to
 * video); later groups are smaller everyday moments. Together they cover every kind of film the app makes.
 */
const GROUPS = [
  ['s1', 's2', 's3', 's4', 's5'],
  ['s6', 's7', 's8', 's9', 's10'],
  ['s11', 's12', 's13', 's14', 's15'],
  ['s16', 's17', 's18', 's19', 's20'],
] as const;

/**
 * A line icon before each sentence, so it is recognized at a glance before it is read.
 * Same color as the text, no backing: a signpost should not outshine the sentence.
 */
const ICONS: Record<string, LucideIcon> = {
  s1: Rocket, s2: Orbit, s3: ShoppingBag, s4: Scissors, s5: Presentation,
  s6: Sparkles, s7: Moon, s8: Flower2, s9: ChartColumn, s10: Atom,
  s11: Plane, s12: Cake, s13: Dumbbell, s14: Mic, s15: PartyPopper,
  s16: Cat, s17: Heart, s18: Briefcase, s19: ChefHat, s20: Images,
};

/** Icons for host-served starters, round-robin by position (cover's are image/cover flavoured). */
const HOST_ICONS: LucideIcon[] = [Images, Wand2, Palette, Type, Sparkles, Camera];

export function ProjectStarters({
  onPick,
  onAttach,
}: {
  /** Puts the sentence in the composer (unsent) and focuses it; Enter starts it. */
  onPick: (text: string) => void;
  onAttach: () => void;
}) {
  const t = useT();
  const [group, setGroup] = React.useState(0);
  /* Host-served starters (the cover editor's own domain); null until told, so the film chat
     renders its built-in groups with zero change. */
  const [hostLines, setHostLines] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    void Promise.resolve(app.starters?.() ?? null).then((lines) => {
      if (Array.isArray(lines) && lines.length) setHostLines(lines);
    }).catch(() => {});
  }, []);
  const built = GROUPS.map((ids) => ids.map((id) => t(`starter.${id}`)));
  const linesOf = (gi: number): string[] => {
    if (hostLines) {
      const size = 5;
      return hostLines.slice(gi * size, gi * size + size);
    }
    return built[gi] ?? [];
  };
  const groups = hostLines ? Math.ceil(hostLines.length / 5) : GROUPS.length;
  const iconOf = (gi: number, i: number): LucideIcon => (hostLines ? HOST_ICONS[(gi * 5 + i) % HOST_ICONS.length] : ICONS[GROUPS[gi]?.[i] ?? ''] ?? Sparkles);
  return (
    <div className="mx-auto w-full max-w-[400px] py-2">
      <BrandLogo size={26} />
      <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[var(--text)]">{t('starter.title')}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">{t('starter.hint')}</p>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-[12px] text-[var(--text-faint)]">{t('starter.tryLabel')}</span>
        <button
          type="button"
          onClick={() => setGroup((g) => (g + 1) % groups)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <RefreshCw size={11} />
          {t('starter.shuffle')}
        </button>
      </div>
      {/* All four groups stack in one grid cell, only the current one visible, so the height is always the tallest
          group's. Otherwise lines wrapping differently per group would change the height, and the centered title and
          "Shuffle" would jump out from under the pointer. */}
      <div className="mt-2 grid">
        {Array.from({ length: groups }, (_, gi) => {
          const on = gi === group;
          return (
            <ul
              key={on ? `on-${gi}` : gi}
              aria-hidden={!on}
              inert={!on}
              className={`col-start-1 row-start-1 flex flex-col gap-1.5 ${on ? '' : 'invisible'}`}
              style={on ? { animation: 'openfilm-rise 0.2s ease-out both' } : undefined}
            >
              {linesOf(gi).map((text, i) => {
                const Icon = iconOf(gi, i);
                return (
                  <li key={`${gi}-${i}`}>
                    <button
                      type="button"
                      onClick={() => onPick(text)}
                      className="group flex w-full items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-left text-[13.5px] leading-snug text-[var(--text)] transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
                    >
                      <Icon aria-hidden size={15} strokeWidth={1.8} className="shrink-0" />
                      <span className="min-w-0 flex-1">{text}</span>
                      <ArrowUpRight size={14} className="shrink-0 text-[var(--text-faint)] transition group-hover:text-[var(--text)]" />
                    </button>
                  </li>
                );
              })}
            </ul>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onAttach}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[12.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
      >
        <Upload size={14} />
        {t('starter.attach')}
      </button>
    </div>
  );
}
