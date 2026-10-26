// The per-job ledger of what the sidecar did for the model (ADR 0044): lines told once, the seals the model did not author, and the recheck they can trigger.
import type { WorkflowId } from "@extynt/workflow";
import { requestScale, type Checklist } from "./server-workflow-checklist-model.js";
import type { WorkflowSpecialistRole } from "./workflow-orchestration.js";

/** The specialists that answer once, without tools. */
export type OneShotRole = Extract<WorkflowSpecialistRole, "planner" | "reviewer" | "expression">;

/** What one role's calls cost and caught over a job: `caught` is items for the planner, fixes for the reviewer and expressions for the expression specialist. */
export type SpecialistTally = { calls: number; failed: number; inputTokens: number; outputTokens: number; ms: number; caught: number };

/**
 * One job's ledger. `lines` are the actions not yet told. `unlooked` counts the mutations the sidecar sealed that the model did not author since it last looked.
 * `recheck` is set when the project state is uncertain, and `feedback` is told to a cycle that has not started. `checklist` is the request as the model listed
 * it and is persisted with the workflow handoffs. `queueLabels` are the items the open queue's stage labels named, read at its seal; `lastLabels` are the items
 * the last labelled seal built (not persisted), which an unlabelled seal continues; `stageMissed` is set when the open queue's label named no item;
 * `unlabelledSeal` holds the items a seal without a stage was counted toward and the open ids, told once. `checklistNudged`, `stageCloseRechecked` and `planned`
 * record that the nudge, the stage-close recheck and the planner already ran. In a free run `mismatchBlocked` records that a mismatched batch already blocked the
 * job once, and `acceptedMismatches` lists the batches left applied with their read-back unverified. `specialistTally` is what the job's specialist calls cost.
 */
export interface SidecarActionLedger {
  lines: Array<{ text: string; read: boolean }>;
  unlooked: { batches: number; lackVisual: boolean };
  recheck?: string;
  feedback?: string;
  checklist?: Checklist;
  queueLabels?: string[];
  lastLabels?: string[];
  stageMissed?: boolean;
  unlabelledSeal?: { credited: string[]; open: string[] };
  checklistNudged?: boolean;
  stageCloseRechecked?: boolean;
  mismatchBlocked?: boolean;
  acceptedMismatches?: string[];
  planned?: boolean;
  specialistTally?: Partial<Record<OneShotRole, SpecialistTally>>;
}

interface GoalStore {
  readonly workflowStore: { getState(): { readonly jobs: Readonly<Record<string, { readonly goalSummary: string } | undefined>> } };
}

/** What the ledger needs of the server state; the workflow coordinator is present when the host has a workflow store. */
export interface SidecarActionHost {
  readonly workflowSidecarActions: Map<WorkflowId, SidecarActionLedger>;
  readonly options: { readonly workflowFreeRun?: boolean };
  readonly persistWorkflowHandoffs?: () => void;
  readonly workflowCoordinator?: GoalStore;
}

interface SeedHost extends SidecarActionHost {
  readonly workflowCoordinator: GoalStore & { jobIdForSeed(seed: string): WorkflowId };
}

/** Lines kept per job, so a long run's cost stays bounded. */
export const MAX_LEDGER_LINES = 20;

const RECHECK_BATCHES = 2;

function freshUnlooked(): SidecarActionLedger["unlooked"] {
  return { batches: 0, lackVisual: false };
}

function existingLedger(host: SidecarActionHost, jobId: WorkflowId | undefined): SidecarActionLedger | undefined {
  return jobId ? host.workflowSidecarActions.get(jobId) : undefined;
}

function isFreeRun(host: SidecarActionHost): boolean {
  return host.options.workflowFreeRun === true;
}

/** The job's ledger, created on first use. */
export function ledgerOf(host: SidecarActionHost, jobId: WorkflowId): SidecarActionLedger {
  const existing = host.workflowSidecarActions.get(jobId);
  if (existing) return existing;
  const created: SidecarActionLedger = { lines: [], unlooked: freshUnlooked() };
  host.workflowSidecarActions.set(jobId, created);
  return created;
}

/** The job's checklist, when it has one. */
export function checklistOf(host: SidecarActionHost, jobId: WorkflowId | undefined): Checklist | undefined {
  return existingLedger(host, jobId)?.checklist;
}

/** Saves the checklists with the workflow handoffs. */
export function persistChecklists(host: SidecarActionHost): void {
  host.persistWorkflowHandoffs?.();
}

/** The job's goal as the workflow store holds it (cut to the store's goal limit), when the host has a store. */
export function jobGoal(host: SidecarActionHost, jobId: WorkflowId): string | undefined {
  return host.workflowCoordinator?.workflowStore.getState().jobs[jobId]?.goalSummary;
}

