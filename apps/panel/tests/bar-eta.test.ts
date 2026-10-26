/** "Time left": remaining items x the whole-run working rate, a narrow range, waits excluded. Pure, so no panel is booted. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  enoughItems,
  rangeWords,
  timeLeft,
  waitedBetween,
  workedBetween,
  type EtaFacts,
} from "../runtime/panel-bar-eta.js";
import type { UiChecklistItem, UiWait } from "../runtime/ui-jobs.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 15, 10, 0, 0);
const iso = (ms: number): string => new Date(ms).toISOString();
const RUNNING = { paused: false, linkDown: false };

function items(total: number, verifiedAtMinutes: number[]): UiChecklistItem[] {
  return Array.from({ length: total }, (_, index) => {
    const at = verifiedAtMinutes[index];
    return at === undefined
      ? { id: "i-" + index, title: "Item " + index, phase: "a", status: "open" as const, verifiedAt: null }
      : { id: "i-" + index, title: "Item " + index, phase: "a", status: "verified" as const, verifiedAt: iso(T0 + at * MIN) };
  });
}

function facts(list: UiChecklistItem[], nowMinutes: number, waits: UiWait[] = []): EtaFacts {
  return { startedAt: iso(T0), waits: waits, items: list, nowMs: T0 + nowMinutes * MIN };
}

test("under five items and under a tenth verified, it is estimating and says so", () => {
  const view = timeLeft(facts(items(60, [2, 4, 6]), 7), RUNNING);
  assert.deepEqual(view, { kind: "estimating", text: "estimating…" });
  assert.equal(enoughItems(4, 60), false);
  assert.equal(enoughItems(5, 60), true, "five items is enough on its own");
  assert.equal(enoughItems(2, 20), true, "so is a tenth, here two of twenty");
  assert.equal(enoughItems(0, 20), false);
});

test("a steady rate gives a tight range around remaining x rate", () => {
  const steady = items(
    60,
    Array.from({ length: 18 }, (_, index) => (index + 1) * 2),
  );
  const view = timeLeft(facts(steady, 36), RUNNING);
  assert.equal(view.kind, "range");
  if (view.kind !== "range") return;
  assert.equal(view.slowing, false);
  assert.equal(Math.round(view.lowMs / MIN), 67);
  assert.equal(Math.round(view.highMs / MIN), 109);
  assert.ok(view.highMs <= 2 * view.lowMs);
  assert.match(view.text, /^≈ 1\.1–1\.8 h left$/);
});

test("lumpy verification (three at once, then gaps) gives a range within 2x and close to the truth", () => {
  const stamps = Array.from({ length: 18 }, (_, index) => (Math.floor(index / 3) + 1) * 6);
  const view = timeLeft(facts(items(60, stamps), 36), RUNNING);
  assert.equal(view.kind, "range");
  if (view.kind !== "range") return;
  assert.ok(view.highMs <= 2 * view.lowMs, view.text);
  assert.ok(view.lowMs <= 84 * MIN && view.highMs >= 84 * MIN, "the truth is inside: " + view.text);
  const midGap = timeLeft(facts(items(60, stamps), 40), RUNNING);
  assert.equal(midGap.kind === "range" && midGap.highMs <= 2 * midGap.lowMs, true);
});

test("a long designer gap adds the excess once, not once per remaining item", () => {
  const stamps = Array.from({ length: 20 }, (_, index) => index + 1);
  const before = timeLeft(facts(items(60, stamps), 20), RUNNING);
  const gap = timeLeft(facts(items(60, stamps), 35), RUNNING);
  assert.equal(before.kind, "range");
  assert.equal(gap.kind, "range");
  if (before.kind !== "range" || gap.kind !== "range") return;
  assert.equal(gap.slowing, true);
  const added = (gap.lowMs - before.lowMs) / MIN / 0.8;
  assert.ok(added >= 13 && added <= 15, "about the 14 excess minutes, not hours: " + added);
  assert.ok(gap.highMs <= 2.5 * gap.lowMs);
  assert.ok(gap.highMs / MIN < 90, gap.text);
});

test("time spent waiting for the user is not part of the rate", () => {
  const stamps = [2, 4, 6, 8, 10, 12];
  const waits: UiWait[] = [{ from: iso(T0 + 12 * MIN), to: iso(T0 + 62 * MIN) }];
  const view = timeLeft(facts(items(60, [...stamps, 64]), 64, waits), RUNNING);
  assert.equal(view.kind, "range");
  if (view.kind !== "range") return;
  assert.equal(view.slowing, false, "an hour of waiting is not slowness");
  assert.equal(Math.round(view.lowMs / MIN), 85, "53 items left at two working minutes each, -20%");
  assert.equal(waitedBetween(waits, T0 + 10 * MIN, T0 + 64 * MIN, T0 + 64 * MIN), 50 * MIN);
  assert.equal(workedBetween(waits, T0 + 10 * MIN, T0 + 64 * MIN, T0 + 64 * MIN), 4 * MIN);
});

test("a wait that is still open runs to now", () => {
  const waits: UiWait[] = [{ from: iso(T0 + 10 * MIN), to: null }];
  assert.equal(waitedBetween(waits, T0, T0 + 30 * MIN, T0 + 30 * MIN), 20 * MIN);
});

test("recent items running slow widen the top of the range and say slowing", () => {
  const slowStamps = [
    ...Array.from({ length: 20 }, (_, index) => index + 1),
    ...Array.from({ length: 8 }, (_, index) => 20 + (index + 1) * 10),
  ];
  const view = timeLeft(facts(items(60, slowStamps), 100), RUNNING);
  assert.equal(view.kind, "range");
  if (view.kind !== "range") return;
  assert.equal(view.slowing, true);
  assert.match(view.text, / · slowing$/);
  assert.ok(view.highMs <= 2.5 * view.lowMs);
  const steady = timeLeft(facts(items(60, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]), 24), RUNNING);
  assert.equal(steady.kind === "range" && steady.slowing, false);
  assert.equal(steady.kind === "range" && steady.highMs <= 2 * steady.lowMs, true);
});

test("an item in progress that has stalled says slowing before the next one lands", () => {
  const verified = [2, 4, 6, 8, 10, 12];
  const quiet = timeLeft(facts(items(60, verified), 13), RUNNING);
  assert.equal(quiet.kind === "range" && quiet.slowing, false);
  const stalled = timeLeft(facts(items(60, verified), 40), RUNNING);
  assert.equal(stalled.kind === "range" && stalled.slowing, true, "28 working minutes with no item, against two before");
});

test("it shows nothing when finished, when there is no checklist, or while the job waits for the user", () => {
  assert.deepEqual(timeLeft(facts(items(6, [1, 2, 3, 4, 5, 6]), 7), RUNNING), { kind: "hidden" }, "everything is verified");
  assert.deepEqual(timeLeft(facts([], 3), RUNNING), { kind: "hidden" });
  assert.deepEqual(timeLeft(facts(items(60, [2, 4, 6, 8, 10, 12]), 14), { paused: true, linkDown: false }), { kind: "hidden" });
});

test("with the link down it says the clock resumes when connected", () => {
  assert.deepEqual(timeLeft(facts(items(60, [2, 4, 6, 8, 10, 12]), 14), { paused: false, linkDown: true }), {
    kind: "offline",
    text: "ETA resumes when connected",
  });
});

test("items verified together by one batch count as that many items of one event", () => {
  const batch = (at: number): number[] => [at, at, at, at, at];
  const view = timeLeft(facts(items(60, [...batch(10), ...batch(20), ...batch(30)]), 30), RUNNING);
  assert.equal(view.kind, "range");
  if (view.kind !== "range") return;
  assert.equal(Math.round(view.lowMs / MIN), 72, "45 left at two minutes each is 90, low -20%");
});

test("the words: 5-minute steps to an hour and a half, hours past it, one number when the range collapses", () => {
  assert.equal(rangeWords(47 * MIN, 68 * MIN), "≈ 45–70 min left");
  assert.equal(rangeWords(25 * MIN, 25 * MIN), "≈ 25 min left");
  assert.equal(rangeWords(35 * MIN, 60 * MIN), "≈ 35–60 min left");
  assert.equal(rangeWords(90 * MIN, 150 * MIN), "≈ 1.5–2.5 h left");
  assert.equal(rangeWords(20 * 1000, 30 * 1000), "≈ 1 min left");
});

test("example: started 25 min ago, 20 of 60 verified in lumps, last item 6 min ago", () => {
  const stamps = [4, 8, 14, 19].flatMap((minutes) => Array<number>(5).fill(minutes));
  const view = timeLeft(facts(items(60, stamps), 25), RUNNING);
  assert.equal(view.kind, "range");
  if (view.kind !== "range") return;
  assert.ok(view.highMs <= 2.5 * view.lowMs);
});

test("a reloaded panel gives the same answer: it needs nothing but the job's own facts", () => {
  const list = items(60, [2, 4, 6, 8, 10, 12, 14]);
  assert.deepEqual(timeLeft(facts(list, 15), RUNNING), timeLeft(facts(structuredClone(list), 15), RUNNING));
});
