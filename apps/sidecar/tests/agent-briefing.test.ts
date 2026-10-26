/** What the agent is told: the briefing halves, the project view, the plan and queue rules, and the worked examples the validator accepts. */
import { decodeOrThrow, object, string } from "@extynt/decode";
import { MockProvider } from "@extynt/llm";
import { PLAN_EXAMPLES } from "@extynt/mcp-server";
import { representativeSnapshot } from "@extynt/project-graph";
import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentBriefing, buildAgentBriefingSegments } from "../src/agent-briefing.js";
import { fieldOf, flagOf, parseJson, readJson } from "./http-json.js";
import { authorization, chatTurn, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

const exampleSummary = object({ summary: string() });
const baseComposition = representativeSnapshot.compositions.at(0);
const secondComposition = representativeSnapshot.compositions.at(1);
if (!baseComposition || !secondComposition) throw new Error("the representative snapshot has two compositions");

test("every worked example in the agent briefing is a plan the validator accepts", async (t) => {
  const provider = new MockProvider({ answer: "ok" });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());

  await fetch(`http://${address.host}:${address.port}/v1/host-census`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: "0.1",
      ok: true,
      requestId: "census-examples",
      warnings: [],
      result: {
        installedEffects: [{ matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", available: true }],
        totalReported: 1,
        returnedCount: 1,
        completeness: "complete",
        runtime: { application: "After Effects", appVersion: "26.2.1", buildNumber: "2", buildName: null, platform: "macOS", architecture: "arm64", compatible: true },
      },
    }),
  });
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-examples")) });
  await chatTurn(address, "hi");
  const [firstStep] = provider.stepInputs;
  assert.ok(firstStep, "the turn made a model call");
  const briefing = firstStep.system;

  let checked = 0;
  for (const [planType, example] of Object.entries(PLAN_EXAMPLES)) {
    const args = parseJson(JSON.stringify(example).replace(/"compositionId":"C"/g, '"compositionId":"comp-1"').replace(/"layerId":"L"/g, '"layerId":"layer-1"'));
    const result = await readJson((await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_propose_plan", arguments: args }) })));
    assert.equal(flagOf(result, "ok"), true, `${planType} (${decodeOrThrow(exampleSummary, example).summary}): ${JSON.stringify(fieldOf(result, "error"))}`);
    checked += 1;
  }
  assert.ok(checked >= 4, "the examples exist and were exercised");

  assert.match(briefing, /^markers: .*add_marker/m);
  assert.match(briefing, /ae_describe_native_operation gives the full schema and an example/);
  assert.match(briefing, /host capability data is authoritative/i);
  assert.doesNotMatch(briefing, /controls -0001 Blurriness/);
});

test("operation schemas are disclosed only for an explicit stage pack", () => {
  const compact = buildAgentBriefing(representativeSnapshot);
  const selected = buildAgentBriefing(representativeSnapshot, { relevantOperationTypes: ["add_marker"] });
  assert.match(compact, /^markers: .*add_marker/m);
  assert.doesNotMatch(compact, /^add_marker — required:/m);
  assert.match(selected, /^Relevant operation schemas for this stage:$/m);
  assert.match(selected, /^add_marker — required:/m);
});

test("a singular reference with several layers selected is a question, never a pick", () => {
  const rule = buildAgentBriefing(representativeSnapshot).split("\n").find((line) => line.startsWith("10. ")) ?? "";
  assert.match(rule, /singular reference[^.]*more than one layer is selected is ambiguous[^.]*ask which one/, "a singular reference with more than one layer selected must ask");
  assert.match(rule, /never pick one yourself \(not the topmost, not the first\)/);
  assert.match(rule, /unless the request names the layer or clearly means all of them/);
});

test("the briefing is split so its stable half can stay cached across turns", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);
  const segments = buildAgentBriefingSegments(representativeSnapshot);
  assert.equal(segments.length, 2);
  assert.equal(segments.map((segment) => segment.text).join(""), briefing, "splitting must not change a byte of the briefing");
  const [stable, live] = segments;
  assert.ok(stable && live, "both halves exist");
  assert.equal(stable.cache, true);
  assert.equal(live.cache, undefined);

  assert.ok(stable.text.length > live.text.length);
  assert.doesNotMatch(stable.text, /Project context/);
  assert.match(live.text, /Project context/);
});

