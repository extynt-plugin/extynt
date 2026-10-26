// The pure reducer: applies one structured event to a sealed state, deduplicating by event identity and dispatching through the exhaustive transition table.

import { assert, fail, id, timestamp } from "./assertions.js";
import { boundedEventBytes, signature } from "./canonical-json.js";
import { assertEventOwner } from "./engine-gate.js";
import type { WorkflowEvent } from "./events.js";
import { finish, isTrustedState, mutable } from "./frozen-state.js";
import type { MutableWorkflowState } from "./frozen-state.js";
import { MAX_WORKFLOW_EVENT_SIGNATURES } from "./limits.js";
import { createWorkflowState } from "./state.js";
import type { WorkflowState } from "./state-types.js";
import type { EventOf, EventType, Transition, TransitionTable } from "./transition-table.js";
import { ADMISSION_TRANSITIONS } from "./transitions/admission.js";
import { AUTHORING_TRANSITIONS } from "./transitions/authoring.js";
import { COMPLETION_TRANSITIONS } from "./transitions/completion.js";
import { CRITERIA_TRANSITIONS } from "./transitions/criteria.js";
import { DISPATCH_TRANSITIONS } from "./transitions/execution.js";
import { PROPOSAL_TRANSITIONS } from "./transitions/proposals.js";
import { RECOVERY_DISPATCH_TRANSITIONS } from "./transitions/recovery.js";
import { RECOVERY_SETTLEMENT_TRANSITIONS } from "./transitions/recovery-settlement.js";
import { SETTLEMENT_TRANSITIONS } from "./transitions/settlement.js";

const TRANSITIONS: TransitionTable = {
  ...AUTHORING_TRANSITIONS,
  ...PROPOSAL_TRANSITIONS,
  ...ADMISSION_TRANSITIONS,
  ...CRITERIA_TRANSITIONS,
  ...COMPLETION_TRANSITIONS,
  ...DISPATCH_TRANSITIONS,
  ...SETTLEMENT_TRANSITIONS,
  ...RECOVERY_DISPATCH_TRANSITIONS,
  ...RECOVERY_SETTLEMENT_TRANSITIONS,
};

function applyTransition<Type extends EventType>(next: MutableWorkflowState, type: Type, event: EventOf<Type>): MutableWorkflowState {
  const transition: Transition<Type> | undefined = Object.hasOwn(TRANSITIONS, type) ? TRANSITIONS[type] : undefined;
  return transition === undefined ? fail("INVALID_EVENT", "Unsupported workflow event.") : transition(next, event);
}

function applyFreshEvent(previous: WorkflowState, event: WorkflowEvent): MutableWorkflowState {
  const next = mutable(previous);
  timestamp(event.at);
  id(event.eventId, "eventId");
  assertEventOwner(next, event);
  return applyTransition(next, event.type, event);
}

function priorOutcome(previous: WorkflowState, event: WorkflowEvent, eventSignature: string): WorkflowState | undefined {
  const seen = previous.eventSignatures[event.eventId];
  if (seen === undefined) return undefined;
  return seen === eventSignature ? previous : fail("DUPLICATE_EVENT_CONFLICT", `Event ${event.eventId} was already applied with different content.`);
}

/** Applies one structured event to a reducer-owned state; repeating an identical event ID returns the same state. */
export function applyWorkflowEvent(previous: WorkflowState, event: WorkflowEvent): WorkflowState {
  assert(previous !== null && typeof previous === "object" && isTrustedState(previous), "INVALID_EVENT", "Workflow state projections are reducer-owned; replay events through a WorkflowStore instead of supplying arbitrary state.");
  boundedEventBytes(event);
  const eventSignature = signature(event);
  const prior = priorOutcome(previous, event, eventSignature);
  if (prior !== undefined) return prior;
  assert(Object.keys(previous.eventSignatures).length < MAX_WORKFLOW_EVENT_SIGNATURES, "EVENT_LOG_FULL", "The bounded workflow event identity ledger is full.");
  const next = applyFreshEvent(previous, event);
  next.eventSignatures = { ...next.eventSignatures, [event.eventId]: eventSignature };
  return finish(next);
}

/** Rebuilds a state by applying every event, in order, to an empty one. */
export function replayWorkflowEvents(events: readonly WorkflowEvent[]): WorkflowState {
  return events.reduce(applyWorkflowEvent, createWorkflowState());
}

/** The state as JSON text. */
export function serializeWorkflowState(state: WorkflowState): string {
  return JSON.stringify(state);
}
