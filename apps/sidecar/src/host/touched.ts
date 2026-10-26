// The layers a plan's operations name, read from either shape: a compiled host command (`compositionId`, `layerId`, `layerIds` on the
// operation) or the authored plan (the same members under `target`). A layer a plan creates has no real id yet and is found by its hash afterwards.
import { array, decode, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import type { ApplyCommand } from "../verify/host-types.js";
import type { LayerRef } from "./read-batch.js";

type OperationList = ApplyCommand["operations"];

const layerFields = { compositionId: optional(string()), layerId: optional(string()), layerIds: optional(array(string())) };
const operationDecoder = object({ ...layerFields, operation: optional(string()), type: optional(string()), target: optional(object(layerFields)) });
type Operation = Infer<typeof operationDecoder>;

const MARKER_KINDS: ReadonlySet<string> = new Set(["add_marker", "update_marker", "remove_marker"]);

function decodedOperations(operations: OperationList): Operation[] {
  return (operations ?? []).flatMap((entry) => {
    const decoded = decode(operationDecoder, entry);
    return decoded.ok ? [decoded.value] : [];
  });
}

function layerIdsOf(fields: { layerId?: string | undefined; layerIds?: ReadonlyArray<string> | undefined } | undefined): string[] {
  return [...(fields?.layerId === undefined ? [] : [fields.layerId]), ...(fields?.layerIds ?? [])];
}

function compositionOf(operation: Operation): string | undefined {
  return operation.compositionId ?? operation.target?.compositionId;
}

function refsOf(operation: Operation): LayerRef[] {
  const compId = compositionOf(operation);
  return compId === undefined ? [] : [...layerIdsOf(operation), ...layerIdsOf(operation.target)].map((layerId) => ({ compId, layerId }));
}

function markerCompositionOf(operation: Operation): string | undefined {
  const kind = operation.operation ?? operation.type;
  const namesLayer = layerIdsOf(operation).length + layerIdsOf(operation.target).length > 0;
  return kind !== undefined && MARKER_KINDS.has(kind) && !namesLayer ? compositionOf(operation) : undefined;
}

/** Every layer the operations name, once each. */
export function touchedBy(operations: OperationList): LayerRef[] {
  const refs = new Map<string, LayerRef>();
  for (const ref of decodedOperations(operations).flatMap(refsOf)) refs.set(`${ref.compId}\u0000${ref.layerId}`, ref);
  return [...refs.values()];
}

/** The compositions whose own marker stream the operations write (a marker operation naming no layer), once each: their lists are read back to verify, as the native composition read carries none. */
export function markerCompositionsBy(operations: OperationList): string[] {
  const ids = decodedOperations(operations).flatMap((operation) => markerCompositionOf(operation) ?? []);
  return [...new Set(ids)];
}
