/**
 * Session config options — the shape `session/new` (and `session/set_config_option`,
 * `config_option_update`) report, and the flat leaf list the chat UI reads.
 *
 * ACP model control (dsh `packages/acp` src/model-control.ts) groups model choices by
 * provider: every top entry of the `model` select's `options` list is
 * `{ group, name, options: [leaf…] }` — a provider group, not a choice. The chat reads
 * that list flat (`optionLabel` lookup, `offeredChoices` filter, the set-value check in
 * `local-agent-run.ts` `setOption`), so groups are flattened where options enter
 * (`noteOptions`, the `config_option_update` event, the `set_config_option` answer);
 * with several providers each leaf keeps `Provider / model` so names stay unambiguous.
 *
 * 2026-11-23 用户报障:未摊平前模型行显示裸 JSON 路由值(`["tintin-server","deepseek…`)、
 * 悬浮菜单把供应商组名「TinTin」当唯一模型 —— 选择的智能体与模型对不上。
 */

export interface SessionConfigChoice {
  /** the choice's id — leaves carry it; provider groups do not (they hold `options`) */
  value?: unknown;
  name: string;
  description?: string;
  disabled?: boolean;
  /** provider group id — present on group entries only */
  group?: string;
  /** the provider group's model leaves — present on group entries only */
  options?: SessionConfigChoice[];
}

export interface SessionConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type?: string;
  currentValue?: unknown;
  options?: SessionConfigChoice[];
}

/** A provider group: no value of its own, carries the nested choices. */
function isProviderGroup(entry: SessionConfigChoice): boolean {
  return entry.value === undefined && Array.isArray(entry.options);
}

/** Flatten provider-grouped select options into the leaf list the UI reads. Options that
 *  are already flat (or a shape this does not recognise) pass through untouched. */
export function flattenSessionConfigOptions(options: SessionConfigOption[]): SessionConfigOption[] {
  return options.map((option) => {
    const entries = option.options ?? [];
    if (entries.length === 0 || !entries.every(isProviderGroup)) return option;
    const multi = entries.length > 1;
    const leaves = entries.flatMap((group) => (group.options ?? []).map((leaf) => (multi && group.name ? { ...leaf, name: `${group.name} / ${leaf.name}` } : leaf)));
    return { ...option, options: leaves };
  });
}
