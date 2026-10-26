// Proves operation outcomes pair each plan operation with its own verification step and band it by the evidence that step carries.
import test from "node:test";
import assert from "node:assert/strict";
import { HOST_EVIDENCE_RULES, operationOutcomes } from "../src/receipts.js";
import type { OperationOutcomeRow, OperationOutcomeSummary } from "../src/receipts.js";
import { operationsOf } from "../src/operations.js";
import { arrayAt, objectAt, objectsIn, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";

const POSITION = "ADBE Transform Group/ADBE Position";
const SCALE = "ADBE Transform Group/ADBE Scale";
const FIXTURE_TARGET: JsonObject = { snapshotFingerprint: "fixture", selectionFingerprint: "fixture" };

function withFixtureTarget(row: JsonObject): JsonObject {
  return { ...row, target: { ...FIXTURE_TARGET, ...objectAt(row, "target") } };
}

function plan(operations: JsonObject[]): { operations: ReturnType<typeof operationsOf> } {
  return { operations: operationsOf(operations.map(withFixtureTarget)) };
}

function rowAt(summary: OperationOutcomeSummary, index: number): OperationOutcomeRow {
  const row = summary.rows[index];
  assert.ok(row, `the summary has a row at index ${index}`);
  return row;
}

function executed(steps: JsonObject[]): JsonObject {
  return { status: "executed", verification: { steps } };
}

test("read-back evidence the panel already sends rides into its row", () => {
  const summary = operationOutcomes(plan([{ type: "create_shape_group", target: { compositionId: "comp-1", layerId: "layer-1" } }]), executed([
    { operation: "create_shape_group", observed: false, verificationState: "applied_unverified", basis: "host-step-evidence-state-not-in-snapshot", compositionId: "comp-1", layerId: "layer-1", hostVerification: "shape-group-read-back", placeholderObserved: true },
  ]));
  const row = rowAt(summary, 0);
  assert.equal(row.outcome, "applied_unconfirmed");
  assert.equal(row.basis, "host-step-evidence-state-not-in-snapshot");
  assert.deepEqual(row.readBack, { hostVerification: "shape-group-read-back", placeholderObserved: true });
});

test("a duplicated composition and a puppet carrier swap pair with their exact step, so the compact outcome agrees with the verified count", () => {
  const duplicate = operationOutcomes(
    plan([{ type: "duplicate_composition", target: { compositionId: "1" }, newCompositionId: "__new__:comp0", name: "Copy" }]),
    { ...executed([{ operation: "duplicate_composition", observed: true, verificationState: "exact", basis: "composition-exists", sourceCompositionId: "1", requestedCompositionId: "__new__:comp0", compositionId: "20" }]), created: { "__new__:comp0": "20" } },
  );
  assert.equal(duplicate.rows[0]?.outcome, "confirmed");
  assert.equal(duplicate.counts.applied_unconfirmed, 0);
  const puppet = operationOutcomes(
    plan([{ type: "set_puppet_pins", target: { compositionId: "1", layerId: "17" }, pins: [{ x: 160, y: 90 }] }]),
    executed([{ operation: "set_puppet_pins", observed: true, verificationState: "exact", basis: "puppet-pins-read-back", compositionId: "1", requestedLayerId: "17", layerId: "31", carrierLayerId: "31" }]),
  );
  assert.equal(puppet.rows[0]?.outcome, "confirmed");
  assert.equal(puppet.counts.applied_unconfirmed, 0);
  const other = operationOutcomes(
    plan([{ type: "set_puppet_pins", target: { compositionId: "1", layerId: "17" }, pins: [{ x: 160, y: 90 }] }]),
    executed([{ operation: "set_puppet_pins", observed: true, verificationState: "exact", basis: "puppet-pins-read-back", compositionId: "1", requestedLayerId: "18", layerId: "31" }]),
  );
  assert.equal(other.rows[0]?.outcome, "applied_unconfirmed");
});

test("an evidence field no allowlist has ever heard of is kept, not dropped", () => {
  const summary = operationOutcomes(plan([{ type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION } }]), executed([
    { operation: "set_layer_property", verificationState: "applied_unverified", basis: "property-value-coerced", observedValue: [960, 540, 0], requestedValue: [960, 540] },
  ]));
  assert.deepEqual(summary.rows[0]?.readBack, { observedValue: [960, 540, 0], requestedValue: [960, 540] });
});

