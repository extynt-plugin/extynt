/** aeUndoPlan: an optional expectedStamp refuses the undo, before any press, when the project is no longer the one the stamp names. */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { loadHostFiles } from "./host-sources.js";
import { type HostContext, callEntry, loadHostContext } from "./host-vm-context.js";
import { fieldOf } from "./json-narrow.js";

const GROUP = "extynt — plan-1";

interface UndoWorld {
  readonly host: HostContext;
  readonly pressed: number[];
}

function setup(): UndoWorld {
  const pressed: number[] = [];
  const app = {
    project: { revision: 12, file: null },
    executeCommand: (id: number) => {
      pressed.push(id);
    },
  };
  const host = loadHostContext({ app, CompItem: class {} });
  loadHostFiles(host.context, "collection.jsx");
  vm.runInContext("__extyntProjectEpoch = 2", host.context);
  return { host, pressed };
}

function undo(host: HostContext, extra: JsonObject): JsonObject {
  return callEntry(host, "aeUndoPlan", JSON.stringify({ operation: "undo_plan", planId: "plan-1", undoGroup: GROUP, ...extra }));
}

const MISMATCHED_STAMPS: JsonValue[] = [{ epoch: 2, revision: 11 }, { epoch: 1, revision: 12 }, { epoch: null, revision: null }];

const MALFORMED_STAMPS: JsonValue[] = [null, 5, "2:12", [], {}, { epoch: 2 }, { revision: 12 }, { epoch: "2", revision: 12 }, { epoch: 2, revision: true }];

test("a matching expectedStamp presses undo", () => {
  const { host, pressed } = setup();
  const result = undo(host, { times: 2, expectedStamp: { epoch: 2, revision: 12 } });
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(fieldOf(result, "times"), 2);
  assert.deepEqual(pressed, [16, 16]);
});

test("a stamp from another revision or epoch refuses UNDO_PROJECT_CHANGED without pressing undo", () => {
  const { host, pressed } = setup();
  for (const expectedStamp of MISMATCHED_STAMPS) {
    const result = undo(host, { expectedStamp });
    assert.equal(fieldOf(result, "ok"), false);
    assert.equal(fieldOf(result, "error", "code"), "UNDO_PROJECT_CHANGED", JSON.stringify(expectedStamp));
  }
  assert.deepEqual(pressed, []);
});

test("without an expectedStamp the undo presses once", () => {
  const { host, pressed } = setup();
  const result = undo(host, {});
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(fieldOf(result, "times"), 1);
  assert.deepEqual(pressed, [16]);
});

test("a malformed expectedStamp is INVALID_COMMAND and nothing is pressed", () => {
  const { host, pressed } = setup();
  for (const expectedStamp of MALFORMED_STAMPS) {
    assert.equal(fieldOf(undo(host, { expectedStamp }), "error", "code"), "INVALID_COMMAND", JSON.stringify(expectedStamp));
  }
  assert.deepEqual(pressed, []);
});

test("the group check still comes first", () => {
  const { host } = setup();
  const raw = JSON.stringify({ operation: "undo_plan", undoGroup: "x", expectedStamp: { epoch: 2, revision: 12 } });
  assert.equal(fieldOf(callEntry(host, "aeUndoPlan", raw), "error", "code"), "INVALID_COMMAND");
});
