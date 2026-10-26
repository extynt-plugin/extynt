// Everything one turn cost: the owner's loops plus every specialist call, as one agent.turn row.
import type { CallUsage } from "@extynt/decide";
import type { ChatProvider } from "@extynt/llm";
import type { AgentRunResult } from "./agent.js";
import type { JsonObject } from "@extynt/decode";
import { SIDECAR_BUILD_ID } from "./server-build.js";
import type { SidecarState } from "./server-state.js";

interface RoleUsage {
  readonly role: string;
  readonly model: string;
  readonly provider: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reported: boolean;
}

/** What a turn cost in total, with the same counts per role; inputTokens includes cachedInputTokens, as providers report it, and fresh = input - cached. */
export interface TurnUsage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly freshInputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly roles: readonly RoleUsage[];
}

interface SpecialistCall {
  readonly requestId: string;
  readonly role: string;
  readonly provider: ChatProvider;
  readonly usage: ReportedCounts;
  readonly calls?: number;
}

interface TurnRow {
  readonly requestId: string;
  readonly used: ChatProvider;
  readonly agent: AgentRunResult;
  readonly turn: TurnUsage;
  readonly extra?: JsonObject;
}

type ReportedCounts = { readonly inputTokens?: number | undefined; readonly outputTokens?: number | undefined; readonly cachedInputTokens?: number | undefined } | undefined;

type RoleTally = {
  readonly calls: number;
  readonly inputTokens: number;
  readonly freshInputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
};

const MAX_PENDING_TURNS = 20;
const MAIN_ROLE = "main";
const DECISIONS_ROLE = "decisions";

function withTokens(row: RoleUsage, usage: NonNullable<SpecialistCall["usage"]>): RoleUsage {
  const input = usage.inputTokens ?? 0;
  return {
    ...row,
    reported: true,
    inputTokens: row.inputTokens + input,
    outputTokens: row.outputTokens + (usage.outputTokens ?? 0),
    cachedInputTokens: row.cachedInputTokens + Math.min(usage.cachedInputTokens ?? 0, input),
  };
}

function withCall(row: RoleUsage, call: SpecialistCall): RoleUsage {
  const counted = { ...row, calls: row.calls + (call.calls ?? 1) };
  const { usage } = call;
  return usage?.inputTokens === undefined && usage?.outputTokens === undefined ? counted : withTokens(counted, usage);
}

function firstCall({ role, provider }: SpecialistCall): RoleUsage {
  return { role, model: provider.model, provider: provider.displayMetadata.displayName, calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reported: false };
}

function withDecisionCall(row: RoleUsage | undefined, call: CallUsage): RoleUsage {
  const base = row ?? { role: DECISIONS_ROLE, model: call.model ?? call.provider, provider: call.provider, calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reported: false };
  return { ...base, calls: base.calls + 1, inputTokens: base.inputTokens + (call.inputTokens ?? 0), reported: base.reported || call.inputTokens !== null };
}

/** Specialist and decision spend waits here, keyed by request, until the turn that caused it reports. */
export class SpecialistUsageLedger {
  private readonly turns = new Map<string, Map<string, RoleUsage>>();

  public add(call: SpecialistCall): void {
    const roles = this.rolesOf(call.requestId);
    roles.set(call.role, withCall(roles.get(call.role) ?? firstCall(call), call));
    this.keep(call.requestId, roles);
  }

  public addDecisions(requestId: string, calls: ReadonlyArray<CallUsage>): void {
    if (calls.length === 0) return;
    const roles = this.rolesOf(requestId);
    let row = roles.get(DECISIONS_ROLE);
    for (const call of calls) row = withDecisionCall(row, call);
    if (row !== undefined) roles.set(DECISIONS_ROLE, row);
    this.keep(requestId, roles);
  }

  public take(requestId: string): readonly RoleUsage[] {
    const roles = [...(this.turns.get(requestId)?.values() ?? [])];
    this.turns.delete(requestId);
    return roles;
  }

  private rolesOf(requestId: string): Map<string, RoleUsage> {
    return this.turns.get(requestId) ?? new Map<string, RoleUsage>();
  }

  private keep(requestId: string, roles: Map<string, RoleUsage>): void {
    this.turns.set(requestId, roles);
    for (const oldest of [...this.turns.keys()].slice(0, Math.max(0, this.turns.size - MAX_PENDING_TURNS))) this.turns.delete(oldest);
  }
}

function mainRole(agent: AgentRunResult, used: ChatProvider): RoleUsage {
  const reported = agent.usageReported === true, usage = agent.usage;
  return { role: MAIN_ROLE, model: used.model, provider: used.displayMetadata.displayName, calls: agent.steps, inputTokens: reported ? usage.inputTokens : 0, cachedInputTokens: reported ? usage.cachedInputTokens : 0, outputTokens: reported ? usage.outputTokens : 0, reported };
}

/** The turn's usage: the owner's loops as the `main` role, then each specialist and the turn's decisions. */
export function turnUsageOf(agent: AgentRunResult, used: ChatProvider, specialists: readonly RoleUsage[]): TurnUsage {
  const roles = [mainRole(agent, used), ...specialists];
  const sum = (field: "calls" | "inputTokens" | "cachedInputTokens" | "outputTokens"): number => roles.reduce((total, role) => total + role[field], 0);
  const inputTokens = sum("inputTokens"), cachedInputTokens = sum("cachedInputTokens");
  const specialistTokens = specialists.reduce((total, role) => total + role.inputTokens + role.outputTokens, 0);
  return { calls: sum("calls"), inputTokens, freshInputTokens: Math.max(0, inputTokens - cachedInputTokens), cachedInputTokens, outputTokens: sum("outputTokens"), totalTokens: agent.usage.totalTokens + specialistTokens, roles };
}

function roleFields(role: RoleUsage): RoleTally {
  return { calls: role.calls, inputTokens: role.inputTokens, freshInputTokens: Math.max(0, role.inputTokens - role.cachedInputTokens), cachedInputTokens: role.cachedInputTokens, outputTokens: role.outputTokens };
}

function turnPayload(state: Pick<SidecarState, "now">, { requestId, used, agent, turn, extra }: TurnRow): JsonObject {
  const roles = Object.fromEntries(turn.roles.map((role) => [role.role, roleFields(role)]));
  return { at: state.now().toISOString(), event: "agent.turn", requestId, provider: used.displayMetadata.displayName, outcome: agent.outcome, steps: agent.steps, tools: agent.tools.length, plans: agent.plans.map((plan) => plan.planId), tokens: turn.totalTokens, modelCalls: turn.calls, inputTokens: turn.inputTokens, freshInputTokens: turn.freshInputTokens, outputTokens: turn.outputTokens, cachedInputTokens: turn.cachedInputTokens, roles, build: SIDECAR_BUILD_ID, ...(agent.stopReason ? { stopReason: agent.stopReason } : {}), ...(agent.failure ? { failure: agent.failure.code } : {}), ...extra };
}

/** The agent.turn log row. A continuation stage writes its own, marked continuation:true, under the same requestId. */
export function logTurnRow(state: Pick<SidecarState, "now" | "options">, row: TurnRow): void {
  if (state.options.quietAgentLog) return;
  process.stdout.write(`${JSON.stringify(turnPayload(state, row))}\n`);
}
