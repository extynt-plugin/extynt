// Turns one probed effect's control tree into typed definition rows (parameters, facts and the menu and layout extras) with identities the definition store accepts.
import { NATIVE_PARAMETER_VALUE_TYPES } from "@extynt/project-graph";
import type { DefinitionDefault, NativeParameterValueType, ParameterDefinition, ParameterDefinitionFacts } from "@extynt/project-graph";
import { escapeParameterSegment, parameterDefinitionId } from "./effect-definition-identity.js";
import { DEFAULT_COMPONENT_COUNTS } from "./effect-definition-validate.js";
import type { CatalogueControlRow } from "./catalogue-page.js";

interface CatalogueParameterExtras { parameterDefinitionId: string; isGroup: boolean; hidden: boolean | null; menu: string[] }

/** Every row the definition store needs for one effect's controls, in tree order. */
export interface CatalogueEffectDefinitions { parameters: ParameterDefinition[]; facts: ParameterDefinitionFacts[]; extras: CatalogueParameterExtras[] }

interface Walk { effectDefinitionId: string; provenanceId: string; defaultsKnown: boolean; out: CatalogueEffectDefinitions }
interface Parent { id: string; path: string }
interface Sibling { row: CatalogueControlRow; path: string }

type LeafFacts = Pick<ParameterDefinitionFacts, "units" | "minimum" | "maximum" | "defaultValue" | "canVaryOverTime" | "canSetExpression">;

const UNKNOWN_DEFAULT: DefinitionDefault = { state: "unknown" };
const GROUP_FACTS: LeafFacts = { units: null, minimum: null, maximum: null, defaultValue: UNKNOWN_DEFAULT, canVaryOverTime: null, canSetExpression: null };

function nativeType(value: string | null, group: boolean): NativeParameterValueType {
  if (group) return "NO_VALUE";
  return NATIVE_PARAMETER_VALUE_TYPES.find((type) => type === value) ?? "unknown";
}

function factoryDefault(valueType: NativeParameterValueType, value: number | number[] | null): DefinitionDefault {
  const expected = DEFAULT_COMPONENT_COUNTS[valueType];
  if (expected === undefined || value === null) return UNKNOWN_DEFAULT;
  if (expected === 1) return typeof value === "number" ? { state: "known", value } : UNKNOWN_DEFAULT;
  return Array.isArray(value) && value.length === expected ? { state: "known", value } : UNKNOWN_DEFAULT;
}

function bounds(row: CatalogueControlRow): { minimum: number | null; maximum: number | null } {
  const { min, max } = row;
  return min !== null && max !== null && min > max ? { minimum: null, maximum: null } : { minimum: min, maximum: max };
}

function nativeName(row: CatalogueControlRow): string {
  return row.matchName || `unnamed-${row.index}`;
}

function siblingPaths(rows: readonly CatalogueControlRow[], parent: Parent | null): Sibling[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = escapeParameterSegment(nativeName(row)), count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const segment = count === 1 ? base : `${base}#${count}`;
    return { row, path: parent ? `${parent.path}/${segment}` : segment };
  });
}

function leafFacts(row: CatalogueControlRow, valueType: NativeParameterValueType, defaultsKnown: boolean): LeafFacts {
  return { units: row.units ?? null, ...bounds(row), defaultValue: defaultsKnown ? factoryDefault(valueType, row.defaultValue) : UNKNOWN_DEFAULT, canVaryOverTime: row.canVary, canSetExpression: row.canSetExpression };
}

function addRow(context: Walk, { row, path }: Sibling, parent: Parent | null): void {
  const id = parameterDefinitionId(context.effectDefinitionId, path), group = row.kind === "group", native = nativeName(row);
  const valueType = nativeType(row.valueType, group);
  context.out.parameters.push({ id, effectDefinitionId: context.effectDefinitionId, matchName: native, path, displayName: row.name || native, parentParameterId: parent?.id ?? null, ordinal: row.index, provenanceId: context.provenanceId });
  context.out.facts.push({ parameterDefinitionId: id, provenanceId: context.provenanceId, valueType, description: null, meaning: null, ...(group ? GROUP_FACTS : leafFacts(row, valueType, context.defaultsKnown)) });
  context.out.extras.push({ parameterDefinitionId: id, isGroup: group, hidden: row.hidden, menu: group || !row.items ? [] : row.items });
  if (group) walk(context, row.children, { id, path });
}

function walk(context: Walk, rows: readonly CatalogueControlRow[], parent: Parent | null): void {
  for (const sibling of siblingPaths(rows, parent)) addRow(context, sibling, parent);
}

/** One probed effect's control tree as typed definition rows, with identities the definition store will accept.
 * Values read from an instance in a project are that instance's current settings, never factory defaults, so `defaultsKnown: false` leaves every default unknown. */
export function effectControlDefinitions(effectDefinitionId: string, provenanceId: string, controls: readonly CatalogueControlRow[], defaultsKnown = true): CatalogueEffectDefinitions {
  const out: CatalogueEffectDefinitions = { parameters: [], facts: [], extras: [] };
  walk({ effectDefinitionId, provenanceId, defaultsKnown, out }, controls, null);
  return out;
}
