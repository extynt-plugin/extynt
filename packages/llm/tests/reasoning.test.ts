// Reasoning extraction: both provider shapes are read, and nothing is invented when neither is present.
import test from "node:test";
import assert from "node:assert/strict";
import { extractReasoning } from "../src/index.js";

test("reasoning is read from either provider shape, and never invented", () => {
  assert.equal(extractReasoning({ reasoning_content: "weighing two paths" }), "weighing two paths");
  assert.equal(
    extractReasoning({ content: [{ type: "thinking", thinking: "first" }, { type: "text", text: "answer" }, { type: "thinking", thinking: "second" }] }),
    "first\nsecond",
  );
  assert.equal(extractReasoning({ reasoning_content: "   ", content: [{ type: "thinking", thinking: "from the blocks" }] }), "from the blocks");
  assert.equal(extractReasoning(undefined), "");
  assert.equal(extractReasoning(null), "");
  assert.equal(extractReasoning({ reasoning_content: "   " }), "");
  assert.equal(extractReasoning({ content: [{ type: "text", text: "not reasoning" }] }), "");
  assert.equal(extractReasoning({ content: "a bare string, not a block list" }), "");
  assert.equal(extractReasoning({ content: [null, 7, { type: "thinking" }] }), "");
});
