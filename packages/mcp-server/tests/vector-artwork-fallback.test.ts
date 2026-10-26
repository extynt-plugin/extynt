// Tests that a created vector artwork carries the converter fallback and routes to the converter on AE 25, a forced switch or the live plugin's capability, down to the host operation.
import test from "node:test";
import assert from "node:assert/strict";
import { array, decodeOrThrow, jsonObject, object, string } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";
import type { StoredPlan, ToolContext } from "../src/index.js";
import { arrayAt, numberAt, objectAt, objectsIn, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { compiledOperations } from "./support/compiled-plan.js";
import { payloadOf } from "./support/json-results.js";

const svg = '<svg viewBox="0 0 100 80"><defs><linearGradient id="g"><stop offset="0" stop-color="#f80"/><stop offset="1" stop-color="#08f"/></linearGradient></defs><g id="badge" transform="translate(10 10)"><rect width="50" height="40" rx="6" fill="url(#g)"/></g><text x="5" y="70">Hi</text></svg>';
const huge = `<svg viewBox="0 0 10 10">${Array.from({ length: 300 }, (_, index) => `<rect x="${index % 9}" width="1" height="1"/>`).join("")}</svg>`;

const createdView = object({ planId: string(), plan: object({ operations: array(jsonObject) }) });

interface Created {
  create: JsonObject;
  card: string;
  plans: Map<string, StoredPlan>;
  planId: string;
}

function createArtwork(source: string, extra: Partial<ToolContext> = {}): Created {
  const plans = new Map<string, StoredPlan>();
  const result = callTool("ae_create_vector_artwork", { svg: source, name: "Badge" }, { snapshot: representativeSnapshot, panelSessionId: "panel-route", plans, ...extra });
  const payload = payloadOf(result);
  const { planId, plan } = decodeOrThrow(createdView, payload);
  const create = plan.operations[0];
  assert.ok(create, "the plan holds the create operation");
  return { create, card: JSON.stringify(payload), plans, planId };
}

test("a compiled create_vector_artwork operation carries the converter fallback", () => {
  const { create } = createArtwork(svg);
  assert.deepEqual(create.fallbackSize, [100, 80]);
  const layers = objectsIn(arrayAt(create, "fallbackLayers"));
  assert.deepEqual(layers.map((layer) => stringAt(layer, "name")), ["badge"]);
  const shape = objectsIn(arrayAt(layers[0], "shapes"))[0];
  assert.equal(arrayAt(shape, "paths")?.length, 1);
  assert.deepEqual(objectAt(shape, "fill")?.color, [1, 0.5333, 0]);
  assert.deepEqual(create.fallbackNotes, { approximated: ["gradient"], skipped: ["text"] });
  assert.equal(create.fallbackUnavailable, undefined);
});

test("the managed svg carries the namespace and the operation hash is of that text", () => {
  const { create } = createArtwork(svg);
  const managed = stringAt(create, "svg") ?? "";
  assert.match(managed, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox/);
  assert.equal(numberAt(objectAt(create, "metadata"), "bytes"), Buffer.byteLength(managed));
});

test("the fallback survives compilation to the host operation", () => {
  const { create, plans, planId } = createArtwork(svg);
  const host = compiledOperations(plans.get(planId), representativeSnapshot)[0];
  assert.equal(stringAt(host, "operation"), "create_vector_artwork");
  assert.deepEqual(host?.fallbackLayers, create.fallbackLayers);
  assert.deepEqual(host?.fallbackSize, create.fallbackSize);
  assert.deepEqual(host?.fallbackNotes, create.fallbackNotes);
});

test("an SVG the converter cannot take says so in the operation and on the approval card", () => {
  const { create, card } = createArtwork(huge);
  assert.match(stringAt(create, "fallbackUnavailable") ?? "", /more than 256 shapes/);
  assert.equal(create.fallbackLayers, undefined);
  assert.match(card, /no extynt converter fallback: the SVG has more than 256 shapes/);
  assert.doesNotMatch(createArtwork(svg).card, /no extynt converter fallback/);
});

test("AE 25 routes to the converter: the operation, its card and the host operation say so", () => {
  const { create, card, plans, planId } = createArtwork(svg, { hostKey: "25.6 (12) macOS/arm64" });
  assert.equal(create.importer, "converter");
  assert.equal(create.importerAeVersion, "25.6");
  assert.match(card, /Create vector artwork: AE 25\.6 has no SVG importer, so extynt's converter builds it\. Gradients become solid colours; text is skipped/);
  const host = compiledOperations(plans.get(planId), representativeSnapshot)[0];
  assert.equal(host?.importer, "converter");
  assert.equal(host?.importerAeVersion, "25.6");
});

test("AE 26 and an unknown host keep native first, with no routing fields", () => {
  for (const hostKey of ["26.2.1 (14) macOS/arm64", null, "unknown"]) {
    const { create, card } = createArtwork(svg, { hostKey });
    assert.equal(create.importer, undefined, String(hostKey));
    assert.equal(create.importerAeVersion, undefined);
    assert.doesNotMatch(card, /has no SVG importer/);
  }
});

test("the development switch routes AE 26 to the converter and says it is forced", () => {
  const { create, card } = createArtwork(svg, { hostKey: "26.2.1 (14) macOS/arm64", svgForceConverter: true });
  assert.equal(create.importer, "converter");
  assert.equal(create.importerAeVersion, undefined);
  assert.match(card, /extynt's converter is forced \(development switch\)\. Gradients become solid colours; text is skipped/);
});

test("an SVG past the converter's limits on AE 25 says it cannot be built", () => {
  const { card } = createArtwork(huge, { hostKey: "25.0 (1) macOS/arm64" });
  assert.match(card, /AE 25\.0 has no SVG importer and this SVG exceeds extynt's converter limits \(the SVG has more than 256 shapes.*so it cannot be built/);
});

test("the live plugin's svgImport capability decides the route, not the last snapshot's host key", () => {
  const swapped = createArtwork(svg, { hostKey: "26.5.0 (61) macOS/arm64", liveHost: { version: "25.6.0 (build 41)", svgImport: "converter" } }).create;
  assert.equal(swapped.importer, "converter");
  assert.equal(swapped.importerAeVersion, "25.6.0");
  const native = createArtwork(svg, { hostKey: "25.6 (12) macOS/arm64", liveHost: { version: "26.5.0 (build 61)", svgImport: "native" } }).create;
  assert.equal(native.importer, undefined);
  assert.equal(createArtwork(svg, { hostKey: "25.6 (12) macOS/arm64", liveHost: { version: "unknown", svgImport: "unknown" } }).create.importer, "converter");
  assert.equal(createArtwork(svg, { hostKey: "26.5 (12) macOS/arm64", liveHost: null }).create.importer, undefined);
});
