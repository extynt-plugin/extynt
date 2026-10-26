/** Panel contract: a new chat starts empty, and a job belongs to the chat that asked for it. */
import assert from "node:assert/strict";
import test from "node:test";
import { bar, jobPayload, output, planRow } from "./contract-helpers.js";
import { MINUTE, stored, withSessions } from "./contract-sessions-fixtures.js";
import { createPanelHarness } from "./contract.test.js";
import { fieldOf } from "./json-narrow.js";

const folds = (harness: ReturnType<typeof createPanelHarness>) => output(harness).all((node) => node.classList.has("plan-fold")).length;

test("a job that shows up after New chat lands its plans in the chat that asked for it", () => {
  const old = { ...stored("s1", "Old chat", MINUTE), messages: [{ kind: "user", text: "make a title", at: Date.now(), requestId: "req-1" }] };
  const harness = withSessions([old], "s1");
  harness.sidecar.plans = [planRow("plan-9")];
  harness.click("chat-clear");
  harness.sse("activity", { jobs: [jobPayload({ jobId: "job-1", requestId: "req-1", via: "apply-resume", plans: ["plan-9"] })] });
  harness.sse("activity", { jobs: [] });
  assert.equal(folds(harness), 0, "the new chat shows no card of the old chat's job");
  const kept = harness.sidecar.sessions.get("s1")?.messages ?? [];
  assert.ok(kept.some((row) => fieldOf(row, "kind") === "plan"), "the old chat keeps its card");
  const others = [...harness.sidecar.sessions.values()].filter((session) => session.id !== "s1");
  assert.ok(others.every((session) => !session.messages.some((row) => fieldOf(row, "kind") === "plan")), "no copy is written into the new chat");
});

test("New chat clears the finished-job strip of the chat before", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [jobPayload({ plansApplied: 3 })] });
  harness.sse("activity", { jobs: [] });
  assert.equal(bar(harness).state, "finished");
  harness.click("chat-clear");
  assert.notEqual(bar(harness).state, "finished", "the strip belongs to the chat that ran the job");
});

test("a job that ends after New chat leaves no strip in the new chat", () => {
  const old = { ...stored("s1", "Old chat", MINUTE), messages: [{ kind: "user", text: "make a title", at: Date.now(), requestId: "req-1" }] };
  const harness = withSessions([old], "s1");
  harness.sse("activity", { jobs: [jobPayload({ requestId: "req-1", plansApplied: 3 })] });
  harness.click("chat-clear");
  harness.sse("activity", { jobs: [] });
  assert.notEqual(bar(harness).state, "finished");
});
