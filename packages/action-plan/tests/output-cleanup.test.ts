// Render output settings and cleanup_project: typed values, the destructive confirmation, and the last-operation rule.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { fingerprints } from "./fixtures.js";
import { assertOperations, assertSequences, refusal, type OperationRow, type SequenceRow } from "./plan-builders.js";

const render = { type: "render_composition", compositionId: "comp-main", ...fingerprints, outputPath: "/renders/title.mov", destinationPolicy: "explicit-local-path" } satisfies JsonObject;
const cleanup = { type: "cleanup_project", ...fingerprints, mode: "remove_unused_footage", destructive: true } satisfies JsonObject;
const reduce = { type: "cleanup_project", ...fingerprints, mode: "reduce", destructive: true } satisfies JsonObject;
const options = { bounds: { maxOperations: 4 } } satisfies { bounds: JsonObject };

function withOutput(outputSettings: JsonValue): OperationRow {
  return ["INVALID_VALUE", { ...render, outputSettings }];
}

test("render_composition accepts typed output settings and render settings", () => {
  const settings = { format: "QuickTime", resize: { width: 1280, height: 720, quality: "Best" }, crop: { top: 2 }, audio: { output: "On", sampleRate: 48000 } };
  assertOperations([["ok", { ...render, outputSettings: settings, renderSettings: { quality: "Best", timeSpan: "Work Area Only" } }]], options);
});

test("render_composition takes a Media Encoder send", () => {
  assertOperations([["ok", { ...render, mediaEncoder: "queue" }], ["ok", { ...render, mediaEncoder: "start", outputSettings: { videoOutput: true } }]], options);
});

test("output settings reject unknown fields, bad values, empty groups and half a resize", () => {
  const bad: readonly JsonValue[] = [{ bogus: 1 }, { resize: { width: 1280 } }, { resize: {} }, { crop: { top: -4 } }, { audio: { sampleRate: 12345 } }, {}, "RGB"];
  assertOperations(bad.map(withOutput), options);
});

test("render settings and Media Encoder modes reject unknown values", () => {
  assertOperations([["INVALID_VALUE", { ...render, renderSettings: { quality: "Ultra" } }], ["INVALID_VALUE", { ...render, mediaEncoder: "later" }]], options);
});

test("Channels is refused at plan validation and points at the alpha output module templates", () => {
  assertOperations(["RGB + Alpha", "RGB", "CMYK"].map((channels) => withOutput({ channels })), options);
  assert.match(refusal([{ ...render, outputSettings: { channels: "RGB + Alpha" } }], options).message, /High Quality with Alpha/);
});

test("a Media Encoder send cannot also authorize a local render", () => {
  assertOperations([["INVALID_VALUE", { ...render, mediaEncoder: "queue", executeAuthorization: "RENDER_NOW" }]], options);
});

test("cleanup_project is destructive and typed by mode", () => {
  const { destructive: _confirmed, ...unconfirmed } = cleanup;
  assertOperations([
    ["ok", cleanup],
    ["ok", { ...cleanup, mode: "consolidate_footage" }],
    ["DESTRUCTIVE_CONFIRMATION_REQUIRED", unconfirmed],
    ["DESTRUCTIVE_CONFIRMATION_REQUIRED", { ...cleanup, destructive: false }],
    ["INVALID_VALUE", { ...cleanup, mode: "wipe" }],
  ], options);
});

test("cleanup_project is always the last operation", () => {
  const rows: readonly SequenceRow[] = [["INVALID_VALUE", [cleanup, render]], ["ok", [render, cleanup]]];
  assertSequences(rows, options);
});

test("cleanup_project reduce needs distinct snapshot compositions", () => {
  assertOperations([
    ["ok", { ...reduce, compositionIds: ["comp-main"] }],
    ["INVALID_VALUE", reduce],
    ["INVALID_VALUE", { ...reduce, compositionIds: [] }],
    ["INVALID_VALUE", { ...reduce, compositionIds: ["comp-main", "comp-main"] }],
    ["INVALID_VALUE", { ...reduce, compositionIds: ["not-in-snapshot"] }],
  ], options);
});

test("no other cleanup mode takes composition ids", () => {
  assertOperations([["INVALID_VALUE", { ...reduce, mode: "remove_unused_footage", compositionIds: ["comp-main"] }]], options);
});
