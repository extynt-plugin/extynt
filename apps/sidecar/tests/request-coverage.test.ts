// Request coverage: the features a prompt names, and completion refused while the project does not show them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSnapshot } from "@extynt/project-graph";
import { coverageRefusal, missingFeatures, requestedFeatures, requestedNames, requestedOperationTypes, takePendingCoverage } from "../src/request-coverage.js";
import { effect, layer, namedSnapshot, property, snapshotOf, step } from "./coverage-fixtures.js";

const promptOf = (id: string): string => readFileSync(new URL(`../../../../tools/chat-tests/prompts/${id}.md`, import.meta.url), "utf8").replace(/^---[\s\S]*?---/, "");
const S4 = promptOf("title-ident-from-scratch");
const ESSENTIAL = step("add_essential_property");
const TEXT_OFFSET = "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Selectors/ADBE Text Selector/ADBE Text Range Offset/ADBE Text Percent Offset";
const idsOf = (goal: string) => requestedFeatures(goal).map((feature) => feature.id);

const s4Partial = () => snapshotOf([
  layer("camera", { type: "camera" }),
  layer("null", { type: "null", properties: [property("ADBE Transform Group/ADBE Orientation")] }),
  layer("rings", { type: "shape", properties: [property("ADBE Root Vectors Group/ADBE Vector Filter - Repeater/ADBE Vector Repeater Copies", { value: 12 })] }),
  layer("title", { type: "text", parentId: "null", properties: [effect("ADBE Glo2"), effect("ADBE Drop Shadow"), property("ADBE Marker", { keyframeCount: 5 })] }),
  layer("shine", { type: "shape" }),
  layer("backdrop", { properties: [effect("ADBE Ramp")] }),
]);

const s4Complete = () => snapshotOf([
  ...s4Partial().compositions.flatMap((composition) => composition.layers).filter((row) => row.id !== "shine" && row.id !== "title"),
  layer("title", { type: "text", parentId: "null", matteLayerId: "shine", matteType: "alpha", properties: [effect("ADBE Glo2"), property("ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0003", { expression: "wiggle(8, 20)", expressionEnabled: true }), effect("ADBE Drop Shadow"), property(TEXT_OFFSET, { keyframeCount: 2 })] }),
  layer("shine", { type: "shape", properties: [effect("ADBE Gaussian Blur 2")] }),
], 6);

test("the S4 prompt names all fifteen checklist features, the matte tied to the word, including a phrase wrapped across lines", () => {
  assert.deepEqual(idsOf(S4), ["text-animator", "selector-offset", "matte", "text-matte", "blur", "glow", "drop-shadow", "ramp", "wiggle", "repeater", "camera", "camera-move", "null", "parent", "markers", "three-d", "essential-graphics"]);
});

