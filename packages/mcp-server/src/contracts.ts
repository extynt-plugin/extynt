// The shared contracts of the MCP server: what a stored plan, a tool definition and a tool context are.
import type { ActionPlan, ActionPlanV2Operation, ApprovalCapability } from "@extynt/action-plan";
import type { CatalogueGraph, HostCapabilityProfile, HostVerificationLedger, Inventory, OperationVerificationReport } from "@extynt/capability-catalogue";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { InputSchema } from "./arg.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { Translate } from "@extynt/ui-text";
import type { PlanNotice } from "./notices.js";
import type { StoredReceipt } from "./stored-receipt.js";
import type { LostPlans } from "./plan-lost.js";
import type { VariantSet } from "./variant-sets.js";

export interface ToolAnnotations { readOnlyHint?: true; destructiveHint?: boolean; openWorldHint: false; }
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: InputSchema;
  annotations: ToolAnnotations;
  planCard?: true;
}
export type PlanStatus = "draft" | "prepared" | "presented" | "approved" | "applying" | "applied" | "applied_unverified" | "verified" | "cancelled" | "failed" | "undo_requested" | "partially_undone" | "undone" | "undo_unverified";
export interface PlanVerificationSummary {
  hostKey: string | null;
  requiresAcknowledgement: boolean;
  counts: Record<string, number>;
  operations: OperationVerificationReport[];
}
/** The card text said in the user's language, kept beside the English the model and the store read. */
export interface PlanShown {
  title: string;
  values: Array<{ label: string; target?: string; before: JsonValue; after: JsonValue }>;
  notices: PlanNotice[];
  warnings: string[];
}
export interface PlanPresentation {
  shown?: PlanShown;
  verification?: PlanVerificationSummary;
  title: string;
  target: { compositionId: string; layerId: string; layerName: string };
  effect: { action: string; name: string; amount: JsonValue; controlPath: string };
  motion: { property: string; from: JsonValue; to: JsonValue; durationSeconds: number };
  values: Array<{ label: string; target?: string; before: JsonValue; after: JsonValue }>;
  expressions?: Array<{ propertyPath: string; source: string }>;
  notices?: PlanNotice[];
  warnings: string[];
  approvalRequired: true;
  actions: { approve: string; cancel: string };
}
export interface StoredPlan {
  project?: { name: string; filePath: string | null };
  variantSetId?: string;
  relationalParameter?: { controlInstanceId: number; sourceObservationId: string };
  plan: ActionPlan;
  status: PlanStatus;
  jobId?: string;
  lastQueuedGroup?: { signature: string; queued: number; accepted: number; corrected: number; resend?: string };
  placeholderBindings?: Record<string, string>;
  verificationAcknowledged?: { at: string; counts: Record<string, number> };
  rebasedOver?: string[];
  approvalCapability?: ApprovalCapability;
  sealedAt?: string;
  presentation?: PlanPresentation;
  receipt?: StoredReceipt;
  undoReceipt?: StoredReceipt;
  staged?: { batch: number; operations: ActionPlanV2Operation[]; authored: JsonValue[] }[];
  undo?: { groups: number; undone: number; stateFingerprint: string | null };
  createdAt: string;
  updatedAt: string;
}
export interface RuntimeOperationEvidence { count: number; lastVerifiedAt: string; hostVersion: string; lastFailedAt?: string; failures?: number; lastFailureBasis?: string; }
/** A font the user asked for that is not installed, and the installed families offered in its place. */
export interface FontSubstitution { readonly requested: string; readonly offered: readonly string[] }
export interface ToolContext {
  translate?: Translate;
  noteFontSubstitution?: (substitution: FontSubstitution) => void;
  runtimeEvidence?: Readonly<Record<string, RuntimeOperationEvidence>>;
  hostKey?: string | null;
  liveHost?: { version: string; svgImport: "native" | "converter" | "unknown" } | null;
  layerStyles?: "available" | "unavailable" | "unknown";
  requestAsksLayerStyle?: boolean;
  svgForceConverter?: boolean;
  ledger?: HostVerificationLedger;
  snapshot?: ProjectSnapshot;
  catalogue?: CatalogueGraph;
  inventory?: Inventory;
  previousInventory?: Inventory;
  hostProfile?: HostCapabilityProfile;
  effectUsage?: () => ReadonlyMap<string, number>;
  panelSessionId?: string;
  plans?: Map<string, StoredPlan>;
  lostPlans?: LostPlans;
  variants?: Map<string, VariantSet>;
  receipts?: Map<string, StoredReceipt>;
  settledBatchIds?: Readonly<Record<string, string>>;
  jobCreatedIds?: (jobId: string | undefined) => ReadonlySet<string>;
  queue?: { planId: string | null; set: (planId: string | null) => void };
  interruptedApply?: string;
  hostFailures?: readonly string[];
  recentBuild?: string;
  statusMemory?: { value: string | null };
  statusFacts?: JsonObject;
  now?: () => Date;
}
