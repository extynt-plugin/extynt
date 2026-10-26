// The contract for native operations: a typed declaration of what the host can do, never an executor.
import type { LayerType } from "@extynt/project-graph";

/** The versioned, machine-readable contract for trusted native operations: a declaration, never an executor. */
export const NATIVE_OPERATION_SCHEMA = "0.1" as const;

/** Every domain a native operation belongs to. */
export const NATIVE_OPERATION_DOMAINS = [
  "project", "composition", "layer", "transform", "timing", "parenting", "track-matte",
  "text", "mask", "shape", "camera", "light", "3d-material", "audio", "effects",
  "expressions", "markers", "footage", "guides-color", "render", "essential-graphics", "presets", "layer-styles", "tracking", "puppet", "roto",
] as const;

/** The area of After Effects an operation works in. */
export type NativeOperationDomain = (typeof NATIVE_OPERATION_DOMAINS)[number];

/** How far an operation is implemented. */
export const NATIVE_OPERATION_STATUSES = ["implemented", "documented_only", "probe_needed", "unsupported"] as const;

/** One of the implementation states. */
export type NativeOperationStatus = (typeof NATIVE_OPERATION_STATUSES)[number];

/** A JSON-schema-shaped object describing the fields an operation accepts. */
export type NativeInputSchema = { type: "object"; required: readonly string[]; properties: Readonly<Record<string, { type: string; description?: string; enum?: readonly string[] }>> };

/** One native operation: its AE target, input schema, applicability, undo behaviour and evidence. `planTypes` are the ActionPlan v0.2 `type` values that execute it in ae_propose_plan; `planSchemas` hold the fields each plan type accepts when one entry backs several, and `inputSchema` is then the union of its siblings. */
export interface NativeOperationDefinition {
  id: string;
  version: "0.1";
  domain: NativeOperationDomain;
  description: string;
  inputSchema: NativeInputSchema;
  applicability: readonly (LayerType | "project" | "item" | "composition" | "render-queue")[];
  aeTarget: string;
  preconditions: readonly string[];
  mutation: "read-only" | "mutating";
  undoability: "undo-group" | "host-dependent" | "not-undoable";
  verificationBasis: string;
  hostVersionGate: string;
  implementationStatus: NativeOperationStatus;
  planTypes: readonly string[];
  planSchemas?: Readonly<Record<string, NativeInputSchema>>;
  evidence: readonly ("catalogue" | "action-plan" | "host-handler" | "fixture" | "documentation")[];
  provenance: string;
}
