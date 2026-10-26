/**
 * Apply-plan host contract: text document units and paragraph justification.
 * The fake host and payload builders live in host-apply-harness.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { type FakeProperty, loadApplyPlan } from "./host-apply-harness.js";
import { nearlyEqual, sourceTextOf, valueNumber } from "./host-fake-lookup.js";
import { TITLE_TARGET, applyPlan, assertApplied, assertRefused, textDocumentSender } from "./host-plan-io.js";
import { installGlobal } from "./host-vm-context.js";
import { fieldOf } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";

interface UnitRangeStyles {
  kerning?: number;
  horizontalScale?: number;
}

type TextSender = (fields: JsonObject) => JsonObject;

function assertPercentUnitsBecomeMultipliers(send: TextSender, sourceText: FakeProperty): void {
  const scaled = send({ horizontalScale: 110, verticalScale: 50, tsume: 10 });
  assertApplied(scaled);
  assert.ok(nearlyEqual(valueNumber(sourceText, "horizontalScale"), 1.1), "110% is AE multiplier 1.1");
  assert.ok(nearlyEqual(valueNumber(sourceText, "verticalScale"), 0.5));
  assert.ok(nearlyEqual(valueNumber(sourceText, "tsume"), 0.1), "10% tsume is AE fraction 0.1");
}

function assertKerningIsRangeOnly(send: TextSender, rangeStyles: UnitRangeStyles): void {
  const documentKerning = send({ kerning: 20 });
  assert.equal(fieldOf(documentKerning, "ok"), false);
  assert.equal(fieldOf(documentKerning, "mayHaveMutated"), false);
  const rangeKerning = send({ characterRanges: [{ start: 0, end: 1, kerning: 20, horizontalScale: 200 }] });
  assertApplied(rangeKerning);
  assert.equal(rangeStyles.kerning, 20);
  assert.ok(nearlyEqual(rangeStyles.horizontalScale ?? Number.NaN, 2));
  assert.equal(fieldOf(rangeKerning, "steps", 0, "rangeReadback", "matched"), true, "range readback converts AE multipliers back to percent");
}

function assertBoxOnlyFailureIsNotMutation(send: TextSender): void {
  const pointBox = send({ boxVerticalAlignment: "CENTER" });
  assertRefused(pointBox, "TEXT_BOX_ONLY");
  assert.equal(fieldOf(pointBox, "mutationState"), "not-applied");
  assert.equal(fieldOf(pointBox, "mayHaveMutated"), false);
}

test("text units: percent scale/tsume write AE multipliers, kerning is range-only, box-only failures are not mutations", () => {
  const { apply, title } = loadApplyPlan();
  const sourceText = sourceTextOf(title);
  const rangeStyles: UnitRangeStyles = {};
  const document = { text: "Hello world", fontSize: 40, boxText: false, characterRange: () => rangeStyles };
  sourceText.value = document;
  const send = textDocumentSender(apply, "units");
  assertPercentUnitsBecomeMultipliers(send, sourceText);
  assertKerningIsRangeOnly(send, rangeStyles);
  assertBoxOnlyFailureIsNotMutation(send);
});

test("text justification is written as a number even when the host enum member is not numeric", () => {
  const { apply, title, context } = loadApplyPlan();
  installGlobal(context, "ParagraphJustification", { LEFT_JUSTIFY: {}, CENTER_JUSTIFY: {}, RIGHT_JUSTIFY: {} });
  const reply = applyPlan(apply, "justify", [{ operation: "set_text_document", ...TITLE_TARGET, justification: "CENTER_JUSTIFY" }]);
  assertApplied(reply);
  assert.equal(valueNumber(sourceTextOf(title), "justification"), 7415);
});

interface JustificationRange {
  start?: number;
  end?: number;
  justification?: number;
}

interface JustificationDocument {
  text: string;
  boxText: boolean;
  characterRange(start: number, end: number): JustificationRange;
}

function rejectingJustificationDocument(range: JustificationRange): JustificationDocument {
  const document: JustificationDocument = {
    text: "Summer Sale",
    boxText: false,
    characterRange(start: number, end: number): JustificationRange {
      range.start = start;
      range.end = end;
      return range;
    },
  };
  Object.defineProperty(document, "justification", {
    enumerable: true,
    get: () => 7419,
    set: () => {
      throw new Error("After Effects error: Unable to set “justification”. NaN is not an unsigned integer.");
    },
  });
  return document;
}

test("a paragraph enum the document setter rejects is written through the whole-text character range", () => {
  const { apply, title } = loadApplyPlan();
  const range: JustificationRange = {};
  sourceTextOf(title).value = rejectingJustificationDocument(range);
  const reply = applyPlan(apply, "justify-range", [{ operation: "set_text_document", ...TITLE_TARGET, justification: "CENTER_JUSTIFY" }]);
  assertApplied(reply);
  assert.deepEqual([range.start, range.end, range.justification], [0, 11, 7415]);
  assert.deepEqual(fieldOf(reply, "steps", 0, "writeFallbacks"), ["justification:character-range"]);
});
