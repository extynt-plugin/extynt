/** Placeholder names a workflow job built are swapped for their real ids in later queue calls and reads; names it never built are refused. */
import test from "node:test";
import assert from "node:assert/strict";
import type { StoredPlan } from "@extynt/mcp-server";
import type { WorkflowBatch } from "@extynt/workflow";
import { resolveJobPlaceholders, type PlaceholderDeps } from "../src/server-workflow-job-placeholders.js";
import { batchFixture, storedPlanFixture } from "./sidecar-fixture.js";
import { createdMapOf } from "../src/server-workflow-seal-receipt.js";
import type { ToolArguments } from "../src/agent-types.js";
import { argumentJson, objectsOf, targetLayerId } from "../src/server-workflow-operation-json.js";
import { drainSeedActions } from "../src/server-workflow-sidecar-actions.js";

const JOB = "job-1";
type Input = Parameters<typeof resolveJobPlaceholders>[1]["input"];
type Call = Parameters<typeof resolveJobPlaceholders>[1];
const plan = (planId: string, layer: string, bindings: Record<string, string> = {}): [string, StoredPlan] => [planId, storedPlanFixture(planId, "applied", { placeholderBindings: bindings }, [{ type: "create_layer", layerType: "null", name: layer, target: { compositionId: "comp-1", layerId: layer, snapshotFingerprint: "snap-1", selectionFingerprint: "sel-1" } }])];
const settled = (id?: string, canonical = "__new__:layer0"): WorkflowBatch => batchFixture("settled", id ? [{ placeholder: canonical, createdId: id }] : [], JOB);
const waiting = (): WorkflowBatch => batchFixture("queued");

function deps(plans: Array<[string, StoredPlan]>, batches: Record<string, WorkflowBatch>): PlaceholderDeps {
  return { state: { plans: new Map(plans), options: { workflowFreeRun: true }, workflowSidecarActions: new Map(), workflowCoordinator: { workflowStore: { getState: () => ({ jobs: {} }) }, jobIdForSeed: () => JOB, jobIdForPlan: () => JOB, batchForPlan: (planId: string) => batches[planId] ?? null } } };
}
const input: Input = { workflowJobId: "seed" };
const run = (d: PlaceholderDeps, name: string, args: ToolArguments, who: Input = input) => resolveJobPlaceholders(d, { name, args, input: who } satisfies Call);
const refusal = (result: ReturnType<typeof run>): { code: string; message: string } => {
  assert.ok(result && !result.ok, "the read is refused");
  return result.error;
};
const layerIds = (args: ToolArguments): Array<string | undefined> => objectsOf(argumentJson(args, "operations")).map(targetLayerId);

test("a read of a placeholder the job built is resolved to the real id", () => {
  const d = deps([plan("p1", "__new__:layer0", { "__new__:title": "__new__:layer0" })], { p1: settled("layer-7") });
  const args: ToolArguments = { layerId: "__new__:title" };
  assert.equal(run(d, "ae_inspect_layer", args), undefined);
  assert.equal(args.layerId, "layer-7");
});

test("a read of a placeholder that is queued, failed or unknown is refused with its state", () => {
  const d = deps([plan("p1", "__new__:layer0", { "__new__:title": "__new__:layer0" }), plan("p2", "__new__:layer1", { "__new__:bg": "__new__:layer1" })], { p1: settled(undefined), p2: waiting() });
  const say = (layerId: string) => refusal(run(d, "ae_inspect_layer", { layerId }));
  assert.equal(say("__new__:title").code, "PLACEHOLDER_NOT_BUILT");
  assert.match(say("__new__:title").message, /did not apply/);
  assert.match(say("__new__:bg").message, /not been applied yet/);
  assert.match(say("__new__:ghost").message, /no batch in this job declares it/);
});

test("a later plan gets built names rewritten, keeps names it declares or that wait in the open batch, and latest applied wins", () => {
  const d = deps([plan("p1", "__new__:a", {}), plan("p2", "__new__:a", {}), plan("p3", "__new__:open", {})], { p1: settled("layer-1", "__new__:a"), p2: settled("layer-2", "__new__:a"), p3: waiting() });
  const args: ToolArguments = { operations: [{ type: "set_layer_name", target: { layerId: "__new__:a" }, name: "x" }, { type: "set_layer_name", target: { layerId: "__new__:open" } }] };
  assert.equal(run(d, "ae_queue_add", args), undefined);
  assert.deepEqual(layerIds(args), ["layer-2", "__new__:open"]);
  assert.match(drainSeedActions(d.state, "seed").join("\n"), /created more than once.*layer-2/);
  const own: ToolArguments = { operations: [{ type: "create_layer", target: { layerId: "__new__:a" } }] };
  run(d, "ae_queue_add", own);
  assert.equal(layerIds(own)[0], "__new__:a", "a plan that declares the name again keeps it");
});

test("outside a workflow job nothing is touched", () => {
  const args = { layerId: "__new__:title" };
  assert.equal(run(deps([], {}), "ae_inspect_layer", args, {}), undefined);
  assert.equal(args.layerId, "__new__:title");
});

test("the receipt's created map keys real ids by the name the model wrote", () => {
  const record = plan("p1", "__new__:layer0", { "__new__:title": "__new__:layer0" })[1];
  const batch = batchFixture("settled", [{ placeholder: "__new__:layer0", createdId: "layer-7" }, { placeholder: "__new__:comp1", createdId: "comp-3" }]);
  assert.deepEqual(createdMapOf(batch, record), { "__new__:comp1": "comp-3", "__new__:title": "layer-7" });
});
