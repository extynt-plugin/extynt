// Proves that ae_get_current_context and ae_status carry what the panel briefing carries: each fact appears when the sidecar supplies it and is absent otherwise.
import { representativeSnapshot } from "@extynt/project-graph";
import assert from "node:assert/strict";
import test from "node:test";
import { callTool } from "../src/index.js";
import type { ToolContext } from "../src/index.js";
import { stringAt, stringsIn, arrayAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { successObject } from "./support/proposal-views.js";

const FACTS = ["interruptedApply", "hostFailures", "recentBuild"];

function dataOf(name: string, context: ToolContext): JsonObject {
  return successObject(callTool(name, {}, { snapshot: representativeSnapshot, ...context }));
}

test("ae_get_current_context carries the interrupted apply, host failures and recent build when supplied", () => {
  const out = dataOf("ae_get_current_context", { interruptedApply: "After Effects quit during apply at step 2 of 5.", hostFailures: ["- add_marker (read-back mismatch, 2 failures)"], recentBuild: "Open comp comp-1." });
  assert.equal(stringAt(out, "interruptedApply"), "After Effects quit during apply at step 2 of 5.");
  assert.deepEqual(stringsIn(arrayAt(out, "hostFailures")), ["- add_marker (read-back mismatch, 2 failures)"]);
  assert.equal(stringAt(out, "recentBuild"), "Open comp comp-1.");
});

test("ae_get_current_context omits each fact when it is absent or empty", () => {
  const out = dataOf("ae_get_current_context", { hostFailures: [] });
  for (const key of FACTS) assert.equal(key in out, false, key);
});

test("ae_status carries the interrupted apply only when there is one", () => {
  assert.equal(stringAt(dataOf("ae_status", { interruptedApply: "quit" }), "interruptedApply"), "quit");
  assert.equal("interruptedApply" in dataOf("ae_status", {}), false);
});
