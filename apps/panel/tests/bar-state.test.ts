/** The status bar as a pure derivation: which state wins, what each offers, and that Stop, Apply and Continue exist in one place. */
import assert from "node:assert/strict";
import test from "node:test";
import { barView, countOf, nextChangeMs, prettyClient, prettyTool, type BarInputs, type WaitingItem } from "../runtime/panel-bar.js";
import { decodeOrThrow } from "@extynt/decode";
import { jobIdDecoder } from "../runtime/ids.js";
import type { HostStatus } from "../runtime/ui-contract.js";
import type { UiJob, UiMcpCall } from "../runtime/ui-jobs.js";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const HOST: HostStatus = {
  state: "online",
  since: NOW - 60_000,
  pluginVersion: "0.1.0",
  aeVersion: "26.2",
  experimental: false,
  idleAgeMs: 10,
  stall: null,
  busyKind: null,
};
const IDLE: BarInputs = {
  reachable: true,
  unreachableMs: 0,
  host: HOST,
  hostSinceMs: 60_000,
  quarantine: null,
  modelConfigured: true,
  nowMs: NOW,
  job: null,
  turnOpen: false,
  progress: null,
  stop: null,
  calls: [],
  waiting: [],
  waitingAt: 0,
  learning: null,
  finished: null,
  project: "Aurora.aep",
  changeCount: 24,
  awaitingSnapshot: false,
};

function job(extra: Partial<UiJob> = {}): UiJob {
  const items = Array.from({ length: 60 }, (_, index) => ({
    id: "i" + index,
    title: "T",
    phase: index < 12 ? "layout" : "type",
    status: index < 18 ? ("verified" as const) : ("open" as const),
    verifiedAt: null,
  }));
  return {
    jobId: decodeOrThrow(jobIdDecoder, "job_1"),
    requestId: "r",
    goal: "Film",
    status: "working",
    via: "request",
    activity: "title card entrance",
    cycle: 3,
    step: 7,
    plansApplied: 4,
    plansNotApplied: 0,
    requestOpen: true,
    plans: [],
    startedAt: new Date(NOW - 41 * 60_000).toISOString(),
    waits: [],
    checklist: {
      items,
      phases: [
        { name: "layout", verified: 12, total: 12 },
        { name: "type", verified: 6, total: 48 },
      ],
      current: "i18",
    },
    specialists: [],
    ...extra,
  };
}
const call = (extra: Partial<UiMcpCall> = {}): UiMcpCall => ({
  id: 1,
  rev: 1,
  at: new Date(NOW).toISOString(),
  tool: "ae_propose_plan",
  client: "claude-code",
  args: "",
  state: "running",
  code: null,
  ms: null,
  planIds: [],
  ...extra,
});
const held = (extra: Partial<WaitingItem> = {}): WaitingItem => ({
  kind: "plan",
  id: "p1",
  title: "Batch 8",
  prompt: "Apply “Batch 8”?",
  detail: "Deletes 4 layers",
  source: "extynt",
  external: false,
  applyLabel: "Apply",
  choiceLabel: "",
  busy: false,
  note: "",
  ...extra,
});
const states = (inputs: Partial<BarInputs>): string => barView({ ...IDLE, ...inputs }).state;
const labels = (inputs: Partial<BarInputs>): string[] => barView({ ...IDLE, ...inputs }).actions.map((action) => action.label);

test("idle is a quiet strip that names the project and its changes", () => {
  const view = barView(IDLE);
  assert.deepEqual([view.state, view.tone, view.text, view.actions], ["idle", "quiet", "Ready · Aurora.aep · 24 changes", []]);
  assert.equal(barView({ ...IDLE, changeCount: 1 }).text, "Ready · Aurora.aep · 1 change");
  assert.equal(barView({ ...IDLE, project: null, changeCount: null }).text, "Ready");
});

test("paired but not yet read: the strip says it is waiting for the project, never Ready, and clears when the read lands", () => {
  const waiting = barView({ ...IDLE, awaitingSnapshot: true, project: null, changeCount: null });
  assert.deepEqual(
    [waiting.state, waiting.tone, waiting.text, waiting.sub, waiting.actions],
    ["idle", "quiet", "Waiting for the project", "extynt is reading After Effects", []],
  );
  assert.equal(
    barView({ ...IDLE, awaitingSnapshot: true, finished: { verified: 1, total: 1, partly: 0, changes: 1 } }).text,
    "Waiting for the project",
  );
  assert.equal(barView({ ...IDLE, awaitingSnapshot: false, project: null, changeCount: null }).text, "Ready");
  assert.equal(states({ awaitingSnapshot: true, modelConfigured: false }), "locked");
  assert.equal(states({ awaitingSnapshot: true, reachable: false, unreachableMs: 20_000 }), "offline");
});

const EVERYTHING: Partial<BarInputs> = {
  quarantine: { kind: "mutation" },
  reachable: false,
  unreachableMs: 20_000,
  waiting: [held()],
  modelConfigured: false,
  job: job(),
  turnOpen: true,
  calls: [call()],
  learning: { kind: "learning", text: "Learning your effects… 1 / 2" },
  finished: { verified: 1, total: 1, partly: 0, changes: 1 },
};