test("the S4 project that closed early is missing exactly what the run dropped", () => {
  const missing = missingFeatures(S4, s4Partial(), [ESSENTIAL]);
  assert.equal(missing.length, 7, JSON.stringify(missing));
  for (const pattern of [/text animator/, /Percent Offset/, /track matte \(/, /involves the text layer/, /blur/, /wiggle/, /camera move/]) assert.ok(missing.some((label) => pattern.test(label)), `${pattern} is missing: ${JSON.stringify(missing)}`);
});

test("each missing feature is satisfied by what the snapshot reads, or by the applied operation the snapshot cannot read", () => {
  assert.equal(missingFeatures(S4, s4Complete(), []).length, 2, "Essential Graphics is never read back, and the camera is not moved");
  assert.deepEqual(missingFeatures(S4, s4Complete(), [ESSENTIAL, step("dolly_camera", { type: "dolly_camera" })]), []);
});

const UNASKED_GOALS = ["Fade the title in. No glow, without a camera, and don't add markers.", "Ramp up the speed of the push.", "Add motion blur to the title."];

test("a negated mention is not a request, and a prompt with no named feature is never refused", () => {
  for (const goal of UNASKED_GOALS) assert.deepEqual(idsOf(goal), [], goal);
  assert.deepEqual(missingFeatures("Make a 6-second animation of a rocket flying over a planet.", snapshotOf([]), []), []);
});

test("a snapshot that did not read properties is not judged", () => {
  const metadataOnly = createSnapshot({ ...s4Partial(), coverage: { kind: "composition-metadata", compositionId: "comp-main", properties: "unknown", otherCompositions: "unknown" } });
  assert.deepEqual(missingFeatures(S4, metadataOnly, []), []);
});

test("completion is refused at most twice per job, and the missing list is handed to one continuation", () => {
  const job = `job-coverage-${Date.now()}`;
  const first = coverageRefusal(job, S4, s4Partial(), []);
  assert.ok(first && first.length > 0);
  assert.deepEqual(takePendingCoverage(job), first);
  assert.equal(takePendingCoverage(job), undefined, "handed over once");
  assert.ok(coverageRefusal(job, S4, s4Partial(), []));
  assert.equal(coverageRefusal(job, S4, s4Partial(), []), null, "a misread request cannot hold the job open");
});

test("a refusal that led to progress does not spend the cap: automatic checks between turns cannot use it up", () => {
  const job = `job-coverage-progress-${Date.now()}`;
  assert.ok(coverageRefusal(job, S4, s4Partial(), []));
  assert.ok(coverageRefusal(job, S4, s4Partial(), []));
  assert.equal(coverageRefusal(job, S4, s4Partial(), []), null);
  const progressed = coverageRefusal(job, S4, s4Partial(), [ESSENTIAL]);
  assert.ok(progressed && !progressed.some((label) => /Essential/.test(label)), "one feature fewer is missing, so the rest are asked for again");
});

test("a repeater or trim paths is proven by the item an operation added, not by a name that mentions it", () => {
  const rings = snapshotOf([layer("rings", { type: "shape", name: "Ellipse + Repeater" })]);
  const named = [step("add_shape_item", { type: "add_shape_item", groupId: "root", item: "ellipse", name: "Ring Ellipse + Repeater" })];
  assert.ok(missingFeatures("Rings with a repeater.", rings, named).some((label) => /Repeater/.test(label)));
  assert.deepEqual(missingFeatures("Rings with a repeater.", rings, [step("add_shape_item", { type: "add_shape_item", groupId: "root", item: "repeater" })]), []);
});

test("a matte over the word needs the text layer in the matte pair; any matte does not satisfy it", () => {
  const goal = "A thin white shape used as an alpha track matte over the word.";
  const elsewhere = snapshotOf([layer("title", { type: "text" }), layer("bar", { type: "shape" }), layer("glint", { matteLayerId: "bar", matteType: "alpha" })]);
  assert.ok(missingFeatures(goal, elsewhere, []).some((label) => /text layer/.test(label)), JSON.stringify(missingFeatures(goal, elsewhere, [])));
  const onText = snapshotOf([layer("title", { type: "text" }), layer("glint", { type: "shape", matteLayerId: "title", matteType: "alpha" })]);
  assert.deepEqual(missingFeatures(goal, onText, []), []);
  assert.deepEqual(idsOf("Matte the glint layer to the bar."), ["matte"], "a matte not tied to the text asks only for a matte");
});

test("a matte set by an executed operation counts when it names a text layer", () => {
  const goal = "A thin white shape used as an alpha track matte over the word.";
  const bare = snapshotOf([layer("title", { type: "text" }), layer("glint", { type: "shape" })]);
  assert.deepEqual(missingFeatures(goal, bare, [step("set_track_matte", { target: { layerId: "glint" }, matteLayerId: "title" })]), []);
  assert.ok(missingFeatures(goal, bare, [step("set_track_matte", { target: { layerId: "glint" }, matteLayerId: "bar" })]).length > 0);
});

test("the request's operations are disclosed to the briefing", () => {
  const types = requestedOperationTypes(S4);
  for (const type of ["add_text_animator", "set_track_matte", "set_expression", "add_essential_property", "set_layer_parent", "add_marker"]) assert.ok(types.includes(type), type);
  assert.deepEqual(requestedOperationTypes("Make the title bigger."), []);
});

const CAMERA_MOVE_ASKED = ["Add a camera with a slow push-in.", "Dolly the camera forward.", "A camera pull-out at the end.", "Pull the camera out over 5 seconds, pulling out slowly", "Give it a camera move.", "camera zoom-in on the logo", "Push in with the camera"];
const CAMERA_MOVE_NOT_ASKED = ["No push-in please.", "Fade in the title without a camera move.", "Add a pull-out quote under the headline.", "Push in the title text from the left.", "Don't dolly anything."];

test("camera-move is requested by push-in, dolly and camera-move wording, but not by negation or a pull-out quote", () => {
  const cameraMove = (goal: string) => idsOf(goal).filter((id) => id === "camera-move");
  for (const goal of CAMERA_MOVE_ASKED) assert.deepEqual(cameraMove(goal), ["camera-move"], goal);
  for (const goal of CAMERA_MOVE_NOT_ASKED) assert.deepEqual(cameraMove(goal), [], goal);
  assert.deepEqual(requestedOperationTypes("A slow push-in on the camera").filter((type) => type === "dolly_camera"), ["dolly_camera"]);
});

const POSITION = "ADBE Transform Group/ADBE Position";
const CAMERA_GOAL = "Add a camera with a slow push-in.";
const cameraMoveMissing = (snapshot: ReturnType<typeof snapshotOf>, applied: ReturnType<typeof step>[] = []) => missingFeatures(CAMERA_GOAL, snapshot, applied).filter((entry) => /camera move/.test(entry));
const onLayer = (type: "camera" | "text", path: string, extra: Parameters<typeof property>[1] = {}) => snapshotOf([layer(type === "camera" ? "cam" : "title", { type, properties: [property(path, extra)] })]);

test("camera-move is shown by a keyed camera Position or Zoom, or by a dolly_camera or camera animate_property that was applied", () => {
  const idle = onLayer("camera", POSITION);
  assert.match(cameraMoveMissing(idle)[0] ?? "", /dolly_camera/);
  assert.equal(cameraMoveMissing(idle).length, 1);
  assert.deepEqual(cameraMoveMissing(onLayer("camera", POSITION, { keyframeCount: 2 })), []);
  assert.deepEqual(cameraMoveMissing(onLayer("camera", "ADBE Camera Options Group/ADBE Camera Zoom", { keyframeCount: 2 })), []);
  assert.equal(cameraMoveMissing(onLayer("text", POSITION, { keyframeCount: 2 })).length, 1, "a keyed text layer is not a camera move");
});

test("a camera move that was applied counts only when it moves a camera", () => {
  const idle = onLayer("camera", POSITION);
  const animate = (layerId: string) => step("animate_property", { target: { layerId, propertyPath: POSITION } });
  assert.deepEqual(cameraMoveMissing(idle, [step("dolly_camera", { type: "dolly_camera" })]), []);
  assert.deepEqual(cameraMoveMissing(idle, [animate("cam")]), []);
  assert.equal(cameraMoveMissing(idle, [animate("title")]).length, 1);
});

const hiddenSignal = (enabled: boolean) => [layer("shine", { type: "shape", matteLayerId: "signal", matteType: "alpha" }), layer("signal", { type: "text", enabled, properties: [effect("ADBE Glo2")] })];

test("evidence found only on a hidden layer does not count, and the refusal names the layer and why it is hidden", () => {
  const goal = "Title word with a glow and a shine matted over the word.";
  assert.deepEqual(missingFeatures(goal, snapshotOf(hiddenSignal(true)), []), []);
  const missing = missingFeatures(goal, snapshotOf(hiddenSignal(false)), [step("ensure_effect", { effectPath: "ADBE Effect Parade/ADBE Glo2" })]);
  assert.equal(missing.length, 1, JSON.stringify(missing));
  assert.match(missing[0] ?? "", /Glow/);
  assert.match(missing[0] ?? "", /layer "signal", which is hidden/);
  assert.match(missing[0] ?? "", /used as a matte, so set showMatteLayer: true on the set_track_matte for "shine"/);
});

test("a hidden layer that is not a matte source is named without the matte fix", () => {
  const missing = missingFeatures("Add a glow to the title.", snapshotOf([layer("title", { type: "text", enabled: false, properties: [effect("ADBE Glo2")] })]), []);
  assert.equal(missing.length, 1);
  assert.match(missing[0] ?? "", /layer "title", which is hidden \(video off\)\)?$/);
  assert.doesNotMatch(missing[0] ?? "", /showMatteLayer/);
});

