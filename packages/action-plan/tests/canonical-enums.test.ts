// Canonical enum spelling: a near-miss value names its one member, and separators and case fold for dash enums.
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalEnumValue, textEnumMembers, TRACK_MATTE_MODES, OPERATION_ENUM_FIELDS } from "../src/canonical-enums.js";

test("a near-miss spelling names its member only when exactly one member fits", () => {
  const justification = textEnumMembers("justification") ?? [];
  assert.equal(canonicalEnumValue("center", justification), "CENTER_JUSTIFY");
  assert.equal(canonicalEnumValue("CENTER", justification), "CENTER_JUSTIFY");
  assert.equal(canonicalEnumValue("Left", justification), "LEFT_JUSTIFY");
  assert.equal(canonicalEnumValue("right-justify", justification), "RIGHT_JUSTIFY");
  assert.equal(canonicalEnumValue("full", justification), undefined);
  assert.equal(canonicalEnumValue("CENTER_JUSTIFY", justification), undefined);
  assert.equal(canonicalEnumValue("sideways", justification), undefined);
  assert.equal(canonicalEnumValue(3, justification), undefined);
});

test("separators and case fold for lower-case dash enums", () => {
  assert.equal(canonicalEnumValue("Alpha Inverted", TRACK_MATTE_MODES), "alpha-inverted");
  assert.equal(canonicalEnumValue("lumaInverted", TRACK_MATTE_MODES), "luma-inverted");
  assert.equal(canonicalEnumValue("luma", TRACK_MATTE_MODES), undefined);
  assert.deepEqual(Object.keys(OPERATION_ENUM_FIELDS.set_track_matte ?? {}), ["mode"]);
});
