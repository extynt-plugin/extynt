// The event store: an append-only, size-bounded event log whose projection is owned by the reducer, optionally persisted through a callback.

import { assert, id } from "./assertions.js";
import { boundedEventBytes } from "./canonical-json.js";
import type { WorkflowEvent } from "./events.js";
import { clone, deepFreeze } from "./frozen-state.js";
import { MAX_WORKFLOW_EVENT_LOG_BYTES } from "./limits.js";
import { applyWorkflowEvent, serializeWorkflowState } from "./reducer.js";
import { classifyWorkflowRecovery } from "./restart-recovery.js";
import { createWorkflowState, job } from "./state.js";
import type { WorkflowState } from "./state-types.js";
import type { EventType } from "./transition-table.js";
import type { InMemoryWorkflowStore, WorkflowStore } from "./store-types.js";

type PersistEvents = (events: readonly WorkflowEvent[]) => void;
interface Projection {
  readonly state: WorkflowState;
  readonly log: readonly WorkflowEvent[];
  readonly bytes: number;
}

const SETTLEMENT_RESERVE_BYTES = 512 * 1024;
const AUTHORING_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  "job.opened", "stage.opened", "batch.proposed", "operation.proposed",
  "authority.recorded", "batch.admitted", "batch.approvalBound", "observation.recorded", "criterion.satisfied",
]);

function eventByteLimit(event: WorkflowEvent): number {
  return AUTHORING_EVENT_TYPES.has(event.type) ? MAX_WORKFLOW_EVENT_LOG_BYTES - SETTLEMENT_RESERVE_BYTES : MAX_WORKFLOW_EVENT_LOG_BYTES;
}

function appendEvents(base: Projection, events: readonly WorkflowEvent[]): Projection {
  let state = base.state;
  let bytes = base.bytes;
  const committed: WorkflowEvent[] = [];
  for (const event of events) {
    const eventBytes = boundedEventBytes(event);
    const duplicate = state.eventSignatures[event.eventId] !== undefined;
    if (!duplicate) assert(bytes + eventBytes <= eventByteLimit(event), "EVENT_LOG_FULL", "The bounded workflow event log is full.");
    const before = state;
    state = applyWorkflowEvent(state, event);
    if (before !== state) {
      committed.push(deepFreeze(clone(event)));
      bytes += eventBytes;
    }
  }
  return { state, log: [...base.log, ...committed], bytes };
}

/** Creates a store that first replays the given events and then appends further ones, calling `persistEvents` with the complete new log before any appended event becomes visible. */
export function createWorkflowEventStore<Resumable extends boolean>(events: readonly WorkflowEvent[], resumeSupported: Resumable, persistEvents?: PersistEvents): WorkflowStore & { readonly resumeSupported: Resumable } {
  let projection = appendEvents({ state: createWorkflowState(resumeSupported), log: [], bytes: 0 }, events);
  const appendBatch = (batch: readonly WorkflowEvent[]): WorkflowState => {
    const next = appendEvents(projection, batch);
    if (next.log.length > projection.log.length) persistEvents?.(next.log);
    projection = next;
    return projection.state;
  };
  return {
    resumeSupported,
    getState: () => projection.state,
    project: () => projection.state,
    append: (event) => appendBatch([event]),
    appendBatch,
    listEvents: (jobId) => {
      id(jobId, "jobId");
      return projection.log.filter((event) => event.jobId === jobId);
    },
    loadJob: (jobId) => {
      id(jobId, "jobId");
      return job(projection.state, jobId);
    },
    recovery: () => classifyWorkflowRecovery(projection.state),
    serialize: () => serializeWorkflowState(projection.state),
    close: () => undefined,
  };
}

/** Creates a store that forgets everything at process exit, replaying the given events first. */
export function createInMemoryWorkflowStore(events: readonly WorkflowEvent[] = []): InMemoryWorkflowStore {
  return createWorkflowEventStore(events, false);
}
