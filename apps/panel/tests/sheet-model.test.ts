/** Which sheet sections show, how verified runs fold, and the thread's fold line: pure, so no panel is booted. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeOrThrow } from "@extynt/decode";
import { jobIdDecoder, planIdDecoder } from "../runtime/ids.js";
import { changeRows, filesLine, foldChanges, foldLabel, needsLook, changesDecoder, type ChangeRow } from "../runtime/panel-changes.js";
import { doneItems, type WaitingItem } from "../runtime/panel-bar.js";
import { planRunWords, runState } from "../runtime/panel-plan-run.js";
import {
  RECENT_CALL_MS,
  connectionTroubled,
  filterRows,
  hasOutsideWork,
  nowCalls,
  visibleSections,
  type SheetFacts,
} from "../runtime/panel-sheet-model.js";
import type { UiJob, UiMcpCall } from "../runtime/ui-jobs.js";
import { nth, required } from "./contract-helpers.js";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const row = (planId: string, extra: Partial<ChangeRow> = {}): ChangeRow => ({
  planId: decodeOrThrow(planIdDecoder, planId),
  title: planId,
  statusLabel: "Done",
  tone: "ok",
  meta: "",
  canUndo: true,
  undoNote: "",
  undoTitle: "",
  status: "verified",
  jobId: null,
  batch: null,
  origin: "chat",
  operations: 3,
  applied: new Date(NOW).toISOString(),
  mayHaveMutated: false,
  source: "You",
  steps: 1,
  undoCode: "",
  filesLine: "",
  ...extra,
});
const call = (extra: Partial<UiMcpCall> = {}): UiMcpCall => ({
  id: 1,
  rev: 1,
  at: new Date(NOW).toISOString(),
  tool: "ae_inspect_layer",
  client: "claude-code",
  args: "",
  state: "ok",
  code: null,
  ms: 10,
  planIds: [],
  ...extra,
});
const job = (extra: Partial<UiJob> = {}): UiJob => ({
  jobId: decodeOrThrow(jobIdDecoder, "j"),
  requestId: "r",
  goal: "g",
  status: "working",
  via: "request",
  activity: "",
  cycle: 1,
  step: 1,
  plansApplied: 0,
  plansNotApplied: 0,
  requestOpen: true,
  plans: [],
  startedAt: new Date(NOW).toISOString(),
  waits: [],
  checklist: null,
  specialists: [],
  ...extra,
});
const WAITING_PLAN: WaitingItem = {
  kind: "plan",
  id: "p1",
  title: "Plan",
  prompt: "Apply?",
  detail: "",
  source: "extynt",
  external: false,
  applyLabel: "Apply",
  choiceLabel: "",
  busy: false,
  note: "",
};
const FACTS: SheetFacts = {
  waiting: [],
  job: null,
  jobRunning: false,
  turnOpen: false,
  calls: [],
  nowMs: NOW,
  rows: [],
  reachable: true,
  host: {
    state: "online",
    since: 0,
    pluginVersion: null,
    aeVersion: "26",
    experimental: false,
    idleAgeMs: null,
    stall: null,
    busyKind: null,
  },
  quarantined: false,
  modelConfigured: true,
  spend: false,
};

test("an idle panel has no sections at all", () => {
  assert.deepEqual(visibleSections(FACTS), []);
});

test("each section appears only when it has something to say, and in the sheet's order", () => {
  const waiting = [WAITING_PLAN];
  const checklist = {
    items: [{ id: "a-1", title: "A", phase: "a", status: "open" as const, verifiedAt: null }],
    phases: [{ name: "a", verified: 0, total: 1 }],
    current: "a-1",
  };
  assert.deepEqual(visibleSections({ ...FACTS, waiting }), ["waiting"]);
  assert.deepEqual(visibleSections({ ...FACTS, turnOpen: true }), ["now"]);
  assert.deepEqual(visibleSections({ ...FACTS, calls: [call({ state: "running" })] }), ["now"], "an outside call in flight is a Now row");
  assert.deepEqual(visibleSections({ ...FACTS, rows: [row("a")] }), ["changes"]);
  assert.deepEqual(visibleSections({ ...FACTS, rows: [row("a", { status: "failed", mayHaveMutated: true })] }), ["look", "changes"]);
  assert.deepEqual(visibleSections({ ...FACTS, job: job({ checklist }), jobRunning: true }), ["now", "checklist"]);
  assert.deepEqual(visibleSections({ ...FACTS, quarantined: true }), ["connection"]);
  assert.deepEqual(visibleSections({ ...FACTS, job: job(), spend: true }), ["spend"]);
  const all = visibleSections({
    ...FACTS,
    waiting,
    job: job({ checklist }),
    jobRunning: true,
    turnOpen: true,
    rows: [row("a", { status: "applied_unverified" })],
    reachable: false,
    spend: true,
  });
  assert.deepEqual(all, ["waiting", "now", "look", "checklist", "changes", "connection", "spend"]);
});

test("an ended job's checklist stays in the sheet for the record, but it is no longer Now", () => {
  const checklist = {
    items: [{ id: "a-1", title: "A", phase: "a", status: "verified" as const, verifiedAt: null }],
    phases: [{ name: "a", verified: 1, total: 1 }],
    current: null,
  };
  assert.deepEqual(visibleSections({ ...FACTS, job: job({ checklist }), jobRunning: false }), ["checklist"]);
});

test("connection shows when any link is off: the helper, a held block, the model, or After Effects", () => {
  assert.equal(connectionTroubled(FACTS), false);
  assert.equal(connectionTroubled({ ...FACTS, reachable: false }), true);
  assert.equal(connectionTroubled({ ...FACTS, quarantined: true }), true);
  assert.equal(connectionTroubled({ ...FACTS, modelConfigured: false }), true);
  assert.equal(connectionTroubled({ ...FACTS, host: { ...required(FACTS.host), state: "offline" } }), true);
  assert.equal(
    connectionTroubled({
      ...FACTS,
      host: {
        ...required(FACTS.host),
        state: "stalled",
        stall: { verdict: "ae-busy", waitedMs: 1, idleAgeMs: 1, dialog: null },
      },
    }),
    true,
  );
});

test("outside calls: those running, then those finished in the last minutes, newest first, a handful at most", () => {
  const calls = [
    call({ id: 1, at: new Date(NOW - RECENT_CALL_MS - 1000).toISOString() }),
    call({ id: 2 }),
    call({ id: 3, state: "running", ms: null }),
    call({ id: 4 }),
    call({ id: 5 }),
    call({ id: 6 }),
    call({ id: 7 }),
  ];
  assert.deepEqual(
    nowCalls(calls, NOW).map((entry) => entry.id),
    [7, 6, 5, 4, 3],
  );
  assert.deepEqual(nowCalls([call({ id: 1, at: new Date(NOW - RECENT_CALL_MS - 1000).toISOString() })], NOW), []);
});

test("the filter chips and what each keeps", () => {
  const rows = [row("a", { origin: "chat" }), row("b", { origin: "mcp" }), row("c", { origin: "designer" }), row("d", { origin: null })];
  assert.equal(hasOutsideWork([], [row("a")]), false);
  assert.equal(hasOutsideWork([call()], [row("a")]), true);
  assert.equal(hasOutsideWork([], rows), true);
  assert.deepEqual(
    filterRows(rows, "all").map((entry) => entry.planId),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    filterRows(rows, "agent").map((entry) => entry.planId),
    ["a", "c"],
  );
  assert.deepEqual(
    filterRows(rows, "mcp").map((entry) => entry.planId),
    ["b"],
  );
});

test("verified runs fold by job, keep the newest few open, and never fold failures, other jobs or outside changes", () => {
  const run = Array.from({ length: 7 }, (_, index) =>
    row("b" + (7 - index), { jobId: "j1", batch: "batch-" + (7 - index), operations: 10 }),
  );
  const rows = [
    row("fail", { status: "failed", jobId: "j1", batch: "batch-8" }),
    ...run,
    row("other", { jobId: "j2", batch: "1" }),
    row("mcp", { origin: "mcp" }),
  ];
  const items = foldChanges(rows);
  assert.deepEqual(
    items.map((item) => (item.kind === "row" ? item.row.planId : "fold:" + item.rows.length)),
    ["fail", "b7", "b6", "b5", "fold:4", "other", "mcp"],
  );
  const fold = items.find((item) => item.kind === "fold");
  assert.equal(fold && fold.kind === "fold" ? fold.label : "", "Batches 1–4 · 40 ops · verified");
  assert.deepEqual(
    foldChanges(run.slice(0, 4)).map((item) => item.kind),
    ["row", "row", "row", "row"],
    "a fold of one saves nothing",
  );
  assert.equal(
    foldLabel([row("x", { batch: "alpha" }), row("y", { batch: "beta" })]),
    "2 batches · 6 ops · verified",
    "unnumbered batches are counted, not ranged",
  );
  assert.equal(needsLook(row("z", { status: "undo_unverified" })), true);
  assert.equal(needsLook(row("z")), false);
});

test("the thread's fold line: one plan reads as its title, a run as batches, with the partly count apart", () => {
  const fact = (status: string, operations = 2, partly = false, title = "Fade in") => ({ status, operations, partly, title });
  assert.deepEqual(planRunWords([fact("verified", 3)]), { text: "Fade in · 3 ops · verified", partly: 0 });
  assert.deepEqual(planRunWords([fact("verified", 5), fact("verified", 6), fact("failed", 2, true)]), {
    text: "Batches 1–3 · 13 ops · done",
    partly: 1,
  });
  assert.equal(runState([fact("prepared")]), "waiting for Apply");
  assert.equal(runState([fact("verified"), fact("prepared")]), "waiting for Apply", "waiting beats everything");
  assert.equal(runState([fact("draft")]), "drafting");
  assert.equal(runState([fact("applying")]), "applying");
  assert.equal(runState([fact("failed")]), "didn't apply");
  const run = [...Array.from({ length: 21 }, () => fact("verified")), fact("failed", 2, false, "Blur the title")];
  assert.equal(runState(run), "applied 21 of 22", "one failure among applied plans is not a run that did not apply");
  assert.match(planRunWords(run).text, /applied 21 of 22 · failed: Blur the title$/);
  assert.equal(doneItems({ verified: 1, total: 2, applied: 2 }), 2, "every plan applied in the turn counts");
  assert.equal(doneItems({ verified: 1, total: 5, applied: 2 }), 2);
  assert.equal(doneItems({ verified: 3, total: 5, applied: 1 }), 3);
  assert.equal(runState([fact("undone")]), "undone");
  assert.equal(runState([fact("cancelled")]), "discarded");
});

test("a change that wrote files outside the project says so in one short line", () => {
  const answer = decodeOrThrow(changesDecoder, {
    ok: true,
    project: { name: "P" },
    changes: [
      {
        planId: "r1",
        summary: "Render",
        status: "verified",
        operations: 1,
        files: [
          { path: "C:\\renders\\a.mov", operation: "render_composition" },
          { path: "/renders/b.png", operation: "export_frame" },
        ],
      },
      { planId: "r2", status: "verified" },
    ],
  });
  const rows = changeRows(answer, NOW);
  assert.equal(nth(rows, 0).filesLine, "Wrote 2 files outside the project: a.mov, b.png.");
  assert.equal(nth(rows, 1).filesLine, "");
  assert.equal(filesLine(["/a/1", "/a/2", "/a/3", "/a/4", "/a/5"]), "Wrote 5 files outside the project: 1, 2, 3, +2 more.");
});