test("a step that carries only a verdict leaves the row without a readBack", () => {
  const summary = operationOutcomes(plan([{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" } }]), executed([
    { operation: "set_layer_name", observed: true, verificationState: "exact", basis: "layer-name", compositionId: "comp-1", layerId: "layer-1" },
  ]));
  const row = rowAt(summary, 0);
  assert.equal(row.outcome, "confirmed");
  assert.equal("readBack" in row, false);
});

test("a superseded failure reads back as unconfirmed, never as a mismatch", () => {
  const summary = operationOutcomes(plan([
    { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION } },
    { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION } },
  ]), executed([
    { operation: "set_layer_property", verificationState: "applied_unverified", basis: "superseded-by-later-operation", supersededBy: 1 },
    { operation: "set_layer_property", verificationState: "exact", basis: "property-value" },
  ]));
  assert.equal(summary.rows[0]?.outcome, "applied_unconfirmed");
  assert.equal(summary.rows[0]?.basis, "superseded-by-later-operation");
  assert.equal(summary.rows[0]?.readBack?.supersededBy, 1, "which operation superseded it stays readable");
  assert.equal(summary.counts.readback_mismatch, 0);
  assert.equal(summary.counts.confirmed, 1);
});

test("the host's own enforced read-back promotes a row the panel could not compare", () => {
  const summary = operationOutcomes(plan([
    { type: "export_mogrt", target: { compositionId: "comp-1" } },
    { type: "render_composition", target: { compositionId: "comp-1" } },
    { type: "set_project_settings" },
    { type: "ensure_text_animator", target: { compositionId: "comp-1", layerId: "layer-1" }, value: 0.5 },
  ]), executed([
    { operation: "export_mogrt", observed: false, verificationState: "applied_unverified", basis: "mogrt-export-host-evidence", hostVerification: "mogrt-file-written" },
    { operation: "render_composition", observed: false, verificationState: "applied_unverified", basis: "render-queue-host-evidence", submission: "render-file-written", bytes: 2048 },
    { operation: "set_project_settings", observed: false, verificationState: "applied_unverified", basis: "project-settings-host-read-back" },
    { operation: "ensure_text_animator", observed: false, verificationState: "applied_unverified", basis: "host-readback-path-not-in-snapshot", observedValue: 0.5, animatorCount: 2, created: true },
  ]));
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["host_confirmed", "host_confirmed", "host_confirmed", "host_confirmed"]);
  assert.deepEqual(summary.rows.map((row) => row.mutated), [true, true, true, true], "a host-confirmed write is a landed write, not an unknown one");
  assert.equal(summary.counts.host_confirmed, 4);
  assert.equal(summary.counts.applied_unconfirmed, 0);
  assert.equal(summary.rows[0]?.basis, "mogrt-export-host-evidence", "the panel's provenance stays readable next to the band");
});

test("weak host evidence stays a pass with a warning, never a confirmation", () => {
  const weak: ReadonlyArray<readonly [type: string, label: string]> = [
    ["ensure_shape_fill", "shape-fill-read-back"], ["create_shape_group", "shape-group-read-back"], ["set_track_matte", "track-matte-set"],
    ["set_composition_settings", "composition-settings-written"], ["update_mask", "mask-values-written"], ["set_camera_options", "camera-options-written"],
  ];
  const labels = weak.map(([, label]) => label);
  const summary = operationOutcomes(plan(weak.map(([type]) => ({ type }))), executed(weak.map(([operation, hostVerification]) => ({
    operation, observed: false, verificationState: "applied_unverified", basis: "host-step-evidence-state-not-in-snapshot", hostVerification, placeholderObserved: true,
  }))));
  assert.equal(summary.counts.applied_unconfirmed, labels.length);
  assert.equal(summary.counts.host_confirmed, 0);
  assert.equal(summary.rows.every((row) => row.outcome === "applied_unconfirmed"), true);
  assert.deepEqual(summary.rows.map((row) => row.readBack?.hostVerification), labels, "the evidence is kept on the row; it just does not move it");
});

