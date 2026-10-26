// The compact views agents read for plans: a proposal, an amendment, a presentation, an approval and a status.
import { arrayAt, asObject, numberAt, objectAt, objectOf, objectsIn, stringAt } from "./json.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonFields } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { operationLine } from "./operation-line.js";
import { receiptView } from "./receipt-agent-view.js";
import { clip, isEmpty, withoutBudget } from "./view-text.js";

/** What the agent view remembers between calls, so an unchanged plan status can collapse to one line. */
export interface AgentViewMemory {
  readonly lastView: Map<string, string>;
}

const GENERIC_NOTICE_CODES = new Set(["NOT_IDEMPOTENT", "UNDO_ONLY", "REVERSIBLE_BY_OPERATION"]);
const PLAN_ENVELOPE_KEYS = new Set(["plan", "presentation", "approvalCapability", "approval", "status", "planId", "renamedPlaceholders", "submittedOperations", "bindings", "next", "warnings", "responseBudgetBytes"]);
const EXPRESSION_ROWS = 64;

function planOf(candidate: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(candidate) && typeof candidate.planId === "string" && isJsonArray(candidate.operations) ? candidate : undefined;
}

function expiryFields(data: JsonObject): JsonFields {
  const expiresAt = objectAt(data, "approvalCapability")?.expiresAt;
  return { expiresAt: expiresAt ? expiresAt : undefined };
}

function expressionRows(presentation: JsonObject | undefined): ReadonlyArray<JsonObject> {
  return objectsIn(arrayAt(presentation, "expressions"))
    .slice(0, EXPRESSION_ROWS)
    .map((entry) => ({ propertyPath: clip(stringAt(entry, "propertyPath") ?? "", 200), source: clip(stringAt(entry, "source") ?? "", 400) }))
    .filter((entry) => entry.source !== "");
}

function expressionFields(presentation: JsonObject | undefined): JsonFields {
  const expressions = expressionRows(presentation);
  return { expressions: expressions.length ? expressions : undefined };
}

function genericWarnings(presentation: JsonObject | undefined): ReadonlySet<string> {
  const generic = objectsIn(arrayAt(presentation, "notices")).filter((notice) => GENERIC_NOTICE_CODES.has(stringAt(notice, "code") ?? ""));
  return new Set(generic.map((notice) => `${String(notice.title)} ${String(notice.detail)}`.trim()));
}

function warningFields(presentation: JsonObject | undefined, data: JsonObject): JsonFields {
  const generic = genericWarnings(presentation);
  const warnings = [...new Set([...(arrayAt(presentation, "warnings") ?? []), ...(arrayAt(data, "warnings") ?? [])])].filter((warning) => !generic.has(String(warning)));
  return { warnings: warnings.length ? warnings : undefined };
}

function mailboxFields(data: JsonObject): JsonFields {
  return {
    queued: objectAt(data, "mailbox")?.queued ? true : undefined,
    queuePosition: numberAt(data, "queuePosition"),
    rebased: objectAt(data, "rebased"),
    pipeline: objectAt(data, "pipeline"),
  };
}

function timingFields(data: JsonObject): JsonFields {
  const receipt = objectAt(data, "receipt");
  const expiresAt = objectAt(data, "approval")?.expiresAt;
  return {
    expiresAt: expiresAt && !receipt ? expiresAt : undefined,
    waitedSeconds: numberAt(data, "waitedSeconds"),
    note: stringAt(data, "note"),
    receipt: receipt ? receiptView(receipt) : undefined,
  };
}

function approvalOutcome(data: JsonObject): JsonFields {
  return { status: data.status, ...mailboxFields(data), ...timingFields(data) };
}

/** The view of an approval outcome: the plan's id and status, queue position, expiry and the receipt when it ran. */
export function approveView(data: JsonObject): JsonObject {
  return objectOf({ planId: data.planId, ...approvalOutcome(data) });
}

function applyFields(data: JsonObject): JsonFields {
  const apply = objectAt(data, "apply");
  if (!apply) return {};
  if (apply.approved === false) return { apply: objectOf({ approved: false, refusal: apply.refusal }) };
  const outcome = approvalOutcome(apply);
  return { apply: objectOf({ approved: true, ...outcome }), ...(outcome.status === undefined ? {} : { status: outcome.status }) };
}

function valueTargetName(presentation: JsonObject | undefined, index: number): string | undefined {
  return stringAt(asObject(arrayAt(presentation, "values")?.[index]), "target");
}

