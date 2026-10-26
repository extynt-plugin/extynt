/** A scoped read (graph page, collection) folds facts in but never displaces the whole-project read plan validation resolves against. */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { callTool } from "@extynt/mcp-server";
import { storeSnapshot, type HttpRoutesDeps } from "../src/server-http-state.js";
import { runScopedAware } from "../src/scoped-aware-tool.js";
import type { ProbeSnapshot } from "../src/server-types.js";
import { decodeOrThrow } from "@extynt/decode";
import { rowList } from "../src/verify/json-fields.js";
import { present } from "./present.js";
import { validSnapshot } from "./sidecar-fixture.js";
import { startUiSidecar } from "./ui-fixture.js";

type Row = JsonObject;
type Over = Readonly<Record<string, JsonObject[string] | undefined>>;
const layer = (id: string, index: number, name: string, type = "text"): Row => ({ id, index, name, type, selected: false, propertyPaths: [] });
const composition = (layers: Row[]): Row => ({ id: "1", name: "Ident", width: 1920, height: 1080, duration: 10, frameRate: 30, layers });
function snapshotOf(requestId: string, over: Over): ProbeSnapshot {
  const result = { ...validSnapshot.result, project: { name: "Fixture", filePath: "/p/fixture.aep" }, hostStamp: { epoch: 1, revision: 435 }, activeCompositionId: "1", ...over };
  return { ...validSnapshot, requestId, result };
}
const full = snapshotOf("full", { compositions: [composition([layer("20", 1, "SIGNAL Word"), layer("17", 2, "Rings", "shape")])] });
const graphPage = (requestId: string): ProbeSnapshot => snapshotOf(requestId, { coverage: { kind: "composition-metadata", compositionId: "1", properties: "unknown", otherCompositions: "unknown", otherLayers: "unknown", observedLayerIds: ["17"] }, compositions: [composition([layer("17", 2, "Rings", "unknown")])] });
const args = { summary: "Rename the word", operations: [{ type: "set_layer_name", target: { compositionId: "1", layerId: "20" }, name: "Renamed" }] };
const compositionsOf = (snapshot: ProbeSnapshot): readonly Row[] => decodeOrThrow(rowList, snapshot.result.compositions);
const layersOf = (entry: Row): readonly Row[] => decodeOrThrow(rowList, entry.layers);
const ids = (snapshot: ProbeSnapshot): string[] => compositionsOf(snapshot).flatMap((entry) => layersOf(entry).map((layerRow) => String(layerRow.id)));

test("a plan on a layer outside two successive graph pages still validates against the whole project", async (t) => {
  const { sidecar } = await startUiSidecar(t);
  const deps: HttpRoutesDeps = { state: sidecar, dispatch: sidecar };
  const now = new Date().toISOString();
  storeSnapshot(deps, full, 1, now);
  storeSnapshot(deps, graphPage("page-1"), 1, now);
  storeSnapshot(deps, graphPage("page-2"), 1, now);
  assert.deepEqual(ids(present(sidecar.latest).snapshot), ["17"], "the page is the current observation");
  assert.equal(present(sidecar.latest).fullBase?.snapshot.requestId, "full", "the whole read rides beside it, however many pages arrive");
  const result = runScopedAware("ae_propose_plan", sidecar.normalizedLatest(), { whole: () => sidecar.normalizedWhole(), demote: () => { sidecar.demoteScoped(); }, call: (snapshot) => callTool("ae_propose_plan", args, snapshot === undefined ? {} : { snapshot }) });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(present(sidecar.latest).snapshot.requestId, "full", "the whole read is current again for apply and approval");
});

test("a graph page still updates the facts it covered", async (t) => {
  const { sidecar } = await startUiSidecar(t);
  const deps: HttpRoutesDeps = { state: sidecar, dispatch: sidecar };
  storeSnapshot(deps, full, 1, new Date().toISOString());
  storeSnapshot(deps, graphPage("page-1"), 1, new Date().toISOString());
  const covered = layersOf(present(compositionsOf(present(sidecar.latest).snapshot)[0]));
  assert.equal(present(covered[0]).type, "unknown");
  assert.equal(sidecar.normalizedLatest()?.coverage?.compositionId, "1");
  storeSnapshot(deps, snapshotOf("full-2", { compositions: [composition([layer("20", 1, "SIGNAL Word")])] }), 1, new Date().toISOString());
  assert.equal(present(sidecar.latest).fullBase, undefined, "a newer whole read replaces the base");
});