test("a truncated project view is disclosed, and no count is invented for it", () => {

  const truncated: typeof representativeSnapshot = {
    ...representativeSnapshot,
    warnings: ["layer-count-limit:Main"],
    truncation: { truncated: true, limits: { maxLayersPerComposition: 256, maxCompositions: 32 } },
  };
  const briefing = buildAgentBriefing(truncated);
  assert.match(briefing, /projectViewTruncated/, "the data must carry the fact, not only the prose");
  assert.match(briefing, /layer-count-limit:Main/);
  assert.match(briefing, /The probe stopped at its 256 layer limit/);
  assert.match(briefing, /absence from this list is not proof a layer does not exist/);

  assert.match(briefing, /more layers than are listed or reachable/);

  assert.match(briefing, /do not treat the layer list as the whole composition/);

  const clean = buildAgentBriefing(representativeSnapshot);
  assert.doesNotMatch(clean, /projectViewTruncated/);
  assert.doesNotMatch(clean, /probe stopped/);
  assert.doesNotMatch(clean, /more composition\(s\) were not listed/);
});

const indexSnapshot: typeof representativeSnapshot = {
  ...representativeSnapshot,
  activeCompositionId: "comp-index",
  selection: { compositionId: "comp-index", layerIds: ["layer-a"] },
  sources: [{ id: "solid-src", name: "Solid", type: "solid", filePath: null, missing: false }],
  compositions: [{
    ...baseComposition,
    id: "comp-index",
    name: "Indexed",
    layers: [
      {
        id: "layer-a", index: 1, name: "Headline", type: "text", enabled: true, shy: false, solo: false, locked: false,
        startTime: 0, inPoint: 0, outPoint: 4, stretch: 100, parentId: "layer-d", matteLayerId: null, matteType: "none", isSelected: true, sourceId: null,
        properties: [
          { path: "ADBE Transform Group/ADBE Position", matchName: "ADBE Position", displayName: "Position", kind: "property", valueType: "vector", value: [960, 540], canSetValue: true, keyframes: [{ time: 0, value: [960, 540] }, { time: 1, value: [100, 100] }] },
          { path: "ADBE Effect Parade", matchName: "ADBE Effect Parade", displayName: "Effects", kind: "group", valueType: "unknown", value: null, canSetValue: false, children: [
            { path: "ADBE Effect Parade/ADBE Gaussian Blur 2", matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", kind: "group", valueType: "unknown", value: null, canSetValue: false, children: [
              { path: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001", matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", kind: "property", valueType: "number", value: 4, canSetValue: true, expression: "time * 4", expressionEnabled: true },
            ] },
            { path: "ADBE Effect Parade/ADBE Fill", matchName: "ADBE Fill", displayName: "Fill", kind: "group", valueType: "unknown", value: null, canSetValue: false },
          ] },
        ],
      },
      {
        id: "layer-b", index: 2, name: "Badge", type: "shape", enabled: true, shy: false, solo: false, locked: true,
        startTime: 0, inPoint: 0, outPoint: 4, stretch: 100, parentId: null, matteLayerId: null, matteType: "none", isSelected: false, sourceId: null,
        properties: [
          { path: "ADBE Effect Parade/ADBE Tint/ADBE Tint-0001", matchName: "ADBE Tint-0001", displayName: "Amount to Tint", kind: "property", valueType: "number", value: 50, canSetValue: true },
          { path: "ADBE Transform Group/ADBE Scale", matchName: "ADBE Scale", displayName: "Scale", kind: "property", valueType: "vector", value: [100, 100], canSetValue: true, keyframeCount: 3 },
        ],
      },
      {
        id: "layer-c", index: 3, name: "Backdrop", type: "av", enabled: false, shy: false, solo: false, locked: false,
        startTime: 0, inPoint: 0, outPoint: 4, stretch: 100, parentId: null, matteLayerId: null, matteType: "none", isSelected: false, sourceId: "solid-src", properties: [],
      },
      {
        id: "layer-d", index: 4, name: "Rig", type: "null", enabled: true, shy: false, solo: false, locked: false,
        startTime: 0, inPoint: 0, outPoint: 4, stretch: 100, parentId: null, matteLayerId: null, matteType: "none", isSelected: false, sourceId: null,
        properties: [{ path: "ADBE Transform Group/ADBE Opacity", matchName: "ADBE Opacity", displayName: "Opacity", kind: "property", valueType: "number", value: 100, canSetValue: true, expression: "wiggle(1, 10)", expressionEnabled: true }],
      },
    ],
  }],
};

