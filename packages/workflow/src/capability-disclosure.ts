// Capability disclosure validation: bounds, uniqueness and safety checks for the progressive, read-only capability projection offered to a model cycle.

import type { WorkflowCapabilityDisclosure, WorkflowCapabilityField, WorkflowCapabilityOperationFamily, WorkflowCapabilitySchemaPack } from "./admission-types.js";
import { assert, boundedText, id, uniqueIds } from "./assertions.js";
import { MAX_WORKFLOW_CAPABILITY_FAMILIES, MAX_WORKFLOW_CAPABILITY_FIELDS, MAX_WORKFLOW_CAPABILITY_OPERATIONS, MAX_WORKFLOW_CAPABILITY_SCHEMA_PACKS, MAX_WORKFLOW_ID_LENGTH, MAX_WORKFLOW_SUMMARY_LENGTH, WORKFLOW_ENGINE_ID } from "./limits.js";

const SAFE_OPERATION_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_FIELD_NAME = /^[a-z][A-Za-z0-9_]{0,63}$/;
const LIFECYCLE_OPERATION_TYPES: ReadonlySet<string> = new Set([
  "job", "stage", "batch", "operation", "workflow", "approval", "claim", "queue",
  "execute", "receipt", "undo", "cancel", "retry", "resume", "provider",
]);
const RAW_HOST_DETAIL = /(?:#target\b|<\/?(?:script|jsx)\b|\b(?:app\s*\.\s*project|activeItem|thisLayer)\b|\b(?:eval|function|new\s+File)\s*\(|=>|\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=)/i;

function safeDescription(value: string, name: string): void {
  boundedText(value, name, MAX_WORKFLOW_SUMMARY_LENGTH);
  assert(!RAW_HOST_DETAIL.test(value), "INVALID_EVENT", `${name} contains executable host detail.`);
}

function operationType(value: string, name: string): string {
  boundedText(value, name, MAX_WORKFLOW_ID_LENGTH);
  assert(SAFE_OPERATION_TYPE.test(value), "INVALID_EVENT", `${name} must be a lowercase typed operation name.`);
  assert(!LIFECYCLE_OPERATION_TYPES.has(value), "INVALID_EVENT", `${name} must describe a host operation, not workflow lifecycle bookkeeping.`);
  return value;
}

function validateOperationTypes(values: readonly string[], name: string): void {
  assert(values.length <= MAX_WORKFLOW_CAPABILITY_OPERATIONS, "LIMIT_EXCEEDED", `${name} exceeds the capability operation bound.`);
  const result = values.map((item, index) => operationType(item, `${name}[${index}]`));
  assert(new Set(result).size === result.length, "INVALID_EVENT", `${name} must not contain duplicate operation types.`);
}

function validateEnumValues(field: WorkflowCapabilityField): void {
  if (field.enumValues === undefined) {
    assert(field.type !== "enum", "INVALID_EVENT", "Enum capability fields must declare enum values.");
    return;
  }
  assert(field.type === "enum", "INVALID_EVENT", "Only enum capability fields may declare enum values.");
  assert(field.enumValues.length <= MAX_WORKFLOW_CAPABILITY_OPERATIONS, "LIMIT_EXCEEDED", "Capability enum values exceed the operation bound.");
  const values = field.enumValues.map((item) => boundedText(item, "Capability enum value", MAX_WORKFLOW_ID_LENGTH));
  assert(new Set(values).size === values.length && values.length > 0, "INVALID_EVENT", "Capability enum values must be unique and non-empty.");
}

function validateField(field: WorkflowCapabilityField, index: number): void {
  assert(SAFE_FIELD_NAME.test(field.name), "INVALID_EVENT", `Capability schema field ${index} has an invalid name.`);
  if (field.description !== undefined) safeDescription(field.description, `Capability schema field ${index} description`);
  validateEnumValues(field);
}

function validateSchemaPack(pack: WorkflowCapabilitySchemaPack): void {
  id(pack.schemaPackId, "schemaPackId");
  safeDescription(pack.version, "schema pack version");
  safeDescription(pack.summary, "schema pack summary");
  validateOperationTypes(pack.operationTypes, "schema pack operationTypes");
  assert(pack.fields.length <= MAX_WORKFLOW_CAPABILITY_FIELDS, "LIMIT_EXCEEDED", "Capability schema fields exceed the field bound.");
  const names = new Set<string>();
  pack.fields.forEach((field, index) => {
    validateField(field, index);
    assert(!names.has(field.name), "INVALID_EVENT", "Capability schema field names must be unique.");
    names.add(field.name);
  });
}

function validateFamily(family: WorkflowCapabilityOperationFamily, knownPacks: ReadonlySet<string>): void {
  id(family.familyId, "familyId");
  safeDescription(family.summary, "operation family summary");
  validateOperationTypes(family.operationTypes, "operation family operationTypes");
  const packs = uniqueIds(family.schemaPackIds, "operation family schemaPackIds", MAX_WORKFLOW_CAPABILITY_SCHEMA_PACKS);
  for (const schemaPackId of packs) assert(knownPacks.has(schemaPackId), "INVALID_EVENT", `Operation family references unknown schema pack ${schemaPackId}.`);
}

/** Validates a progressive, typed capability projection; it is read-only and creates no workflow state, authorizes no batch and implies no dispatchable operation. */
export function validateWorkflowCapabilityDisclosure(disclosure: WorkflowCapabilityDisclosure): void {
  id(disclosure.disclosureId, "disclosureId");
  assert(disclosure.engineId === WORKFLOW_ENGINE_ID, "INVALID_EVENT", "Capability disclosure engine is unsupported.");
  validateOperationTypes(disclosure.stableCore, "stableCore");
  assert(disclosure.schemaPacks.length <= MAX_WORKFLOW_CAPABILITY_SCHEMA_PACKS, "LIMIT_EXCEEDED", "Capability schema packs exceed the workflow bound.");
  const packs = new Set<string>();
  for (const pack of disclosure.schemaPacks) {
    validateSchemaPack(pack);
    assert(!packs.has(pack.schemaPackId), "INVALID_EVENT", "Capability schema pack IDs must be unique.");
    packs.add(pack.schemaPackId);
  }
  assert(disclosure.operationFamilies.length <= MAX_WORKFLOW_CAPABILITY_FAMILIES, "LIMIT_EXCEEDED", "Capability operation families exceed the workflow bound.");
  const families = new Set<string>();
  for (const family of disclosure.operationFamilies) {
    validateFamily(family, packs);
    assert(!families.has(family.familyId), "INVALID_EVENT", "Capability family IDs must be unique.");
    families.add(family.familyId);
  }
}
