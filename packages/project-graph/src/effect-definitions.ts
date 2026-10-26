/** Definition facts describe controls; they never establish current host state or edit authority. */
export const NATIVE_PARAMETER_VALUE_TYPES = ["unknown", "NO_VALUE", "ThreeD_SPATIAL", "ThreeD", "TwoD_SPATIAL", "TwoD", "OneD", "COLOR", "CUSTOM_VALUE", "MARKER", "LAYER_INDEX", "MASK_INDEX", "SHAPE", "TEXT_DOCUMENT"] as const;
export type NativeParameterValueType = typeof NATIVE_PARAMETER_VALUE_TYPES[number];
export type DefinitionSourceKind = "official-documentation" | "authored-documentation" | "native-observation";
export type NativeDefinitionContext = "property-metadata" | "factory-default" | "effect-inventory";
export interface DefinitionProvenance {
  id: string;
  kind: DefinitionSourceKind;
  sourceUrl: string | null;
  title: string;
  hostKey: string | null;
  observedAt: number | null;
  observationContext: NativeDefinitionContext | null;
  instanceBinding: string | null;
}
export interface PluginDefinition {
  id: string;
  nativeId: string;
  displayName: string;
  vendor: string | null;
  version: string | null;
  provenanceId: string;
}
export interface EffectDefinition {
  id: string;
  hostKey: string;
  matchName: string;
  displayName: string;
  category: string | null;
  version: string | null;
  pluginId: string | null;
  provenanceId: string;
}
/** One control of an effect definition; its `path` is the escaped native matchName path, which keeps the collector sibling suffixes, and native indices bind instances. */
export interface ParameterDefinition {
  id: string;
  effectDefinitionId: string;
  matchName: string;
  path: string;
  displayName: string;
  parentParameterId: string | null;
  ordinal: number | null;
  provenanceId: string;
}
export type DefinitionDefault = { state: "unknown" } | { state: "known"; value: number | number[] };
export interface ParameterDefinitionFacts {
  parameterDefinitionId: string;
  provenanceId: string;
  valueType: NativeParameterValueType;
  units: string | null;
  minimum: number | null;
  maximum: number | null;
  defaultValue: DefinitionDefault;
  description: string | null;
  meaning: string | null;
  canVaryOverTime: boolean | null;
  canSetExpression: boolean | null;
}
export interface EffectDefinitionBundle {
  sources: DefinitionProvenance[];
  plugins: PluginDefinition[];
  effects: EffectDefinition[];
  parameters: ParameterDefinition[];
  facts: ParameterDefinitionFacts[];
}
export interface DefinitionPage<T> {
  rows: T[];
  nextCursor: string | null;
  writeAuthorizing: false;
}
export interface PluginDefinitionQuery {
  nativeId?: string;
  cursor?: string;
  limit?: number;
}
export interface EffectDefinitionQuery {
  hostKey: string;
  matchName?: string;
  cursor?: string;
  limit?: number;
}
export interface ParameterDefinitionQuery {
  effectDefinitionId: string;
  cursor?: string;
  limit?: number;
}
export interface ParameterDefinitionFactQuery {
  parameterDefinitionId: string;
  cursor?: string;
  limit?: number;
}
export interface ParameterDefinitionEvidence {
  provenance: DefinitionProvenance;
  facts: ParameterDefinitionFacts;
}
export interface ParameterDefinitionView {
  parameter: ParameterDefinition;
  facts: DefinitionPage<ParameterDefinitionEvidence>;
}
