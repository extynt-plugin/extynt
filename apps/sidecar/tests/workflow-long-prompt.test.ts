// The goal limit: a long brief starts a workflow, a prompt over the limit is refused with its size, and a sent-anyway goal is cut on a character boundary.
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_WORKFLOW_GOAL_LENGTH } from "@extynt/workflow";
import { promptTooLong } from "../src/server-workflow-cycles.js";
import { present } from "./agent-test-support.js";
import { utf8Prefix, workflowGoalText } from "../src/workflow-coordinator-types.js";

test("the goal limit is 32 KB, so a long brief starts a workflow", () => {
  assert.equal(MAX_WORKFLOW_GOAL_LENGTH, 32_000);
  assert.equal(promptTooLong("x".repeat(9_500), {}), undefined);
  assert.equal(promptTooLong("x".repeat(32_000), {}), undefined);
});

test("a prompt over the limit is refused with its size and 'Shorten the prompt', unless the user chose Send anyway", () => {
  const refused = promptTooLong("x".repeat(41_200), {});
  assert.equal(refused?.failure?.code, "PROMPT_TOO_LONG");
  assert.equal(refused?.outcome, "failed");
  assert.match(present(refused).answer, /^Your prompt is 42 KB; the limit is 32 KB\. Shorten the prompt, or choose Send anyway/);
  assert.equal(promptTooLong("x".repeat(41_200), { allowLongPrompt: true }), undefined);
});

test("the limit counts UTF-8 bytes: 11,000 emoji are 44 KB", () => {
  assert.equal(promptTooLong("🎬".repeat(11_000), {})?.failure?.code, "PROMPT_TOO_LONG");
});

test("a sent-anyway goal is kept to its first 32 KB without cutting a character in half", () => {
  assert.equal(utf8Prefix("aé", 2), "a");
  assert.equal(utf8Prefix("a🎬", 4), "a");
  assert.equal(utf8Prefix("a🎬", 5), "a🎬");
  const goal = workflowGoalText("é🎬".repeat(9_000));
  const bytes = Buffer.byteLength(goal, "utf8");
  assert.ok(bytes <= MAX_WORKFLOW_GOAL_LENGTH && bytes > MAX_WORKFLOW_GOAL_LENGTH - 4, `kept ${bytes} bytes`);
  assert.ok(!goal.includes("�"));
});
