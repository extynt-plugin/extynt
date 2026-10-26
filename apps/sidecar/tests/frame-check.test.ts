/** Frame placement: the host's measurements judged against the frame, the sentence the model is told, and the receipt rows. */
import type { JsonValue } from "@extynt/decode";
import { jsonOf } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";
import { array, decodeOrThrow, object, string } from "@extynt/decode";
import { boundedFrameChecks, frameCheckRow, frameCheckRows, hostFrameChecks, judgeSample, standingFindings } from "../src/verify/frame-check.js";
import type { FrameCheckRow, HostFrameCheck } from "../src/verify/frame-check.js";
import type { ApplyContext } from "../src/verify/host-types.js";
import { makeApplyReceipt } from "../src/verify/receipt-build.js";

const verdictRows = array(object({ verdict: string() }));

function withoutMessage(row: FrameCheckRow): FrameCheckRow {
  const { message: _message, ...rest } = row;
  return rest;
}

function signalRow(): FrameCheckRow {
  const row = frameCheckRow(SIGNAL);
  assert.ok(row);
  return row;
}

const check = (patch: Partial<HostFrameCheck> & Pick<HostFrameCheck, "samples">): HostFrameCheck => ({ compositionId: "comp-1", layerId: "layer-9", name: "SIGNAL", width: 1920, height: 1080, position: null, shift: null, parent: null, text: false, ...patch });

const SIGNAL = check({
  samples: [{ kind: "settled", time: 5, active: true, box: [1636, 1028, 2203, 1131] }, { kind: "middle", time: 5, active: true, box: [1636, 1028, 2203, 1131] }],
  position: [666.9, 589.7], shift: [-959.5, -539.5], parent: { name: "Title Null", world: [960, 540] },
});

test("S4 run 14: SIGNAL's box is a clipped corner, and the sentence gives the parent-space fix", () => {
  const row = signalRow();
  assert.equal(row.verdict, "CLIPPED");
  assert.deepEqual(row.box, { left: 1636, top: 1028, right: 2203, bottom: 1131 });
  assert.equal(row?.time, 5);
  assert.deepEqual(row?.suggestedPosition, [-293, 50]);
  assert.equal(row?.message, "SIGNAL is mostly outside the 1920×1080 frame at 5 s (25% of its box is inside): its box spans x 1636–2203, y 1028–1131. It is parented to Title Null (world 960,540), so its Position, and any Position expression, is relative to that layer rather than the composition: to centre it, use Position ≈ (-293,50).");
});

test("a box wholly outside the frame is OFF_FRAME and the parent is named", () => {
  const row = frameCheckRow({ ...SIGNAL, samples: [{ kind: "settled", time: 5, active: true, box: [2000, 1100, 2500, 1200] }] });
  assert.equal(row?.verdict, "OFF_FRAME");
  assert.match(row?.message ?? "", /^SIGNAL is outside the 1920×1080 frame at 5 s: its box spans x 2000–2500, y 1100–1200\. It is parented to Title Null \(world 960,540\)/);
});

test("an unparented layer's sentence gives the Position that centres it, with no parent talk", () => {
  const row = frameCheckRow(check({ samples: [{ kind: "settled", time: 2, active: true, box: [-900, 100, -300, 200] }], position: [-600, 150], shift: [1260, 390] }));
  assert.equal(row?.verdict, "OFF_FRAME");
  assert.equal(row?.message, "SIGNAL is outside the 1920×1080 frame at 2 s: its box spans x -900–-300, y 100–200. To centre it, use Position ≈ (660,540).");
});

test("less than half inside a box smaller than the frame is CLIPPED, and the sentence says how much shows", () => {
  const row = frameCheckRow(check({ samples: [{ kind: "settled", time: 3, active: true, box: [1800, 400, 2200, 600] }] }));
  assert.equal(row?.verdict, "CLIPPED");
  assert.match(row?.message ?? "", /^SIGNAL is mostly outside the 1920×1080 frame at 3 s \(30% of its box is inside\)/);
});

test("half or more inside is fine, and a backdrop larger than the frame is never clipped", () => {
  assert.equal(judgeSample([1700, 400, 2100, 600], 1920, 1080), "IN_FRAME");
  assert.equal(judgeSample([-480, -270, 2400, 1350], 1920, 1080), "IN_FRAME", "a backdrop bigger than the frame");
  assert.equal(judgeSample([1900, -2000, 2000, 5000], 1920, 1080), "CLIPPED", "a tall sliver smaller than the frame by area, 20% inside");
  assert.equal(judgeSample([2000, -3000, 2400, 5000], 1920, 1080), "OFF_FRAME");
});

