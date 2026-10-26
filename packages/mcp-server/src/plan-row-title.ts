// The title a plan card falls back on when the model wrote none: the first change's own row, in plain words, with a count of the rest.
import type { Translate } from "@extynt/ui-text";
import type { PlanValueRow } from "./plan-rows.js";
import { ENGLISH_TEXT } from "./plan-text.js";
import { isFallbackTitle } from "./queue-words.js";

function rowSentence(row: PlanValueRow, isSet: boolean, translate: Translate): string {
  const { label, after, target } = row;
  if (after && isSet && target) return translate("plan.title.labelToOn", { label, after, target });
  if (after && isSet) return translate("plan.title.labelTo", { label, after });
  return target ? translate("plan.title.labelOn", { label, target }) : label;
}

/** The plan's title: the one written when it was not made up, else the first row's sentence plus "and N more changes". `english` holds the same rows in English, which decide whether the first one is a "Set" row. */
export function planCardTitle(summary: string, rows: readonly PlanValueRow[], translate: Translate = ENGLISH_TEXT, english: readonly PlanValueRow[] = rows): string {
  const [first] = rows;
  if (!first || !isFallbackTitle(summary)) return summary;
  const sentence = rowSentence(first, english[0]?.label.startsWith("Set ") === true, translate);
  const more = rows.length - 1;
  return more > 0 ? translate("plan.title.andMore", { first: sentence, count: more }) : sentence;
}
