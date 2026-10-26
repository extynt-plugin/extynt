// Tests that SVG filters, clips and blend modes on a scene group become catalogue effect controls, add masks and layer attributes, that unsupported or inner uses warn, and that the resulting plans are accepted.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot } from "@extynt/project-graph";
import { applyEffectControlEvidence, makeHostProfile, makeInventory } from "@extynt/capability-catalogue";
import { loadFixtureEffectEvidence } from "@extynt/capability-catalogue/test-evidence";
import { callTool, designPlaceholder, sceneManifest } from "../src/index.js";
import type { CompiledScene } from "../src/index.js";
import { arrayAt, objectAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { closeTo, compileScene, firstOp, layerAt, layerIdOf, layerOps, opAt, opsOfType, present } from "./support/svg-scene.js";

const compile = (svg: string, width = 200, height = 200): CompiledScene => compileScene(svg, { width, height });
const operations = (scene: CompiledScene): ReadonlyArray<JsonObject> => layerOps(layerAt(scene, 0), designPlaceholder(layerAt(scene, 0).name, 0), { compositionId: "comp-main", center: [scene.width / 2, scene.height / 2] });
const controls = (ops: ReadonlyArray<JsonObject>): ReadonlyArray<JsonObject> => opsOfType(ops, "set_effect_control");
const effectOp = (ops: ReadonlyArray<JsonObject>, matchName: string): JsonObject => present(ops.find((operation) => stringAt(operation, "type") === "ensure_effect" && stringAt(operation, "effectMatchName") === matchName), matchName);

const hostProfile = (matchNames: ReadonlyArray<string>) => {
  const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS" as const, architecture: "arm64" as const };
  const installed = matchNames.map((matchName) => ({ matchName, displayName: matchName, available: true, evidence: [{ kind: "observed" as const, source: "host" as const }] }));
  return applyEffectControlEvidence(makeHostProfile(makeInventory(host, installed)), present(loadFixtureEffectEvidence(), "the fixture effect evidence"));
};

const proposeWith = (summary: string, ops: ReadonlyArray<JsonObject>, matchNames: ReadonlyArray<string>): void => {
  const proposed = callTool("ae_propose_plan", { summary, operations: ops }, { snapshot: representativeSnapshot, plans: new Map(), hostProfile: hostProfile(matchNames) });
  assert.ok(proposed.ok, proposed.ok ? "" : JSON.stringify(proposed.error));
};

test("maps SVG blur, drop shadow, and the common glow filter to catalogue controls", () => {
  const blur = compile(`<svg viewBox="0 0 100 100"><defs><filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="3"/></filter></defs><g id="Blur" filter="url(#blur)"><rect width="100" height="100" fill="red"/></g></svg>`);
  assert.equal(layerAt(blur, 0).effect?.kind, "gaussian-blur");
  assert.equal(opAt(controls(operations(blur)), 0).value, 20);

  const shadow = compile(`<svg viewBox="0 0 100 100"><defs><filter id="shadow"><feDropShadow dx="3" dy="4" stdDeviation="0.6" flood-color="#336699" flood-opacity="0.5"/></filter></defs><g id="Shadow" filter="url(#shadow)"><rect width="100" height="100" fill="red"/></g></svg>`);
  const shadowControls = controls(operations(shadow));
  assert.deepEqual(shadowControls.map((operation) => operation.value), [[0.2, 0.4, 0.6, 1], 127.5, 143.13010235415595, 10, 4]);
  assert.deepEqual(shadowControls.map((operation) => stringAt(objectAt(operation, "target"), "propertyPath")?.split("/").at(-1)), ["ADBE Drop Shadow-0001", "ADBE Drop Shadow-0002", "ADBE Drop Shadow-0003", "ADBE Drop Shadow-0004", "ADBE Drop Shadow-0005"]);

  const glow = compile(`<svg viewBox="0 0 100 100"><defs><filter id="glow"><feGaussianBlur in="SourceGraphic" stdDeviation="1" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g id="Glow" filter="url(#glow)"><rect width="100" height="100" fill="red"/></g></svg>`);
  assert.equal(layerAt(glow, 0).effect?.kind, "glow");
  assert.equal(opAt(controls(operations(glow)), 0).value, 6.666666666666667);
});

test("compiles clip subpaths into add masks in layer space and maps SVG blend modes", () => {
  const scene = compile(`<svg viewBox="0 0 100 100"><defs><clipPath id="clip" clipPathUnits="objectBoundingBox"><path d="M0 0H.5V1Z"/><path d="M.5 0H1V1Z"/></clipPath></defs><g id="Masked" clip-path="url(#clip)" mix-blend-mode="color-dodge"><rect width="100" height="100" fill="red"/></g></svg>`);
  const layer = layerAt(scene, 0);
  const clipPaths = present(layer.clipPath, "the clip path").paths;
  assert.deepEqual(clipPaths.map((path) => path.vertices), [[[-100, -100], [0, -100], [0, 100]], [[0, -100], [100, -100], [100, 100]]]);
  assert.equal(layer.blendMode, "COLOR_DODGE");
  const ops = operations(scene);
  assert.equal(opsOfType(ops, "add_mask").length, 2);
  assert.deepEqual(objectAt(firstOp(ops, "add_mask"), "values")?.path, clipPaths[0]);
  assert.equal(stringAt(ops.at(-1), "type"), "set_layer_attribute");
});

test("omits compound and even-odd clips whose holes additive AE masks would fill", () => {
  const compound = compile(`<svg viewBox="0 0 100 100"><defs><clipPath id="ring"><path d="M0 0H100V100H0Z M25 25H75V75H25Z"/></clipPath></defs><g id="Part" clip-path="url(#ring)"><rect width="100" height="100" fill="red"/></g></svg>`);
  assert.equal(layerAt(compound, 0).clipPath, undefined);
  assert.ok(compound.warnings.some((warning) => /compound path contours.*no mask was added/.test(warning)));
  assert.equal(opsOfType(operations(compound), "add_mask").length, 0);

  const evenOdd = compile(`<svg viewBox="0 0 100 100"><style>.cut { clip-rule: evenodd; }</style><defs><clipPath id="clip"><path class="cut" d="M0 0H100V100H0Z"/></clipPath></defs><g id="Part" clip-path="url(#clip)"><rect width="100" height="100" fill="red"/></g></svg>`);
  assert.equal(layerAt(evenOdd, 0).clipPath, undefined);
  assert.ok(evenOdd.warnings.some((warning) => /even-odd clip geometry.*no mask was added/.test(warning)));
});

test("gradient effects run on a precomposed matte result and preserve masks and blend mode", () => {
  const scene = compile(`<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter><clipPath id="clip"><path d="M0 0H100V100Z"/></clipPath></defs><g id="Part" filter="url(#blur)" clip-path="url(#clip)" mix-blend-mode="multiply"><rect width="100" height="100" fill="url(#g)"/></g></svg>`);
  const ops = operations(scene);
  const shapeId = layerIdOf(opAt(ops, 0));
  const solidId = layerIdOf(ops.find((operation) => stringAt(operation, "type") === "create_layer" && stringAt(operation, "layerType") === "solid"));
  const precompose = firstOp(ops, "precompose_layers");
  const newLayerId = stringAt(precompose, "newLayerId");
  assert.equal(layerIdOf(firstOp(ops, "add_mask")), shapeId);
  assert.equal(layerIdOf(firstOp(ops, "set_track_matte")), solidId);
  assert.deepEqual(arrayAt(precompose, "layerIds"), [shapeId, solidId]);
  assert.ok(ops.indexOf(precompose) < ops.indexOf(effectOp(ops, "ADBE Gaussian Blur 2")));
  assert.equal(layerIdOf(effectOp(ops, "ADBE Gaussian Blur 2")), newLayerId);
  assert.equal(layerIdOf(ops.find((operation) => stringAt(operation, "type") === "set_layer_attribute" && stringAt(operation, "role") === "blend-mode")), newLayerId);
  const row = present(sceneManifest(scene).layers[0], "the Part manifest row");
  assert.deepEqual(row.effects, ["Gaussian Blur"]);
  assert.equal(row.companion, "Part Gradient");
  proposeWith("Gradient with blur", ops, ["ADBE Ramp", "ADBE Gaussian Blur 2"]);
});

test("keeps inner filters, clips, and blend modes as actionable top-level-group warnings", () => {
  const scene = compile(`<svg viewBox="0 0 10 10"><defs><filter id="blur"><feGaussianBlur stdDeviation="1"/></filter><clipPath id="clip"><path d="M0 0H5V5Z"/></clipPath></defs><g id="Part"><rect width="10" height="10" fill="red" filter="url(#blur)" clip-path="url(#clip)" style="mix-blend-mode:multiply"/></g></svg>`, 10, 10);
  const layer = layerAt(scene, 0);
  assert.equal(layer.effect, undefined);
  assert.equal(layer.clipPath, undefined);
  assert.equal(layer.blendMode, undefined);
  assert.equal(scene.warnings.filter((warning) => /inner SVG element/.test(warning)).length, 3);
  assert.ok(scene.warnings.every((warning) => !/drawn whole|not applied;/.test(warning) || /top-level group/.test(warning)));
});

test("keeps filter, clip, and blend settings on an unnamed composite wrapper", () => {
  const scene = compile(`<svg viewBox="0 0 100 100"><defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter><clipPath id="clip"><rect width="100" height="100"/></clipPath></defs><g filter="url(#blur)" clip-path="url(#clip)" mix-blend-mode="multiply"><g id="Left"><rect width="50" height="100" fill="red"/></g><g id="Right"><rect x="50" width="50" height="100" fill="blue"/></g></g></svg>`);
  assert.equal(scene.layers.length, 1);
  assert.equal(layerAt(scene, 0).effect?.kind, "gaussian-blur");
  assert.equal(layerAt(scene, 0).clipPath?.paths.length, 1);
  assert.equal(layerAt(scene, 0).blendMode, "MULTIPLY");
});

test("reports nonuniform SVG blur instead of silently using one axis", () => {
  const scene = compile(`<svg viewBox="0 0 100 100"><defs><filter id="blur"><feGaussianBlur stdDeviation="2 5"/></filter></defs><g id="Part" filter="url(#blur)"><rect width="100" height="100" fill="red"/></g></svg>`);
  assert.equal(layerAt(scene, 0).effect, undefined);
  assert.ok(scene.warnings.some((warning) => /nonuniform stdDeviation/.test(warning)));
});

test("scales filters with the actual viewBox and group transform, including rotated shadow offsets", () => {
  const sliced = compile(`<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs><g id="Part" filter="url(#blur)"><rect width="100" height="100" fill="red"/></g></svg>`, 200, 100);
  assert.equal(layerAt(sliced, 0).effect?.blur?.stdDeviation, 4);

  const rotated = compile(`<svg viewBox="0 0 100 100"><defs><filter id="shadow"><feDropShadow dx="3" dy="4" stdDeviation="2"/></filter></defs><g id="Part" transform="rotate(90) scale(2)" filter="url(#shadow)"><rect width="10" height="10" fill="red"/></g></svg>`, 100, 100);
  const shadow = present(layerAt(rotated, 0).effect?.shadow, "the drop shadow");
  assert.equal(shadow.stdDeviation, 4);
  closeTo([shadow.dx, shadow.dy], [-8, 6], 1e-9);

  const stretched = compile(`<svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs><g id="Part" filter="url(#blur)"><rect width="100" height="100" fill="red"/></g></svg>`, 200, 100);
  assert.equal(layerAt(stretched, 0).effect, undefined);
  assert.ok(stretched.warnings.some((warning) => /nonuniform or skewed transform/.test(warning)));
});

test("names unsupported filter primitives and accepts a blur, mask, and blend plan", () => {
  const unsupported = compile(`<svg viewBox="0 0 10 10"><defs><filter id="bad"><feColorMatrix type="saturate" values="0"/></filter></defs><g id="Part" filter="url(#bad)"><rect width="10" height="10" fill="red"/></g></svg>`, 10, 10);
  assert.ok(unsupported.warnings.some((warning) => /filter #bad \(fecolormatrix\)/.test(warning)));

  const scene = compile(`<svg viewBox="0 0 100 100"><defs><filter id="blur"><feGaussianBlur stdDeviation="3"/></filter><clipPath id="clip"><path d="M0 0H1V1Z"/></clipPath></defs><g id="Part" filter="url(#blur)" clip-path="url(#clip)" mix-blend-mode="multiply"><rect width="100" height="100" fill="red"/></g></svg>`, 1920, 1080);
  proposeWith("SVG layer effects", operations(scene), ["ADBE Gaussian Blur 2"]);
});