test("a box touching the edge from outside is off the frame, and a zero-height rule inside it is not", () => {
  assert.equal(judgeSample([-100, 100, 0, 200], 1920, 1080), "OFF_FRAME");
  assert.equal(judgeSample([100, 300, 900, 300], 1920, 1080), "IN_FRAME");
  assert.equal(judgeSample([100, 1200, 900, 1200], 1920, 1080), "OFF_FRAME");
});

test("a layer that is in the frame at any drawn sample is not a finding: motion crosses the edge on its way", () => {
  const sliding = check({ samples: [{ kind: "settled", time: 2.4, active: true, box: [900, 500, 1100, 600] }, { kind: "middle", time: 5, active: true, box: [-400, 500, -200, 600] }, { kind: "end", time: 9.96, active: true, box: [-400, 500, -200, 600] }] });
  assert.equal(frameCheckRow(sliding)?.verdict, "IN_FRAME");
  assert.equal(frameCheckRow(sliding)?.message, undefined);
});

test("a layer cut by the frame edge only while it moves is in frame at rest: IN_FRAME with an advisory edge note, not a finding", () => {
  const popping = check({ samples: [{ kind: "middle", time: 0.9, active: true, box: [800, 1000, 1100, 1200] }, { kind: "settled", time: 7.9, active: true, box: [800, 400, 1100, 600] }] });
  const row = frameCheckRow(popping);
  assert.equal(row?.verdict, "IN_FRAME");
  assert.equal(row?.edge, "SIGNAL is cut by the 1920×1080 frame edge at 0.9 s while it moves (its box spans x 800–1100, y 1000–1200), though it is inside the frame at rest (7.9 s). Check whether that moment should reach the edge.");
  if (row) assert.deepEqual(standingFindings([row]), []);
});

test("a layer that touches the frame edge at a moving moment but not at rest gets the edge note, and one that touches at rest does not", () => {
  const touching = check({ samples: [{ kind: "middle", time: 1, active: true, box: [800, 300, 1100, 1078] }, { kind: "settled", time: 6, active: true, box: [800, 400, 1100, 600] }] });
  assert.match(frameCheckRow(touching)?.edge ?? "", /^SIGNAL touches the frame edge at 1 s while it moves/);
  const resting = check({ samples: [{ kind: "middle", time: 1, active: true, box: [800, 300, 1100, 600] }, { kind: "settled", time: 6, active: true, box: [800, 400, 1100, 1078] }] });
  assert.equal(frameCheckRow(resting)?.edge, undefined);
  const backdrop = check({ samples: [{ kind: "middle", time: 1, active: true, box: [-100, 0, 2000, 1080] }, { kind: "settled", time: 6, active: true, box: [800, 400, 1100, 600] }] });
  assert.equal(frameCheckRow(backdrop)?.edge, undefined, "a backdrop bigger than the frame is never at its edge");
});

test("a slide that leaves the frame is not an edge note: the rest is outside", () => {
  const leaving = check({ samples: [{ kind: "settled", time: 2.4, active: true, box: [900, 500, 1100, 600] }, { kind: "end", time: 9.96, active: true, box: [-400, 500, -200, 600] }] });
  assert.equal(frameCheckRow(leaving)?.edge, undefined);
});

test("only the samples at which the layer is drawn count, and a layer never measured gives no row", () => {
  const late = check({ samples: [{ kind: "settled", time: 1, active: false, box: [5000, 0, 5100, 100] }, { kind: "end", time: 9.9, active: true, box: [100, 100, 200, 200] }] });
  assert.equal(frameCheckRow(late)?.verdict, "IN_FRAME", "the sample before the in point is not judged");
  assert.equal(frameCheckRow(check({ samples: [{ kind: "settled", time: 1, active: false, box: [5000, 0, 5100, 100] }] })), null);
  assert.equal(frameCheckRow(check({ samples: [{ kind: "settled", time: 1, active: true, box: null }] })), null, "a box After Effects could not place is unverifiable, never a verdict");
});

