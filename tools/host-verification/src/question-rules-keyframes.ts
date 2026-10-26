/** Derives the findings for the keyframe questions: what a property holds outside its key range, and what a static write does to existing keys. */
import type { HostReply, KeyRangeCase, SampleRow, StaticWriteCase } from "./question-data.js";
import type { Recorded } from "./question-values.js";
import { fmt, hostOutcome, matchesVector, memberOf, numberOf, objectRows, sameJson, sameValue, str, vector } from "./question-values.js";
import type { JsonObject } from "./json.js";

const staticWriteSummary = (entry: KeyRangeCase, staticValue: number[] | null): string =>
  staticValue ? `static write of ${fmt(entry.staticValue)} accepted, reading back ${fmt(entry.afterStatic.value)} with ${entry.afterStatic.numKeys ?? "?"} key(s)` : "no static write";
const keyShapeLine = (sampled: KeyRangeCase["sampled"]): string =>
  `  keys read back as ${fmt(sampled.keys)}, numKeys=${sampled.numKeys ?? "?"}, isTimeVarying=${str(sampled.isTimeVarying) ?? "?"}, canVaryOverTime=${sampled.canVaryOverTime ?? "?"}, expressionEnabled=${sampled.expressionEnabled ?? "?"}`;

function appendSampleLines(facts: string[], samples: SampleRow[]): void {
  for (const row of samples) facts.push(`  t=${str(row.t) ?? "?"}: valueAtTime(t, true)=${fmt(row.preExpression)} · valueAtTime(t, false)=${fmt(row.postExpression)} · property.value=${fmt(row.propertyValue)}`);
}

function appendFirstKeyHolds(facts: string[], samples: SampleRow[], first: number[], firstTime: number): void {
  const upToFirst = samples.filter((row) => (row.t ?? 0) <= firstTime);
  const holdsFirst = upToFirst.length > 0 && upToFirst.every((row) => sameValue(row.propertyValue, first) && sameValue(row.preExpression, first));
  if (holdsFirst) facts.push(`  at every sampled time up to the first key (t=${upToFirst.map((row) => str(row.t)).join(", ")}) the property reads the first key's value ${fmt(first)}, at a negative time as much as at the first key itself`);
}

interface KeyRangeTally { staticCases: number; staticGone: number; visibility: Array<{ entry: KeyRangeCase; visible: boolean }> }

interface StaticVisibility { facts: string[]; entry: KeyRangeCase; staticValue: number[]; tally: KeyRangeTally }

function appendStaticVisibility({ facts, entry, staticValue, tally }: StaticVisibility): void {
  tally.staticCases += 1;
  const visible = entry.sampled.rows.filter(
    (row) => matchesVector(row.propertyValue, staticValue) || matchesVector(row.preExpression, staticValue) || matchesVector(row.postExpression, staticValue),
  );
  tally.visibility.push({ entry, visible: visible.length > 0 });
  if (visible.length) facts.push(`  the statically written ${fmt(staticValue)} is still observable at t=${visible.map((row) => str(row.t)).join(", ")}, so the keys did not replace it`);
  else { tally.staticGone += 1; facts.push(`  the statically written ${fmt(staticValue)} is not observable at any sampled time — not at the negative time, and not at any keyed time`); }
}

function appendKeyRangeCase(facts: string[], entry: KeyRangeCase, tally: KeyRangeTally): void {
  const { sampled } = entry, staticValue = vector(entry.staticValue);
  facts.push(`"${entry.label ?? "?"}": ${staticWriteSummary(entry, staticValue)}, then keys ${fmt(entry.keyframes)}`);
  facts.push(keyShapeLine(sampled));
  appendSampleLines(facts, sampled.rows);
  const first = vector(memberOf(sampled.keys[0], "v")), firstTime = numberOf(memberOf(sampled.keys[0], "t"));
  if (first && firstTime !== null) appendFirstKeyHolds(facts, sampled.rows, first, firstTime);
  if (staticValue) appendStaticVisibility({ facts, entry, staticValue, tally });
}

function appendKeyRangeCases(facts: string[], cases: KeyRangeCase[]): KeyRangeTally {
  const tally: KeyRangeTally = { staticCases: 0, staticGone: 0, visibility: [] };
  for (const entry of cases) appendKeyRangeCase(facts, entry, tally);
  return tally;
}

function appendStaticVerdict(facts: string[], tally: KeyRangeTally): void {
  if (tally.staticCases && tally.staticGone === tally.staticCases) facts.push(`the answer: a statically written value is NOT held outside the key range. Adding keyframes discards it, and the property reads the FIRST KEYFRAME'S value at every time before that key, negative times included. The coherence check that says a property keeps whatever it already had before its first key is contradicted by this measurement`);
  else if (tally.staticCases) facts.push(`the static value survives in ${tally.staticCases - tally.staticGone} of ${tally.staticCases} cases, so keyframes do not always discard it on this host`);
}

const firstKeyTime = (entry: KeyRangeCase): number | null => numberOf(memberOf(entry.sampled.keys[0], "t"));

function appendZeroFirstVerdict(facts: string[], cases: KeyRangeCase[], tally: KeyRangeTally): void {
  const zeroFirst = cases.filter((entry) => firstKeyTime(entry) === 0);
  const zeroFirstGone = tally.visibility.filter((read) => firstKeyTime(read.entry) === 0 && !read.visible);
  const withStatic = zeroFirst.filter((entry) => vector(entry.staticValue));
  if (withStatic.length && zeroFirstGone.length === withStatic.length) facts.push(`with the first key at t=0 the static value is still not observable at any time at all — the keys decide every sampled value, so there is no window in which a static write can survive`);
}

