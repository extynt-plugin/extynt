/** The words of a run of plans in the thread: "Batches 1–6 · 38 ops · verified". Pure, so no panel is booted. */
import { isActionable } from "./panel-plan-labels.js";
import { t } from "./panel-language.js";

export interface FoldFact { status: string; operations: number; partly: boolean; title: string }

const APPLIED = new Set(["verified", "applied"]);
const MAX_NAMED = 2;
const ACTIVE = new Set(["approved", "applying", "undo_requested"]);

function failedFacts(facts: FoldFact[]): FoldFact[] {
  return facts.filter((fact) => fact.status === "failed" && !fact.partly);
}

function failedState(facts: FoldFact[]): string {
  const failed = failedFacts(facts);
  if (!failed.length) return "";
  return failed.length === facts.length ? t("plans.run.didntApply") : t("plans.run.appliedOf", { done: facts.filter((fact) => APPLIED.has(fact.status)).length, total: facts.length });
}

function failedNames(facts: FoldFact[]): string {
  const failed = failedFacts(facts);
  if (!failed.length || failed.length === facts.length) return "";
  const names = failed.slice(0, MAX_NAMED).map((fact) => fact.title).join(", ");
  return t("plans.run.failed", { names: failed.length > MAX_NAMED ? t("plans.run.andMore", { names, count: failed.length - MAX_NAMED }) : names });
}

/** The state of a whole run in one word: waiting beats applying beats a failure beats verified. */
export function runState(facts: FoldFact[]): string {
  if (facts.some((fact) => isActionable(fact.status))) return t("plans.run.waiting");
  if (facts.some((fact) => fact.status === "draft")) return t("plans.run.drafting");
  if (facts.some((fact) => ACTIVE.has(fact.status))) return t("plans.run.applying");
  const failed = failedState(facts);
  if (failed) return failed;
  if (facts.every((fact) => APPLIED.has(fact.status))) return t("plans.run.verified");
  if (facts.every((fact) => fact.status === "undone" || fact.status === "cancelled")) return facts.every((fact) => fact.status === "cancelled") ? t("plans.run.discarded") : t("plans.run.undone");
  return t("plans.run.done");
}

/** "Batches 1–6 · 38 ops · verified" for a run, "Fade in the title · 3 ops · verified" for one plan. `partly` counts the ones that applied only in part. */
export function planRunWords(facts: FoldFact[]): { text: string; partly: number } {
  const ops = facts.reduce((sum, fact) => sum + fact.operations, 0), partly = facts.filter((fact) => fact.partly).length;
  const label = facts.length === 1 ? (facts[0]?.title ?? "") : t("plans.fold.range", { first: 1, last: facts.length });
  return { text: [label, t("plans.unit.op", { count: ops }), runState(facts), failedNames(facts)].filter(Boolean).join(" · "), partly: partly };
}
