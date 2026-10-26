/**
 * Panel contract: learning the installed effects, the status bar's quietest state. It follows the sidecar's catalogue progress (health polling),
 * names a scratch-project hold as the reason new effects wait, speaks only at start, finish and when action is needed, and
 * goes away when there is nothing to say. The panel no longer reads whether the open project is saved, so only the host's
 * own "not-scratch-project" pause says an empty project is needed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPanelHarness } from "./contract.test.js";
import { element, nth } from "./contract-helpers.js";
import { type JsonObject } from "@extynt/decode";

type Progress = JsonObject | null;
const learning = (collected: number): JsonObject => ({
  state: "collecting",
  installed: 584,
  collected,
  pending: 584 - collected,
  failed: 0,
  deferred: 0,
  lastPageMs: 90,
  totalProbeMs: 0,
  probedThisRun: 0,
  pauseReason: null,
  outstanding: false,
});
const COMPLETE: JsonObject = { ...learning(584), state: "complete" };
const HINT = "3 new effects not learned yet — open a new empty project to learn them (a few seconds)";

function lineHarness() {
  const harness = createPanelHarness();
  const poll = (next: Progress): void => {
    harness.sidecar.health = { ...harness.sidecar.health, catalogue: next };
    harness.runIntervals((timer) => timer.ms === 5000);
  };
  return { harness, poll };
}
type Harness = ReturnType<typeof lineHarness>["harness"];
const bar = (harness: Harness) => element(harness, "status-bar");
const learningText = (harness: Harness): string =>
  bar(harness).getAttribute("data-state") === "learning" ? (bar(harness).querySelector(".bar-text")?.textContent ?? "") : "";
const spoken = (harness: Harness) => element(harness, "bar-announce").textContent;

test("learning is the lowest bar state, announced politely and not by the counting line", () => {
  const html = readFileSync("apps/panel/index.html", "utf8");
  const announce = html.match(/<span id="bar-announce"[^>]*>/)?.[0] ?? "";
  assert.match(announce, /role="status"/);
  assert.match(announce, /aria-live="polite"/);
  assert.equal(html.includes("catalogue-line"), false, "the separate line is gone: the bar carries it");
  assert.equal(html.includes("catalogue-announce"), false);
  const slot = html.match(/<section id="status-bar"[^>]*>/)?.[0] ?? "";
  assert.ok(html.indexOf('id="status-bar"') > html.indexOf('id="chat-output"'), "the bar is below the transcript, above the composer");
  assert.match(slot, /role="status"/);
});

test("the line appears with the count, updates as progress moves, and disappears when learning is done", () => {
  const { harness, poll } = lineHarness();
  assert.equal(bar(harness).getAttribute("data-state"), "idle", "idle until the sidecar reports something");
  poll(learning(212));
  assert.equal(learningText(harness), "Learning your effects… 212 / 584");
  assert.equal(spoken(harness), "Learning your effects. This runs in the background.", "start is announced once");
  element(harness, "bar-announce").textContent = "";
  poll(learning(300));
  assert.equal(learningText(harness), "Learning your effects… 300 / 584");
  assert.equal(spoken(harness), "", "a count moving is not announced");
  poll(COMPLETE);
  assert.equal(bar(harness).getAttribute("data-state"), "idle");
  assert.equal(spoken(harness), "Finished learning your effects.");
});

test("when the host holds collection back for a project that is not empty, the line says to open a new empty project", () => {
  const { harness, poll } = lineHarness();
  poll({ ...learning(581), state: "paused", pauseReason: "not-scratch-project" });
  assert.equal(learningText(harness), HINT);
  assert.match(spoken(harness), /^3 new effects not learned yet/, "needing action is announced");
  poll({ ...learning(581), state: "paused", pauseReason: "not-scratch-project" });
  assert.equal(learningText(harness), HINT, "still the same hint on the next poll");
});

test("the panel does not know whether the project is saved, so collecting progress always reads as learning", () => {
  const { harness, poll } = lineHarness();
  poll(learning(581));
  assert.equal(learningText(harness), "Learning your effects… 581 / 584");
});

test("a paused catalogue for any other reason says it stopped and that reopening the panel tries again", () => {
  const { harness, poll } = lineHarness();
  poll({ ...learning(100), state: "paused", pauseReason: "host-busy" });
  assert.equal(learningText(harness), "Learning your effects stopped at 100 / 584. extynt tries again by itself.");
});

test("a machine with no After Effects to learn in says so instead of counting forever", () => {
  const { harness, poll } = lineHarness();
  poll({ ...learning(6), installed: 448, pending: 442, engineHosts: 0 });
  assert.match(learningText(harness), /^Your effects can't be learned yet: extynt found no After Effects 2025 or later/);
  assert.equal(learningText(harness).includes("/ 448"), false);
  assert.match(spoken(harness), /^Your effects can't be learned yet/, "needing action is announced");
  poll({ ...learning(6), installed: 448, pending: 442, engineHosts: 1 });
  assert.equal(learningText(harness), "Learning your effects… 6 / 448", "an engine host exists: learning is true");
});

test("a sidecar that stops answering or reports no catalogue clears the line instead of leaving a stale count", () => {
  const { harness, poll } = lineHarness();
  poll(learning(100));
  assert.equal(bar(harness).getAttribute("data-state"), "learning");
  poll(null);
  assert.equal(bar(harness).getAttribute("data-state"), "idle");
  poll(learning(120));
  assert.equal(bar(harness).getAttribute("data-state"), "learning");
  const failing = createPanelHarness({ respond: (record) => (record.url.endsWith("/health") ? { fail: true } : undefined) });
  failing.runIntervals((timer) => timer.ms === 5000);
  assert.equal(element(failing, "status-bar").getAttribute("data-state"), "idle");
});

test("the poll is a plain GET /health every five seconds, and a hidden panel does not poll for it", () => {
  const { harness } = lineHarness();
  const before = harness.requestsTo("/health").length;
  assert.equal(harness.runIntervals((timer) => timer.ms === 5000) > 0, true, "a five-second poll is running");
  assert.equal(harness.requestsTo("/health").length, before + 1);
  assert.equal(nth(harness.requestsTo("/health"), -1).method, "GET");
  harness.document.hidden = true;
  harness.runIntervals((timer) => timer.ms === 5000);
  assert.equal(harness.requestsTo("/health").length, before + 1);
});
