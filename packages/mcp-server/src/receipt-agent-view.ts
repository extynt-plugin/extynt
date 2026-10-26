// The compact receipt an agent reads: what was applied, what read back, and what still needs attention.
import { arrayAt, numberAt, objectAt, objectsIn, objectOf, stringAt } from "./json.js";
import { isJsonObject } from "@extynt/decode";
import type { JsonFields } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { readbackRepairCorrection, rolledBackCorrection } from "./receipt-repair.js";
import { isVerifiedOutcome } from "./receipts.js";
import { clip, isEmpty, tail } from "./view-text.js";

interface StepLadder {
  readonly counts: { readonly [state: string]: number };
  readonly issues: ReadonlyArray<string>;
  readonly presets: ReadonlyArray<string>;
}

function verificationSteps(receipt: JsonObject): ReadonlyArray<JsonObject> {
  return objectsIn(arrayAt(objectAt(receipt, "verification"), "steps"));
}

function verifiedRowIndexes(receipt: JsonObject): ReadonlySet<number> {
  const verified = objectsIn(arrayAt(receipt, "operationOutcomes")).filter((row) => isVerifiedOutcome(row.outcome));
  return new Set(verified.flatMap((row) => numberAt(row, "index") ?? []));
}

function coverage(receipt: JsonObject): JsonObject {
  const verification = objectAt(receipt, "verification");
  const conditions = objectsIn([...(arrayAt(receipt, "postconditions") ?? []), ...(arrayAt(verification, "postconditions") ?? [])]);
  const passed = (kind: string): boolean => conditions.some((condition) => condition.kind === kind && condition.state === "passed");
  return {
    applied: receipt.status === "executed" || receipt.mutationState === "applied" || (arrayAt(receipt, "appliedOperations")?.length ?? 0) > 0,
    readback: receipt.postcondition === "passed",
    visual: passed("visual"),
    temporal: passed("temporal"),
  };
}

function mutationFields(receipt: JsonObject): JsonFields {
  return {
    mutation: stringAt(receipt, "mutationState"),
    mayHaveMutated: receipt.mayHaveMutated === true && receipt.postcondition !== "passed" ? true : undefined,
  };
}

function rollbackField(receipt: JsonObject): JsonFields {
  const rollback = stringAt(receipt, "rollback");
  return { rollback: rollback !== undefined && rollback !== "none" ? rollback : undefined };
}

function fileRows(receipt: JsonObject): JsonValue | undefined {
  const outputs = arrayAt(receipt, "externalOutputs");
  if (!outputs?.length) return undefined;
  return objectsIn(outputs).slice(0, 16).map((row) => ({ path: clip(String(row.path), 1024), operation: clip(String(row.operation), 64) }));
}

function appliedFields(receipt: JsonObject): JsonFields {
  const applied = arrayAt(receipt, "appliedOperations");
  const completed = arrayAt(receipt, "completedOperations");
  const created = objectAt(receipt, "created");
  return {
    applied: applied?.length ? applied.length : undefined,
    created: created && !isEmpty(created) ? created : undefined,
    completed: completed?.length ? completed : undefined,
    files: fileRows(receipt),
  };
}

function stepIssue(step: JsonObject, state: string): string {
  const { observed: _observed, verificationState: _state, operation, basis, ...rest } = step;
  return clip(`${String(operation)} ${state} ${String(basis ?? "")} ${isEmpty(rest) ? "" : JSON.stringify(rest)}`.trim(), 200);
}

function stateOf(step: JsonObject): string {
  return stringAt(step, "verificationState") ?? (step.observed ? "exact" : "unknown");
}

function stepLadder(receipt: JsonObject, steps: ReadonlyArray<JsonObject>): StepLadder {
  const settled = verifiedRowIndexes(receipt);
  const counts: { [state: string]: number } = {};
  const issues: string[] = [];
  steps.forEach((step, index) => {
    const state = stateOf(step);
    counts[state] = (counts[state] ?? 0) + 1;
    if (state !== "exact" && !settled.has(index)) issues.push(stepIssue(step, state));
  });
  const presets = steps.filter((step) => step.operation === "apply_preset" && isJsonObject(step.added)).map((step) => `${String(step.layerId ?? "")} ${JSON.stringify(step.added)}`);
  return { counts, issues, presets };
}