function extraEnvelope(data: JsonObject, view: JsonObject): JsonObject {
  if (!planOf(data.plan)) return {};
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => !(key in view) && !PLAN_ENVELOPE_KEYS.has(key) && !isEmpty(value)));
}

function proposalFields(plan: JsonObject, data: JsonObject, presentation: JsonObject | undefined): JsonFields {
  const operations = objectsIn(arrayAt(plan, "operations"));
  const conflicts = arrayAt(plan, "conflicts");
  const renamed = objectAt(data, "renamedPlaceholders");
  return {
    planId: plan.planId,
    status: data.status ?? "prepared",
    summary: plan.summary,
    ops: operations.map((operation, index) => operationLine(operation, valueTargetName(presentation, index))),
    digest: String(plan.digest ?? "").slice(0, 12),
    ...expiryFields(data),
    ...applyFields(data),
    conflicts: conflicts?.length ? conflicts : undefined,
    ...expressionFields(presentation),
    ...warningFields(presentation, data),
    renamedPlaceholders: renamed && !isEmpty(renamed) ? renamed : undefined,
  };
}

/** The view of a proposed plan: one line per operation, its digest, what applying it did, and the unfamiliar parts of the envelope. */
export function planView(data: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(data)) return data;
  const plan = planOf(data.plan) ?? planOf(data);
  if (!plan) return withoutBudget(data);
  const view = objectOf(proposalFields(plan, data, objectAt(data, "presentation")));
  return { ...view, ...extraEnvelope(data, view) };
}

/** The view of an amendment: which operations changed, plus the expressions and warnings of the new presentation. */
export function amendView(data: JsonObject): JsonObject {
  const presentation = objectAt(data, "presentation");
  return objectOf({
    planId: data.planId,
    status: data.status,
    amended: data.amended,
    operationCount: data.operationCount,
    editedIndexes: data.editedIndexes,
    ...expiryFields(data),
    ...expressionFields(presentation),
    ...warningFields(presentation, data),
  });
}

function sideText(part: JsonValue | undefined): string {
  return part === null || part === undefined ? "" : String(part);
}

function valueRowLine(value: JsonObject): string {
  const label = stringAt(value, "label") ?? "";
  const target = stringAt(value, "target");
  const before = sideText(value.before);
  const after = sideText(value.after);
  const change = before && after ? `${before} → ${after}` : after || before;
  return `${label}${target ? ` · ${target}` : ""}${label && change ? ": " : ""}${change}`.trim();
}

/** The view of a presentation: its title, a line per value, the expressions, and the warnings. */
export function presentView(data: JsonObject): JsonObject {
  const presentation = objectAt(data, "presentation");
  const warnings = arrayAt(presentation, "warnings");
  return objectOf({
    planId: data.planId,
    status: data.status,
    title: presentation?.title,
    ops: objectsIn(arrayAt(presentation, "values")).map(valueRowLine),
    ...expressionFields(presentation),
    warnings: warnings?.length ? warnings : undefined,
    ...expiryFields(data),
  });
}

function statusFacts(data: JsonObject): JsonFields {
  const postcondition = stringAt(data, "postcondition");
  return {
    postcondition: postcondition !== undefined && postcondition !== data.status ? postcondition : undefined,
    approvalExpired: data.approvalExpired === true && data.status !== "verified" ? true : undefined,
    warning: stringAt(data, "warning"),
  };
}

function statusReceiptFields(data: JsonObject): JsonFields {
  const receipt = objectAt(data, "receipt");
  return { receipt: receipt ? receiptView(receipt) : undefined, rebased: objectAt(data, "rebased"), queuePosition: numberAt(data, "queuePosition") };
}

function collapsedStatus(view: JsonObject, live: JsonObject, data: JsonObject, memory: AgentViewMemory): JsonObject {
  const key = `status:${String(data.planId)}`;
  const serialized = JSON.stringify(view);
  const collapsed = { planId: data.planId, status: data.status, unchanged: true };
  if (memory.lastView.get(key) === serialized && JSON.stringify(collapsed).length < serialized.length) return { ...objectOf(collapsed), ...live };
  memory.lastView.set(key, serialized);
  return { ...view, ...live };
}

/** The view of a plan's status; with a memory, a status unchanged since the last view collapses to its id and a flag. */
export function statusView(data: JsonObject, memory: AgentViewMemory | undefined): JsonObject {
  const view = objectOf({ planId: data.planId, status: data.status, ...statusFacts(data), ...statusReceiptFields(data) });
  const pipeline = objectAt(data, "pipeline");
  const live: JsonObject = pipeline ? { pipeline } : {};
  return memory ? collapsedStatus(view, live, data, memory) : { ...view, ...live };
}
