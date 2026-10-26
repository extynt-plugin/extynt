// The native-operation registry tools: search, count and describe, each answering compactly enough for a plain MCP client to call freely.
import { NATIVE_OPERATION_REGISTRY, NATIVE_OPERATION_SCHEMA, PLAN_TYPE_CONTRACTS, findNativeOperations, nativeOperationCoverage, planOperationDescription, planTypeVerification, searchNativeOperations, MAX_NATIVE_SEARCH_RESULTS } from "@extynt/capability-catalogue";
import type { NativeOperationDefinition } from "@extynt/capability-catalogue";
import type { Infer, JsonObject } from "@extynt/decode";
import type { ToolContext } from "./contracts.js";
import { pageByBudget } from "./inspection.js";
import { boundedAt, jsonFieldsOf, jsonOf, objectOf } from "./json.js";
import { LAYER_STYLES_OPERATION_ID, layerStylesDescription } from "./layer-style-fallback.js";
import { planExampleFor } from "./plan-examples.js";
import { verificationOptions } from "./plan-verification.js";
import type { HostRequest } from "./tool-handle.js";
import { hostSuccess, toolError } from "./tool-result.js";
import type { ToolResult } from "./tool-result.js";
import { AE_DESCRIBE_NATIVE_OPERATION, AE_SEARCH_NATIVE_OPERATIONS } from "./tool-specs-read.js";

const MAX_DESCRIBE_IDS = 12;
const SUMMARY_CHARS = 100;
const SEARCH_BUDGET = 12288;
const LIST_BUDGET = 2048;
const SIBLING_DESCRIPTION_CHARS = 240;
const COUNTS_NOTE = "Counts rise as receipts verify each plan type exactly on this host; fixture-backed operations are implemented but not yet observed live here.";

function firstSentence(text: string, limit: number): string {
  const sentence = (text.split(/(?<=\.)\s/, 1)[0] ?? text).trim();
  return sentence.length <= limit ? sentence : `${sentence.slice(0, limit - 1).replace(/\s*\S*$/, "")}…`;
}

function searchRow(entry: NativeOperationDefinition, context: ToolContext): JsonObject {
  const planType = entry.planTypes[0] ?? entry.id;
  const shared = NATIVE_OPERATION_REGISTRY.filter((other) => other.planTypes.includes(planType)).length > 1;
  const also = entry.planTypes.length > 1 ? ` (also ${entry.planTypes.slice(1).join(", ")})` : "";
  return objectOf({ planType, id: shared ? entry.id : undefined, summary: `${firstSentence(layerStylesDescription(entry, context), SUMMARY_CHARS - also.length)}${also}` });
}

/** One row per registry entry: the plan type an author writes and what it does. `id` appears only where several entries answer to one plan type. */
export function searchNativeOperationsTool({ name, args, context }: HostRequest<Infer<typeof AE_SEARCH_NATIVE_OPERATIONS.input.decoder>>): ToolResult {
  const limit = boundedAt(args, "limit", { fallback: 120, min: 1, max: MAX_NATIVE_SEARCH_RESULTS });
  const matched = searchNativeOperations(args.query ?? "", limit).filter((entry) => !(entry.id === LAYER_STYLES_OPERATION_ID && context.layerStyles === "unavailable"));
  const rows = matched.map((entry) => searchRow(entry, context));
  const page = pageByBudget(rows, rows.length, SEARCH_BUDGET - 512).items;
  const cut = page.length < rows.length;
  return hostSuccess(name, objectOf({
    entries: page,
    truncated: cut ? true : undefined,
    next: cut ? `${rows.length - page.length} more matched but did not fit the ${SEARCH_BUDGET}-byte answer budget; narrow the query.` : undefined,
    responseBudgetBytes: SEARCH_BUDGET,
  }));
}

/** The registry's size and verification counts for this host. */
export function nativeOperationListTool({ name, context }: HostRequest): ToolResult {
  const options = verificationOptions(context);
  const evidence = Object.entries(context.runtimeEvidence ?? {});
  const verifiedTypes = new Set(evidence.filter(([type]) => planTypeVerification(type, options).status === "verified").map(([type]) => type));
  const coverage = nativeOperationCoverage(NATIVE_OPERATION_REGISTRY, verifiedTypes, options);
  return hostSuccess(name, objectOf({
    schemaVersion: NATIVE_OPERATION_SCHEMA,
    domains: Object.keys(coverage.domains).length,
    operations: coverage.total,
    counts: jsonOf(coverage.statuses),
    fixtureBacked: coverage.fixtureBacked,
    runtimeVerified: coverage.runtimeVerified,
    runtimeVerifiedHost: evidence[0]?.[1].hostVersion ?? null,
    runtimeVerifiedPlanTypes: [...verifiedTypes].sort(),
    hostKey: context.hostKey ?? null,
    planTypeVerification: jsonOf(coverage.planTypeVerification),
    runtimeNote: coverage.runtimeVerified === 0 ? COUNTS_NOTE : undefined,
    responseBudgetBytes: LIST_BUDGET,
  }));
}

