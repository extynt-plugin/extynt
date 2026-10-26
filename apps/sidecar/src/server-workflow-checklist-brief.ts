/**
 * Verbatim brief coverage. An item is done after one verified batch, so a coarse list ticks whole sections off early. Every build item's spec must be a slice of
 * the brief copied word for word (case, whitespace, quote and dash styles and list markers aside), at most MAX_SPEC_SLICE_CHARS long, and the specs together
 * must hold the brief's substantive sentences: when more than MAX_UNCOVERED_SHARE of them are left out, the sidecar adds items for them. Small requests and
 * hosts with no stored goal are exempt.
 */
import { MAX_NAMED_OPEN, requestScale, type ChecklistItem } from "./server-workflow-checklist-model.js";

const MAX_SPEC_SLICE_CHARS = 400;
const TRUNCATED_GOAL_CHARS = 30_000;
const MAX_UNCOVERED_SHARE = 0.1;
const MIN_SENTENCE_CHARS = 20;
const GAP_TITLE_CHARS = 40;

interface Sentence { raw: string; folded: string }

function fold(text: string): string {
  return text.normalize("NFKC").replace(/[‘’ʼ]/gu, "'").replace(/[“”]/gu, '"').replace(/[–—−]/gu, "-")
    .replace(/^\s*(?:[-*•]|#+|\d+[.)])\s+/gmu, "").toLowerCase().replace(/\s+/g, " ").replace(/^[\s.,;:!?"'-]+|[\s.,;:!?"'-]+$/gu, "");
}

function briefSentences(brief: string): Sentence[] {
  const parts = brief.split(/\n+|(?<=[.!?])\s+/u).map((part) => part.replace(/^\s*(?:[-*•]|#+|\d+[.)])\s*/u, "").trim());
  return parts.filter((part) => part.length >= MIN_SENTENCE_CHARS && !/^[^.!?]{0,60}:$/u.test(part)).map((raw) => ({ raw, folded: fold(raw) }));
}

function listed(ids: readonly string[]): string {
  return `${ids.slice(0, MAX_NAMED_OPEN).join(", ")}${ids.length > MAX_NAMED_OPEN ? ` and ${ids.length - MAX_NAMED_OPEN} more` : ""}`;
}

function hasSpec(item: ChecklistItem): boolean {
  return item.kind !== "review" && !!item.spec?.trim();
}

/**
 * The brief the specs are checked against, or undefined when the job is exempt (a small request, or no stored goal). A stored goal this long was probably cut
 * to the workflow store's goal limit, and only then is the caller's whole first message used instead.
 */
export function briefToCheck(storedGoal: string | undefined, callerBrief: string | undefined): string | undefined {
  const cut = callerBrief !== undefined && storedGoal !== undefined && storedGoal.length >= TRUNCATED_GOAL_CHARS && callerBrief.length > storedGoal.length;
  const text = cut ? callerBrief : storedGoal;
  return text === undefined || requestScale(text) === "small" ? undefined : text;
}

/**
 * Build items whose spec is not in the brief word for word are left out rather than refusing the whole list: one reworded or invented item must not cost a long
 * plan. Coverage then judges what is left; a list with no copied spec is refused.
 */
export function withoutOffBrief(items: ChecklistItem[], text: string | undefined): { items: ChecklistItem[]; dropped: string[] } | { error: string } {
  if (text === undefined) return { items, dropped: [] };
  const flat = fold(text);
  const dropped = new Set(items.filter((item) => hasSpec(item) && !flat.includes(fold(item.spec ?? ""))).map((item) => item.id));
  if (!dropped.size) return { items, dropped: [] };
  const kept = items.filter((item) => !dropped.has(item.id)).map((item) => (item.covers ? { ...item, covers: item.covers.filter((id) => !dropped.has(id)) } : item));
  if (!kept.some(hasSpec)) return { error: `The spec of ${listed([...dropped])} is not copied from the request word for word. Paste the exact words instead.` };
  return { items: kept.filter((item) => item.kind !== "review" || !item.covers || item.covers.length > 0), dropped: [...dropped] };
}

function gapSpecs(uncovered: ReadonlyArray<Sentence>, flat: string): string[] {
  const specs: string[] = [];
  for (const { raw } of uncovered) {
    const last = specs.at(-1);
    const joined = last === undefined ? "" : `${last} ${raw}`;
    if (joined && joined.length <= MAX_SPEC_SLICE_CHARS && flat.includes(fold(joined))) specs[specs.length - 1] = joined;
    else specs.push(raw.slice(0, MAX_SPEC_SLICE_CHARS));
  }
  return specs;
}

function gapIdSource(taken: ReadonlySet<string>): () => string {
  let number = 0;
  const next = (): string => {
    number += 1;
    const candidate = `gap-${String(number).padStart(2, "0")}`;
    return taken.has(candidate) ? next() : candidate;
  };
  return next;
}

function gapItems(uncovered: ReadonlyArray<Sentence>, flat: string, taken: ReadonlySet<string>): ChecklistItem[] {
  const nextId = gapIdSource(taken);
  return gapSpecs(uncovered, flat).map((spec) => ({ id: nextId(), title: spec.length > GAP_TITLE_CHARS ? `${spec.slice(0, GAP_TITLE_CHARS - 1)}…` : spec, spec }));
}

function specRefusal(builds: readonly ChecklistItem[]): string | undefined {
  const missing = builds.filter((item) => !item.spec?.trim()).map((item) => item.id);
  if (missing.length) return `Every item needs a spec: the words of the request it covers, copied exactly. Missing on ${listed(missing)}.`;
  const long = builds.filter((item) => (item.spec?.length ?? 0) > MAX_SPEC_SLICE_CHARS).map((item) => item.id);
  return long.length ? `Too coarse: ${listed(long)} cover more than ${MAX_SPEC_SLICE_CHARS} characters of the request each. Split each into items of one shot or beat.` : undefined;
}

function coveredMask(flat: string, specs: readonly string[]): Uint8Array {
  const covered = new Uint8Array(flat.length);
  for (const spec of specs) {
    for (let at = flat.indexOf(spec); at >= 0; at = flat.indexOf(spec, at + 1)) covered.fill(1, at, at + spec.length);
  }
  return covered;
}

function locate(flat: string, sentence: Sentence, cursor: number): number {
  const found = flat.indexOf(sentence.folded, cursor);
  return found >= 0 ? found : flat.indexOf(sentence.folded);
}

function isUncovered(covered: Uint8Array, at: number, sentence: Sentence, specs: readonly string[]): boolean {
  const marked = at >= 0 ? covered.subarray(at, at + sentence.folded.length).reduce((sum, bit) => sum + bit, 0) : 0;
  return marked * 2 < sentence.folded.length && !specs.some((spec) => spec.includes(sentence.folded));
}

function uncoveredSentences(flat: string, sentences: readonly Sentence[], specs: readonly string[]): Sentence[] {
  const covered = coveredMask(flat, specs);
  const uncovered: Sentence[] = [];
  let cursor = 0;
  for (const sentence of sentences) {
    const at = locate(flat, sentence, cursor);
    if (at >= 0) cursor = at + sentence.folded.length;
    if (isUncovered(covered, at, sentence, specs)) uncovered.push(sentence);
  }
  return uncovered;
}

/** A refusal when a build item has no spec or too long a spec, else the gap items the list needs added for the brief's uncovered sentences (neighbouring sentences share an item while their joined words are still a slice of the brief), else nothing. */
export function granularityRefusal(all: readonly ChecklistItem[], text: string | undefined): string | { gaps: ChecklistItem[] } | undefined {
  if (text === undefined) return undefined;
  const builds = all.filter((item) => item.kind !== "review");
  const refusal = specRefusal(builds);
  if (refusal) return refusal;
  const flat = fold(text);
  const sentences = briefSentences(text);
  const uncovered = uncoveredSentences(flat, sentences, builds.map((item) => fold(item.spec ?? "")));
  return uncovered.length > sentences.length * MAX_UNCOVERED_SHARE ? { gaps: gapItems(uncovered, flat, new Set(all.map((item) => item.id))) } : undefined;
}
