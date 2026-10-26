/**
 * Reasoning effort as the model menu shows it: the stored choice, the level a request actually sends for it, and the
 * levels the model offers. Pure, so the words and the checked row are one rule for the pill, the menu and the status line.
 */
import type { Translate } from "@extynt/ui-text";
import { capitalized } from "./panel-model-label.js";
import type { ModelSlot } from "./panel-model-wire.js";

const EFFORT_REFRESH_MS = 5 * 60 * 1000;

interface EffortChoice {
  readonly stored: string | null;
  readonly effective: string | null;
  readonly adjusted: boolean;
}

/** One row of the effort list; `label` is its words, `value` is what to save, and empty means "Default". */
export interface EffortRow {
  readonly label: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly value: string;
}

/**
 * What the user chose (`stored`, null for "Default", which sends no effort parameter) and what a request sends because of
 * it (`effective`, null when nothing is chosen or the model takes no effort control); `adjusted` is true when the model
 * does not offer the stored level and the effective one stands in for it. `slot` holds the stored choice; `active` is the
 * running model, which knows the level it sends.
 */
export function effortChoice(slot: ModelSlot | null, active: ModelSlot | null): EffortChoice {
  const stored = slot?.reasoningEffort || null;
  if (stored === null) return { stored: null, effective: null, adjusted: false };
  const reported = active?.effectiveEffort === undefined ? stored : active.effectiveEffort;
  const effective = reported || null;
  return { stored, effective, adjusted: effective !== stored };
}

function levelWord(level: string, translate: Translate): string {
  if (level === "low") return translate("model.effort.low");
  if (level === "medium") return translate("model.effort.medium");
  if (level === "high") return translate("model.effort.high");
  return capitalized(level);
}

/** "Default", "high", or "high (medium is not offered by this model)", in the language `translate` speaks. */
export function effortWords(choice: EffortChoice, translate: Translate): string {
  if (!choice.stored) return translate("model.effort.default");
  if (!choice.adjusted) return choice.stored;
  if (!choice.effective) return translate("model.effort.noSetting");
  return translate("model.effort.notOffered", { level: choice.effective, stored: choice.stored });
}

/** The Default row, then one row per level the model offers; the checked row is the level a request sends. */
export function effortRows(choice: EffortChoice, offered: ReadonlyArray<string>, translate: Translate): ReadonlyArray<EffortRow> {
  const defaultRow: EffortRow = { label: translate("model.effort.default"), detail: "", selected: !choice.stored, value: "" };
  const levelRows = offered.map((level): EffortRow => {
    const selected = !!choice.stored && choice.effective === level;
    const detail = selected && choice.adjusted && choice.stored ? translate("model.effort.sentInPlace", { stored: choice.stored }) : "";
    return { label: levelWord(level, translate), detail, selected, value: level };
  });
  return [defaultRow, ...levelRows];
}

/** A list is stale after the refresh period, and also when the clock has gone backwards. */
export function effortListStale(fetchedAt: number, now: number): boolean {
  const age = now - fetchedAt;
  return age < 0 || age >= EFFORT_REFRESH_MS;
}
