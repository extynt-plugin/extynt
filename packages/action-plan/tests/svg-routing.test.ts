// Covers choosing between the native and converter svg import routes and wording the converter trade-offs.
import assert from "node:assert/strict";
import test from "node:test";
import { aeVersionOf, converterTradeOffs, svgImporterRoute } from "../src/index.js";

test("the AE version is read from a host key, a bare version or app.version text", () => {
  assert.equal(aeVersionOf("26.2.1 (14) macOS/arm64"), "26.2.1");
  assert.equal(aeVersionOf("After Effects:25.6.1:macOS"), "25.6.1");
  assert.equal(aeVersionOf("25.0x56"), "25.0");
  assert.equal(aeVersionOf("26"), "26");
});

test("malformed or implausible versions are unknown, never old", () => {
  for (const value of [undefined, null, "", "unknown", "After Effects", "0.0", "7.0", "x26", "12345"]) assert.equal(aeVersionOf(value), null, String(value));
});

test("25.x routes to the converter and names the version", () => {
  assert.deepEqual(svgImporterRoute({ hostKey: "25.6 (12) macOS/arm64" }), { importer: "converter", importerAeVersion: "25.6" });
  assert.deepEqual(svgImporterRoute({ hostKey: "After Effects:23.0.1:Windows" }), { importer: "converter", importerAeVersion: "23.0.1" });
});

test("26.x tries the native importer first", () => {
  assert.deepEqual(svgImporterRoute({ hostKey: "26.0 (1) macOS/arm64" }), {});
  assert.deepEqual(svgImporterRoute({ hostKey: "27.1.2 (1) macOS/arm64" }), {});
});

test("an unknown or malformed version keeps native first", () => {
  for (const hostKey of [null, undefined, "", "garbage", "0 (0) x/y"]) assert.deepEqual(svgImporterRoute({ hostKey }), {}, String(hostKey));
});

test("the switch forces the converter without a version, and never overrides a real old version's note", () => {
  assert.deepEqual(svgImporterRoute({ hostKey: "26.2 (1) macOS/arm64", forceConverter: true }), { importer: "converter" });
  assert.deepEqual(svgImporterRoute({ hostKey: null, forceConverter: true }), { importer: "converter" });
  assert.deepEqual(svgImporterRoute({ hostKey: "25.0 (1) macOS/arm64", forceConverter: true }), { importer: "converter", importerAeVersion: "25.0" });
  assert.deepEqual(svgImporterRoute({ hostKey: "26.2 (1) macOS/arm64", forceConverter: false }), {});
});

test("converter notes read as plain trade-offs, without repeats", () => {
  const words = converterTradeOffs({ approximated: ["gradient", "group-opacity"], skipped: ["text", "clip-path", "mask", "filter", "pattern-paint"] });
  assert.deepEqual(words, ["gradients become solid colours", "group opacity is applied to each shape", "text is skipped", "clip paths, masks and filters are skipped", "patterns and other unsupported paint are skipped"]);
  assert.deepEqual(converterTradeOffs({ approximated: [], skipped: [] }), []);
  assert.deepEqual(converterTradeOffs(undefined), []);
  assert.deepEqual(converterTradeOffs({ skipped: ["brand-new-code"] }), ["brand-new-code is skipped"]);
});
