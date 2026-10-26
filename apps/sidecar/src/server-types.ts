// The shapes the sidecar's state, options and host reports are described by.
import type { DecisionSettings } from "./decision-settings-service.js";
import type { JsonValue } from "@extynt/decode";
import type { DecisionModel } from "@extynt/decide";
import type { ChatProvider } from "@extynt/llm";
import type { EffectProbeEvidence } from "@extynt/capability-catalogue";
import type { ApprovalCapability } from "@extynt/action-plan";
import type { HostCaptureCommand } from "@extynt/host-ae";
import type { WorkflowContinuationInput, WorkflowId, WorkflowStore } from "@extynt/workflow";
import type { DiagnosticMethod, DiagnosticOptions, DiagnosticRoute } from "./diagnostics.js";
import type { ModelSettingsStore } from "./llm-config.js";
import type { ProbeSnapshot } from "./server-probe-wire.js";
import type { ObservedRevisions } from "./snapshot-merge.js";
import type { WorkflowOrchestrationSummary, WorkflowSpecialistRole } from "./workflow-orchestration.js";

export type { FontCensus, HostCensus } from "./server-census-wire.js";
export type { ProbeSnapshot } from "./server-probe-wire.js";

/**
 * A snapshot with when and how big it arrived. `observed` says when each part was last read, by host revision, kept beside the raw
 * snapshot and absent on one stored before merging existed; `fullBase` is, on a scoped collection snapshot, the whole-project read it
 * was set beside, kept so its provenance is not lost and later reads still merge onto it.
 */
export interface StoredSnapshot {
  snapshot: ProbeSnapshot;
  receivedAt: string;
  bytes: number;
  observed?: ObservedRevisions;
  fullBase?: StoredSnapshot;
}

/** What a chat turn has queued for a plan so far. */
export interface ChatAuthoringProgress {
  planId: string;
  jobId: string | null;
  operations: number;
  batches: number;
  sealed: boolean;
  label: string;
  at: string;
}

/** Where a chat turn is: its step, notes, usage and, for the clickable panel roster, a bounded role lifecycle with the live specialist stream. */
export interface ChatProgress {
  requestId: string;
  step: number;
  maxSteps: number;
  phase: string;
  label: string;
  notes: string[];
  at: string;
  wrappingUp?: boolean;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number };
  reasoning?: string;
  authoring?: ChatAuthoringProgress;
  orchestration?: WorkflowOrchestrationSummary;
}

/**
 * What the sidecar is started with. The port is always loopback by design. Only the composition root enables `catalogueProbe`;
 * `fallbackChatProvider` is used only when the primary model fails to produce an answer or a valid plan; `fetch` is how the sidecar
 * reaches a provider's own API; `panelSnapshotWaitMs` is how long a chat turn with no snapshot waits for the paired panel's automatic
 * refresh (default 8000, at most 8000); `workflowCycleCeiling` is the cycles one go-ahead may spend before the job pauses to check in;
 * `workflowSingleLoop` false restores one authoring stage per cycle; `workflowFreeRun` feeds a block the model can fix back to it and
 * keeps the job going, bounded by the stall rule; omitted specialist roles fall back to the primary owner. The remaining members are test
 * seams: `effectControlEvidence`, `presetRoots`, `approvalSweepMs`, the host-call timings, `discoveryPath` (where the plugin's
 * native.json lives) and `uiDirectory` (what is served under /ui/); `svgForceConverter` is the development switch that builds SVG
 * artwork with extynt's converter on any After Effects version.
 */
