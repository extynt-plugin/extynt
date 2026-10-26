/** Panel contract: the live stream. Frames, events, the poll and reconnects while it is down, the watchdog, and a 401. */
import assert from "node:assert/strict";
import test from "node:test";
import { bar, buttonsNamed, focusPayload, harnessWithPlanCard, hostEventBody, nth, openedChange, planCard, required, toolCalls } from "./contract-helpers.js";
import { createPanelHarness, PNG, type PanelHarness } from "./contract.test.js";

const FOCUS = focusPayload();
function hostText(harness: PanelHarness): string {
  return harness.el("diag-host")?.textContent ?? "";
}
function chipText(harness: PanelHarness): string {
  return harness.el("context-chip")?.querySelector(".ctx-chip-text")?.textContent ?? "";
}
function eventRequests(harness: PanelHarness): number {
  return harness.requestsTo("/v1/ui/events").length;
}
function lists(harness: PanelHarness): number {
  return toolCalls(harness, "ae_list_plans").length;
}
function round(harness: PanelHarness, ms: number): number {
  return harness.runTimeouts((timer) => timer.ms === ms);
}

test("the stream opens once after the bootstrap, with the bearer and an event-stream Accept", () => {
  const harness = createPanelHarness();
  const events = harness.requestsTo("/v1/ui/events");
  assert.equal(events.length, 1);
  assert.equal(nth(events, 0).method, "GET");
  assert.equal(nth(events, 0).headers.Authorization, "Bearer test-token");
  assert.equal(nth(events, 0).headers.Accept, "text/event-stream");
  assert.ok(
    harness.requests.indexOf(nth(events, 0)) > harness.requests.indexOf(nth(harness.requestsTo("/v1/ui/bootstrap"), 0)),
    "after the bootstrap",
  );
  harness.sse("host", hostEventBody("online"));
  assert.equal(eventRequests(harness), 1, "events do not open another stream");
});

test("no stream opens when the bootstrap cannot be read", () => {
  const harness = createPanelHarness({ respond: (record) => (record.url.endsWith("/v1/ui/bootstrap") ? { fail: true } : undefined) });
  assert.equal(harness.streamCount(), 0);
  assert.equal(eventRequests(harness), 0);
});

test("a frame split across chunks, even mid-field, is delivered whole and once", () => {
  const harness = createPanelHarness();
  const frame = "event: focus\ndata: " + JSON.stringify({ focus: FOCUS }) + "\n\n";
  harness.sseRaw(frame.slice(0, 12));
  assert.equal(chipText(harness), "No composition open");
  harness.sseRaw(frame.slice(12, 40));
  harness.sseRaw(frame.slice(40));
  assert.equal(chipText(harness), "Main · TITLE");
});

test("CRLF line endings, split between the CR and the LF, work like LF", () => {
  const harness = createPanelHarness();
  const body = JSON.stringify({ focus: { ...FOCUS, layerNames: ["LOGO"] } });
  harness.sseRaw("event: focus\r\ndata: " + body + "\r\n\r");
  assert.equal(chipText(harness), "No composition open", "the frame is not finished yet");
  harness.sseRaw("\n");
  assert.equal(chipText(harness), "Main · LOGO");
});

test("data without a space after the colon, and two frames in one chunk, are both read", () => {
  const harness = createPanelHarness();
  const first = "event: focus\ndata:" + JSON.stringify({ focus: FOCUS }) + "\n\n";
  const second =
    "event: host\ndata:" +
    JSON.stringify(
      hostEventBody("stalled", { pluginVersion: null, idleAgeMs: null, stall: { verdict: "slow", waitedMs: 8000, idleAgeMs: null } }),
    ) +
    "\n\n";
  harness.sseRaw(first + second);
  assert.equal(chipText(harness), "Main · TITLE");
  assert.match(hostText(harness), /^stalled · slow \(8 s\)$/);
});

test("comments, keepalives and frames without data change nothing", () => {
  const harness = createPanelHarness();
  const before = harness.requests.length;
  harness.sseRaw(": keepalive\n\n");
  harness.sseRaw("retry: 1000\n\n");
  harness.sseRaw("event: host\n\n");
  harness.sseRaw(": hello\nevent: focus\ndata: " + JSON.stringify({ focus: FOCUS }) + "\n\n");
  assert.equal(chipText(harness), "Main · TITLE", "a comment line inside a frame does not spoil it");
  assert.equal(harness.requests.length, before);
});

