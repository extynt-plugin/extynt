// The queue's own wording: the plan tools' names in the queue's vocabulary, call positions as runs, the card title, and a stable signature of a submitted group.
import { stringAt } from "./json.js";
import { isJsonObject } from "@extynt/decode";
import type { JsonArray, JsonValue } from "@extynt/decode";
import type { ToolFailure } from "./tool-result.js";

const SUMMARY_CHARS = 512;

/** Rewrites the plan lifecycle's tool names into the queue's own, because a caller has none of those names on its surface. */
export function queueVocabulary(message: string): string {
  return message
    .replace(/ae_plan_add/g, "ae_queue_add")
    .replace(/ae_plan_complete/g, "ae_queue_finish")
    .replace(/ae_amend_plan/g, "ae_queue_fix")
    .replace(/read it back with ae_recall_plan and start a new plan against the current project/gi, "call ae_refresh_snapshot and start a new queue against the current project");
}

/** The same refusal, in the caller's vocabulary. */
export function inQueueVocabulary(failure: ToolFailure): ToolFailure {
  return { ok: false, error: { ...failure.error, message: queueVocabulary(failure.error.message) } };
}

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isJsonObject(value)) return value;
  const sorted = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(sorted.map(([key, entry]) => [key, canonical(entry)]));
}

/** A fingerprint of one submitted group that ignores key order, because a model rewriting the same operation after a lost result may spell its keys differently; any changed value or extra operation is a different group. */
export function queueGroupSignature(operations: JsonArray): string {
  return JSON.stringify(canonical(operations));
}

const GENERIC_TITLE = "Make a change";

const PLAIN_TITLES: Readonly<Record<string, string>> = {
  ensure_effect: "Add an effect", set_effect_control: "Set an effect value", create_layer: "Add a layer", remove_layer: "Remove a layer", set_layer_property: "Change a layer property", set_layer_name: "Rename a layer",
};

function firstType(operations: JsonArray): string {
  const [first] = operations;
  return (isJsonObject(first) ? stringAt(first, "type") : undefined) ?? "";
}

/** A title for the reader's card when the model did not offer one: what the first change does in plain words, never an operation's own name. */
export function queueSummary(summary: string | undefined, operations: JsonArray): string {
  const written = summary?.trim() ?? "";
  if (written) return written.slice(0, SUMMARY_CHARS);
  const base = PLAIN_TITLES[firstType(operations)] ?? GENERIC_TITLE;
  const more = operations.length - 1;
  return (more > 0 ? `${base} and ${more} more ${more === 1 ? "change" : "changes"}` : base).slice(0, SUMMARY_CHARS);
}

/** Call positions as a compact list such as "3, 7" or "25–29, 31–49", so a refusal names what to change by position in the call that was sent. */
export function positionRuns(positions: readonly number[]): string {
  const runs: Array<[number, number]> = [];
  for (const position of [...positions].sort((left, right) => left - right)) {
    const last = runs.at(-1);
    if (last && position === last[1] + 1) last[1] = position;
    else runs.push([position, position]);
  }
  return runs.map(([from, to]) => (from === to ? String(from) : `${from}–${to}`)).join(", ");
}

const FALLBACK_BASES: readonly string[] = [GENERIC_TITLE, ...Object.values(PLAIN_TITLES)];

const MORE_CHANGES = / and \d+ more changes?$/;

/** Whether a plan title is one `queueSummary` made up because the model wrote none, so the card may name the real change instead. */
export function isFallbackTitle(title: string): boolean {
  return FALLBACK_BASES.includes(title.replace(MORE_CHANGES, ""));
}
