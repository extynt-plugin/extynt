// Projects the native operation registry into the bounded capability disclosure a fresh workflow cycle carries.

import { NATIVE_OPERATION_REGISTRY, type NativeInputSchema, type NativeOperationDefinition } from "@extynt/capability-catalogue";
import type { WorkflowCapabilityDisclosure, WorkflowCapabilityField, WorkflowCapabilityOperationFamily, WorkflowCapabilitySchemaPack } from "@extynt/workflow";

const STABLE_CORE = ["create_layer", "set_layer_name", "set_layer_property", "animate_property", "ensure_effect", "set_effect_control", "animate_control", "set_text_document"] as const;

const MAX_FIELDS_PER_PACK = 64;
const MAX_SCHEMA_PACKS = 128;
const MAX_OPERATION_FAMILIES = 64;
const MAX_OPERATION_TYPES = 256;
const MAX_ENUM_VALUES = 256;
const MAX_DESCRIPTION_LENGTH = 1000;

type FieldsByDomain = ReadonlyMap<string, ReadonlyMap<string, WorkflowCapabilityField>>;
type OperationFamily = { readonly summary: string; readonly operationTypes: ReadonlySet<string> };
type SchemaProperty = NativeInputSchema["properties"][string];

function fieldType(property: SchemaProperty): WorkflowCapabilityField["type"] {
  if (property.enum?.length) return "enum";
  if (property.type === "number" || property.type === "integer") return "number";
  return property.type === "boolean" ? "boolean" : "string";
}

function capabilityField(name: string, property: SchemaProperty, schema: NativeInputSchema): WorkflowCapabilityField {
  return {
    name,
    type: fieldType(property),
    required: schema.required.includes(name),
    ...(property.description ? { description: property.description.slice(0, MAX_DESCRIPTION_LENGTH) } : {}),
    ...(property.enum ? { enumValues: property.enum.slice(0, MAX_ENUM_VALUES) } : {}),
  };
}

function addSchemaFields(fields: Map<string, WorkflowCapabilityField>, schema: NativeInputSchema): void {
  for (const [name, property] of Object.entries(schema.properties)) {
    if (fields.has(name) || fields.size >= MAX_FIELDS_PER_PACK) continue;
    fields.set(name, capabilityField(name, property, schema));
  }
}

function implementedEntries(): readonly NativeOperationDefinition[] {
  return NATIVE_OPERATION_REGISTRY.filter((entry) => entry.implementationStatus === "implemented");
}

function operationFieldsByDomain(): FieldsByDomain {
  const domains = new Map<string, Map<string, WorkflowCapabilityField>>();
  for (const entry of implementedEntries()) {
    const fields = domains.get(entry.domain) ?? new Map<string, WorkflowCapabilityField>();
    addSchemaFields(fields, entry.inputSchema);
    for (const schema of Object.values(entry.planSchemas ?? {})) addSchemaFields(fields, schema);
    domains.set(entry.domain, fields);
  }
  return domains;
}

function operationFamilies(): ReadonlyMap<string, OperationFamily> {
  const families = new Map<string, { summary: string; operationTypes: Set<string> }>();
  for (const entry of implementedEntries()) {
    const family = families.get(entry.domain) ?? { summary: `${entry.domain} typed operations`, operationTypes: new Set<string>() };
    entry.planTypes.forEach((type) => family.operationTypes.add(type));
    families.set(entry.domain, family);
  }
  return families;
}

function schemaPacks(families: ReadonlyMap<string, OperationFamily>, fieldsByDomain: FieldsByDomain): readonly WorkflowCapabilitySchemaPack[] {
  return [...families.entries()].slice(0, MAX_SCHEMA_PACKS).map(([domain, family]) => ({
    schemaPackId: `schema-pack:${domain}`,
    version: "registry-v1",
    summary: `${domain} operation fields; retrieve one full schema before authoring unfamiliar fields.`,
    operationTypes: [...family.operationTypes].slice(0, MAX_OPERATION_TYPES),
    fields: [...(fieldsByDomain.get(domain)?.values() ?? [])].slice(0, MAX_FIELDS_PER_PACK),
  }));
}

function familyDisclosures(families: ReadonlyMap<string, OperationFamily>, packs: readonly WorkflowCapabilitySchemaPack[]): readonly WorkflowCapabilityOperationFamily[] {
  const packIds = new Set(packs.map((pack) => pack.schemaPackId));
  return [...families.entries()].slice(0, MAX_OPERATION_FAMILIES).map(([domain, family]) => ({
    familyId: `operation-family:${domain}`,
    summary: family.summary,
    operationTypes: [...family.operationTypes].slice(0, MAX_OPERATION_TYPES),
    schemaPackIds: packIds.has(`schema-pack:${domain}`) ? [`schema-pack:${domain}`] : [],
  }));
}

/** The bounded disclosure carried by fresh workflow cycles: a read-only registry projection that never authorizes, queues or dispatches. */
export function workflowCapabilityDisclosure(): WorkflowCapabilityDisclosure {
  const families = operationFamilies();
  const packs = schemaPacks(families, operationFieldsByDomain());
  const disclosedFamilies = familyDisclosures(families, packs);
  const available = new Set(disclosedFamilies.flatMap((family) => family.operationTypes));
  return { disclosureId: "workflow-capabilities:registry-v1", engineId: "workflow-v1", stableCore: STABLE_CORE.filter((type) => available.has(type)), operationFamilies: disclosedFamilies, schemaPacks: packs };
}
