// Covers create_vector_artwork validation of the converter fallback: exact match with the svg, unavailable reasons, unknown fields and the importer route.
import assert from "node:assert/strict";
import test from "node:test";
import { validateInlineSvgText, vectorArtworkFallback } from "../src/index.js";
import { fingerprints } from "./fixtures.js";
import { verdict } from "./plan-builders.js";
import { toJsonValue } from "../src/plain-json.js";

type Extras = Partial<ReturnType<typeof vectorArtworkFallback>> & { importer?: string; importerAeVersion?: string; fallbackExtra?: number };

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><g id="mark"><rect width="20" height="10" fill="#f00"/></g></svg>';

function code(extra: Extras, source = svg): string {
  const checked = validateInlineSvgText(source);
  if (!checked.ok) assert.fail(checked.message);
  const operation = { type: "create_vector_artwork", newItemId: "__new__:vector", ...fingerprints, name: "Vector", svg: checked.svg, sourceHash: checked.metadata.sourceHash, metadata: checked.metadata, importMode: "editable", managedSourcePolicy: "retain", ...extra };
  return verdict([toJsonValue(operation) ?? null]);
}

test("an operation without fallback fields is still valid", () => {
  assert.equal(code({}), "ok");
});

test("the exact fallback derived from the svg is accepted", () => {
  assert.equal(code({ ...vectorArtworkFallback(svg) }), "ok");
});

test("a fallback that does not match the svg is refused: no smuggled geometry", () => {
  const fallback = vectorArtworkFallback(svg);
  const tampered: Extras = { ...fallback, fallbackLayers: [{ name: "mark", shapes: [{ name: "evil", paths: [{ vertices: [[0, 0], [1, 1]], closed: false }], stroke: { color: [1, 0, 0], width: 1 } }] }] };
  assert.equal(code(tampered), "SVG_FALLBACK_MISMATCH");
  assert.equal(code({ fallbackSize: [1, 1] }), "SVG_FALLBACK_MISMATCH");
  assert.equal(code({ ...fallback, fallbackNotes: { approximated: ["gradient"], skipped: [] } }), "SVG_FALLBACK_MISMATCH");
});

test("an unavailable fallback is carried with its reason and must match the converter's own", () => {
  const huge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${Array.from({ length: 300 }, (_, index) => `<rect x="${index % 9}" width="1" height="1"/>`).join("")}</svg>`;
  const fallback = vectorArtworkFallback(huge);
  assert.match(fallback.fallbackUnavailable ?? "", /more than 256 shapes/);
  assert.equal(code({ ...fallback }, huge), "ok");
  assert.equal(code({ fallbackUnavailable: "because" }, huge), "SVG_FALLBACK_MISMATCH");
});

test("unknown fallback-like fields are still refused", () => {
  assert.notEqual(code({ fallbackExtra: 1 }), "ok");
});

test("the importer route is accepted only in its two shapes", () => {
  assert.equal(code({ ...vectorArtworkFallback(svg), importer: "converter", importerAeVersion: "25.6" }), "ok");
  assert.equal(code({ ...vectorArtworkFallback(svg), importer: "converter" }), "ok");
  assert.equal(code({ importer: "native" }), "INVALID_VALUE");
  assert.equal(code({ importerAeVersion: "25.6" }), "INVALID_VALUE");
  assert.equal(code({ importer: "converter", importerAeVersion: "twenty-five" }), "INVALID_VALUE");
});