test("an echo of the request is not host evidence", () => {
  const summary = operationOutcomes(plan([
    { type: "ensure_effect", target: { compositionId: "comp-1", layerId: "layer-1", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, enabled: true },
    { type: "set_time_remap", target: { compositionId: "comp-1", layerId: "layer-1" }, enabled: true },
    { type: "set_audio", target: { compositionId: "comp-1", layerId: "layer-1" }, enabled: true, levelDb: -6 },
  ]), executed([
    { operation: "ensure_effect", observed: false, verificationState: "applied_unverified", basis: "effect-enabled-state-not-in-snapshot", hostVerification: null, enabled: true, defaults: true },
    { operation: "set_time_remap", observed: false, verificationState: "applied_unverified", basis: "host-step-evidence-state-not-in-snapshot", hostVerification: "time-remap-state-written", enabled: true },
    { operation: "set_audio", observed: false, verificationState: "applied_unverified", basis: "host-step-evidence-state-not-in-snapshot", hostVerification: null, enabled: true, levelDb: -6 },
  ]));
  assert.equal(summary.counts.host_confirmed, 0);
  assert.equal(summary.counts.coerced_equivalent, 0);
  assert.equal(summary.counts.applied_unconfirmed, 3);
  assert.equal(summary.rows[0]?.readBack?.enabled, true);
  assert.equal(summary.rows[2]?.readBack?.levelDb, -6);
});

test("a failed row stays a mismatch even when host evidence is present", () => {
  const summary = operationOutcomes(plan([
    { type: "export_mogrt", target: { compositionId: "comp-1" } },
    { type: "set_project_settings" },
    { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION } },
  ]), executed([
    { operation: "export_mogrt", observed: false, verificationState: "failed", basis: "mogrt-export-host-evidence", hostVerification: "mogrt-file-written" },
    { operation: "set_project_settings", observed: false, verificationState: "failed", basis: "project-settings-host-read-back" },
    { operation: "set_layer_property", observed: false, verificationState: "failed", basis: "property-value-coerced" },
  ]));
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["readback_mismatch", "readback_mismatch", "readback_mismatch"]);
  assert.equal(summary.counts.readback_mismatch, 3);
  assert.equal(summary.counts.host_confirmed + summary.counts.coerced_equivalent, 0);
});

test("a coerced or broadcast write is equivalent, not a warning and not a failure", () => {
  const summary = operationOutcomes(plan([
    { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION } },
    { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: SCALE } },
    { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" } },
  ]), executed([
    { operation: "set_layer_property", observed: false, verificationState: "applied_unverified", basis: "property-value-coerced" },
    { operation: "set_layer_property", observed: false, verificationState: "applied_unverified", basis: "property-value-broadcast" },
    { operation: "set_layer_name", observed: false, verificationState: "applied_unverified", basis: "property-value-coerced" },
  ]));
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["coerced_equivalent", "coerced_equivalent", "applied_unconfirmed"]);
  assert.deepEqual(summary.rows.slice(0, 2).map((row) => row.mutated), [true, true]);
  assert.equal(summary.counts.coerced_equivalent, 2);
});

test("a write under an enabled expression is an equivalent outcome, not a mismatch", () => {
  const summary = operationOutcomes(plan([
    { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION } },
    { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" } },
  ]), executed([
    { operation: "set_layer_property", observed: false, verificationState: "applied_unverified", basis: "property-value-under-expression" },
    { operation: "set_layer_name", observed: false, verificationState: "applied_unverified", basis: "property-value-under-expression" },
  ]));
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["coerced_equivalent", "applied_unconfirmed"]);
});

test("a file claim is withheld when the step's byte count contradicts it", () => {
  const summary = operationOutcomes(plan([
    { type: "render_composition", target: { compositionId: "comp-1" } },
    { type: "render_composition", target: { compositionId: "comp-1" } },
    { type: "render_composition", target: { compositionId: "comp-1" } },
  ]), executed([
    { operation: "render_composition", verificationState: "applied_unverified", basis: "render-queue-host-evidence", submission: "render-file-written", bytes: 0 },
    { operation: "render_composition", verificationState: "applied_unverified", basis: "render-queue-host-evidence", submission: "render-file-written", bytes: "many" },
    { operation: "render_composition", verificationState: "applied_unverified", basis: "render-queue-host-evidence", submission: "render-queued" },
  ]));
  assert.equal(summary.counts.host_confirmed, 0);
  assert.equal(summary.counts.applied_unconfirmed, 3);
});

