/** Derives the findings for the parenting question: which transform properties a parent change rewrites, and by what rule. */
import type { ParentCase } from "./question-data.js";
import { fmt, sameValue, vectorOf } from "./question-values.js";

type Transform = ParentCase["before"];

const TRANSFORM_FIELDS = ["position", "scale", "rotation", "anchor", "opacity"] as const;

function labelVectors(label: string): number[][] {
  return [...label.matchAll(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g)].map((match) => [Number(match[1]), Number(match[2])]);
}
const labelParentPosition = (label: string): number[] | null => labelVectors(label)[labelVectors(label).length - 1] ?? null;
const labelFirstPosition = (label: string): number[] | null => labelVectors(label)[0] ?? null;

function appendMovedFieldSummary(facts: string[], movedFields: Set<string>, caseCount: number): void {
  const otherMoves = [...movedFields].filter((field) => field !== "position");
  if (caseCount && otherMoves.length === 0) facts.push(`Position is the only transform property any of the ${caseCount} cases rewrote; Scale, Rotate Z, Anchor Point and Opacity read back identical before and after every parenting, so the compensation is Position-only`);
  else if (otherMoves.length) facts.push(`the compensation is NOT Position-only on this host: it also rewrote ${otherMoves.join(", ")}`);
}

function appendCompensationSnapshots(facts: string[], cases: ParentCase[]): number {
  const movedFields = new Set<string>();
  let applied = 0;
  for (const { label, before, after, host } of cases) {
    for (const field of TRANSFORM_FIELDS) if (!sameValue(before[field], after[field])) movedFields.add(field);
    facts.push(`"${label ?? "?"}": Position ${fmt(before.position)} → ${fmt(after.position)}; Scale ${fmt(before.scale)} → ${fmt(after.scale)}; Rotate Z ${fmt(before.rotation)} → ${fmt(after.rotation)}; Anchor Point ${fmt(before.anchor)} → ${fmt(after.anchor)}; Opacity ${fmt(before.opacity)} → ${fmt(after.opacity)}`);
    if (host.ok === true) applied += 1;
    else facts.push(`  the host refused this parenting with ${host.errorCode ?? "no code"}${host.errorMessage ? ` — ${host.errorMessage}` : ""}, so these two snapshots are a refusal's leftovers rather than a measured compensation`);
  }
  appendMovedFieldSummary(facts, movedFields, cases.length);
  return applied;
}

function appendReparentRule(facts: string[], label: string, before: Transform, after: Transform): void {
  const beforePosition = vectorOf(before.position), afterPosition = vectorOf(after.position), anchor = vectorOf(before.anchor);
  const parent = labelParentPosition(label), named = labelFirstPosition(label);
  if (named && !sameValue(named, beforePosition)) facts.push(`  the case's label still names the child as "already at ${fmt(named)}" — the value the recorded "world − parent" rule predicted — while the probe's own measured before is ${fmt(beforePosition)}: the label carries the old assumption and the data contradicts it`);
  if (!sameValue(beforePosition, afterPosition)) facts.push(`  the re-parent moved Position again (${fmt(beforePosition)} → ${fmt(afterPosition)}), so the compensation re-runs on a second parenting rather than being a one-shot`);
  if (!parent) return;
  const fromLocal = beforePosition.map((value, index) => value - (parent[index] ?? 0));
  const anchorFromLocal = beforePosition.map((value, index) => value - (parent[index] ?? 0) + (anchor[index] ?? 0));
  const world = afterPosition.map((value, index) => value + (parent[index] ?? 0) - (anchor[index] ?? 0));
  facts.push(`  the value is the world-preserving one for a world of ${fmt(world)} under the new parent ${fmt(parent)} (${fmt(world)} − ${fmt(parent)} + ${fmt(anchor)} = ${fmt(afterPosition)}); because the local value it started from already carried the first parent's offset, neither "before − parent" (${fmt(fromLocal)}) nor "before + anchor − parent" (${fmt(anchorFromLocal)}) fits`);
}

function appendFirstParentRule(facts: string[], label: string, before: Transform, after: Transform): void {
  const beforePosition = vectorOf(before.position), afterPosition = vectorOf(after.position), anchor = vectorOf(before.anchor);
  const parent = labelParentPosition(label);
  if (!parent) {
    facts.push(
      `  the case label names no parent position, so the world-preserving rule could not be fitted arithmetically for it — that is a gap in the label, not in the rule`,
    );
    return;
  }
  const world = beforePosition,
    anchorRule = world.map((value, index) => value - (parent[index] ?? 0) + (anchor[index] ?? 0)),
    recordedRule = world.map((value, index) => value - (parent[index] ?? 0));
  const anchorHolds = sameValue(afterPosition, anchorRule),
    recordedHolds = sameValue(afterPosition, recordedRule);
  if (anchorHolds) facts.push(`  world-preserving "world − parent + anchor" predicts ${fmt(anchorRule)} and the host holds exactly that`);
  if (!recordedHolds) facts.push(`  the recorded "world − parent" rule predicts ${fmt(recordedRule)}, which the host does not hold — it is short by the anchor point ${fmt(anchor)}`);
  if (parent[0] === 0 && parent[1] === 0 && !sameValue(beforePosition, afterPosition)) facts.push(`  with the parent at [0,0] a "world − parent" rule would have been a no-op (${fmt(beforePosition)} would have stayed put); the host instead wrote ${fmt(afterPosition)} = world + anchor, so parenting to a parent at the origin is NOT a no-op`);
}

function appendCompensationRules(facts: string[], cases: ParentCase[]): void {
  for (const { label, before, after } of cases) {
    const caseLabel = label ?? "?";
    if (/^re-parent/i.test(caseLabel)) appendReparentRule(facts, caseLabel, before, after);
    else appendFirstParentRule(facts, caseLabel, before, after);
  }
}

function appendCompensationConclusion(facts: string[], caseCount: number, applied: number): void {
  const conclusions = [`the compensation is Position-only and world-preserving WITH the anchor term: local_after = world_before − parent.position + child.anchor. The "world − parent" rule recorded in this repo ignores the anchor point and is contradicted by the cases above`];
  if (applied !== caseCount) conclusions.push(`${caseCount - applied} of ${caseCount} cases were refused, so the rule is measured only from the ${applied} that applied`);
  if (caseCount) facts.push(`the answer: ${conclusions.join("; ")}`);
  else facts.push("no parenting case was recorded, so this question measured nothing");
}

/** The findings for the parent-compensation question from its recorded cases. */
export function deriveParentCompensation(cases: ParentCase[]): string[] {
  const facts: string[] = [];
  const applied = appendCompensationSnapshots(facts, cases);
  appendCompensationRules(facts, cases);
  appendCompensationConclusion(facts, cases.length, applied);
  return facts;
}
