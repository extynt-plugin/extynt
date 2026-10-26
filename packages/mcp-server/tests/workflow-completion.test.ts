// Proves workflow completion is advertised with disjoint receipt and observation references, offered only inside the panel turn, narrowed exactly, and refused in standalone dispatch.
import assert from "node:assert/strict";
import test from "node:test";
import { agentToolDefinitions, callTool, handleMcpRequest, workflowCompletionEvidenceOf, workflowCompletionReferenceOf } from "../src/index.js";
import { arrayAt, objectAt, objectsIn, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { refusalOf } from "./support/json-results.js";
import { objectPath, propertyOf, schemaOf, toolNamed } from "./support/protocol-views.js";

function completionDefinition() {
  return toolNamed(agentToolDefinitions(), "ae_workflow_complete");
}

function offeredTools(): ReadonlyArray<JsonObject> {
  const response = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {});
  return objectsIn(arrayAt(objectAt(response, "result"), "tools"));
}

test("workflow completion advertises disjoint receipt and observation evidence references", () => {
  const definition = completionDefinition();
  assert.match(definition.description, /Call it with no arguments: the sidecar cites its own verified batch receipts and the observations/);
  assert.equal(definition.inputSchema.required, undefined, "evidence is optional: the sidecar holds the ids");
  const reference = objectPath(propertyOf(definition, "evidence"), ["items", "properties", "reference"]);
  const variants = objectsIn(arrayAt(reference, "oneOf"));
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map((variant) => arrayAt(objectPath(variant, ["properties", "kind"]), "enum")?.[0]), ["batch_receipt", "observation"]);
  assert.deepEqual(variants.map((variant) => arrayAt(variant, "required")), [["kind", "batchId", "receiptId"], ["kind", "evidenceId"]]);
  assert.equal(variants.every((variant) => variant.additionalProperties === false), true);
});

test("an external client is offered the plan contract, never the in-panel turn's queue or completion", () => {
  const tools = offeredTools();
  const names = tools.map((tool) => stringAt(tool, "name"));
  for (const name of ["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_workflow_complete"]) assert.equal(names.includes(name), false, `${name} only works inside the in-panel turn`);
  for (const name of ["ae_propose_plan", "ae_approve_plan", "ae_undo_plan"]) assert.ok(names.includes(name), `${name} is the external contract`);
  const serialized = JSON.stringify(schemaOf(completionDefinition()));
  assert.match(serialized, /batch_receipt/);
  assert.match(serialized, /observation/);
  assert.match(serialized, /evidenceId/);
  for (const tool of tools) assert.doesNotMatch(stringAt(tool, "description") ?? "", /ae_queue_(add|fix|finish)/, `${stringAt(tool, "name")} does not point an external client at a tool it is not offered`);
});

test("completion reference narrowing preserves both forms and rejects ambiguous hybrids", () => {
  assert.deepEqual(workflowCompletionReferenceOf({ kind: "batch_receipt", batchId: "batch-1", receiptId: "receipt-1" }), { kind: "batch_receipt", batchId: "batch-1", receiptId: "receipt-1" });
  assert.deepEqual(workflowCompletionReferenceOf({ kind: "observation", evidenceId: "visual-frame-1" }), { kind: "observation", evidenceId: "visual-frame-1" });
  assert.equal(workflowCompletionReferenceOf({ kind: "observation", evidenceId: "visual-frame-1", receiptId: "receipt-1" }), undefined);
  assert.equal(workflowCompletionReferenceOf({ kind: "batch_receipt", batchId: "batch-1" }), undefined);
  assert.equal(workflowCompletionReferenceOf({ kind: "observation", evidenceId: "bad id" }), undefined);
  assert.deepEqual(workflowCompletionEvidenceOf({ criterionId: "frame-accepted", reference: { kind: "observation", evidenceId: "visual-frame-1" } }), { criterionId: "frame-accepted", reference: { kind: "observation", evidenceId: "visual-frame-1" } });
});

test("standalone dispatch refuses to fake workflow completion", () => {
  const references: JsonObject[] = [
    { kind: "batch_receipt", batchId: "batch-1", receiptId: "receipt-1" },
    { kind: "observation", evidenceId: "visual-frame-1" },
  ];
  for (const reference of references) {
    const result = callTool("ae_workflow_complete", { goalDigest: "a".repeat(64), criterionIds: ["frame-accepted"], evidence: [{ criterionId: "frame-accepted", reference }] }, {});
    assert.equal(refusalOf(result).code, "WORKFLOW_COORDINATOR_REQUIRED");
  }
});