test("a text animator value that differs from the request is not promoted", () => {
  const summary = operationOutcomes(plan([
    { type: "ensure_text_animator", target: { compositionId: "comp-1", layerId: "layer-1" }, value: 0.5 },
    { type: "ensure_text_animator", target: { compositionId: "comp-1", layerId: "layer-1" }, value: 0.5 },
  ]), executed([
    { operation: "ensure_text_animator", verificationState: "applied_unverified", basis: "host-readback-path-not-in-snapshot", observedValue: 5 },
    { operation: "ensure_text_animator", verificationState: "applied_unverified", basis: "host-readback-path-not-in-snapshot" },
  ]));
  assert.equal(summary.counts.host_confirmed, 0);
  assert.equal(summary.counts.applied_unconfirmed, 2);
});

const MEASURED_COMPOSITION: ReadonlyArray<readonly [type: string, count: number]> = [
  ["create_layer", 20], ["set_layer_property", 19], ["set_effect_control", 15],
  ["add_shape_item", 13], ["set_layer_timing", 13], ["add_marker", 12],
  ["set_text_document", 11], ["create_shape_group", 8], ["ensure_shape_fill", 6],
  ["ensure_effect", 4], ["animate_property", 3], ["ensure_shape_stroke", 2],
  ["set_composition_settings", 1], ["update_shape_item", 1], ["set_track_matte", 1],
];

const MEASURED_STEP_COUNT = 64;

const MEASURED_HOST_EVIDENCE: ReadonlyArray<readonly [index: number, type: string]> = [
  [3, "create_shape_group"], [5, "ensure_shape_fill"], [15, "create_shape_group"],
  [17, "ensure_shape_stroke"], [26, "create_shape_group"], [28, "ensure_shape_fill"],
  [33, "create_shape_group"], [35, "ensure_shape_fill"], [45, "create_shape_group"],
  [47, "ensure_shape_stroke"], [52, "set_track_matte"],
];

const MEASURED_COERCED_INDICES: readonly number[] = [9, 24, 37, 39, 41, 61, 63];

function weakHostToken(type: string): string {
  const rule = HOST_EVIDENCE_RULES.find((entry) => entry.type === type && entry.strength === "weak" && entry.field === "hostVerification");
  if (!rule) throw new Error(`no weak host-verification rule covers ${type}`);
  return rule.evidence;
}

function reconstructedLongReceipt(): JsonObject {
  const operations = layOutMeasuredOperations();
  const steps = operations.slice(0, MEASURED_STEP_COUNT).map(stepFor);
  return { status: "executed", verification: { steps }, operationOutcomes: operations.map((type, index) => ({ index, type })) };
}

function layOutMeasuredOperations(): string[] {
  const total = MEASURED_COMPOSITION.reduce((sum, [, count]) => sum + count, 0);
  const slots = new Array<string | undefined>(total).fill(undefined);
  for (const [index, type] of MEASURED_HOST_EVIDENCE) slots[index] = type;
  for (const index of MEASURED_COERCED_INDICES) {
    if (slots[index] !== undefined) throw new Error(`the reconstruction puts two operations at index ${index}`);
    slots[index] = "set_layer_property";
  }
  fillSlots(slots, remainingCounts(slots));
  const operations = slots.flatMap((slot) => slot ?? []);
  assertComposition(operations);
  return operations;
}

function remainingCounts(slots: Array<string | undefined>): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const [type, count] of MEASURED_COMPOSITION) {
    const placed = slots.filter((slot) => slot === type).length;
    if (placed > count) throw new Error(`the measured rows need ${placed} ${type} operations; the composition has ${count}`);
    remaining.set(type, count - placed);
  }
  return remaining;
}

function fillSlots(slots: Array<string | undefined>, remaining: Map<string, number>): void {
  const order = [...remaining.keys()];
  let cursor = 0;
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index] !== undefined) continue;
    const placement = placeNext(order, remaining, cursor);
    if (!placement) throw new Error(`no operation left to fill index ${index}`);
    slots[index] = placement.type;
    cursor = placement.cursor;
  }
}