test("the layer list is identity only and the index carries the aggregate facts", () => {
  const lines = buildAgentBriefing(indexSnapshot).split("\n");
  const header = lines.findIndex((line) => line.startsWith("Layers in "));
  const indexAt = lines.findIndex((line) => line.startsWith("Project index: "));
  assert.ok(header > 0 && indexAt > header, "the index follows the layer list");
  const layerLines = lines.slice(header + 1, indexAt);

  assert.deepEqual(layerLines, [
    "1 layer-a \"Headline\" text [selected]",
    "2 layer-b \"Badge\" shape",
    "3 layer-c \"Backdrop\" solid",
    "4 layer-d \"Rig\" null",
  ]);

  const listed = layerLines.join("\n");
  for (const absent of ["0-4s", "parent=", "locked", "hidden", "effects=", "position", "960", "keyframes", "expr=", "ADBE Gaussian Blur", "wiggle"]) assert.ok(!listed.includes(absent), `${absent} must not be on a layer line: ${listed}`);

  assert.equal(lines[indexAt], "Project index: 4 of 4 probed layers listed, 0 omitted; 1 text, 1 shape, 1 solid, 1 null; 1 selected, 1 locked, 1 hidden; effects on 2 layers (3 in total); keyframes on 2 properties, expressions on 2 properties.");
  assert.equal(lines[indexAt + 1], "View: complete. Every layer the probe returned for this composition is listed.");
  assert.match(lines[indexAt + 2] ?? "", /ae_inspect_layer/);
  assert.match(lines[indexAt + 2] ?? "", /ae_inspect_composition/);
});

test("the index states whether the view is complete and never invents a total for a partial one", () => {
  const complete = buildAgentBriefing(indexSnapshot);
  assert.match(complete, /View: complete\. Every layer the probe returned for this composition is listed\./);
  assert.doesNotMatch(complete, /View: partial/);

  const truncated: typeof representativeSnapshot = { ...indexSnapshot, warnings: ["layer-count-limit:Indexed"], truncation: { truncated: true, limits: { maxLayersPerComposition: 256, maxCompositions: 32 } } };
  const partial = buildAgentBriefing(truncated);
  assert.match(partial, /View: partial\./);
  assert.match(partial, /The probe stopped at its 256 layer limit for "Indexed"/);
  assert.match(partial, /limits: maxLayersPerComposition=256, maxCompositions=32/);
  assert.match(partial, /more layers than are listed or reachable/);
  assert.match(partial, /absence from this list is not proof a layer does not exist/);

  assert.doesNotMatch(partial, /View: complete/);

  const depthCapped: typeof representativeSnapshot = { ...indexSnapshot, truncation: { truncated: true, limits: { maxPropertyDepth: 4, maxPropertiesPerLayer: 200 } } };
  assert.match(buildAgentBriefing(depthCapped), /View: partial\./);
  assert.match(buildAgentBriefing(depthCapped), /The probe reported a truncated project view/);

  const empty: typeof representativeSnapshot = { ...indexSnapshot, activeCompositionId: null, compositions: [], truncation: { truncated: true, limits: { maxLayersPerComposition: 256 } } };
  assert.match(buildAgentBriefing(empty), /Project index: no active composition is open\./);
  assert.match(buildAgentBriefing(empty), /View: partial\./);
});

