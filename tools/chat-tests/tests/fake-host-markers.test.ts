/** The fixture host's marker writes: a null field is accepted, a wrongly typed field is refused, and a stored marker without fields is edited in place. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apply, compositionOf, fixture } from "./fake-host-fixture.js";

const TARGET = { compositionId: "comp-main" };

describe("fake host marker writes", () => {
  it("accepts a null marker field without validating it and stores it as null", () => {
    const result = apply(fixture(), [{ type: "add_marker", target: TARGET, time: 1, comment: "Hit", chapter: null }]);
    assert.equal(result.verdicts[0]?.ok, true, JSON.stringify(result.verdicts));
    assert.deepEqual(compositionOf(result.snapshot, "comp-main").markers?.markers, [{ time: 1, comment: "Hit", chapter: null, url: null, cuePointName: null, duration: 0, label: 0 }]);
  });

  it("refuses a marker whose only field has the wrong type as an invalid value", () => {
    const result = apply(fixture(), [{ type: "add_marker", target: TARGET, time: 1, comment: 5 }]);
    assert.deepEqual([result.verdicts[0]?.ok, result.verdicts[0]?.code], [false, "INVALID_VALUE"]);
  });

  it("refuses a marker with no marker field at all as an invalid operation", () => {
    const result = apply(fixture(), [{ type: "add_marker", target: TARGET, time: 1 }]);
    assert.deepEqual([result.verdicts[0]?.ok, result.verdicts[0]?.code], [false, "INVALID_OPERATION"]);
  });

  it("keeps only the fields it was given when it edits a stored composition marker that has none beyond its time", () => {
    const input = fixture();
    const sparse = { ...input, compositions: input.compositions.map((composition) => ({ ...composition, markers: { count: 1, markers: [{ time: 1 }] } })) };
    const result = apply(sparse, [{ type: "update_marker", target: TARGET, time: 1, comment: "Now named" }]);
    assert.equal(result.verdicts[0]?.ok, true, JSON.stringify(result.verdicts));
    assert.deepEqual(compositionOf(result.snapshot, "comp-main").markers?.markers, [{ time: 1, comment: "Now named" }]);
  });
});