function placeNext(order: string[], remaining: Map<string, number>, cursor: number): { type: string; cursor: number } | null {
  for (let scan = 0; scan < order.length; scan += 1) {
    const type = order[(cursor + scan) % order.length];
    const left = type === undefined ? 0 : (remaining.get(type) ?? 0);
    if (type === undefined || left <= 0) continue;
    remaining.set(type, left - 1);
    return { type, cursor: (cursor + scan + 1) % order.length };
  }
  return null;
}

function assertComposition(operations: string[]): void {
  const composition = new Map<string, number>();
  for (const type of operations) composition.set(type, (composition.get(type) ?? 0) + 1);
  for (const [type, count] of MEASURED_COMPOSITION) if (composition.get(type) !== count) throw new Error(`the reconstruction has ${composition.get(type) ?? 0} ${type} operations; the receipt measured ${count}`);
}

const MEASURED_HOST_EVIDENCE_AT = new Map(MEASURED_HOST_EVIDENCE);
const MEASURED_COERCED_AT = new Set<number>(MEASURED_COERCED_INDICES);

function stepFor(type: string, index: number): JsonObject {
  const hostEvidence = MEASURED_HOST_EVIDENCE_AT.get(index);
  if (hostEvidence !== undefined) return { operation: type, observed: false, verificationState: "applied_unverified", basis: "host-step-evidence-state-not-in-snapshot", hostVerification: weakHostToken(hostEvidence), placeholderObserved: true };
  if (MEASURED_COERCED_AT.has(index)) return { operation: type, observed: false, verificationState: "applied_unverified", basis: "property-value-coerced" };
  return { operation: type, observed: true, verificationState: "exact", basis: "read-back-equal" };
}

test("the stored 129-operation receipt promotes nothing on its weak host evidence", () => {
  const receipt = reconstructedLongReceipt();
  const recorded = objectsIn(arrayAt(receipt, "operationOutcomes"));
  assert.equal(recorded.length, 129, "the run record's receipt is the long plan this ladder was designed against");
  const summary = operationOutcomes(plan(recorded.map((row) => ({ type: stringAt(row, "type") ?? "" }))), receipt);
  assert.equal(summary.counts.confirmed, 46);
  assert.equal(summary.counts.readback_mismatch, 0);
  const withHostEvidence = summary.rows.filter((row) => typeof row.readBack?.hostVerification === "string");
  assert.equal(withHostEvidence.length, 11);
  assert.equal(withHostEvidence.every((row) => row.outcome === "applied_unconfirmed"), true);
  assert.equal(summary.counts.host_confirmed, 0, "no row in this receipt has strong host evidence");
  assert.equal(summary.counts.coerced_equivalent, 7);
  assert.equal(summary.rows.filter((row) => row.outcome === "coerced_equivalent").every((row) => row.type === "set_layer_property"), true);
  assert.equal(summary.counts.applied_unconfirmed, 76);
});

test("each operation keeps its own step when the steps arrive in another order", () => {
  const target: JsonObject = { compositionId: "comp-1", layerId: "layer-1" };
  const summary = operationOutcomes(plan([
    { type: "set_layer_property", target, role: "transform.scale", propertyPath: SCALE, value: [5, 5] },
    { type: "set_layer_property", target, role: "transform.position", propertyPath: POSITION, value: [961, 541] },
  ]), executed([
    { operation: "set_layer_property", observed: true, verificationState: "exact", basis: "property-value", ...target, propertyPath: POSITION },
    { operation: "set_layer_property", observed: false, verificationState: "applied_unverified", basis: "property-value-coerced", ...target, propertyPath: SCALE, observedValue: [5, 5, 100] },
  ]));
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["coerced_equivalent", "confirmed"]);
  assert.deepEqual(summary.rows.map((row) => row.basis), ["property-value-coerced", "property-value"], "the provenance travels with the verdict");
  assert.deepEqual(summary.rows[0]?.readBack?.observedValue, [5, 5, 100], "the compared value the scale step carried stays on the scale row");
  assert.equal(summary.rows[0]?.readBack?.propertyPath, undefined, "and the position step's compared path is not on it");
});

