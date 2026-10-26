/**
 * Apply-plan host contract: partial failures, batching of long plans, and rollback through the host's Undo.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { type FakeProperty, loadApplyPlan } from "./host-apply-harness.js";
import { positionOf } from "./host-fake-lookup.js";
import { type PlanApply, TITLE_TARGET, applyPlan, assertRefused } from "./host-plan-io.js";
import { installGlobal } from "./host-vm-context.js";
import { fieldOf, listAt, textAt } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";

test("a rejected apply_plan never labels earlier completed operations as fully applied", () => {
  const { apply, calls, title } = loadApplyPlan();
  positionOf(title).setValue = () => {
    throw new Error("PROPERTY_WRITE_FAILED: hidden leader");
  };
  const reply = applyPlan(apply, "partial-failure", [
    { operation: "set_text_document", ...TITLE_TARGET, text: "Written before failure" },
    { operation: "set_layer_property", ...TITLE_TARGET, propertyPath: "ADBE Transform Group/ADBE Position", role: "transform.position", value: [640, 360] },
  ]);
  assert.equal(fieldOf(reply, "ok"), false);
  assert.equal(calls.begin.length, 1);
  assert.equal(calls.end, 1);
  assert.deepEqual(fieldOf(reply, "appliedOperations"), []);
  assert.deepEqual(fieldOf(reply, "completedOperations"), ["set_text_document"]);
  assert.equal(fieldOf(reply, "mayHaveMutated"), true);
  assert.equal(fieldOf(reply, "mutationState"), "partial-applied");
  assert.equal(fieldOf(reply, "receipt", "postcondition"), "partial_mutation_possible");
  assert.deepEqual(fieldOf(reply, "receipt", "appliedOperations"), []);
  assert.deepEqual(fieldOf(reply, "receipt", "completedOperations"), ["set_text_document"]);
  assert.equal(fieldOf(reply, "receipt", "rollback"), "After Effects Undo required");
});

const TIMING_OPERATION: JsonObject = { operation: "set_layer_timing", ...TITLE_TARGET, inPoint: 0.1 };

function repeatedTiming(count: number): JsonObject[] {
  return Array.from({ length: count }, () => TIMING_OPERATION);
}

function assertFiveOperationsShareOneUndoGroup(apply: PlanApply): void {
  const reply = applyPlan(apply, "wide-1", [
    { operation: "set_layer_property", ...TITLE_TARGET, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [1, 1] },
    TIMING_OPERATION,
    { operation: "set_audio", ...TITLE_TARGET, levelDb: -3 },
    { operation: "set_layer_timing", ...TITLE_TARGET, outPoint: 6 },
    { operation: "set_audio", ...TITLE_TARGET, enabled: true },
  ]);
  assert.equal(fieldOf(reply, "ok"), true);
  assert.equal(listAt(reply, "steps").length, 5);
  assert.equal(fieldOf(reply, "undoGroups"), 1, "a plan shorter than one batch stays a single undo group");
}

function assertLongPlanIsBatched(apply: PlanApply, beginCalls: ReadonlyArray<string>): void {
  const beforeLong = beginCalls.length;
  const long = applyPlan(apply, "wide-2", repeatedTiming(117), { batchSize: 25 });
  assert.equal(fieldOf(long, "ok"), true);
  assert.equal(listAt(long, "steps").length, 117);
  assert.equal(fieldOf(long, "undoGroups"), 5, "117 operations at 25 per group is five presses of Undo");
  assert.equal(fieldOf(long, "batchSize"), 25);
  assert.deepEqual(
    beginCalls.slice(beforeLong).map((name) => name.replace("extynt — wide-2", "")),
    [" (1/5)", " (2/5)", " (3/5)", " (4/5)", " (5/5)"],
    "After Effects is handed one undo group per batch, in order, each named for where it sits in the plan",
  );
}

function assertOperationCeilingNamed(apply: PlanApply): void {
  const ceiling = 256;
  const atCeiling = applyPlan(apply, "wide-3", repeatedTiming(ceiling));
  assert.equal(fieldOf(atCeiling, "ok"), true, "the advertised maximum must apply");
  assert.equal(listAt(atCeiling, "steps").length, ceiling);
  const overCeiling = applyPlan(apply, "wide-4", repeatedTiming(ceiling + 1));
  assertRefused(overCeiling, "INVALID_COMMAND");
  assert.match(textAt(overCeiling, "error", "message"), /1-256 operations/);
}

test("apply_plan applies a plan as long as the schema advertises, not as long as the mailbox used to allow (regression: a 117-operation plan was refused after approval with nothing applied)", () => {
  const { apply, calls } = loadApplyPlan();
  assertFiveOperationsShareOneUndoGroup(apply);
  assertLongPlanIsBatched(apply, calls.begin);
  assertOperationCeilingNamed(apply);
});

type LoadedPlan = ReturnType<typeof loadApplyPlan>;

interface FakeUndo {
  readonly position: FakeProperty;
  readonly pressed: number[];
  readonly stack: Array<() => void>;
}

const INSTALL_FAKE_UNDO = `
  app.project.revision = 1;
  app.executeCommand = function (id) {
    fakeUndo.press(id);
    app.project.revision += 1;
  };
`;

function withFakeUndo(loaded: LoadedPlan): FakeUndo {
  const pressed: number[] = [];
  const stack: Array<() => void> = [];
  const press = (id: number): void => {
    pressed.push(id);
    const inverse = stack.pop();
    if (!inverse) throw new Error("nothing to undo");
    inverse();
  };
  installGlobal(loaded.context, "fakeUndo", { press });
  vm.runInContext(INSTALL_FAKE_UNDO, loaded.context);
  const position = positionOf(loaded.title);
  const write = position.setValue.bind(position);
  position.setValue = (written) => {
    const before = position.value;
    stack.push(() => {
      position.value = before;
    });
    vm.runInContext("app.project.revision += 1", loaded.context);
    write(written);
  };
  return { position, pressed, stack };
}

function rejectStringWrites(position: FakeProperty): void {
  const writeUnderlying = position.setValue.bind(position);
  position.setValue = (written) => {
    if (typeof written === "string") throw new Error("PROPERTY_WRITE_FAILED: bad value");
    writeUnderlying(written);
  };
}

const ROLLBACK_OPERATIONS: ReadonlyArray<JsonObject> = [
  { operation: "set_layer_property", ...TITLE_TARGET, propertyPath: "ADBE Transform Group/ADBE Position", role: "transform.position", value: [640, 360] },
  { operation: "set_layer_property", ...TITLE_TARGET, propertyPath: "ADBE Transform Group/ADBE Position", role: "transform.position", value: "not a position" },
];

test("a batch that fails part-way is undone and reported as rolled back when the project reads as before", () => {
  const loaded = loadApplyPlan();
  const { position, pressed } = withFakeUndo(loaded);
  const before = JSON.stringify(position.value);
  rejectStringWrites(position);
  const reply = applyPlan(loaded.apply, "rolled-back", ROLLBACK_OPERATIONS);
  assert.equal(fieldOf(reply, "ok"), false);
  assert.deepEqual(pressed, [16], "one undo group held a step, so one Undo was pressed");
  assert.equal(JSON.stringify(position.value), before, "the earlier write was taken back");
  assert.equal(fieldOf(reply, "mayHaveMutated"), false);
  assert.equal(fieldOf(reply, "mutationState"), "rolled-back");
  assert.equal(fieldOf(reply, "rolledBack"), true);
  assert.deepEqual(fieldOf(reply, "completedOperations"), []);
  assert.equal(fieldOf(reply, "receipt", "postcondition"), "not_run");
  assert.match(textAt(reply, "receipt", "rollback"), /^Rolled back/);
  assert.equal(fieldOf(reply, "failedOperationIndex"), 1);
});

test("a batch whose Undo cannot restore the project keeps the partial-mutation answer", () => {
  const loaded = loadApplyPlan();
  const { position, stack } = withFakeUndo(loaded);
  rejectStringWrites(position);
  stack.length = 0;
  vm.runInContext("app.executeCommand = function () {};", loaded.context);
  const reply = applyPlan(loaded.apply, "unclean", ROLLBACK_OPERATIONS);
  assert.equal(fieldOf(reply, "ok"), false);
  assert.equal(fieldOf(reply, "mayHaveMutated"), true);
  assert.equal(fieldOf(reply, "mutationState"), "partial-applied");
  assert.equal(fieldOf(reply, "receipt", "postcondition"), "partial_mutation_possible");
  assert.equal(fieldOf(reply, "receipt", "rollback"), "After Effects Undo required");
});
