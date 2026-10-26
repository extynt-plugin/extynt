/** New chat: the project context a turn carries never includes another chat's built work. */
import assert from "node:assert/strict";
import test from "node:test";
import { enterChatSession, foreignJobs } from "../src/chat-session-fence.js";
import { carriedContextSummary } from "../src/context-carry.js";

type Input = Parameters<typeof carriedContextSummary<{ type: string; name?: string }>>[0];

const OPERATIONS = { "op-solid": { payload: { type: "create_layer", name: "Red Solid" } } };
const snapshot: NonNullable<Input["snapshot"]> = { activeCompositionId: "comp-9", compositions: [{ id: "comp-9", name: "Smoke", width: 1920, height: 1080, duration: 10, frameRate: 30, layers: [{ id: "layer-62", name: "Red Solid" }] }] };

function ledger(jobIds: string[]): Input["state"] {
  const batch = { lifecycle: "settled" as const, summary: "Title", recovery: { state: "none" as const }, verification: { state: "verified" as const }, execution: { state: "executed" as const, receipt: { outcomes: [], createdBindings: [{ placeholder: "__new__:s", createdId: "layer-62", operationId: "op-solid" }] } } };
  const jobs = Object.fromEntries(jobIds.map((jobId, index) => [jobId, { jobId, createdAt: `2026-10-12T10:00:0${index}Z`, batchIds: [`b-${jobId}`] }]));
  return { jobs, batches: Object.fromEntries(jobIds.map((jobId) => [`b-${jobId}`, batch])), operations: OPERATIONS };
}

function store() {
  let current = ledger([]);
  return {
    getState: () => current,
    enter(jobIds: string[], sessionId: string | undefined): void {
      current = ledger(jobIds);
      enterChatSession(this, sessionId);
    },
  };
}

test("a new chat does not carry the earlier chat's layers", () => {
  const key = store();
  key.enter([], "chat-a");
  const state = ledger(["job-1"]);
  assert.match(carriedContextSummary({ state, snapshot, hiddenJobs: foreignJobs(key) }) ?? "", /layer-62/, "the chat that built it still sees it");
  key.enter(["job-1"], "chat-b");
  assert.equal(carriedContextSummary({ state, snapshot, hiddenJobs: foreignJobs(key) }), undefined, "the new chat starts without it");
});

test("a job the new chat builds is carried, and going back restores the first chat", () => {
  const key = store();
  key.enter([], "chat-a");
  key.enter(["job-1"], "chat-b");
  assert.deepEqual([...foreignJobs(key)], ["job-1"]);
  key.enter(["job-1", "job-2"], "chat-a");
  assert.deepEqual([...foreignJobs(key)], ["job-2"]);
  key.enter(["job-1", "job-2"], "chat-b");
  assert.deepEqual([...foreignJobs(key)], ["job-1"]);
});

test("a turn without a session id changes nothing", () => {
  const key = store();
  key.enter(["job-1"], undefined);
  assert.equal(foreignJobs(key).size, 0);
});
