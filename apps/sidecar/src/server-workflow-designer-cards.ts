// The plan cards of the plans the visual-scene designer sealed: kept per job, handed to every run of that job so each turn reports all of them.
import { planCard } from "./agent-plan.js";
import { embeddedSealsOf } from "./agent-tool-control.js";
import type { AgentPlanCard, ToolResult } from "./agent-types.js";

const held = new WeakMap<WeakKey, Map<string, AgentPlanCard[]>>();

function heldBy(state: WeakKey): Map<string, AgentPlanCard[]> {
  const existing = held.get(state);
  if (existing) return existing;
  const created = new Map<string, AgentPlanCard[]>();
  held.set(state, created);
  return created;
}

const MAX_JOBS = 8;

function trimJobs(jobs: Map<string, AgentPlanCard[]>): void {
  for (const oldest of jobs.keys()) {
    if (jobs.size <= MAX_JOBS) return;
    jobs.delete(oldest);
  }
}

function cardOf(seal: ToolResult, autoApply: boolean): AgentPlanCard | undefined {
  return seal.ok ? planCard(seal.data, {}, seal.sealedCard, autoApply) : undefined;
}

/** Keeps the cards of the plans a designer queue call sealed, replacing a card the job already holds for the same plan. */
export function noteDesignerSeals(state: WeakKey, note: { readonly jobId: string; readonly queued: ToolResult; readonly autoApply: boolean }): void {
  const seals = embeddedSealsOf(note.queued);
  const cards = (seals.length ? seals : [note.queued]).map((seal) => cardOf(seal, note.autoApply)).filter((card): card is AgentPlanCard => card !== undefined);
  if (!cards.length) return;
  const kept = heldBy(state).get(note.jobId) ?? [];
  for (const card of cards) {
    const index = kept.findIndex((entry) => entry.planId === card.planId);
    if (index >= 0) kept[index] = card;
    else kept.push(card);
  }
  heldBy(state).delete(note.jobId);
  heldBy(state).set(note.jobId, kept);
  trimJobs(heldBy(state));
}

/** Every card the designer sealed for the job, kept so a later run of the same job still reports the plans an earlier run's turn ended before. */
export function takeDesignerCards(state: WeakKey, jobId: string): AgentPlanCard[] {
  return [...(heldBy(state).get(jobId) ?? [])];
}
