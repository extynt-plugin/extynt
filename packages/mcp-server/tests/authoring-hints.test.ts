// Proves that refusals an agent can hit while authoring a plan name the exact fix rather than leaving it to guess.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../src/index.js";
import { arrayAt, booleanAt, stringAt, stringsIn } from "../src/json.js";
import { planContext, propose, successObject } from "./support/proposal-views.js";
import { refusalOf } from "./support/json-results.js";

test("a composition placeholder no operation declares is refused with the ids the plan's compositions answer to", () => {
  const result = propose("Bridge Test", [
    { type: "create_composition", name: "Bridge Test", width: 1920, height: 1080, durationSeconds: 10, frameRate: 30 },
    { type: "create_layer", target: { compositionId: "__new__:Bridge Test", layerId: "__new__:hello" }, layerType: "text", name: "Hello" },
  ], planContext());
  const { message } = refusalOf(result);
  assert.match(message, /__new__:comp0/);
  assert.match(message, /newCompositionId "__new__:Bridge Test"/);
});

test("describing an operation that does not exist names the nearest ones", () => {
  const data = successObject(callTool("ae_describe_native_operation", { id: "create_text_layer" }, {}));
  const nearest = stringsIn(arrayAt(data, "nearest"));
  assert.equal(booleanAt(data, "found"), false);
  assert.ok(nearest.includes("create_layer"), JSON.stringify(nearest));
  assert.match(stringAt(data, "next") ?? "", /create_layer/);
});
