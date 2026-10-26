/** Panel contract: workflow recovery status is visible, read-only, and honest. */
import assert from "node:assert/strict";
import test from "node:test";
import { createPanelHarness } from "./contract.test.js";
import type { StubRequestRecord, StubResponse } from "./contract.test.js";
import { type JsonObject } from "@extynt/decode";

function workflowProjection(): JsonObject {
  return {
    resumeSupported: true,
    automaticDispatchResumeSupported: false,
    activeJobId: "job-1",
    jobs: [{ jobId: "job-1", status: "blocked", providerCycle: 1, blocker: "workflow:uncertain" }],
    stages: [],
    batches: [
      {
        batchId: "batch-1",
        jobId: "job-1",
        stageId: "stage-1",
        dependencies: [],
        lifecycle: "executing",
        execution: "JsonValue",
        verification: "JsonValue",
        mutation: "may_have_mutated",
      },
    ],
    providerFailures: [],
    divergences: [],
    continuation: null,
  };
}

function elementText(harness: ReturnType<typeof createPanelHarness>, id: string): string {
  return harness.el(id)?.textContent ?? "";
}

function workflowResponder(record: StubRequestRecord): StubResponse | undefined {
  if (!record.url.includes("/v1/workflow/status")) return undefined;
  return {
    status: 200,
    text: JSON.stringify({
      ok: true,
      projection: workflowProjection(),
      resume: {
        status: "blocked",
        automatic: false,
        autoApply: true,
        applied: { totalBatches: 1, settledBatches: 0, verifiedBatches: 0, appliedUnverifiedBatches: 0 },
        remaining: { criteria: 2, batches: 3 },
        needsInput: true,
        whyPaused: "workflow:uncertain",
      },
    }),
  };
}

const missingStatusResponder = (record: StubRequestRecord): StubResponse | undefined =>
  record.url.includes("/v1/workflow/status") ? { status: 404, text: '{"ok":false}' } : undefined;

test("workflow diagnostics shows durable facts without offering resume or retry", () => {
  const harness = createPanelHarness({ respond: workflowResponder });
  assert.equal(harness.requestsTo("/v1/workflow/status").length, 1, "startup reads the status projection");
  assert.equal(elementText(harness, "workflow-engine"), "workflow-v1");
  assert.match(elementText(harness, "workflow-status-summary"), /restart never dispatches or retries/);
  assert.equal(elementText(harness, "workflow-recovery"), "Needs input · workflow:uncertain");
  assert.equal(elementText(harness, "workflow-applied"), "0 of 1 batches settled · 0 verified · 0 applied, unverified");
  assert.equal(elementText(harness, "workflow-remaining"), "2 criteria · 3 batch slots");
  assert.equal(elementText(harness, "workflow-pause"), "workflow:uncertain");
  assert.equal(elementText(harness, "workflow-job"), "blocked · job-1");
  assert.match(elementText(harness, "workflow-batch"), /executing · execution JsonValue · verification JsonValue/);
  assert.equal(elementText(harness, "workflow-evidence"), "JsonValue verification · may_have_mutated mutation");
  assert.equal(elementText(harness, "workflow-blocker"), "workflow:uncertain");
  assert.equal(harness.el("workflow-lease"), null, "there is no host dispatch lease row any more");
  assert.equal(
    harness.body().all((node) => node.tagName === "BUTTON" && /resume|retry/i.test(node.textContent)).length,
    0,
    "status does not become a recovery command",
  );
});

test("Refresh workflow status reads the projection again and nothing else", () => {
  const harness = createPanelHarness({ respond: workflowResponder });
  const before = harness.requests.length;
  harness.click("workflow-refresh");
  assert.deepEqual(
    harness.requests.slice(before).map((record) => [record.method, record.url.replace("http://127.0.0.1:3210", "")]),
    [["GET", "/v1/workflow/status"]],
  );
});

test("a sidecar without workflow status reads as unavailable instead of implying durable recovery", () => {
  const harness = createPanelHarness({ respond: missingStatusResponder });
  assert.equal(elementText(harness, "workflow-engine"), "unavailable");
  assert.match(elementText(harness, "workflow-status-summary"), /does not report workflow status/);
  assert.match(elementText(harness, "workflow-recovery"), /no recovery action was attempted/);
});

test("a status with no projection is unavailable, not guessed at", () => {
  const harness = createPanelHarness({
    respond: (record) => (record.url.includes("/v1/workflow/status") ? { status: 200, text: JSON.stringify({ ok: true }) } : undefined),
  });
  assert.equal(elementText(harness, "workflow-engine"), "unavailable");
  assert.equal(elementText(harness, "workflow-status-summary"), "Workflow status returned no projection.");
  assert.equal(elementText(harness, "workflow-job"), "Unknown");
});