export interface SidecarOptions {
  port?: number;
  maxBodyBytes?: number;
  now?: () => Date;
  catalogueProbe?: boolean;
  svgForceConverter?: boolean;
  onHostClosed?: () => void;
  token: string;
  panelSessionId?: string;
  diagnostics?: DiagnosticOptions;
  chatProvider?: ChatProvider;
  fallbackChatProvider?: ChatProvider;
  modelSettings?: ModelSettingsStore;
  decisionModels?: () => ReadonlyArray<DecisionModel>;
  decisionSettings?: DecisionSettings;
  fetch?: typeof globalThis.fetch;
  quietAgentLog?: boolean;
  maxAgentSteps?: number;
  readyPlanQueueLimit?: number;
  effectControlEvidence?: EffectProbeEvidence;
  presetRoots?: Array<{ path: string; alias: "ae-presets" | "user-presets" }>;
  stateDirectory?: string;
  approvalSweepMs?: number;
  panelSnapshotWaitMs?: number;
  workflowStore?: WorkflowStore;
  workflowMaxCycles?: number;
  workflowCycleCeiling?: number;
  workflowSingleLoop?: boolean;
  workflowFreeRun?: boolean;
  workflowDesignApproval?: boolean;
  workflowSpecialistProviders?: Partial<Record<WorkflowSpecialistRole, ChatProvider>>;
  hostCallTimeoutMs?: number;
  hostReadyRetry?: { stepMs: number; budgetMs: number };
  hostStallAfterMs?: number;
  discoveryPath?: string;
  uiDirectory?: string;
}

/** Where the sidecar listens. */
export interface SidecarAddress {
  host: "127.0.0.1";
  port: number;
}

/** One request being served; `answered` is set by `respond`, for the code that watches the response finish. */
export interface RequestContext {
  correlationId: string;
  requestId: string | null;
  method: DiagnosticMethod;
  route: DiagnosticRoute;
  startedAt: number;
  answered?: { statusCode: number; errorCode?: string; planId?: string };
}

/** An approval the sidecar issued and whether it has been used. */
export interface StoredApprovalRecord {
  capability: ApprovalCapability;
  consumedAt: string | null;
}

/** One item waiting for the panel to claim it. */
export interface AgentMailboxItem {
  planId?: string;
  approvedData: { [field: string]: JsonValue };
}

/** Whether a mailbox item is ready to hand to the panel, should be dropped, or should be tried again. */
export type MailboxPreparation = "ready" | "drop" | "retry";

/** What the sidecar knows of the paired panel's activity. */
export interface PanelState {
  lastSeenAt: number;
  busy: boolean;
  busyKind: string | null;
  busySinceAt: number | null;
  lastError: { code: string; message: string; at: number } | null;
}

/** A claimed item the panel is working on. */
export interface InFlightItem {
  kind: string;
  id: string;
  claimedAt: number;
  nativeSettlement?: "unknown";
  nativeErrorCode?: string;
  nativeAccessKind?: "read" | "mutation";
}

/** The plan an apply followed and the project fingerprint it started from. */
export interface LineageLink {
  planId: string;
  beforeFingerprint: string;
}

type CaptureOutcome = {
  captureId?: string;
  status?: "completed" | "failed";
  compositionId?: string;
  time?: number;
  dataUrl?: string;
  originalWidth?: number;
  originalHeight?: number;
  previewWidth?: number;
  previewHeight?: number;
  resized?: boolean;
  decision?: Readonly<Record<string, string | number>>;
  providerShared?: boolean;
  backgroundFlattened?: boolean;
  frameHash?: string;
  summary?: JsonValue;
  error?: JsonValue;
};

/** A frame capture and how far it has got. */
export interface CaptureRecord {
  captureId: string;
  status: "queued" | "capturing" | "completed" | "failed";
  request: HostCaptureCommand;
  preview: { maxWidth: number; maxHeight: number };
  maxEncodedBytes: number;
  receipt?: CaptureOutcome;
}

/** One workflow job's run between a receipt and the next cycle. */
export interface WorkflowContinuationRun {
  readonly jobId: WorkflowId;
  readonly requestId: string;
  readonly goalSummary: string;
  readonly autoApply: boolean;
  readonly controller: AbortController;
  state: "waiting_receipt" | "scheduled" | "running" | "terminal";
  pendingBatchId: WorkflowId | null;
  nextCycle: number;
  continuation: WorkflowContinuationInput | null;
}
