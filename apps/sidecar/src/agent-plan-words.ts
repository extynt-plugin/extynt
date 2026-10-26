// Plain words for what a plan did, for the reply a turn ends on when the model wrote none.
import { changesNothing } from "@extynt/mcp-server";
import type { Translate } from "@extynt/ui-text";
import type { AgentPlanCard } from "./agent-types.js";
import { ENGLISH_TEXT } from "./plan-text.js";

const GENERIC_TITLE = /^(queued\b|[a-z0-9]+(?:[_-][a-z0-9]+)+$)/i;
const MAX_NAMED = 3;

function plainPlanTitle(plan: AgentPlanCard, translate: Translate): string {
  const title = plan.title.replace(/[.\s]+$/, "");
  if (title && !GENERIC_TITLE.test(title) && title !== plan.planId) return title;
  const row = plan.rows?.[0];
  if (row) return row.target ? translate("plan.applied.changedOn", { label: row.label, target: row.target }) : translate("plan.applied.changed", { label: row.label });
  return translate("plan.applied.madeChanges", { count: plan.operations.length || 1 });
}

function titleCounts(plans: readonly AgentPlanCard[], translate: Translate): string[] {
  const counts = new Map<string, number>();
  for (const plan of plans) {
    const title = plainPlanTitle(plan, translate);
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return [...counts].map(([title, count]) => (count > 1 ? translate("plan.applied.times", { title, count }) : title));
}

function changedPlans(plans: readonly AgentPlanCard[]): AgentPlanCard[] {
  return plans.filter((plan) => !changesNothing(plan.rows ?? []));
}

/** The reply naming the plans a turn applied, each by its title, however many; plans with the same title are counted once with how many times. English unless a translator is given. */
export function appliedWords(plans: readonly AgentPlanCard[], translate: Translate = ENGLISH_TEXT): string {
  const changed = changedPlans(plans);
  if (!changed.length) return translate(plans.length ? "plan.applied.nothingChanged" : "plan.applied.plan");
  const titles = titleCounts(changed, translate).join(translate("plan.applied.separator"));
  if (changed.length <= MAX_NAMED) return translate("plan.applied.few", { titles });
  return translate("plan.applied.many", { count: changed.length, titles });
}
