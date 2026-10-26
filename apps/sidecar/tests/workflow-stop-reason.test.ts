// A workflow the sidecar stopped leads with the real reason; other failures and finished runs keep the model's answer.
import assert from "node:assert/strict";
import test from "node:test";
import { withStopReason } from "../src/server-workflow-cycle-state.js";
import { agentResult } from "./workflow-cycle-fixtures.js";

test("a workflow the sidecar stopped leads with the real reason, above the model's own wrap-up", () => {
  const blocked = agentResult({ outcome: "failed", answer: "I ran out of time in this turn.", failure: { code: "WORKFLOW_BATCH_BLOCKED", message: "After Effects refused the batch before running it (MARKER_EXISTS) after 2 corrected retries; nothing was applied, and the workflow is blocked." } });
  const stopped = withStopReason(blocked);
  assert.match(stopped.answer, /^Stopped: After Effects refused the batch before running it \(MARKER_EXISTS\)/);
  assert.match(stopped.answer, /The model's notes:\nI ran out of time in this turn\.$/);
  assert.equal(withStopReason(stopped).answer.match(/Stopped:/g)?.length, 1, "applied once");
});

test("other failures and successful runs keep the model's answer as it is", () => {
  assert.equal(withStopReason(agentResult({ answer: "Done." })).answer, "Done.");
  const prose = agentResult({ outcome: "failed", answer: "Renamed.", failure: { code: "WORKFLOW_NO_BATCH", message: "The initial workflow cycle produced no bounded batch." } });
  assert.equal(withStopReason(prose).answer, "Renamed.", "an answer in prose is not a stop");
  const provider = agentResult({ outcome: "failed", answer: "x", failure: { code: "PROVIDER_TIMEOUT", message: "y" } });
  assert.equal(withStopReason(provider).answer, "x");
});
