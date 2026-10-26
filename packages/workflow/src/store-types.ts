// The store contracts: an append-only event log with a reducer-owned projection, in memory or persisted.

import type { WorkflowRecoveryReport } from "./continuation-types.js";
import type { WorkflowEvent } from "./events.js";
import type { WorkflowId } from "./identity.js";
import type { WorkflowJob, WorkflowState } from "./state-types.js";

/** An append-only event log with its reducer-owned projection. */
export interface WorkflowStore {
  readonly resumeSupported: boolean;
  readonly getState: () => WorkflowState;
  readonly project: () => WorkflowState;
  readonly append: (event: WorkflowEvent) => WorkflowState;
  readonly appendBatch: (events: readonly WorkflowEvent[]) => WorkflowState;
  readonly listEvents: (jobId: WorkflowId) => readonly WorkflowEvent[];
  readonly loadJob: (jobId: WorkflowId) => WorkflowJob;
  readonly recovery: () => WorkflowRecoveryReport;
  readonly serialize: () => string;
  readonly close: () => void;
}

/** A store that forgets everything at process exit. */
export interface InMemoryWorkflowStore extends WorkflowStore { readonly resumeSupported: false; }

/** A store backed by an atomically replaced event-log file. */
export interface PersistentWorkflowStore extends WorkflowStore {
  readonly resumeSupported: true;
  readonly filePath: string;
}

/** Where a persistent store keeps its event log. */
export interface PersistentWorkflowStoreOptions { readonly filePath: string; }
