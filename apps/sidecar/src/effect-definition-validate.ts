// Validation of definition provenance, facts and query limits before the store writes or reads them.
import type { DefinitionProvenance, NativeParameterValueType, ParameterDefinitionFacts } from "@extynt/project-graph";

const PROVENANCE_INVALID = "GRAPH_DEFINITION_PROVENANCE_INVALID";
const DEFINITION_INVALID = "GRAPH_DEFINITION_INVALID";
const MAX_DEFAULT_COMPONENTS = 16;

/** How many numbers a factory default of each value type carries; a type absent here never has a known default. */
export const DEFAULT_COMPONENT_COUNTS: Readonly<Partial<Record<NativeParameterValueType, number>>> = { OneD: 1, LAYER_INDEX: 1, MASK_INDEX: 1, TwoD: 2, TwoD_SPATIAL: 2, ThreeD: 3, ThreeD_SPATIAL: 3, COLOR: 4 };

/** Accepts a non-empty text of at most 4096 characters without a NUL, or throws GRAPH_DEFINITION_INVALID. */
export function definitionText(value: string): void {
  if (value.length === 0 || value.length > 4096 || value.includes("\0")) throw Error(DEFINITION_INVALID);
}

/** Accepts null, or a text that passes `definitionText`. */
export function definitionNullableText(value: string | null): void { if (value !== null) definitionText(value); }

function definitionUnits(value: string | null): void {
  if (value === null || value === "") return;
  definitionText(value);
}

function definitionNumber(value: number | null): void {
  if (value !== null && !Number.isFinite(value)) throw Error(DEFINITION_INVALID);
}

function validateDocumentedSource(source: DefinitionProvenance): void {
  if (source.sourceUrl === null || source.observationContext !== null || source.instanceBinding !== null) throw Error(PROVENANCE_INVALID);
  const url = new URL(source.sourceUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw Error(PROVENANCE_INVALID);
}

function hasObservationTime(source: DefinitionProvenance): boolean {
  return source.observedAt !== null && Number.isSafeInteger(source.observedAt) && source.observedAt >= 0;
}

function validateNativeSource(source: DefinitionProvenance): void {
  const missingBinding = source.observationContext !== "effect-inventory" && source.instanceBinding === null;
  if (source.hostKey === null || !hasObservationTime(source) || source.observationContext === null || missingBinding) throw Error(PROVENANCE_INVALID);
}

/** Accepts a well-formed provenance record or throws GRAPH_DEFINITION_INVALID or GRAPH_DEFINITION_PROVENANCE_INVALID. */
export function validateDefinitionSource(source: DefinitionProvenance): void {
  [source.id, source.title].forEach(definitionText);
  [source.sourceUrl, source.hostKey, source.instanceBinding].forEach(definitionNullableText);
  definitionNumber(source.observedAt);
  if (source.kind === "native-observation") validateNativeSource(source);
  else validateDocumentedSource(source);
}

function validateDefaultShape(valueType: NativeParameterValueType, components: readonly number[], isVector: boolean): void {
  const expected = DEFAULT_COMPONENT_COUNTS[valueType];
  if (expected !== components.length || (expected === 1) === isVector) throw Error(DEFINITION_INVALID);
}

function validateDefault(facts: ParameterDefinitionFacts): void {
  if (facts.defaultValue.state === "unknown") return;
  const { value } = facts.defaultValue, isVector = Array.isArray(value);
  const components = Array.isArray(value) ? value : [value];
  if (components.length < 1 || components.length > MAX_DEFAULT_COMPONENTS) throw Error(DEFINITION_INVALID);
  components.forEach(definitionNumber);
  validateDefaultShape(facts.valueType, components, isVector);
}

function validateNativeFacts(facts: ParameterDefinitionFacts, source: DefinitionProvenance): void {
  if (source.kind !== "native-observation") return;
  if (facts.description !== null || facts.meaning !== null) throw Error(PROVENANCE_INVALID);
  if (facts.defaultValue.state === "known" && source.observationContext !== "factory-default") throw Error("GRAPH_DEFINITION_DEFAULT_UNVERIFIED");
}

/** Accepts well-formed facts for one parameter observed by `source`, or throws the matching GRAPH_DEFINITION_* code. */
export function validateDefinitionFacts(facts: ParameterDefinitionFacts, source: DefinitionProvenance): void {
  [facts.parameterDefinitionId, facts.provenanceId].forEach(definitionText);
  definitionUnits(facts.units);
  [facts.description, facts.meaning].forEach(definitionNullableText);
  [facts.minimum, facts.maximum].forEach(definitionNumber);
  validateDefault(facts);
  if (facts.minimum !== null && facts.maximum !== null && facts.minimum > facts.maximum) throw Error(DEFINITION_INVALID);
  validateNativeFacts(facts, source);
}

/** The page size to use: the maximum when none is asked for, else the request capped at the maximum; anything below one throws GRAPH_DEFINITION_QUERY_INVALID. */
export function definitionLimit(limit: number | undefined, maximum: number): number {
  if (limit === undefined) return maximum;
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error("GRAPH_DEFINITION_QUERY_INVALID");
  return Math.min(maximum, limit);
}