test("a layer list cut by the prompt budget says so and still counts every layer", () => {
  const lines = buildAgentBriefing(indexSnapshot, { briefingTokens: 1 }).split("\n");
  const header = lines.findIndex((line) => line.startsWith("Layers in "));

  assert.equal(lines[header + 1], "… 4 more layers; use ae_inspect_composition.");
  assert.equal(lines[header + 2], "Project index: 0 of 4 probed layers listed, 4 omitted; 1 text, 1 shape, 1 solid, 1 null; 1 selected, 1 locked, 1 hidden; effects on 2 layers (3 in total); keyframes on 2 properties, expressions on 2 properties.");
  assert.match(lines[header + 3] ?? "", /View: partial\. 4 layers are omitted from this list to stay inside the prompt budget/);
});

test("the briefing sets no plan-size limit and never asks for a request to be split", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);
  const rule = briefing.split("\n").find((line) => line.startsWith("2. ")) ?? "";

  assert.doesNotMatch(rule, /at most 25 operations/i);
  assert.doesNotMatch(rule, /several plans are better than one long one/i);
  assert.doesNotMatch(rule, /call ae_propose_plan again for each further part/i);
  assert.doesNotMatch(rule, /\b(?:at most|no more than|maximum of|limit of)\s+\d+\s+operations?/i);
  assert.doesNotMatch(briefing, /at most 25 operations/i);

  const whole = briefing.split("\n").find((line) => line.startsWith("4. ")) ?? "";
  assert.match(whole, /one coherent request may be several queues/i);
  assert.match(whole, /finish a queue when the operations in it are whole/i);
  assert.match(whole, /finish:true on the last ae_queue_add of a stage/i);
  assert.doesNotMatch(whole, /look at what it applied with ae_status/i);
  assert.match(whole, /open the next queue for the rest/i);
  assert.match(whole, /never save the whole job for one plan at the end/i);

  assert.match(whole, /genuinely separate stages/);
  assert.match(whole, /never by telling the user to split their request/i);
  assert.match(whole, /is the harness's business/i);

  assert.match(whole, /bounded undo groups, in order/i);
  assert.match(whole, /may honestly take several Undos/i);

  const carried = briefing.split("\n").find((line) => line.startsWith("5. ")) ?? "";
  assert.match(carried, /do not invent or carry plan, job, or batch ids/i);
  assert.match(carried, /sourcePlanId.*ae_recall_plan/i, "an exact repair uses the reducer-supplied source plan instead of model memory");

  const evidence = briefing.split("\n").find((line) => line.startsWith("11. ")) ?? "";
  assert.match(evidence, /planned \(the operations were accepted\)/i);
  assert.match(evidence, /applied \(the receipt says After Effects ran them\)/i);
  assert.match(evidence, /structurally verified \(a fresh inspection read the result back\)/i);
  assert.match(evidence, /how many undo groups it became/i);
  assert.match(evidence, /how many Undos take the work back/i);
  assert.match(evidence, /Never claim visual appearance, rendered motion, or perceptual quality/i);

  assert.match(briefing, /ae_queue_add \{operations/);
  assert.match(briefing, /ae_queue_fix \{edits/);
  assert.match(briefing, /ae_queue_finish \{\}/);
  assert.doesNotMatch(briefing, /ae_propose_plan/);
  assert.doesNotMatch(briefing, /ae_plan_create|ae_plan_add|ae_plan_complete/);
});

test("the briefing tells the model the layer list is identity only and where the detail lives", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);
  const rule = briefing.split("\n").find((line) => line.startsWith("14. ")) ?? "";
  assert.match(rule, /carries identity only/);
  assert.match(rule, /ae_inspect_layer/);
  assert.match(rule, /ae_inspect_composition/);
  assert.match(rule, /transform, effect, keyframe, expression, parent, lock, or timing/);
  assert.match(rule, /(?:not proof it does not exist|Never treat an omitted target or normalized default as observed absence)/, "the truncation honesty rule survives");

  assert.doesNotMatch(briefing, /expr= in the layer list/);
});

test("an unlisted composition remainder is stated rather than sliced away silently", () => {
  const many = {
    ...representativeSnapshot,
    compositions: [
      ...representativeSnapshot.compositions,
      ...Array.from({ length: 30 }, (_, index) => ({ ...secondComposition, id: `comp-extra-${index}`, name: `Extra ${index}` })),
    ],
  };
  const briefing = buildAgentBriefing(many);

  assert.match(briefing, /more composition\(s\) were not listed/);
});