test("a step naming the layer an operation created pairs with the operation that created it", () => {
  const summary = operationOutcomes(plan([
    { type: "duplicate_layer", target: { compositionId: "comp-1", layerId: "layer-1" }, newLayerId: "__new__:copy" },
    { type: "precompose_layers", target: { compositionId: "comp-1" }, layerIds: ["layer-1"], name: "Pre", newCompositionId: "__new__:pre", newLayerId: "__new__:prelayer" },
  ]), { ...executed([
    { operation: "duplicate_layer", observed: true, verificationState: "exact", basis: "layer-exists", compositionId: "comp-1", sourceLayerId: "layer-1", requestedLayerId: "__new__:copy", layerId: "layer-7" },
    { operation: "precompose_layers", observed: true, verificationState: "exact", basis: "precomp-created-and-layers-moved", compositionId: "comp-1", requestedNewCompositionId: "__new__:pre", newCompositionId: "comp-4", requestedLayerId: "__new__:prelayer", layerId: "layer-8" },
  ]), created: { "__new__:copy": "layer-7", "__new__:pre": "comp-4", "__new__:prelayer": "layer-8" } });
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["confirmed", "confirmed"]);
  assert.deepEqual(summary.rows.map((row) => row.basis), ["layer-exists", "precomp-created-and-layers-moved"]);
});

test("an operation whose step never arrived reads no evidence, never its neighbour's", () => {
  const named = (layerId: string): JsonObject => ({ operation: "set_layer_name", observed: true, verificationState: "exact", basis: "layer-name", compositionId: "comp-1", layerId });
  const summary = operationOutcomes(plan([
    { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" } },
    { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-2" } },
    { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-3" } },
  ]), executed([named("layer-1"), named("layer-3")]));
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["confirmed", "applied_unconfirmed", "confirmed"]);
  assert.equal(summary.rows[1]?.basis, "no-read-back");
  assert.equal(summary.rows[1]?.mutated, "unknown");
  assert.equal(summary.rows[1]?.readBack, undefined);
  assert.equal(summary.rows[1]?.targets.layerId, "layer-2");
});

test("a truncated step array leaves the unreported tail without evidence", () => {
  const operations = Array.from({ length: 4 }, (_, index): JsonObject => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId: `layer-${index + 1}` } }));
  const steps = [0, 1].map((index): JsonObject => ({ operation: "set_layer_name", observed: true, verificationState: "exact", basis: "layer-name", compositionId: "comp-1", layerId: `layer-${index + 1}` }));
  const summary = operationOutcomes(plan(operations), executed(steps));
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["confirmed", "confirmed", "applied_unconfirmed", "applied_unconfirmed"]);
  assert.equal(summary.rows.slice(2).every((row) => row.basis === "no-read-back"), true);
});

test("operations identical in type and target still pair by position", () => {
  const target: JsonObject = { compositionId: "comp-1", layerId: "layer-1" };
  const summary = operationOutcomes(plan([
    { type: "set_layer_property", target, role: "transform.position", propertyPath: POSITION, value: [961, 541] },
    { type: "set_layer_property", target, role: "transform.position", propertyPath: POSITION, value: [962, 542] },
  ]), executed([
    { operation: "set_layer_property", observed: true, verificationState: "exact", basis: "property-value", ...target, propertyPath: POSITION },
    { operation: "set_layer_property", observed: false, verificationState: "failed", basis: "property-value-mismatch", ...target, propertyPath: POSITION },
  ]));
  assert.deepEqual(summary.rows.map((row) => row.outcome), ["confirmed", "readback_mismatch"]);
});

test("a step that names no operation is still taken at its own position", () => {
  const summary = operationOutcomes(plan([{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" } }]), executed([
    { observed: true, verificationState: "exact", basis: "layer-name" },
  ]));
  assert.equal(summary.rows[0]?.outcome, "confirmed");
  assert.equal(summary.rows[0]?.basis, "layer-name");
});

test("a read_keyframes row is a read: it never counts as a mutation, and the writes beside it still do", () => {
  const summary = operationOutcomes(plan([
    { type: "read_keyframes", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION } },
    { type: "export_mogrt", target: { compositionId: "comp-1" } },
  ]), executed([
    { operation: "read_keyframes", observed: false, verificationState: "applied_unverified", basis: "host-step-evidence-state-not-in-snapshot", hostVerification: "keyframes-read" },
    { operation: "export_mogrt", observed: false, verificationState: "applied_unverified", basis: "mogrt-export-host-evidence", hostVerification: "mogrt-file-written" },
  ]));
  assert.deepEqual(summary.rows.map((row) => row.mutated), [false, true]);
});