/** Whether the job's stored goal is small enough to be one item; a job with no stored goal is long. */
export function jobScale(host: SidecarActionHost, jobId: WorkflowId): "small" | "long" {
  const goal = jobGoal(host, jobId);
  return goal === undefined ? "long" : requestScale(goal);
}

/** Appends one line (free run only). `sealed` marks a mutation the sidecar sealed that the model did not author; `visual` says whether its receipt carries visual coverage. */
export function recordSidecarAction(host: SidecarActionHost, jobId: WorkflowId | undefined, line: string, sealed?: { visual: boolean }): void {
  if (!jobId || !isFreeRun(host)) return;
  const ledger = ledgerOf(host, jobId);
  ledger.lines.push({ text: line, read: false });
  if (ledger.lines.length > MAX_LEDGER_LINES) ledger.lines.splice(0, ledger.lines.length - MAX_LEDGER_LINES);
  if (!sealed) return;
  ledger.unlooked.batches += 1;
  ledger.unlooked.lackVisual ||= !sealed.visual;
}

/** The unread lines, once: they are marked read as they are returned. */
export function drainSidecarActions(host: SidecarActionHost, jobId: WorkflowId | undefined): string[] {
  const unread = existingLedger(host, jobId)?.lines.filter((line) => !line.read) ?? [];
  for (const line of unread) line.read = true;
  return unread.map((line) => line.text);
}

/** The model looked at the project itself (a capture, an observation, an inspection): earlier sidecar seals no longer count. */
export function noteModelLooked(host: SidecarActionHost, jobId: WorkflowId | undefined): void {
  const ledger = existingLedger(host, jobId);
  if (ledger) ledger.unlooked = freshUnlooked();
}

/** Marks the project state uncertain (an unverified mutation, a batch rejected or abandoned after dispatch): the next cycle rechecks. */
export function requestRecheck(host: SidecarActionHost, jobId: WorkflowId | undefined, reason: string): void {
  if (jobId && isFreeRun(host)) ledgerOf(host, jobId).recheck = reason;
}

/** Why the next cycle is an observation-only recheck, or undefined: uncertain state, or sidecar seals the model did not author that lack visual coverage or number two or more. */
export function pendingRecheck(host: SidecarActionHost, jobId: WorkflowId | undefined): string | undefined {
  const ledger = existingLedger(host, jobId);
  if (!ledger) return undefined;
  if (ledger.recheck) return ledger.recheck;
  const { batches, lackVisual } = ledger.unlooked;
  if (batches >= RECHECK_BATCHES) return `the sidecar sealed ${batches} batches you did not author since you last looked`;
  return batches >= 1 && lackVisual ? "the sidecar sealed a batch you did not author and its receipt has no visual coverage" : undefined;
}

/** The recheck cycle has been started: the next one authors again unless something new happens. */
export function clearRecheck(host: SidecarActionHost, jobId: WorkflowId | undefined): void {
  const ledger = existingLedger(host, jobId);
  if (!ledger) return;
  delete ledger.recheck;
  ledger.unlooked = freshUnlooked();
}

/** Feedback for a cycle that has not started survives a window or continuation boundary. */
export function carryFeedback(host: SidecarActionHost, jobId: WorkflowId | undefined, message: string | undefined): void {
  if (jobId && message) ledgerOf(host, jobId).feedback = message;
}

/** The carried feedback, once. */
export function takeCarriedFeedback(host: SidecarActionHost, jobId: WorkflowId | undefined): string | undefined {
  const ledger = existingLedger(host, jobId);
  const message = ledger?.feedback;
  if (ledger) delete ledger.feedback;
  return message;
}

/** The lines as the model reads them. */
export function sidecarActionsText(lines: readonly string[]): string {
  return lines.length ? `While you worked, the sidecar did this for you (once):\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
}

function jobOfSeed(host: SeedHost, seed: string | undefined): WorkflowId | undefined {
  if (!seed) return undefined;
  try {
    return host.workflowCoordinator.jobIdForSeed(seed) || undefined;
  } catch {
    return undefined;
  }
}

/** recordSidecarAction for a tool call, which knows its job by the workflow seed. */
export function recordSeedAction(host: SeedHost, seed: string | undefined, line: string, sealed?: { visual: boolean }): void {
  if (isFreeRun(host)) recordSidecarAction(host, jobOfSeed(host, seed), line, sealed);
}

/** The unread lines for a tool call's job, once. */
export function drainSeedActions(host: SeedHost, seed: string | undefined): string[] {
  return isFreeRun(host) ? drainSidecarActions(host, jobOfSeed(host, seed)) : [];
}

/** noteModelLooked for a tool call, which knows its job by the workflow seed. */
export function noteSeedLooked(host: SeedHost, seed: string | undefined): void {
  noteModelLooked(host, jobOfSeed(host, seed));
}
