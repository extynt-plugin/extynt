/** While completion is withheld, sidecar text never invites the owner to complete; what it says to build next survives intact. */
import assert from "node:assert/strict";
import test from "node:test";
import { withoutCompletion } from "../src/server-workflow-checklist-tools.js";

test("every way the sidecar offers completion is taken out, and the building instruction around it reads whole", () => {
  const cases: Array<[string, string]> = [
    ["After Effects applied this batch. The sidecar captured a frame of the built scene and measured it (frame), so no capture of your own is needed. Check the measurement against the design: if it disagrees, queue only the correction; if it agrees, queue the next batch if the request is not fully built, or call ae_workflow_complete if it is (it takes any further frame it needs itself). Do not queue this batch again.",
      "After Effects applied this batch. The sidecar captured a frame of the built scene and measured it (frame), so no capture of your own is needed. Check the measurement against the design: if it disagrees, queue only the correction; if it agrees, queue the next batch if the request is not fully built. Do not queue this batch again."],
    ["The host read-back already proves what this batch did. Queue the next batch if the request is not fully built, or call ae_workflow_complete if it is.",
      "The host read-back already proves what this batch did. Queue the next batch if the request is not fully built."],
    ["[Sidecar wake event: Two parts are missing. Queue what is missing in one bounded batch with ae_queue_add, seal it with ae_queue_finish, then continue from its receipt (and call ae_workflow_complete once everything is built).]",
      "[Sidecar wake event: Two parts are missing. Queue what is missing in one bounded batch with ae_queue_add, seal it with ae_queue_finish, then continue from its receipt.]"],
    ["Your cycle ended in prose, so the job is still open. Build the next missing part, or call ae_workflow_complete if everything is built and verified.",
      "Your cycle ended in prose, so the job is still open. Build the next missing part."],
    ["Queue each item's batches with stage set to its id. Call ae_workflow_complete only when every item is done.", "Queue each item's batches with stage set to its id. "],
    ["Fix its cause and keep building, and call ae_workflow_complete once every part of the request is built and verified.\n\n", "Fix its cause and keep building.\n\n"],
  ];
  for (const [text, expected] of cases) assert.equal(withoutCompletion(text), expected);
});

test("strings deep in a tool result are filtered; other values and texts without the tool are untouched", () => {
  const result = { ok: true, data: { receipt: { frameCheck: "Queue the next batch if the request is not fully built, or call ae_workflow_complete if it is.", ids: ["layer-1"], count: 3 }, checklist: "4 of 49 items done" } };
  assert.deepEqual(withoutCompletion(result), { ok: true, data: { receipt: { frameCheck: "Queue the next batch if the request is not fully built.", ids: ["layer-1"], count: 3 }, checklist: "4 of 49 items done" } });
  assert.equal(withoutCompletion("ae_workflow_complete"), "ae_workflow_complete", "a bare tool name, as in a tool list, is not a clause");
});