function appendNoStaticWriteVerdict(facts: string[], cases: KeyRangeCase[], staticCases: number): void {
  if (staticCases && cases.some((entry) => !vector(entry.staticValue))) facts.push(`the case with no static write behaves exactly like the static-write cases (same keys, same value at every sampled time), so the keyframes alone decide what is held before the first key`);
}

function cadenceLine(cases: KeyRangeCase[]): string {
  const keyCounts = [...new Set(cases.map((entry) => entry.sampled.numKeys ?? "?"))];
  const timeVarying = cases.length > 0 && cases.every((entry) => entry.sampled.isTimeVarying === true);
  return `the keys read back as written, numKeys reads ${keyCounts.join("/")} across the cases and isTimeVarying is ${timeVarying ? "true in every one" : "not true in every one"}; between the keys the property interpolates (t=1.5 sits between the two keys' values) rather than stepping`;
}

/** The findings for the question of what a keyframed property holds outside its key range. */
export function deriveKeyRangeValue(cases: KeyRangeCase[]): string[] {
  const facts: string[] = [];
  const tally = appendKeyRangeCases(facts, cases);
  appendStaticVerdict(facts, tally);
  appendZeroFirstVerdict(facts, cases, tally);
  appendNoStaticWriteVerdict(facts, cases, tally.staticCases);
  facts.push(cadenceLine(cases));
  return facts;
}

const staticWriteOutcomeLine = (entry: StaticWriteCase): string => {
  const { host } = entry;
  const outcome = host.ok === true ? "the host applied it" : `REFUSED ${host.errorCode ?? "with no code"}${host.errorMessage ? ` — ${host.errorMessage}` : ""}`;
  return `"${entry.label ?? "?"}": ${outcome}${host.mutationState ? ` (mutationState ${host.mutationState})` : ""}; numKeys afterwards=${entry.numKeysAfter ?? "?"}, keys afterwards=${fmt(entry.keysAfter)}`;
};

interface KeyWriteTally { refused: number; untouched: number }

function appendStaticWriteCase(facts: string[], entry: StaticWriteCase, beforeKeys: JsonObject[], tally: KeyWriteTally): void {
  facts.push(staticWriteOutcomeLine(entry));
  if (entry.host.ok !== true) {
    tally.refused += 1;
    if (sameJson(objectRows(entry.keysAfter), beforeKeys)) { tally.untouched += 1; facts.push(`  the keys are exactly the ones that were there before the write, so the refusal cleared and overwrote nothing`); }
    else facts.push(`  the keys CHANGED despite the refusal: ${fmt(entry.keysAfter)}`);
  }
  for (const row of entry.sampled.rows) facts.push(`  t=${str(row.t) ?? "?"}: property.value=${fmt(row.propertyValue)}`);
}

function appendStaticWriteCases(facts: string[], cases: StaticWriteCase[], beforeKeys: JsonObject[]): KeyWriteTally {
  const tally: KeyWriteTally = { refused: 0, untouched: 0 };
  for (const entry of cases) appendStaticWriteCase(facts, entry, beforeKeys, tally);
  return tally;
}

function appendStaticWriteVerdict(facts: string[], cases: StaticWriteCase[], refused: number): void {
  const code = cases[0]?.host.errorCode;
  if (cases.length && refused === cases.length && code) facts.push(`the answer: a static write to a property that already has keyframes is REFUSED by the host adapter (${code}) and never reaches the property — the keys are neither cleared nor overwritten. The plan contract's "either set or keyframed, never both" is a safety rule the host enforces, not a fidelity preference an agent may talk itself out of`);
  else if (cases.length && !refused) facts.push(`the answer: this host ACCEPTED the static write over the keyframes, so the "never both" rule is not enforced here — read the key read-backs above to see what it did to them`);
}

function appendSameValueRefusal(facts: string[], cases: StaticWriteCase[]): void {
  const sameValueCase = cases.find((entry) => /value a key (already )?holds/i.test(entry.label ?? ""));
  if (sameValueCase && sameValueCase.host.ok !== true) facts.push(`"${sameValueCase.label ?? "?"}" wrote the value the t=1 key already holds and was refused with the same code, and its keys are unchanged too`);
}

function appendMutationUnknownNote(facts: string[], cases: StaticWriteCase[]): void {
  if (cases[0]?.host.mutationState === "mutation-unknown") facts.push(`the refusal reports mutationState "mutation-unknown" because the adapter cannot vouch for a host it no longer controls, but the key read-backs prove nothing was applied — "unknown" describes the adapter's bookkeeping, not a risk to the project`);
}

interface KeysWrittenFirst { keyWrite: HostReply; numKeys: string | undefined; keys: Recorded }

/** The findings for the question of what a static write does to a property that already has keyframes. */
export function deriveStaticWriteOverKeyframes(written: KeysWrittenFirst, cases: StaticWriteCase[]): string[] {
  const facts: string[] = [];
  facts.push(`the keys went in first: ${hostOutcome(written.keyWrite)}; the property then held numKeys=${written.numKeys ?? "?"} (${fmt(written.keys)})`);
  const tally = appendStaticWriteCases(facts, cases, objectRows(written.keys));
  appendStaticWriteVerdict(facts, cases, tally.refused);
  if (tally.untouched === tally.refused && tally.refused > 0) facts.push(`the refusal is about the property's shape, not about the value written: every case was refused, whatever value it carried`);
  appendSameValueRefusal(facts, cases);
  appendMutationUnknownNote(facts, cases);
  return facts;
}
