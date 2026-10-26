// Runs a tool against the snapshot it can trust: the scoped collection snapshot only for the scoped writes it was demanded for, the whole project otherwise.
import type { ProjectSnapshot } from "@extynt/project-graph";

import type { PlanStateCapability } from "./server-plan-state.js";

const WHOLE_PROJECT_READS: ReadonlySet<string> = new Set(["ae_inspect_composition", "ae_inspect_layer", "ae_get_project_overview", "ae_find_project_objects", "ae_list_project_issues", "ae_measure_layer", "ae_get_effect_controls", "ae_get_current_context", "ae_get_selection", "ae_get_fresh_edit_context", "ae_trace_dependencies", "ae_get_inventory_diff", "ae_list_effects_and_expressions"]);
const SCOPED_PLAN_TOOLS: ReadonlySet<string> = new Set(["ae_propose_plan", "ae_prepare_change"]);
const SCOPED_ANSWERS: ReadonlySet<string> = new Set(["READ_SET_UNSUPPORTED", "TARGET_NOT_FOUND"]);

type Outcome = { ok: true } | { ok: false; error: { code: string } };

interface ScopedAwareDeps<R extends Outcome> {
  call(snapshot: ProjectSnapshot | undefined): R;
  whole(): ProjectSnapshot | undefined;
  demote(): void;
}

function scopedThenWhole<R extends Outcome>(current: ProjectSnapshot, deps: ScopedAwareDeps<R>): R {
  const scoped = deps.call(current);
  const whole = scoped.ok ? undefined : deps.whole();
  if (!whole || whole.coverage) return scoped;
  const retried = deps.call(whole);
  if (retried.ok) {
    deps.demote();
    return retried;
  }
  return SCOPED_ANSWERS.has(retried.error.code) ? scoped : retried;
}

/**
 * A scoped collection snapshot (what a bounded graph page observed) serves only the scoped write it was demanded for.
 * Inspections read the whole project. A plan is tried against the scoped observation first, the only one that can ground
 * a bounded write; when that refuses, against the whole project, which then becomes current again so apply and approval bind to it.
 * A whole-project refusal to take a scoped-only plan, or one over targets only the scoped read has seen, is an artefact of the older read, so the scoped refusal, which names the real fault and its next step, is the one returned.
 */
export function runScopedAware<R extends Outcome>(tool: string, current: ProjectSnapshot | undefined, deps: ScopedAwareDeps<R>): R {
  if (!current?.coverage) return deps.call(current);
  if (WHOLE_PROJECT_READS.has(tool)) return deps.call(deps.whole());
  return SCOPED_PLAN_TOOLS.has(tool) ? scopedThenWhole(current, deps) : deps.call(current);
}

/** The scoped-aware run over the plan state: the whole-project read, the way to make it current again and the call made under whichever snapshot is chosen. */
export function scopedCaller<R extends Outcome>(planState: Pick<PlanStateCapability, "normalizedWhole" | "demoteScoped">, call: (snapshot: ProjectSnapshot | undefined) => R): ScopedAwareDeps<R> {
  return {
    whole: () => planState.normalizedWhole(),
    demote: () => {
      planState.demoteScoped();
    },
    call,
  };
}
