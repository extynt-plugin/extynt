// Model-written tool arguments: harmless wrappers are peeled, real breaks are refused by naming the field.
import assert from "node:assert/strict";
import test from "node:test";
import { toolCallArguments } from "../src/index.js";

test("fences, surrounding text and trailing commas are peeled", () => {
  for (const raw of ["```json\n{\"a\":1}\n```", "Here you go: {\"a\":1} done", "{\"a\":[1,2,],}"]) assert.deepEqual(toolCallArguments(raw), { arguments: { a: raw.includes("[") ? [1, 2] : 1 } }, raw);
});

test("plain text inside a value is refused by naming the field, without echoing it", () => {
  const result = toolCallArguments("{\"summary\":\"Shots\",\"operations\": [accepted in the previous call]}");
  assert.deepEqual(result.arguments, {});
  assert.match(result.argumentsError ?? "", /not valid JSON: the value of "operations" breaks near character \d+/);
  assert.match(result.argumentsError ?? "", /never describe or refer to earlier ones/);
  assert.doesNotMatch(result.argumentsError ?? "", /accepted/);
});

test("cut-off arguments say so", () => {
  assert.match(toolCallArguments("{\"operations\":[{\"type\":\"x\"},").argumentsError ?? "", /cut off/);
});