function nearestNativeOperations(requested: string): string[] {
  const words = requested.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const attempts = [words, ...words.map((_, skip) => words.filter((__, index) => index !== skip))].filter((attempt) => attempt.length > 0);
  for (const attempt of attempts) {
    const found = searchNativeOperations(attempt.join(" "), 5);
    if (found.length) return found.map((candidate) => candidate.planTypes[0] ?? candidate.id);
  }
  return [];
}

function unknownOperation(requested: string): JsonObject {
  const nearest = [...new Set(nearestNativeOperations(requested))];
  const next = nearest.length
    ? `No operation is named ${requested}. Nearest: ${nearest.join(", ")}. Describe one of those by passing it as id; a kind of object (a text layer, a solid) is usually a field of the general operation, such as the layerType of create_layer.`
    : `No operation is named ${requested}. ae_search_native_operations finds one by meaning.`;
  return { found: false, requested, nearest, next };
}

function siblingDescription(text: string): string {
  return text.length <= SIBLING_DESCRIPTION_CHARS ? text : `${text.slice(0, SIBLING_DESCRIPTION_CHARS).replace(/\s*\S*$/, "")}…`;
}

function operationStatus(entry: NativeOperationDefinition, planType: string, context: ToolContext): string {
  return entry.implementationStatus === "implemented" ? planTypeVerification(planType, verificationOptions(context)).status : entry.implementationStatus;
}

function coverageNote(entry: NativeOperationDefinition, others: readonly NativeOperationDefinition[], planType: string): JsonObject {
  if (others.length === 0) return {};
  const siblings = others.map((sibling) => ({ id: sibling.id, description: siblingDescription(sibling.description), implementationStatus: sibling.implementationStatus }));
  return { planTypeCoverage: { planType, servedBy: others.length + 1, described: entry.id, others: siblings, next: `${planType} is served by ${others.length + 1} registry entries; this answer describes ${entry.id} only. Pass any id above as \`id\` to describe that entry's schema.` } };
}

function fullDescription(entry: NativeOperationDefinition, others: readonly NativeOperationDefinition[], planType: string, context: ToolContext): JsonObject {
  const described = planOperationDescription(entry, planType);
  const options = verificationOptions(context);
  const { planSchemas: _derivationOnly, ...publicEntry } = entry;
  const verification = entry.planTypes.map((type) => [type, { ...planTypeVerification(type, options), contract: PLAN_TYPE_CONTRACTS[type] ?? null }] as const);
  const evidence = entry.planTypes.flatMap((type) => (context.runtimeEvidence?.[type] ? [[type, context.runtimeEvidence[type]] as const] : []));
  const example = planExampleFor(planType);
  return {
    ...jsonFieldsOf(publicEntry),
    schemaVersion: NATIVE_OPERATION_SCHEMA,
    planType,
    inputSchema: jsonOf(described.inputSchema),
    planShape: jsonOf(described.planShape),
    ...(example ? { planExample: jsonOf(example) } : {}),
    runtimeEvidence: jsonOf(Object.fromEntries(evidence)),
    verification: jsonOf(Object.fromEntries(verification)),
    ...coverageNote(entry, others, planType),
  };
}

function summaryDescription(entry: NativeOperationDefinition, others: readonly NativeOperationDefinition[], planType: string, context: ToolContext): JsonObject {
  const example = planExampleFor(planType);
  const note = layerStylesDescription(entry, context);
  return objectOf({
    id: entry.id,
    planType,
    status: operationStatus(entry, planType, context),
    inputSchema: jsonOf(planOperationDescription(entry, planType).inputSchema),
    planExample: example ? jsonOf(example) : undefined,
    otherEntries: others.length ? others.map((sibling) => sibling.id) : undefined,
    note: note === entry.description ? undefined : note,
  });
}

function describeOne(requested: string, detail: "full" | "summary", context: ToolContext): JsonObject {
  const [entry, ...others] = findNativeOperations(requested);
  if (!entry) return unknownOperation(requested);
  const planType = entry.planTypes.includes(requested) ? requested : (entry.planTypes[0] ?? requested);
  return detail === "full" ? fullDescription(entry, others, planType, context) : summaryDescription(entry, others, planType, context);
}

function requestedIds(id: string | ReadonlyArray<string>): ReadonlyArray<string> | undefined {
  const ids = typeof id === "string" ? [id] : id;
  return ids.length >= 1 && ids.length <= MAX_DESCRIBE_IDS ? ids : undefined;
}

/** One id answers with its description; an array answers `operations`, one description per id in order. */
export function nativeOperationDescribeTool({ name, args, context }: HostRequest<Infer<typeof AE_DESCRIBE_NATIVE_OPERATION.input.decoder>>): ToolResult {
  const ids = requestedIds(args.id);
  if (!ids) return toolError("INVALID_ARGUMENT", `id must be a string or an array of 1 to ${MAX_DESCRIBE_IDS} strings.`);
  const detail = args.detail === "full" ? "full" : "summary";
  const described = ids.map((id) => describeOne(id, detail, context));
  return hostSuccess(name, Array.isArray(args.id) ? { operations: described } : (described[0] ?? null));
}
