// Resolving the compositions and layers an operation names: a real id passes through, a placeholder is looked up
// in the tables the pass fills, and a name nothing declared is refused with the fix.
import { openCompositionNotRead } from "@extynt/project-graph";
import { objectAt, stringAt } from "./json.js";
import type { JsonObject } from "@extynt/decode";
import { impliedComposition, isPlaceholderId, mappedPlaceholder, refusal } from "./compose-pass.js";
import type { ComposePass, Resolved } from "./compose-pass.js";

/** The composition id an operation's `target` names, or an empty string when it names none. */
export function targetCompositionName(candidate: JsonObject): string {
  return stringAt(objectAt(candidate, "target"), "compositionId") ?? "";
}

/** A composition name resolved to the real or canonical id it stands for; an empty name stays empty. */
export function mappedComposition(pass: ComposePass, named: string): Resolved<string> {
  const compositionId = mappedPlaceholder(pass.maps.compositions, named);
  if (compositionId === undefined) return refusal("INVALID_ARGUMENT", "New composition references must be created earlier in the same plan.");
  return { ok: true, value: compositionId };
}

/** The composition an operation names in its target, or the one the pass implies when it names none. */
export function namedOrImpliedComposition(pass: ComposePass, candidate: JsonObject, input: { index: number; type: string }): Resolved<string> {
  const composition = mappedComposition(pass, targetCompositionName(candidate));
  if (!composition.ok || composition.value) return composition;
  return impliedComposition(pass, input);
}

function undeclaredComposition(pass: ComposePass, compositionId: string): string {
  const known = [...pass.maps.compositions.keys()];
  const fix = known.length
    ? `Compositions created earlier in this plan answer to ${known.join(", ")}: target one of those, or give its create_composition newCompositionId "${compositionId}".`
    : `Add newCompositionId "${compositionId}" to the create_composition that makes it, before this operation.`;
  return `Composition ${compositionId} is not created earlier in this plan. ${fix} A create_composition without newCompositionId is addressed as __new__:comp<operation index>.`;
}

function snapshotComposition(pass: ComposePass, compositionId: string): Resolved<string> {
  if (pass.snapshot.compositions.some((composition) => composition.id === compositionId)) return { ok: true, value: compositionId };
  if (pass.forwardPlaceholders) return { ok: true, value: compositionId };
  return refusal("TARGET_NOT_FOUND", openCompositionNotRead(pass.snapshot, compositionId) ?? `Composition ${compositionId} is not in the current snapshot. To target a composition created in this plan, reuse the newCompositionId you gave create_composition.`);
}

/** A composition id from an operation: a placeholder resolves through the pass, a real id must be in the snapshot. */
export function declaredComposition(pass: ComposePass, compositionId: string, index: number): Resolved<string> {
  if (!isPlaceholderId(pass.maps.compositions, compositionId)) return snapshotComposition(pass, compositionId);
  const mapped = pass.maps.compositions.get(compositionId) ?? (compositionId === `__new__:comp${index}` ? compositionId : undefined);
  if (mapped) return { ok: true, value: mapped };
  if (pass.forwardPlaceholders) return { ok: true, value: compositionId };
  return refusal("INVALID_ARGUMENT", undeclaredComposition(pass, compositionId));
}

function pendingLayer(pass: ComposePass, named: string): Resolved<string> {
  if (pass.forwardPlaceholders) return { ok: true, value: named };
  return refusal("INVALID_ARGUMENT", `Layer ${named} is not created earlier in this plan; create_layer (or duplicate_layer) must come first and later operations must reuse its target.layerId.`);
}

/** A layer id from an operation: a placeholder resolves to the layer created earlier in the same composition. */
export function layerReference(pass: ComposePass, named: string, compositionId: string): Resolved<string> {
  if (!isPlaceholderId(pass.maps.layers, named)) return { ok: true, value: named };
  const mapped = pass.maps.layers.get(named);
  if (!mapped) return pendingLayer(pass, named);
  if (mapped.compositionId && mapped.compositionId !== compositionId) return refusal("INVALID_ARGUMENT", "New layer references must stay in their created composition.");
  return { ok: true, value: mapped.layerId };
}
