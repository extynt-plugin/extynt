// The focus gate in front of the agent's tool calls and chat turns: which tools wait for a current read, which only mark a changed project, and the one shared deadline.
import { type JsonObject } from "@extynt/decode";
import { CACHE_READ_TOOLS, offlineReadNote } from "./offline-note.js";
import { compositionIdsMentioned, createCompositionGate } from "./composition-gate.js";
import { heldCompositions } from "./read-currency.js";
import { tickReadScheduler } from "./read-scheduler.js";
import { focusNote } from "./live-focus.js";
import type { FocusDeps, FocusGate } from "./server-focus-gate.js";

const WAITING_TOOLS: ReadonlySet<string> = new Set(["ae_propose_plan", "ae_plan_create", "ae_plan_add", "ae_offer_variants", "ae_create_vector_artwork", "ae_approve_plan"]);
const CONTEXT_TOOLS: ReadonlySet<string> = new Set(["ae_get_current_context", "ae_get_project_overview", "ae_get_bootstrap_context", "ae_inspect_composition", "ae_inspect_layer", "ae_find_project_objects"]);
const COMPOSITION_READ_TOOLS: ReadonlySet<string> = new Set(["ae_inspect_composition", "ae_inspect_layer", "ae_measure_layer", "ae_list_effects_and_expressions", "ae_trace_dependencies"]);

function joined(notes: ReadonlyArray<string | undefined>): string | undefined {
  return notes.filter((note): note is string => !!note).join(" ") || undefined;
}

function namedComposition(args: JsonObject | undefined, active: string | null | undefined): string[] {
  const named = args?.compositionId;
  const id = (typeof named === "string" && named) || active;
  return id ? [id] : [];
}

/** Gates the agent's tool calls and chat turns on a current read: the project first, then each composition the call names and the one After Effects has open. */
export class FocusTools {
  private readonly compositions: ReturnType<typeof createCompositionGate>;

  constructor(private readonly deps: FocusDeps, private readonly gate: FocusGate) {
    this.compositions = createCompositionGate(deps);
  }

  private async ensureCurrent(ids: readonly string[], signal?: AbortSignal): Promise<string | undefined> {
    const { state, planState } = this.deps;
    const deadline = state.now().getTime() + state.panelSnapshotWaitMs, seconds = () => Math.max(0, (deadline - state.now().getTime()) / 1000);
    const project = await this.gate.ensureFocusCurrent(seconds(), signal);
    const active = planState.normalizedLatest()?.activeCompositionId;
    const outcome = await this.compositions.ensureCompositionsCurrent(active ? [...ids, active] : ids, seconds(), signal);
    return joined([project.note, outcome.note]);
  }

  private projectNote(): string | undefined {
    const seen = this.gate.observe();
    if (seen?.difference !== "project") return undefined;
    tickReadScheduler(this.deps.state, "focus");
    return focusNote("project", seen.focus, seen.snapshot);
  }

  private async contextNotes(name: string, args: JsonObject | undefined): Promise<string | undefined> {
    const { state, planState } = this.deps;
    const target = namedComposition(args, planState.normalizedLatest()?.activeCompositionId);
    const stale = COMPOSITION_READ_TOOLS.has(name) ? (await this.compositions.ensureCompositionsCurrent(target)).note : undefined;
    return joined([stale, offlineReadNote(state) ?? (CONTEXT_TOOLS.has(name) ? this.projectNote() : undefined)]);
  }

  async beforeTool(name: string, agent = true, args?: JsonObject): Promise<string | undefined> {
    if (!agent) return undefined;
    if (WAITING_TOOLS.has(name)) return this.ensureCurrent(compositionIdsMentioned(args, heldCompositions(this.deps.state)));
    return CACHE_READ_TOOLS.has(name) ? this.contextNotes(name, args) : undefined;
  }

  async beforeTurn(turn: { signal?: AbortSignal; workflowCycle?: number }): Promise<string | undefined> {
    return (turn.workflowCycle ?? 0) > 0 ? undefined : this.ensureCurrent([], turn.signal);
  }
}