const CLEARINGS: ReadonlyArray<(inputs: Partial<BarInputs>) => Partial<BarInputs>> = [
  (inputs) => ({ ...inputs, quarantine: null }),
  (inputs) => ({ ...inputs, reachable: true, unreachableMs: 0 }),
  (inputs) => ({ ...inputs, waiting: [] }),
  (inputs) => ({ ...inputs, modelConfigured: true }),
  (inputs) => ({ ...inputs, job: null, turnOpen: false }),
  (inputs) => ({ ...inputs, calls: [] }),
  (inputs) => ({ ...inputs, learning: null }),
  (inputs) => ({ ...inputs, finished: null }),
];

test("the states win in this order: blocked, offline, needs you, locked, working, outside agent, learning, finished, idle", () => {
  const order = [states(EVERYTHING)];
  let remaining = EVERYTHING;
  for (const clear of CLEARINGS) {
    remaining = clear(remaining);
    order.push(states(remaining));
  }
  assert.deepEqual(order, ["blocked", "offline", "needs-you", "locked", "working", "outside", "learning", "finished", "idle"]);
});

test("blocked: a red alert, with What happened, and Stop only while something runs", () => {
  const quiet = barView({ ...IDLE, quarantine: { kind: "read" } });
  assert.deepEqual([quiet.tone, quiet.alert, quiet.actions.map((action) => action.label)], ["red", true, ["What happened"]]);
  assert.deepEqual(labels({ quarantine: { kind: "read" }, job: job() }), ["What happened", "Stop"]);
  const old = barView({ ...IDLE, host: { ...HOST, aeVersion: "24.6.0" } });
  assert.deepEqual([old.state, old.tone, old.alert], ["blocked", "red", true]);
});

test("offline: the helper down offers Try again; After Effects away keeps the job's Stop and its numbers; a dialog is grey with no button", () => {
  assert.equal(states({ reachable: false, unreachableMs: 2000 }), "idle", "a blink is not worth a state");
  assert.deepEqual(labels({ reachable: false, unreachableMs: 4000 }), [], "reconnecting offers nothing yet");
  assert.deepEqual(labels({ reachable: false, unreachableMs: 12_000 }), ["Try again"]);
  const away = barView({ ...IDLE, host: { ...HOST, state: "offline" }, hostSinceMs: 5000, job: job() });
  assert.deepEqual(
    [away.state, away.tone, away.text, away.sub, away.eta, away.count],
    ["offline", "grey", "Waiting for After Effects", "Job paused · 18/60 · cycle 3", "ETA resumes when connected", "18/60"],
  );
  assert.deepEqual(
    away.actions.map((action) => action.label),
    ["Stop"],
  );
  const busy = barView({
    ...IDLE,
    host: {
      ...HOST,
      state: "stalled",
      stall: { verdict: "ae-busy", waitedMs: 5000, idleAgeMs: 0, dialog: { title: "Select a LUT", sinceMs: 1 } },
    },
  });
  assert.deepEqual([busy.state, busy.tone, busy.actions.length], ["offline", "grey", 0]);
  assert.match(busy.text, /Select a LUT/);
});

test("needs you: amber, the decision's own buttons, a stepper when several wait, and Stop kept in the same bar", () => {
  const plan = barView({ ...IDLE, waiting: [held()], job: job(), turnOpen: true });
  assert.deepEqual([plan.state, plan.tone, plan.text, plan.sub], ["needs-you", "amber", "Apply “Batch 8”?", "Deletes 4 layers"]);
  assert.deepEqual(
    plan.actions.map((action) => action.label),
    ["Apply", "Discard", "Stop"],
  );
  assert.equal(plan.stepper, null);
  assert.equal(plan.count, "18/60", "the job keeps its count");
  assert.equal(plan.eta, "", "and shows no time left while it waits for the user");
  const two = barView({ ...IDLE, waiting: [held(), held({ id: "p2", prompt: "Apply “Batch 9”?" })], waitingAt: 1 });
  assert.deepEqual([two.text, two.stepper], ["Apply “Batch 9”?", { at: 2, of: 2 }]);
  const variant = barView({
    ...IDLE,
    waiting: [
      held({ kind: "variant", id: "s1", prompt: "Pick an easing", detail: "2 options", choiceLabel: "Use soft out", applyLabel: "" }),
    ],
  });
  assert.deepEqual(
    variant.actions.map((action) => action.label),
    ["Use soft out", "None of these"],
  );
  const pause = barView({ ...IDLE, waiting: [held({ kind: "pause", id: "job_1", prompt: "Paused after 40 steps", detail: "Continue" })] });
  assert.deepEqual(
    pause.actions.map((action) => action.label),
    ["Continue"],
  );
  const outside = barView({ ...IDLE, waiting: [held({ external: true, source: "Claude Code" })] });
  assert.match(outside.sub, /Claude Code/);
  assert.equal(outside.tone, "amber", "an outside agent's held plan still needs your Apply");
  const busy = barView({ ...IDLE, waiting: [held({ busy: true })] });
  assert.ok(busy.actions.every((action) => action.disabled === true));
});

