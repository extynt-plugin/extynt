// Unit tests for the workflow cycle contract.

import assert from "node:assert/strict";
import test from "node:test";
import { workflowCycleContract } from "../src/workflow-contract.js";
import { present } from "./agent-test-support.js";

test("workflowCycleContract returns undefined without workflowJobId", () => {
  const result = workflowCycleContract({ workflowCycle: 0 });
  assert.equal(result, undefined);
});

test("workflowCycleContract for cycle 0 includes required sections", () => {
  const result = present(workflowCycleContract({ workflowJobId: "job-1", workflowCycle: 0 }), "contract");
  assert.match(result, /1\. Ask first\./);
  assert.match(result, /2\. One loop\./);
  assert.match(result, /3\. Proportional checking\./);
  assert.match(result, /Never capture before you build to see the starting state/, "a look at the untouched comp is a wasted capture and observation");
  assert.match(result, /4\. Design only artwork\./);
  assert.match(result, /ae_consult_specialist/);
  assert.doesNotMatch(result, /ae_select_workflow_stage/);
  assert.match(result, /"maxOperationsPerBatch":25/);
});

test("workflowCycleContract for observation-only is read-only", () => {
  const result = present(workflowCycleContract({ workflowJobId: "job-1", workflowObservationOnly: true }), "contract");
  assert.match(result, /WORKFLOW OBSERVATION CONTRACT/);
  assert.match(result, /read-only/);
  assert.match(result, /ae_observe_frame/);
});
