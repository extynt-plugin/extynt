// What an external caller owns: the layers its applied agent plans created within the same job, and nothing a panel, an undone plan or another job placed.
import test from "node:test";
import assert from "node:assert/strict";
import type { StoredPlan } from "@extynt/mcp-server";
import { callerCreatedIds } from "../src/host/job-created-ids.js";
import { storedPlanFixture } from "./sidecar-fixture.js";

const created = new Map<string, string>();

function applied(planId: string, createdId: string, status: StoredPlan["status"]): [string, StoredPlan] {
  created.set(planId, createdId);
  return [planId, storedPlanFixture(planId, status, { jobId: planId === "p4" ? "job-other" : "job-1" })];
}

test("an external caller owns the layers its applied agent plans created; the panel and undone plans do not add any", () => {
  const plans = new Map([applied("p1", "layer-9", "applied"), applied("p2", "layer-10", "undone"), applied("p3", "layer-11", "applied"), applied("p4", "layer-12", "applied")]);
  const held = { plans, batchForPlan: (planId: string) => ({ execution: { receipt: { createdBindings: [{ createdId: created.get(planId) ?? "" }] } } }) };
  const sources = new Map([["p1", "agent"], ["p2", "agent"], ["p3", "panel"], ["p4", "agent"]]);
  const own = new Set(["job-layer"]);
  assert.deepEqual([...callerCreatedIds({ own, caller: "external", held, sources, jobId: "job-1" })].sort(), ["job-layer", "layer-9"], "only applied agent plans of the same job count; another job's layer-12 is not owned");
  assert.deepEqual([...callerCreatedIds({ own, caller: "external", held, sources, jobId: "job-other" })].sort(), ["job-layer", "layer-12"], "a new job never owns a previous job's layers");
  assert.deepEqual([...callerCreatedIds({ own, caller: "external", held, sources, jobId: undefined })], ["job-layer"]);
  assert.deepEqual([...callerCreatedIds({ own, caller: "panel", held, sources, jobId: "job-1" })], ["job-layer"]);
});
