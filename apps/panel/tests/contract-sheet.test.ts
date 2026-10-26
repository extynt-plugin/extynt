/**
 * Panel contract: the sheet that lifts from the status bar. Sections appear only when non-empty (Waiting for you, Now, Needs a
 * look, Checklist, Changes, Connection, spend); the bar is its header, so there is still one Stop and one Apply; reads happen on
 * events, never on a timer.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { allButtonsFor, bar, barButton, element, holdChat, noticeTexts, nth, openSheet, required, sheetTitles, textsOf, toolCalls } from "./contract-helpers.js";
import { fieldOf } from "./json-narrow.js";
import { ago, change, reads, waiting, waitingRows, withState } from "./contract-sheet-fixtures.js";
const html = readFileSync("apps/panel/index.html", "utf8");

test("an idle panel's sheet is nearly empty: the bar is the door, and no section is invented", () => {
  const harness = withState([]);
  const sheet = openSheet(harness);
  assert.equal(sheet.hidden, false);
  assert.deepEqual(sheetTitles(harness), []);
  assert.match(sheet.textContent, /Nothing is running\./);
  assert.equal(element(harness, "status-zone").getAttribute("data-open"), "true");
  assert.equal(element(harness, "app").getAttribute("data-sheet"), "open");
  element(harness, "bar-main").click();
  assert.equal(sheet.hidden, true, "pressing the bar again closes it");
  assert.equal(element(harness, "app").getAttribute("data-sheet"), "closed");
});

test("Waiting for you lists the plans that need an answer, with title, who proposed it and how long ago", () => {
  const harness = withState([
    waiting("a1", "Fade the logo in"),
    waiting("a2", "Parent the layers", { status: "presented", source: "claude-code", updatedAt: ago(2 * 3600000) }),
    waiting("v1", "Pick a blur", { variantSetId: "set-1" }),
    waiting("d1", "Already applied", { status: "verified" }),
  ]);
  const rows = waitingRows(harness);
  assert.deepEqual(sheetTitles(harness)[0], "Waiting for you · 2");
  assert.deepEqual(
    rows.map((row) => textsOf(row, "sheet-item-title")[0]),
    ["Fade the logo in", "Parent the layers"],
    "no variant option and nothing already applied",
  );
  assert.match(nth(rows, 0).textContent, /Source: extynt · asked 3 min ago/);
  assert.match(nth(rows, 1).textContent, /Source: claude-code · asked 2 h ago/);
  assert.deepEqual(
    rows.map((row) => textsOf(row, "sheet-item-next")[0]),
    [undefined, "next"],
    "the one the bar names is current; the other is next in line",
  );
  assert.deepEqual(bar(harness).actions, ["Apply", "Discard"]);
  assert.equal(bar(harness).state, "needs-you");
});

test("with two waiting the buttons act on the one named, and 1 of 2 steps to the next", () => {
  const harness = withState([waiting("a1", "Fade the logo in"), waiting("a2", "Parent the layers")]);
  assert.match(bar(harness).text, /Fade the logo in/);
  const stepper = required(element(harness, "status-bar").find((node) => node.classList.has("bar-step")));
  assert.equal(stepper.textContent, "1 of 2");
  stepper.click();
  assert.match(bar(harness).text, /Parent the layers/);
  assert.equal(required(element(harness, "status-bar").find((node) => node.classList.has("bar-step"))).textContent, "2 of 2");
  required(barButton(harness, "discard")).click();
  assert.deepEqual(
    toolCalls(harness, "ae_cancel_plan").map((call) => fieldOf(call, "planId")),
    ["a2"],
    "Discard acted on the one named",
  );
});

test("with nothing waiting there is no Waiting section", () => {
  const harness = withState([waiting("d1", "Applied", { status: "verified" })]);
  assert.equal(
    sheetTitles(harness).some((title) => title.startsWith("Waiting")),
    false,
  );
  assert.equal(bar(harness).state, "idle");
});

test("Apply sends the approval as the panel, once, and the plan leaves Waiting once it is applied", () => {
  const harness = withState([waiting("a1", "Fade the logo in")]);
  required(barButton(harness, "apply")).click();
  const [call] = toolCalls(harness, "ae_approve_plan");
  assert.equal(fieldOf(required(call), "planId"), "a1");
  assert.equal(fieldOf(required(call), "acknowledgeUnverified"), undefined);
  assert.equal(
    required(harness.requestsTo("/v1/mcp/tools/call").find((record) => record.body.includes("ae_approve_plan"))).headers["X-AE-Client"],
    "panel",
  );
  assert.equal(waitingRows(harness).length, 0);
  assert.equal(allButtonsFor(harness, "Apply").length, 0);
});

test("a plan that cannot be fully checked says so on the bar's button, and one press carries the acknowledgement", () => {
  const unchecked = waiting("a1", "Set an expression", {
    presentation: {
      title: "Set an expression",
      values: [],
      warnings: [],
      notices: [{ severity: "unverified", title: "Can't be checked", detail: "", operationIndexes: [0, 1] }],
      verification: { requiresAcknowledgement: true },
    },
  });
  const harness = withState([unchecked]);
  assert.equal(required(barButton(harness, "apply")).textContent, "Apply (2 unchecked)");
  required(barButton(harness, "apply")).click();
  assert.equal(fieldOf(nth(toolCalls(harness, "ae_approve_plan"), 0), "acknowledgeUnverified"), true);
});

test("an Apply the sidecar refuses stays waiting with the reason", () => {
  const harness = withState([waiting("a1", "Fade the logo in")], [], {
    sidecar: (sidecar) => {
      sidecar.approve = () => ({
        status: 409,
        text: JSON.stringify({ ok: false, error: { code: "STALE_SNAPSHOT", message: "The project changed." } }),
      });
    },
  });
  required(barButton(harness, "apply")).click();
  assert.match(bar(harness).sub, /Couldn't apply: The project changed\./);
  assert.equal(waitingRows(harness).length, 1);
});

test("the bar's count of waiting plans counts only the plans waiting for the reader", () => {
  const harness = withState([
    waiting("a1", "One"),
    waiting("a2", "Two"),
    waiting("v1", "Option", { variantSetId: "s" }),
    waiting("d1", "Done", { status: "verified" }),
  ]);
  assert.equal(required(element(harness, "status-bar").find((node) => node.classList.has("bar-step"))).textContent, "1 of 2");
  required(barButton(harness, "discard")).click();
  assert.equal(
    element(harness, "status-bar").find((node) => node.classList.has("bar-step")),
    null,
    "one left: no stepper",
  );
  required(barButton(harness, "discard")).click();
  assert.equal(bar(harness).state, "idle");
  assert.equal(harness.el("plans-badge"), null, "the Activity icon and its badge are gone");
  assert.equal(harness.el("open-history"), null);
});

test("reads happen when something changes, never on a timer", () => {
  const harness = withState([], [change("c1")]);
  const quiet = reads(harness);
  harness.runIntervals((timer) => timer.ms !== 15000 && timer.ms !== 5000 && timer.ms !== 10000);
  assert.deepEqual(reads(harness), quiet, "no timer reads plans or changes");
  harness.sse("change", { seq: 1, reason: "plan", planId: null });
  assert.equal(reads(harness).plans, quiet.plans + 1, "a change refreshes the plan list");
  assert.equal(reads(harness).changes, quiet.changes + 1, "and the changes list, which the bar's count and the sheet both show");
  const open = reads(harness);
  harness.sse("change", { seq: 2, reason: "plan", planId: null });
  assert.equal(reads(harness).changes, open.changes + 1);
  assert.equal(reads(harness).plans, open.plans + 1);
});

test("a plan an outside agent proposes is not announced in the chat: the bar is amber and the sheet lists it", () => {
  const harness = withState([]);
  harness.sidecar.plans.push(waiting("n1", "Add a vignette", { source: "claude-code" }));
  harness.sse("change", { seq: 1, reason: "plan", planId: "n1" });
  assert.deepEqual(noticeTexts(harness), [], "no second surface in the thread");
  assert.equal(bar(harness).state, "needs-you");
  assert.match(bar(harness).sub, /claude-code/);
  assert.equal(waitingRows(harness).length, 1);
});

test("nothing is announced while a turn is running either", () => {
  const harness = withState([], [], { respond: holdChat });
  harness.send("start");
  harness.sidecar.plans.push(waiting("n1", "During the turn"));
  harness.sse("change", { seq: 1, reason: "plan", planId: "n1" });
  assert.deepEqual(noticeTexts(harness), []);
});

test("the old Plans list, the Activity tab and the Changes section of the Chats page are gone from the markup", () => {
  for (const id of [
    "plans-list",
    "refresh-plans",
    "changes-list",
    "changes-note",
    "changes-project",
    "changes-section",
    "changes-status",
    "waiting-list",
    "activity-changes",
    "activity-project",
    "open-history",
    "plans-badge",
    "drawer-tabs",
    "status-banner",
    "state-note",
    "catalogue-line",
    "chat-live",
    "main-tabs",
    "suggestions",
  ])
    assert.equal(html.includes('id="' + id + '"'), false, id);
  const chats = html.slice(html.indexOf('data-panel="chats"'), html.indexOf('data-panel="settings"'));
  assert.doesNotMatch(chats, /Earlier chats|Changes in|Waiting for you|Plans/);
});