test("unknown events, malformed JSON and payloads of the wrong shape are ignored, and the next good frame still lands", () => {
  const harness = createPanelHarness();
  const before = hostText(harness);
  harness.sse("surprise", { anything: true });
  harness.sseRaw("event: host\ndata: {not json\n\n");
  harness.sse("host", { host: { state: "exploding" } });
  harness.sse("host", "text");
  harness.sse("undo", { planId: 7 });
  harness.sse("thumbs", {});
  harness.sse("focus", { focus: { project: 3 } });
  assert.equal(hostText(harness), before);
  assert.equal(chipText(harness), "No composition open");
  harness.sse("host", hostEventBody("offline"));
  assert.match(hostText(harness), /^offline/);
});

test("a host event updates the host in Developer and the bar, and the instance every later request names", () => {
  const harness = createPanelHarness();
  assert.match(hostText(harness), /^online · plugin 0\.1\.0/);
  harness.sse(
    "host",
    hostEventBody(
      "stalled",
      { idleAgeMs: 9000, stall: { verdict: "ae-busy", waitedMs: 12000, idleAgeMs: 9000 }, busyKind: "modal" },
      { hostInstanceId: "native:2:1" },
    ),
  );
  assert.equal(hostText(harness), "stalled · plugin 0.1.0 · idle 9 s · ae-busy (12 s)");
  assert.equal(bar(harness).state, "offline");
  assert.equal(bar(harness).tone, "grey");
  harness.send("hello");
  assert.equal(nth(harness.requestsTo("/v1/chat"), 0).headers["X-AE-Panel-Instance"], "native:2:1");
});

test("a focus event updates the context chip, and a focus with no composition shows that", () => {
  const harness = createPanelHarness();
  harness.sse("focus", { focus: FOCUS });
  assert.equal(chipText(harness), "Main · TITLE");
  harness.sse("focus", { focus: { ...FOCUS, selected: 3, layerNames: ["A", "B", "C"] } });
  assert.equal(chipText(harness), "Main · 3 layers");
  harness.sse("focus", { focus: null });
  assert.equal(chipText(harness), "No composition open");
});

test("a change event reads the plan list again", () => {
  const harness = createPanelHarness();
  const before = lists(harness);
  harness.sse("change", { seq: 5, reason: "plan", planId: "p1" });
  assert.equal(lists(harness), before + 1);
});

test("a change event reads the changes list, which the bar's count and the sheet both show", () => {
  const harness = createPanelHarness();
  const reads = (): number => harness.requestsTo("/v1/changes").length;
  const before = reads();
  harness.sse("change", { seq: 1, reason: "state", planId: null });
  assert.equal(reads(), before + 1);
  harness.click("bar-main");
  const opened = reads();
  assert.ok(opened > before, "opening the sheet reads once");
  harness.sse("change", { seq: 2, reason: "state", planId: null });
  assert.equal(reads(), opened + 1);
});

test("an undo event enables or disables Undo on the change's row, with the reason", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  required(required(harness.el("status-bar")).find((node) => node.tagName === "BUTTON" && node.textContent === "Apply")).click();
  assert.equal(nth(buttonsNamed(openedChange(harness), "Undo"), 0).disabled, false);
  harness.sse("undo", { planId: "p1", undo: { available: false, reason: "the project changed after this was applied" } });
  assert.equal(nth(buttonsNamed(openedChange(harness), "Undo"), 0).disabled, true);
  harness.sse("undo", { planId: "p1", undo: { available: true, reason: null } });
  assert.equal(nth(buttonsNamed(openedChange(harness), "Undo"), 0).disabled, false);
});

test("a thumbs event fills the receipt's frames from the sidecar", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  required(required(harness.el("status-bar")).find((node) => node.tagName === "BUTTON" && node.textContent === "Apply")).click();
  assert.equal(openedChange(harness).all((node) => node.tagName === "IMG").length, 0);
  harness.sidecar.thumbs.set("p1", { before: PNG, after: PNG });
  harness.sse("thumbs", { planId: "p1" });
  assert.equal(openedChange(harness).all((node) => node.tagName === "IMG").length, 2);
});