function unverifiedReasons(steps: ReadonlyArray<JsonObject>): ReadonlyArray<string> {
  const reasons = steps.flatMap((step, index) => (step.verificationState === "exact" || step.observed === true ? [] : [`#${index} ${String(step.operation)} ${String(step.verificationState ?? "unknown")} ${String(step.basis ?? "")}`.trim()]));
  return reasons.slice(0, 16).map((reason) => clip(reason, 200));
}

function verificationFields(receipt: JsonObject): JsonFields {
  const steps = verificationSteps(receipt);
  if (!steps.length) return {};
  const ladder = stepLadder(receipt, steps);
  const reasons = ladder.issues.length || receipt.postcondition === "passed" ? [] : unverifiedReasons(steps);
  return {
    verified: ladder.counts,
    issues: ladder.issues.length ? ladder.issues.slice(0, 16) : undefined,
    unverifiedBecause: reasons.length ? reasons : undefined,
    presets: ladder.presets.length ? ladder.presets.slice(0, 8) : undefined,
  };
}

function keyframeStepLine(step: JsonObject): string {
  const removed = numberAt(step, "removedKeys");
  return `${tail(String(step.propertyPath ?? ""), 2)} ${String(step.keyframeMode ?? "")}${removed ? ` -${removed}` : ""}→${String(step.afterKeys ?? "?")}`;
}

function frameLines(receipt: JsonObject): ReadonlyArray<string> {
  const findings = objectsIn(arrayAt(receipt, "frameChecks")).filter((row) => row.verdict === "OFF_FRAME" || row.verdict === "CLIPPED");
  return findings.slice(0, 8).map((row) => clip(stringAt(row, "message") ?? `${String(row.layer)} is ${String(row.verdict)}`, 600));
}

function layoutFields(receipt: JsonObject): JsonFields {
  const keyframes = arrayAt(receipt, "keyframeSteps");
  const frame = frameLines(receipt);
  return {
    keys: keyframes?.length ? objectsIn(keyframes).map(keyframeStepLine) : undefined,
    frame: frame.length ? frame : undefined,
    undo: objectAt(receipt, "undo"),
  };
}

function repairField(receipt: JsonObject): JsonFields {
  const repair = objectAt(receipt, "repair");
  const operations = arrayAt(repair, "operations");
  if (!operations?.length) return {};
  return { repair: { failedCount: numberAt(repair, "failedCount") ?? operations.length, operations: objectsIn(operations).slice(0, 8) } };
}

function unconfirmedLine(row: JsonObject): string {
  const basis = row.basis ? ` (${String(row.basis)})` : "";
  const error = objectAt(row, "error");
  const code = error ? ` ${String(error.code)}` : "";
  return clip(`#${String(row.index)} ${String(row.type)} ${String(row.outcome)}${basis}${code}`, 160);
}

function positiveCounts(counts: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => typeof count === "number" && count > 0));
}

function outcomeFields(receipt: JsonObject): JsonFields {
  const counts = objectAt(receipt, "outcomeCounts");
  const unconfirmed = objectsIn(arrayAt(receipt, "operationOutcomes")).filter((row) => !isVerifiedOutcome(row.outcome)).map(unconfirmedLine);
  return {
    outcomes: counts ? positiveCounts(counts) : undefined,
    failure: objectAt(receipt, "failure"),
    unconfirmed: unconfirmed.length ? unconfirmed.slice(0, 24) : undefined,
  };
}

function effectControlField(receipt: JsonObject): JsonFields {
  const entries = objectsIn(arrayAt(receipt, "effectControls")).slice(0, 8);
  const listed = entries.map((entry) => objectOf({ effect: entry.effect, controls: arrayAt(entry, "controls")?.slice(0, 40) ?? [] }));
  return { effectControls: listed.length ? listed : undefined };
}

/** The agent-facing view of a receipt: status and read-back coverage first, then only the sections that have something to say. */
export function receiptView(receipt: JsonObject): JsonObject {
  return objectOf({
    status: receipt.status,
    postcondition: receipt.postcondition,
    verificationCoverage: coverage(receipt),
    ...mutationFields(receipt),
    error: objectAt(receipt, "error") ?? objectAt(receipt, "hostError"),
    ...rollbackField(receipt),
    ...appliedFields(receipt),
    ...verificationFields(receipt),
    ...layoutFields(receipt),
    ...repairField(receipt),
    ...outcomeFields(receipt),
    ...effectControlField(receipt),
    correction: rolledBackCorrection(receipt) ?? readbackRepairCorrection(receipt),
    host: objectAt(receipt, "host"),
  });
}
