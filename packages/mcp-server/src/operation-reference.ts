// The field reference for every plan type, generated from the same descriptions `ae_describe_native_operation` serves, so it cannot drift from the validator.
import { NATIVE_OPERATION_REGISTRY, planOperationDescription } from "@extynt/capability-catalogue";
import type { NativeOperationDefinition } from "@extynt/capability-catalogue";

type ReferenceRow = { required: Set<string>; optional: Set<string>; enums: Map<string, string[]> };

function emptyRow(): ReferenceRow {
  return { required: new Set<string>(), optional: new Set<string>(), enums: new Map<string, string[]>() };
}

function mergeEnumMembers(row: ReferenceRow, name: string, declared: readonly string[] | undefined): void {
  if (!declared) return;
  const merged = row.enums.get(name) ?? [];
  for (const member of declared) if (!merged.includes(member)) merged.push(member);
  row.enums.set(name, merged);
}

function accumulatePlanType(seen: Map<string, ReferenceRow>, entry: NativeOperationDefinition, planType: string): void {
  const described = planOperationDescription(entry, planType);
  const schema = described.inputSchema;
  const required = [...(schema.required ?? [])];
  const properties = Object.entries(schema.properties ?? {});
  const row = seen.get(planType) ?? emptyRow();
  for (const name of required) row.required.add(name);
  for (const [name] of properties) if (!required.includes(name)) row.optional.add(name);
  for (const [name, value] of properties) mergeEnumMembers(row, name, value.enum);
  seen.set(planType, row);
}

function renderReferenceRow(planType: string, row: ReferenceRow): string {
  const required = row.required.size ? [...row.required].join(", ") : "target";
  const optional = row.optional.size ? [`optional: ${[...row.optional].join(", ")}`] : [];
  const enums = [...row.enums].map(([name, values]) => `${name}=${values.join("|")}`);
  return [planType, `required: ${required}`, ...optional, ...enums].join(" — ");
}

/** One line per implemented plan type naming its required and optional fields and enum values, and the ids of the operations that are not implemented. */
export function operationReference(): { lines: string[]; unavailable: string[] } {
  const seen = new Map<string, ReferenceRow>();
  for (const entry of NATIVE_OPERATION_REGISTRY) {
    if (entry.implementationStatus !== "implemented") continue;
    for (const planType of entry.planTypes) accumulatePlanType(seen, entry, planType);
  }
  const rows = [...seen.entries()].sort(([left], [right]) => left.localeCompare(right));
  return {
    lines: rows.map(([planType, row]) => renderReferenceRow(planType, row)),
    unavailable: NATIVE_OPERATION_REGISTRY.filter((entry) => entry.implementationStatus !== "implemented").map((entry) => entry.id).sort(),
  };
}
