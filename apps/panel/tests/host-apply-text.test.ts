/**
 * Apply-plan host contract: text documents, markers, compositions and the host source's own probes.
 * The fake host and payload builders live in host-apply-harness.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { FakeCompItem, loadApplyPlan } from "./host-apply-harness.js";
import { itemAt, markerComment, markerOf, sourceTextOf, valueJson, valueNumber } from "./host-fake-lookup.js";
import { type PlanApply, TITLE_TARGET, applyPlan, assertApplied, assertRefused, textDocumentSender } from "./host-plan-io.js";
import { fieldOf, listAt, textAt } from "./json-narrow.js";
import { hostText } from "./host-sources.js";
import { type JsonObject } from "@extynt/decode";

test("apply_plan normalizes the nested typed composition and marker payloads used by CEP builds", () => {
  const { apply, comp, title } = loadApplyPlan();
  const reply = applyPlan(apply, "nested-typed-payloads", [
    { operation: "set_composition_settings", target: { compositionId: "comp-main" }, settings: { width: 1440, backgroundColor: [0.2, 0.3, 0.4] } },
    { operation: "add_marker", target: { compositionId: "comp-main", layerId: "layer-title" }, marker: { time: 1.25, comment: "Nested marker", duration: 0.25, label: 2 } },
  ]);
  assertApplied(reply);
  assert.equal(comp.width, 1440);
  assert.deepEqual(Array.from(comp.bgColor), [0.2, 0.3, 0.4]);
  const marker = markerOf(title);
  assert.equal(marker.numKeys, 1);
  assert.equal(markerComment(marker, 1), "Nested marker");
});

interface CharacterStyles {
  fontSize?: number;
  fontCapsOption?: number;
  fauxBold?: boolean;
}

interface RangeRecord {
  readonly start: number;
  readonly end: number;
  readonly styles: CharacterStyles;
}

interface RangedDocument {
  readonly text: string;
  readonly fontSize: number;
  readonly boxText: boolean;
  characterRange(start: number, end: number): CharacterStyles;
}

function rangedDocument(ranges: RangeRecord[], boxText: boolean): RangedDocument {
  return {
    text: "Hello world",
    fontSize: 40,
    boxText,
    characterRange(start, end) {
      const existing = ranges.find((range) => range.start === start && range.end === end);
      if (existing) return existing.styles;
      const created: RangeRecord = { start, end, styles: {} };
      ranges.push(created);
      return created.styles;
    },
  };
}

test("apply_plan maps typed text enums, guards box-only fields, and reads back character ranges", () => {
  const { apply, title } = loadApplyPlan();
  const sourceText = sourceTextOf(title);
  const ranges: RangeRecord[] = [];
  sourceText.value = rangedDocument(ranges, false);
  const send = textDocumentSender(apply, "text");
  const styled = send({ fontCapsOption: "FONT_ALL_CAPS", characterRanges: [{ start: 0, end: 5, fontSize: 96, fontCapsOption: "FONT_SMALL_CAPS" }] });
  assertApplied(styled);
  assert.equal(valueNumber(sourceText, "fontCapsOption"), 11014, "enum names resolve through the AE enum object");
  assert.deepEqual(itemAt(ranges, 0).styles, { fontSize: 96, fontCapsOption: 11013 });
  assert.deepEqual(fieldOf(styled, "steps", 0, "rangeReadback"), { ranges: 1, matched: true, mismatches: [] });
  const pointBox = send({ boxVerticalAlignment: "CENTER" });
  assert.equal(fieldOf(pointBox, "ok"), false);
  assert.match(textAt(pointBox, "error", "message"), /TEXT_BOX_ONLY/);
  sourceText.value = rangedDocument(ranges, true);
  assert.equal(fieldOf(send({ boxVerticalAlignment: "CENTER", boxTextSize: [640, 320] }), "ok"), true);
  const outOfRange = send({ characterRanges: [{ start: 0, end: 50, fauxBold: true }] });
  assert.equal(fieldOf(outOfRange, "ok"), false);
  assert.match(textAt(outOfRange, "error", "message"), /TEXT_RANGE_OUT_OF_BOUNDS/);
});

test("apply_plan writes only the typed TextDocument field allowlist", () => {
  const { apply, title } = loadApplyPlan();
  const reply = applyPlan(apply, "text-document-1", [{
    operation: "set_text_document",
    ...TITLE_TARGET,
    text: "Hello",
    font: "Arial-BoldMT",
    fontSize: 72,
    fillColor: [0.2, 0.4, 0.6],
    justification: "CENTER_JUSTIFY",
    tracking: 25,
    leading: 80,
    autoLeading: false,
  }]);
  assert.equal(fieldOf(reply, "ok"), true);
  assert.deepEqual(valueJson(sourceTextOf(title)), {
    text: "Hello",
    font: "Arial-BoldMT",
    fontSize: 72,
    fillColor: [0.2, 0.4, 0.6],
    applyFill: true,
    justification: 7415,
    tracking: 25,
    leading: 80,
    autoLeading: false,
  });
  assert.equal(fieldOf(reply, "steps", 0, "verification"), "source-text-written");
  const invalid = applyPlan(apply, "text-document-bad", [{ operation: "set_text_document", ...TITLE_TARGET, fontSize: 0 }]);
  assertRefused(invalid, "INVALID_VALUE");
});

test("apply_plan adds, updates, and explicitly removes typed layer markers", () => {
  const { apply, title } = loadApplyPlan();
  const add = applyPlan(apply, "marker-1", [{ operation: "add_marker", ...TITLE_TARGET, time: 1, comment: "Beat", duration: 0.5, label: 3 }]);
  assert.equal(fieldOf(add, "ok"), true);
  const marker = markerOf(title);
  assert.equal(marker.numKeys, 1);
  const update = applyPlan(apply, "marker-2", [{ operation: "update_marker", ...TITLE_TARGET, time: 1, comment: "Downbeat", chapter: "Intro" }]);
  assert.equal(fieldOf(update, "ok"), true);
  assert.equal(markerComment(marker, 1), "Downbeat");
  const remove = applyPlan(apply, "marker-3", [{ operation: "remove_marker", ...TITLE_TARGET, time: 1, destructive: true }]);
  assert.equal(fieldOf(remove, "ok"), true);
  assert.equal(marker.numKeys, 0);
});

test("apply_plan writes a comment-only marker through the native MarkerValue path", () => {
  const { apply, title } = loadApplyPlan();
  const reply = applyPlan(apply, "marker-comment-only", [{ operation: "add_marker", ...TITLE_TARGET, time: 0.75, comment: "Comment only" }]);
  assertApplied(reply);
  assert.equal(markerComment(markerOf(title), 1), "Comment only");
});

test("apply_plan creates a new composition and, in the same plan, a text layer inside it, resolving the __new__: composition reference", () => {
  const { apply, projectItems } = loadApplyPlan();
  const reply = applyPlan(apply, "comp-1", [
    { operation: "create_composition", newCompositionId: "__new__:variant1", name: "Variant 1", width: 1920, height: 1080, durationSeconds: 4, frameRate: 30 },
    { operation: "create_layer", compositionId: "__new__:variant1", layerId: "__new__:title1", layerType: "text", name: "Lorem Ipsum", text: "Lorem ipsum" },
  ]);
  assert.equal(fieldOf(reply, "ok"), true);
  assert.equal(listAt(reply, "steps").length, 2);
  assert.equal(fieldOf(reply, "steps", 0, "operation"), "create_composition");
  assert.equal(fieldOf(reply, "steps", 0, "name"), "Variant 1");
  assert.equal(projectItems.length, 2);
  const createdComp = itemAt(projectItems, 1);
  assert.ok(createdComp instanceof FakeCompItem);
  assert.equal(createdComp.name, "Variant 1");
  assert.equal(createdComp.layerItems.length, 1);
  assert.equal(itemAt(createdComp.layerItems, 0).name, "Lorem Ipsum");
});

function createCompositionReply(apply: PlanApply, planId: string, fields: JsonObject): JsonObject {
  return applyPlan(apply, planId, [{ operation: "create_composition", name: "Bad", height: 1080, durationSeconds: 4, frameRate: 30, ...fields }]);
}

test("apply_plan rejects a create_composition operation with an invalid placeholder id or out-of-range dimensions", () => {
  const { apply } = loadApplyPlan();
  const badId = createCompositionReply(apply, "comp-2", { newCompositionId: "not-a-placeholder", width: 1920 });
  assertRefused(badId, "INVALID_VALUE");
  const badWidth = createCompositionReply(apply, "comp-3", { newCompositionId: "__new__:variant2", width: 0 });
  assertRefused(badWidth, "INVALID_VALUE");
});

const PULSE_SOURCE_PATTERNS = [
  /function aeProjectPulse\(/,
  /function aeReadBridgeSession\(/,
  /session\.json/,
  /entry\.keyDigest = aeKeyDigest\(property, keyCount\)/,
  /keyInTemporalEase\(key\)/,
  /keyInSpatialTangent\(key\)/,
  /keyRoving\(key\)/,
  /return count \+ ":" \+ limit \+ ":" \+ hash\.toString\(16\)/,
  /keyCount > AE_KEY_DIGEST_LIMIT\) entry\.keyDigestTruncated = true/,
  /afterDigest: after\.digest/,
  /label: aeSafeGet\(layer, "label", 0\)/,
  /backgroundColor: aeSafe\(function \(\) \{ return aeProbeJsonValue\(comp\.bgColor\); \}, null\)/,
  /aeApplyRestoreSelection\(\);\s*var mayHaveMutated = aeApplyMayHaveMutated\(run, failure\.code\)/,
];

test("marker validation reports what the host received and the project pulse is cheap JSON", () => {
  const { apply } = loadApplyPlan();
  const bad = applyPlan(apply, "marker-diag", [{ operation: "add_marker", ...TITLE_TARGET, time: 1 }]);
  assert.equal(fieldOf(bad, "ok"), false);
  assert.match(textAt(bad, "error", "message"), /Host saw time:number,comment:undefined/);
  const source = hostText("probe.jsx");
  for (const pattern of PULSE_SOURCE_PATTERNS) assert.match(source, pattern);
});