test("when the stream drops, the bootstrap is polled every second and the stream is retried after one second", () => {
  const harness = createPanelHarness();
  harness.sse("host", hostEventBody("online"));
  const polls = (): number => harness.requestsTo("/v1/ui/bootstrap").length;
  const base = polls();
  harness.dropStream();
  assert.equal(harness.streamCount(), 0);
  assert.equal(harness.pendingTimeouts().filter((timer) => timer.ms === 1000).length, 2, "one poll and one reconnect");
  assert.equal(round(harness, 1000), 2);
  assert.equal(polls(), base + 1);
  assert.equal(harness.streamCount(), 1, "the reconnect opened a new stream");
  assert.equal(round(harness, 1000), 1, "the stream has said nothing yet, so the poll goes on");
  assert.equal(polls(), base + 2);
});

test("the poll keeps the panel current while the stream is down", () => {
  const harness = createPanelHarness();
  harness.dropStream();
  harness.sidecar.focus = FOCUS;
  harness.sidecar.host = { ...harness.sidecar.host, state: "offline" };
  round(harness, 1000);
  assert.equal(chipText(harness), "Main · TITLE");
  assert.match(hostText(harness), /^offline/);
});

test("the poll stops once the stream is back", () => {
  const harness = createPanelHarness();
  harness.dropStream();
  round(harness, 1000);
  harness.sseRaw(": ready\n\n");
  const polls = harness.requestsTo("/v1/ui/bootstrap").length;
  assert.equal(round(harness, 1000), 1, "the last poll timer fires");
  assert.equal(harness.requestsTo("/v1/ui/bootstrap").length, polls, "and reads nothing");
  assert.equal(harness.pendingTimeouts().filter((timer) => timer.ms === 1000).length, 0, "and does not reschedule");
});

test("reconnects wait one second, then two, then five, and stay at five", () => {
  const harness = createPanelHarness();
  for (const expected of [1000, 2000, 5000, 5000]) {
    harness.dropStream();
    assert.equal(harness.streamCount(), 0);
    const retry = harness.pendingTimeouts().find((timer) => timer.ms === expected);
    assert.ok(retry, "a reconnect after " + expected + " ms");
    assert.equal(retry.ms, expected);
    harness.runTimeouts((timer) => timer.ms === expected);
    assert.equal(harness.streamCount(), 1, "reconnected after " + expected + " ms");
  }
  assert.equal(
    harness.pendingTimeouts().filter((timer) => timer.ms > 5000 && timer.ms < 45000).length,
    0,
    "never longer than five seconds",
  );
});

test("a stream that comes back resets the waits to one second", () => {
  const harness = createPanelHarness();
  harness.dropStream();
  round(harness, 1000);
  harness.dropStream();
  round(harness, 2000);
  harness.sseRaw(": ready\n\n");
  harness.dropStream();
  assert.ok(
    harness.pendingTimeouts().some((timer) => timer.ms === 1000),
    "back to one second",
  );
  assert.equal(harness.pendingTimeouts().filter((timer) => timer.ms === 5000).length, 0);
});

test("a stream that ends cleanly is reconnected like one that failed", () => {
  const harness = createPanelHarness();
  harness
    .held()
    .find((xhr) => xhr.url.endsWith("/v1/ui/events") && !xhr.ended)
    ?.respond(200, "");
  assert.equal(harness.streamCount(), 0);
  round(harness, 1000);
  assert.equal(harness.streamCount(), 1);
});

test("a silent stream is aborted after 45 seconds and reconnected", () => {
  const harness = createPanelHarness();
  harness.sseRaw(": keepalive\n\n");
  harness.sseRaw(": keepalive\n\n");
  assert.equal(harness.pendingTimeouts().filter((timer) => timer.ms === 45000).length, 1, "one watchdog, restarted by each frame");
  assert.equal(round(harness, 45000), 1);
  assert.equal(harness.streamCount(), 0, "the silent stream was aborted");
  assert.equal(harness.held().filter((xhr) => xhr.url.endsWith("/v1/ui/events") && xhr.aborted).length, 1);
  round(harness, 1000);
  assert.equal(harness.streamCount(), 1);
  assert.equal(eventRequests(harness), 2);
});

test("a 401 on the stream reloads the page and does not reconnect", () => {
  const harness = createPanelHarness();
  harness
    .held()
    .find((xhr) => xhr.url.endsWith("/v1/ui/events") && !xhr.ended)
    ?.respond(401, '{"ok":false}');
  assert.equal(harness.reloads(), 1);
  assert.equal(harness.streamCount(), 0);
  assert.equal(
    harness.pendingTimeouts().filter((timer) => timer.ms === 1000).length,
    0,
    "the reload brings a fresh token and a fresh stream",
  );
});
