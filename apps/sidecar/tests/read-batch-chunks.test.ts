/** The batches an apply or an undo sends: none over the plugin's cap, and every composition read once, in order, after the write. */
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BATCH_OPS } from "@extynt/host-native";
import type { BatchEntry, BatchResult, CallOutcome } from "@extynt/host-native";
import type { BatchLane } from "../src/host/call.js";
import { present } from "./present.js";
import { COMP_ID_PREFIX, detailsOp, detailsRequestFor, hostBatches, packBatches, readOpsFor, stampOp, STAMP_BEFORE_ID, STAMP_ID } from "../src/host/read-batch.js";

const TIMING = { queuedMs: 0, walkMs: 0, hashMs: 0, serializeMs: 0, totalMainThreadMs: 0, bytes: 0, getterCalls: 0, dispatchedBy: "idle" as const };
const compIds = (count: number): string[] => Array.from({ length: count }, (_, index) => String(1000 + index));

function fakePlugin(batches: BatchEntry[][]): BatchLane {
  const batch = async (ops: BatchEntry[]): Promise<CallOutcome<BatchResult>> => {
    batches.push([...ops]);
    const results = ops.map((op) => ({ op: op.op, id: op.id, ok: true, result: null, mainThreadMs: 0, getterCalls: 0 }));
    return { kind: "ok", rttMs: 0, timing: TIMING, result: { source: "native", results, ran: ops.length, failed: 0, requested: ops.length, totalMainThreadMs: 0 } };
  };
  return { client: { batch } };
}

test("an apply's batches stay under the plugin cap, and every composition is read once, in order, after the write", async () => {
  const ids = compIds(100);
  const batches: BatchEntry[][] = [];
  const write: BatchEntry = { op: "host_call", id: "apply", entry: "aeApplyPlan", args: "{}" };
  const reads = readOpsFor({ scope: "compositions", compositionIds: ids, includeItems: false });
  const outcome = await hostBatches(fakePlugin(batches), packBatches([stampOp(STAMP_BEFORE_ID), write, stampOp(STAMP_ID)], reads));
  assert.equal(outcome.kind, "ok");
  assert.ok(batches.length > 1, "100 compositions cannot fit in one batch");
  for (const ops of batches) assert.ok(ops.length <= MAX_BATCH_OPS, `a batch of ${ops.length} ops`);
  assert.deepEqual(batches[0]?.slice(0, 3).map((op) => op.id), [STAMP_BEFORE_ID, "apply", STAMP_ID]);
  assert.deepEqual(batches.flat().filter((op) => op.op === "read_comp").map((op) => op.id), ids.map((id) => `${COMP_ID_PREFIX}${id}`));
  if (outcome.kind === "ok") assert.equal(outcome.result.results.length, batches.flat().length, "every op is answered in the merged result");
});

test("a precheck with the details call last keeps the cap and puts the details after the reads", async () => {
  const batches: BatchEntry[][] = [];
  const details = detailsOp(present(detailsRequestFor([{ compId: "1000", layerId: "5" }])));
  const reads = readOpsFor({ scope: "compositions", compositionIds: compIds(130), includeItems: true });
  await hostBatches(fakePlugin(batches), packBatches([stampOp()], reads, [details]));
  for (const ops of batches) assert.ok(ops.length <= MAX_BATCH_OPS, `a batch of ${ops.length} ops`);
  assert.equal(batches.flat().at(-1)?.id, "details");
  assert.equal(batches.flat().filter((op) => op.op === "read_comp").length, 130);
});