test("setup: no model offers Set up; the advisories wait for quiet", () => {
  assert.deepEqual(labels({ modelConfigured: false }), ["Set up"]);
  assert.equal(states({ host: { ...HOST, experimental: true, aeVersion: "27.1" } }), "locked");
  assert.equal(states({ host: { ...HOST, experimental: true, aeVersion: "27.1" }, turnOpen: true }), "working");
});

test("working: the step, the count, Stop, the range of time left, and a dashed chip when an outside agent works too", () => {
  const view = barView({ ...IDLE, job: job(), turnOpen: true, calls: [call()] });
  assert.deepEqual(
    [view.state, view.tone, view.text, view.count, view.chip, view.title],
    ["working", "accent", "title card entrance", "18/60 · cycle 3 · step 7", "Claude Code", "Working"],
  );
  assert.equal(view.meta, "cycle 3 · 41 min");
  assert.deepEqual(
    view.actions.map((action) => action.label),
    ["Stop"],
  );
  assert.deepEqual(
    view.segments,
    [
      { name: "layout", verified: 12, total: 12 },
      { name: "type", verified: 6, total: 48 },
    ],
    "the progress edge is segmented by phase",
  );
  assert.equal(barView({ ...IDLE, turnOpen: true }).text, "Thinking…");
  assert.equal(barView({ ...IDLE, turnOpen: true, progress: { label: "Reading the composition", step: 2 } }).count, "step 2");
  const stopping = barView({ ...IDLE, job: job(), stop: { phase: "stopping", text: "Stopping…" } });
  assert.deepEqual([stopping.sub, stopping.actions.map((action) => [action.label, action.disabled])], ["Stopping…", [["Stopping…", true]]]);
});

test("outside agent alone: dashed, named, watching, with no Stop", () => {
  const view = barView({ ...IDLE, calls: [call({ tool: "ae_inspect_composition" })] });
  assert.deepEqual(
    [view.state, view.tone, view.text, view.sub, view.actions.length],
    ["outside", "dashed", "Claude Code · inspect composition", "watching", 0],
  );
  assert.equal(states({ calls: [call({ state: "ok" })] }), "idle", "a finished call is not working");
  assert.equal(prettyClient("claude-code"), "Claude Code");
  assert.equal(prettyTool("ae_propose_plan"), "propose plan");
});

test("finished and the stop's own words settle the bar", () => {
  const done = barView({ ...IDLE, finished: { verified: 60, total: 60, partly: 2, changes: 22 } });
  assert.deepEqual([done.state, done.text, done.sub], ["finished", "Done", "60/60 · 2 items partly applied"]);
  assert.equal(barView({ ...IDLE, finished: { verified: 0, total: 0, partly: 0, changes: 3 } }).sub, "3 changes");
  const stopped = barView({
    ...IDLE,
    stop: { phase: "stopped", text: "Stopped. Anything already applied is listed above and can be undone." },
    finished: { verified: 1, total: 2, partly: 0, changes: 1 },
  });
  assert.deepEqual([stopped.state, stopped.text], ["idle", "Stopped. Anything already applied is listed above and can be undone."]);
});

test("exactly one Stop, and Apply, Discard and Continue only in a needs-you bar", () => {
  const everyAction = (view: ReturnType<typeof barView>): string[] => view.actions.map((action) => action.id);
  const withStop = [
    barView({ ...IDLE, job: job() }),
    barView({ ...IDLE, job: job(), waiting: [held()] }),
    barView({ ...IDLE, job: job(), host: { ...HOST, state: "offline" }, hostSinceMs: 9000 }),
    barView({ ...IDLE, job: job(), quarantine: { kind: "read" } }),
  ];
  for (const view of withStop) assert.equal(everyAction(view).filter((id) => id === "stop").length, 1, view.state);
  for (const view of [
    barView(IDLE),
    barView({ ...IDLE, calls: [call()] }),
    barView({ ...IDLE, finished: { verified: 1, total: 1, partly: 0, changes: 1 } }),
  ])
    assert.equal(everyAction(view).includes("stop"), false, view.state);
  const decisions = new Set(["apply", "discard", "continue", "use-variant", "variant-none"]);
  for (const view of [...withStop, barView(IDLE), barView({ ...IDLE, job: job() })])
    assert.equal(view.state === "needs-you" || !everyAction(view).some((id) => decisions.has(id)), true, view.state);
});

test("the bar's clock: the reconnect words turn into the helper words with no event, and a quiet bar sets no timer", () => {
  const down = { ...IDLE, reachable: false, unreachableMs: 4000 };
  assert.equal(nextChangeMs(down, barView(down)), 6000);
  const brief = { ...IDLE, reachable: false, unreachableMs: 500 };
  assert.equal(nextChangeMs(brief, barView(brief)), 2500);
  assert.equal(nextChangeMs(IDLE, barView(IDLE)), null);
  assert.equal(countOf(null), "");
});
