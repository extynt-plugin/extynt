// Where the model kept sending bad arguments: the descriptions say what is required, and a refused item placeholder says how to declare one.
import test from "node:test";
import assert from "node:assert/strict";
import type { JsonObject } from "@extynt/decode";
import { TOOL_DEFINITIONS, callTool } from "../src/index.js";
import { queueContext } from "./support/queue-context.js";

const descriptionOf = (name: string): string => TOOL_DEFINITIONS.find((definition) => definition.name === name)?.description ?? "";

test("the capture tools say captureId is required and where it comes from", () => {
  assert.match(descriptionOf("ae_get_capture_frame"), /captureId is required: it is the captureId field of the ae_capture_composition_frame result/);
});

test("the arc solver description lists its required arguments and points at measuring an existing path", () => {
  const description = descriptionOf("ae_solve_arc_path");
  assert.match(description, /Required: center, sweep, startTime and duration/);
  assert.match(description, /ae_measure_layer/);
});

test("a sourceItemId with no declaring import says how to declare it", () => {
  const operation: JsonObject = { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:logo" }, layerType: "footage", name: "Logo", sourceItemId: "__new__:logoItem" };
  const result = callTool("ae_queue_add", { operations: [operation] }, queueContext());
  const text = JSON.stringify(result);
  assert.match(text, /sourceItemId __new__:logoItem matches no item declared earlier/);
  assert.match(text, /newItemId/);
});