test("host rows are read through typed bounds: a malformed row is dropped, not guessed at", () => {
  const rows = decodeOrThrow(hostFrameChecks, [{ ...SIGNAL }, { compositionId: "c" }, "nope", { ...SIGNAL, samples: [{ time: "5", active: true, box: [0, 0, 1, 1] }, { kind: "x", time: 5, active: true, box: [0, 0, 1] }] }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.samples.length, 1, "the sample with a string time is dropped");
  assert.equal(rows[1]?.samples[0]?.box, null, "a three-corner box is not a box");
  assert.equal(frameCheckRows(undefined), undefined);
  assert.equal(frameCheckRows([]), undefined);
});

test("a later check of the same layer replaces an earlier finding, and IN_FRAME rows stand for nothing", () => {
  const off = signalRow(), fixed = withoutMessage({ ...off, verdict: "IN_FRAME" });
  const other = { ...off, layerId: "layer-10", layer: "Rule" };
  assert.deepEqual(standingFindings([off, other, fixed]).map((row) => row.layer), ["Rule"]);
  assert.deepEqual(standingFindings([fixed, off]).map((row) => row.layer), ["SIGNAL"]);
});

test("stored rows survive the receipt's bounds unchanged and an invented verdict does not", () => {
  const row = signalRow();
  assert.deepEqual(boundedFrameChecks(jsonOf([row])), [row]);
  assert.equal(boundedFrameChecks(jsonOf([{ ...row, verdict: "FINE" }])), undefined);
  assert.equal(boundedFrameChecks("x"), undefined);
});

test("an edge note survives the receipt's bounds on an IN_FRAME row", () => {
  const noted = { compositionId: "comp-1", layerId: "layer-9", layer: "SIGNAL", verdict: "IN_FRAME", edge: "SIGNAL touches the frame edge at 1 s while it moves." };
  assert.deepEqual(boundedFrameChecks(jsonOf([noted])), [noted]);
});

test("the apply receipt carries the frame rows of a successful apply and none from a failed one", () => {
  const context: ApplyContext = { approvedData: { planId: "p1" }, command: { operations: [] } };
  const hostRow = { ...SIGNAL };
  const ok = makeApplyReceipt(context, { ok: true, steps: [{ operation: "create_layer" }], frameChecks: [hostRow] });
  assert.equal(decodeOrThrow(verdictRows, ok.frameChecks)[0]?.verdict, "CLIPPED");
  const failed = makeApplyReceipt(context, { ok: false, mayHaveMutated: true, error: { code: "HOST_MUTATION_FAILED" }, frameChecks: [hostRow] });
  assert.equal(failed.frameChecks, undefined);
  assert.equal(makeApplyReceipt(context, { ok: true, steps: [{ operation: "create_layer" }] }).frameChecks, undefined);
});

const WORD = (box: [number, number, number, number] | null, patch: Partial<HostFrameCheck> = {}): HostFrameCheck => check({ name: "SIGNAL Word", text: true, samples: [{ kind: "settled", time: 1.8, active: true, box }], position: [960, 540], shift: [-661, 0], ...patch });

test("a text layer cut by the frame edge is CLIPPED even at 71% inside, with the centring hint", () => {
  const row = frameCheckRow(WORD([973, 400, 2309, 700]));
  assert.equal(row?.verdict, "CLIPPED");
  assert.deepEqual(row?.suggestedPosition, [299, 540]);
  assert.equal(row?.message, "\"SIGNAL Word\" is cut off by the 1920×1080 frame edge at 1.8 s: its box spans x 973–2309, y 400–700 (71% of it is inside). Move it so the whole box is inside, for example Position ≈ (299,540), or check its paragraph justification.");
});

test("a text layer wholly inside is fine, a wholly outside one is still OFF_FRAME, and a non-text layer at 71% stays IN_FRAME", () => {
  assert.equal(frameCheckRow(WORD([300, 400, 1600, 700]))?.verdict, "IN_FRAME");
  assert.equal(frameCheckRow(WORD([2000, 400, 2400, 700]))?.verdict, "OFF_FRAME");
  assert.equal(frameCheckRow(WORD([973, 400, 2309, 700], { text: false }))?.verdict, "IN_FRAME");
});

test("a text layer whose settled sample is inactive is not judged, and the host's text flag is parsed strictly", () => {
  assert.equal(frameCheckRow(WORD([973, 400, 2309, 700], { samples: [{ kind: "settled", time: 1.8, active: false, box: [973, 400, 2309, 700] }] })), null);
  const raw = (text: JsonValue | undefined) => ({ compositionId: "c", layerId: "l", name: "T", width: 1920, height: 1080, samples: [], text });
  assert.deepEqual(decodeOrThrow(hostFrameChecks, [raw(true), raw("true"), raw(undefined)]).map((row) => row.text), [true, false, false]);
});
