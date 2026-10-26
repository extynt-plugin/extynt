// The command the sidecar sends the panel: one apply_plan wrapper around every host operation family.
import type { MetadataReadSet } from "@extynt/action-plan";
import type { EffectHostOperation, LayerAnimationHostOperation, LayerPropertyHostOperation, LayerStateHostOperation, LayerStructureHostOperation, MarkerHostOperation, TextHostOperation } from "./host-layer-operations.js";
import type { CompositionHostOperation, FootageHostOperation, OutputHostOperation, ProjectItemHostOperation, ProjectSettingsHostOperation } from "./host-project-operations.js";
import type { MaskHostOperation, ShapeHostOperation, ThreeDOptionsHostOperation } from "./host-shape-operations.js";
import type { SpecHostOperation } from "./host-spec-operations.js";
import type { EffectEditHostOperation, KeyframeHostOperation, LayerDeriveHostOperation, LayerToolHostOperation, ProjectToolHostOperation } from "./host-tool-operations.js";

export type HostPlanOperation =
  | EffectHostOperation | TextHostOperation | LayerPropertyHostOperation | LayerAnimationHostOperation | LayerStateHostOperation | LayerStructureHostOperation | MarkerHostOperation
  | MaskHostOperation | ShapeHostOperation | ThreeDOptionsHostOperation | SpecHostOperation
  | ProjectItemHostOperation | FootageHostOperation | CompositionHostOperation | OutputHostOperation | ProjectSettingsHostOperation
  | LayerDeriveHostOperation | KeyframeHostOperation | EffectEditHostOperation | LayerToolHostOperation | ProjectToolHostOperation;

export type HostPlanCommand = {
  operation: "apply_plan";
  planId: string;
  operations: HostPlanOperation[];
  undoGroup: string;
  readSet?: MetadataReadSet;
  batchSize?: number;
};

/** How many operations share one After Effects undo group: a long plan applied as one group is a single Ctrl+Z, so the host splits it here; the plan itself keeps one digest and one approval. */
export const PLAN_UNDO_BATCH_SIZE = 25;
