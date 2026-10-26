// Links the nodes of an accepted properties page to the effect and parameter definitions they were observed as.
import type { JsonObject } from "@extynt/decode";
import { decodeOrCode, fallback, number, object } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { effectDefinitionId, linkEffectDefinition, linkParameterDefinition, parameterDefinitionId } from "./effect-definition-store.js";
import { selectOne } from "./graph-sql.js";
import { indicesOrEmpty, textOr } from "./native-page.js";
import type { ControlObservation } from "./graph-control-types.js";

const linkFacts = object({
  id: textOr(""), propertyIndices: indicesOrEmpty,
  effectContext: fallback(object({ effectMatchName: textOr(""), relativeIndices: indicesOrEmpty }), undefined),
});
const nodeRow = object({ id: number() });

interface ObservedLinks { database: DatabaseSync; scope: number; rows: readonly JsonObject[]; controls: readonly ControlObservation[]; hostKey: string }

/** Links each row that names an effect to that effect's definition, and each of its parameter rows to the parameter definition of the control read at the same indices. */
export function linkObservedDefinitions(input: ObservedLinks): void {
  for (const row of input.rows) {
    const facts = decodeOrCode(linkFacts, row, "GRAPH_ROW_INVALID"), context = facts.effectContext;
    if (!context?.effectMatchName) continue;
    const node = selectOne(input.database, "SELECT id FROM nodes WHERE scope_id=? AND native_id=?", nodeRow, input.scope, facts.id);
    if (!node) continue;
    const effectId = effectDefinitionId(input.hostKey, context.effectMatchName, null);
    if (context.relativeIndices.length === 0) { linkEffectDefinition(input.database, { nodeId: node.id, effectDefinitionId: effectId }); continue; }
    const control = input.controls.find((candidate) => candidate.indexPath === facts.propertyIndices.join("/"));
    if (control) linkParameterDefinition(input.database, { nodeId: node.id, parameterDefinitionId: parameterDefinitionId(effectId, control.relativePath) });
  }
}
