// Wire shapes of the host operations whose property writes are resolved from the typed settings tables.
// Each write names an exact relative matchName path that the host re-checks against its own allowlist.
import type { KeyframeMode, KeyframeSpec, resolveSpecWrites } from "@extynt/action-plan";
import type { LayerRef } from "./host-layer-operations.js";

export type SpecResolution = Exclude<ReturnType<typeof resolveSpecWrites>, string>;

export type SpecValues = NonNullable<Parameters<typeof resolveSpecWrites>[1]>;

type SpecWriteValue = SpecResolution["writes"][number]["value"];

export type HostSpecWrite = { path: string; value: SpecWriteValue };

export type HostSpecAnimation = { path: string; keyframes: KeyframeSpec[]; keyframeMode?: KeyframeMode };

export type SpecHostOperation =
  | { operation: "precompose_layers"; compositionId: string; layerIds: readonly string[]; name: string; newCompositionId: string; newLayerId: string; moveAllAttributes: boolean }
  | (LayerRef & { operation: "add_text_animator" | "update_text_animator"; newAnimatorId?: string; animatorId?: string; name?: string; selectorMatchName?: string; amountExpression?: string; writes: HostSpecWrite[]; animations: HostSpecAnimation[] })
  | (LayerRef & { operation: "add_shape_item" | "update_shape_item"; groupId: string; itemMatchName: string; newItemId?: string; itemId?: string; name?: string; writes: HostSpecWrite[]; animations: HostSpecAnimation[] });