test("named layers and compositions in the request must exist before the job is covered", () => {
  const goal = "Build EXTYNT_LAUNCH_30 with a BEAT_GRID, a PLAN_CARD and its PLAN_CARD_SHADOW. Do not add a DEBUG_GUIDE. Use ADBE_Glo2 nowhere.";
  const built = (name: string) => `a layer or composition named "${name}", built as the request describes it`;
  assert.deepEqual(requestedNames(goal), ["EXTYNT_LAUNCH_30", "BEAT_GRID", "PLAN_CARD", "PLAN_CARD_SHADOW"], "a negated name and a native match name are not asked for");
  const partial = namedSnapshot("EXTYNT_LAUNCH_30", ["BEAT_GRID"]);
  assert.deepEqual(missingFeatures(goal, partial, []), [built("PLAN_CARD"), built("PLAN_CARD_SHADOW")]);
  assert.deepEqual(missingFeatures(goal, partial, [step("create_layer", { name: "PLAN_CARD" })]), [built("PLAN_CARD_SHADOW")], "an applied creation with the name counts before the snapshot catches up");
  assert.deepEqual(missingFeatures(goal, namedSnapshot("EXTYNT_LAUNCH_30", ["BEAT_GRID", "PLAN_CARD", "PLAN_CARD_SHADOW"]), []), []);
});
