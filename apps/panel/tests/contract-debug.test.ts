/** Panel contract: the Developer page (status grid, event tail, host census, effect catalogue, telemetry), the diagnostics export, and the chat-log save on the Chats page. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { StubElement } from "./contract-dom.js";
import { chatResponder, element, jobPayload, nth } from "./contract-helpers.js";
import { createPanelHarness, type PanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { readJson } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const html = readFileSync("apps/panel/index.html", "utf8");
const text = (harness: PanelHarness, id: string): string => element(harness, id).textContent;
const json = (value: JsonValue, status = 200): StubResponse => ({ status, text: JSON.stringify(value) });
const only =
  (suffix: string, answer: StubResponse) =>
  (record: StubRequestRecord): StubResponse | undefined =>
    record.url.endsWith(suffix) ? answer : undefined;
const hostEvent = (host: JsonObject): JsonObject => ({
  host: { state: "online", since: 1, pluginVersion: "0.1.0", aeVersion: "26.2", idleAgeMs: 10, stall: null, busyKind: null, ...host },
  hostInstanceId: "native:1:1",
  nativeAccessQuarantine: null,
});
const focus = (selected: number): JsonObject => ({
  project: "Fixture.aep",
  compositionId: "comp-1",
  compositionName: "Main",
  selected,
  layerNames: [],
  kinds: [],
  selectionFingerprint: null,
  at: 1,
});
const openDebug = (harness: PanelHarness): StubElement => {
  harness.click("open-settings");
  harness.click("open-developer");
  return element(harness, "page");
};

test("the Developer page shows its own panel, and its back arrow returns to Settings", () => {
  const harness = createPanelHarness();
  openDebug(harness);
  assert.deepEqual(
    harness.document.panels.filter((panel) => !panel.hidden).map((panel) => panel.getAttribute("data-panel")),
    ["debug"],
  );
  assert.equal(text(harness, "page-title"), "Developer");
  harness.click("page-back");
  assert.equal(text(harness, "page-title"), "Settings");
  assert.equal(element(harness, "page").classList.has("open"), true);
  harness.click("page-back");
  assert.equal(element(harness, "page").classList.has("open"), false);
});

test("the status grid names the sidecar, the versions in play, what After Effects has open and the host link", () => {
  const harness = createPanelHarness();
  harness.window.__EXTYNT_PRODUCT_VERSION__ = "0.1.0";
  harness.sse("host", hostEvent({}));
  assert.equal(text(harness, "diag-sidecar"), "Connected · 0.1.0");
  assert.equal(text(harness, "diag-product"), "UI 0.1.0 · plugin 0.1.0 · After Effects 26.2");
  assert.equal(text(harness, "diag-snapshot"), "Fixture.aep", "the project, until a composition is open");
  assert.equal(text(harness, "diag-host"), "online · plugin 0.1.0 · idle 0 s");
  harness.sse("focus", { focus: focus(2) });
  assert.equal(text(harness, "diag-snapshot"), "Main · 2 selected");
});

test("a stalled host shows its verdict and how long it has waited", () => {
  const harness = createPanelHarness();
  harness.sse("host", hostEvent({ state: "stalled", idleAgeMs: 9000, stall: { verdict: "ae-busy", waitedMs: 12000, idleAgeMs: 9000 } }));
  assert.equal(text(harness, "diag-host"), "stalled · plugin 0.1.0 · idle 9 s · ae-busy (12 s)");
});

test("losing the sidecar shows Not reachable", () => {
  const harness = createPanelHarness();
  harness.dropStream();
  assert.equal(text(harness, "diag-sidecar"), "Not reachable");
});

test("Save chat log posts the export and shows where it went, with no file picker", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.sessions.set("s1", {
        id: "s1",
        title: "One",
        project: null,
        createdAt: 1,
        updatedAt: 1,
        messages: [{ kind: "user", text: "hi" }],
      });
    },
  });
  harness.click("chat-history-export");
  const posts = harness.requestsTo("/v1/ui/chat-logs/export");
  assert.equal(posts.length, 1);
  assert.equal(nth(posts, 0).method, "POST");
  assert.equal(harness.window.showSaveFilePicker, undefined, "the panel has no picker to open");
  assert.equal(element(harness, "chats-result").hidden, false);
  assert.equal(text(harness, "chats-result"), "Saved 1 chats to /tmp/extynt/Chat Logs/export.jsonl");
  assert.equal(
    html.indexOf("chat-history-export") > html.indexOf('data-panel="chats"') &&
      html.indexOf("chat-history-export") < html.indexOf('data-panel="settings"'),
    true,
    "the chat log is saved from the Chats page, not Settings",
  );
});

test("a chat log the sidecar cannot save shows its reason", () => {
  const harness = createPanelHarness({
    respond: only("/v1/ui/chat-logs/export", json({ ok: false, error: { message: "The disk is full." } }, 500)),
  });
  harness.click("chat-history-export");
  assert.equal(text(harness, "chats-result"), "The disk is full.");
});

test("Read installed effects and fonts posts the census and shows what came back", () => {
  const harness = createPanelHarness({ respond: only("/v1/host/census", json({ ok: true, effects: 312, fonts: 1840 })) });
  harness.click("host-capabilities");
  assert.equal(nth(harness.requestsTo("/v1/host/census"), 0).method, "POST");
  assert.deepEqual(readJson(text(harness, "activity-list")), { ok: true, effects: 312, fonts: 1840 });
});

test("a census the sidecar refuses with 501 shows the refusal in words", () => {
  const harness = createPanelHarness({
    respond: only(
      "/v1/host/census",
      json({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "Reading installed effects is not available in this build." } }, 501),
    ),
  });
  harness.click("host-capabilities");
  assert.equal(text(harness, "activity-list"), "Reading installed effects is not available in this build.");
});

test("Build effect catalogue starts it and reports how far it has got", () => {
  const progress = { state: "running", collected: 12, installed: 40, pending: 27, failed: 1 };
  const harness = createPanelHarness({ respond: only("/v1/catalogue/start", json({ ok: true, progress })) });
  harness.click("catalogue-build");
  assert.equal(nth(harness.requestsTo("/v1/catalogue/start"), 0).method, "POST");
  assert.equal(text(harness, "catalogue-progress"), "Effect catalogue: 12 of 40 effects collected, 27 pending, 1 skipped.");
});

test("a catalogue that has no census yet says it is waiting for one", () => {
  const harness = createPanelHarness({ respond: only("/v1/catalogue/start", json({ ok: true, progress: { state: "idle" } })) });
  harness.click("catalogue-build");
  assert.equal(text(harness, "catalogue-progress"), "Effect catalogue: waiting for the first installed-effects census.");
});

test("the controls of the old connection plumbing, the activity log and the usage stats are gone from the page", () => {
  for (const id of [
    "endpoint",
    "token",
    "test-bridge",
    "transport-debug",
    "probe",
    "heartbeat-dot",
    "benchmark-capture-export",
    "workflow-lease",
    "diag-queue",
    "output",
    "activity-log",
    "usage-stats",
    "help-status",
  ])
    assert.equal(html.includes('id="' + id + '"'), false, id);
});

test("the event tail shows event names and ids only, never a prompt, an answer or reasoning", () => {
  const harness = createPanelHarness();
  harness.sse("activity", {
    jobs: [jobPayload({ jobId: "job_8f2a41", goal: "SECRET GOAL TEXT", activity: "SECRET ACTIVITY", requestOpen: true })],
  });
  harness.sse("mcp", {
    calls: [
      {
        id: 142,
        rev: 1,
        at: "2026-10-15T10:00:00.000Z",
        tool: "ae_propose_plan",
        client: "claude-code",
        args: "SECRET ARGS",
        state: "running",
        code: null,
        ms: null,
        planIds: [],
      },
    ],
  });
  harness.sse("change", { seq: 218, reason: "state", planId: "plan_3c9" });
  const tail = text(harness, "event-tail");
  assert.match(tail, /activity job_8f2a41 working/);
  assert.match(tail, /mcp #142 ae_propose_plan running/);
  assert.match(tail, /change plan_3c9/);
  assert.doesNotMatch(tail, /SECRET/);
});

const rowsOf = (harness: PanelHarness): string[] => element(harness, "request-history").childNodes.map((node) => node.textContent);

test("the request log lists what the panel asked of the sidecar, with how long each took", () => {
  const harness = createPanelHarness({ respond: chatResponder(() => ({ answer: "Done." })) });
  harness.send("hello");
  openDebug(harness);
  assert.ok(rowsOf(harness).some((row) => /POST \/v1\/chat \(\d+ ms\) ok$/.test(row)));
  assert.match(text(harness, "telemetry-display"), /^Requests \d+ · errors 0 · model calls/);
});

test("a request that failed is marked and counted", () => {
  const harness = createPanelHarness({ respond: only("/v1/chat", json({ ok: false, error: { message: "The model timed out." } }, 500)) });
  harness.send("hello");
  openDebug(harness);
  assert.ok(rowsOf(harness).some((row) => /POST \/v1\/chat \(\d+ ms\) failed$/.test(row)));
  assert.match(text(harness, "telemetry-display"), /^Requests \d+ · errors 1 ·/);
});
