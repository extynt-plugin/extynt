/** Panel contract: the "Done N/M" strip counts the applied plans of the chat's last turn, and shows nothing for a turn that ran no plans. */
import assert from "node:assert/strict";
import test from "node:test";
import { bar, jobPayload } from "./contract-helpers.js";
import { MINUTE, itemFor, openChats, stored, withSessions } from "./contract-sessions-fixtures.js";
import { createPanelHarness } from "./contract.test.js";

type ItemStatus = "open" | "verified" | "unbuilt";

function checklist(statuses: ItemStatus[]) {
  return {
    items: statuses.map((status, index) => ({ id: "item-" + index, title: "Item " + index, phase: "Build", status, verifiedAt: status === "verified" ? new Date().toISOString() : null })),
    phases: [],
    current: null,
  };
}

test("a design turn that built nothing shows no strip, not Done 0/4", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [jobPayload({ plansApplied: 0, checklist: checklist(["open", "open", "open", "open"]) })] });
  harness.sse("activity", { jobs: [] });
  assert.notEqual(bar(harness).state, "finished", "no plan ran, so there is no summary");
  assert.equal(bar(harness).sub.includes("0/4"), false);
});

test("a five-plan build reads Done 5/5 even when its checklist has one item", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [jobPayload({ plansApplied: 5, checklist: checklist(["verified"]) })] });
  harness.sse("activity", { jobs: [] });
  assert.equal(bar(harness).state, "finished");
  assert.equal(bar(harness).sub, "5/5");
});

test("a chat with no plans does not show the Done strip of another chat", () => {
  const first = { ...stored("s1", "First chat", MINUTE), messages: [{ kind: "user", text: "animate the title", at: Date.now(), requestId: "req-b" }] };
  const harness = withSessions([first, stored("s2", "Second chat", MINUTE)], "s1");
  harness.sse("activity", { jobs: [jobPayload({ requestId: "req-b", plansApplied: 1, checklist: checklist(["verified"]) })] });
  harness.sse("activity", { jobs: [] });
  assert.equal(bar(harness).sub, "1/1", "the chat that ran the plan shows it");
  openChats(harness);
  itemFor(harness, "Second chat").click();
  assert.notEqual(bar(harness).state, "finished", "the other chat has no plans, so it shows no strip");
  assert.equal(bar(harness).sub.includes("1/1"), false);
});

test("returning to a chat shows its own Done strip after another chat's job ended", () => {
  const first = { ...stored("s1", "First chat", MINUTE), messages: [{ kind: "user", text: "animate the title", at: Date.now(), requestId: "req-b" }] };
  const second = { ...stored("s2", "Second chat", MINUTE), messages: [{ kind: "user", text: "fade the logo", at: Date.now(), requestId: "req-c" }] };
  const harness = withSessions([first, second], "s1");
  harness.sse("activity", { jobs: [jobPayload({ requestId: "req-b", plansApplied: 1, checklist: checklist(["verified"]) })] });
  harness.sse("activity", { jobs: [] });
  openChats(harness);
  itemFor(harness, "Second chat").click();
  harness.sse("activity", { jobs: [jobPayload({ requestId: "req-c", plansApplied: 2 })] });
  harness.sse("activity", { jobs: [] });
  assert.equal(bar(harness).sub, "2/2", "the second chat shows its own job");
  openChats(harness);
  itemFor(harness, "First chat").click();
  assert.equal(bar(harness).state, "finished");
  assert.equal(bar(harness).sub, "1/1", "the first chat keeps its strip after the other chat's job ended");
});

test("a failed or discarded plan counts in the total: 21 applied and 1 failed reads 21/22", () => {
  const harness = createPanelHarness();
  harness.sse("activity", { jobs: [jobPayload({ plansApplied: 21, plansNotApplied: 1 })] });
  harness.sse("activity", { jobs: [] });
  assert.equal(bar(harness).sub, "21/22");
});
