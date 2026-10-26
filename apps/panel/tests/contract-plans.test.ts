/**
 * Panel contract: plans follow state, not place. A held plan's detail is in the sheet's Waiting section and its one Apply and
 * Discard are in the status bar; a finished plan's receipt, frames and Undo are on its row in the sheet's Changes; the thread
 * keeps one fold line. One approval gate, plain words, and a receipt that never overwrites itself.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { allButtonsFor, bar, barButton, buttonsNamed, buttonStarting, cards, folds, harnessWithPlanCard, nth, openSheet, planCard, planRow, required, textsOf, toolCalls } from "./contract-helpers.js";
import { createPanelHarness, PNG, type PanelHarness, type StubElement } from "./contract.test.js";
import { fieldOf } from "./json-narrow.js";
import { patchPlan } from "./contract-xhr.js";
import { type JsonObject } from "@extynt/decode";

const unverified = [
  {
    severity: "unverified",
    title: "2 changes can't be checked automatically",
    detail: "After Effects does not report back expressions.",
    operationIndexes: [0, 1],
  },
];

const waitingItem = (harness: PanelHarness): StubElement => required(openSheet(harness).find((node) => node.classList.has("sheet-item")));
const changeRow = (harness: PanelHarness): StubElement => required(openSheet(harness).find((node) => node.classList.has("change-row")));
const opened = (harness: PanelHarness): StubElement => {
  const row = changeRow(harness);
  if (!row.find((node) => node.classList.has("change-detail"))) required(row.find((node) => node.classList.has("change-head"))).click();
  return changeRow(harness);
};
const pill = (row: StubElement): string | undefined => row.find((node) => node.classList.has("pill"))?.textContent;
const apply = (harness: PanelHarness): void => {
  required(barButton(harness, "apply")).click();
};

test("a proposed change is one fold line in the thread, plain rows in the sheet, and Apply and Discard in the bar", () => {
  const harness = harnessWithPlanCard(planCard("p1", { title: "Fade in the title" }));
  assert.equal(cards(harness).length, 0, "no card in the thread");
  assert.equal(folds(harness).length, 1);
  assert.match(nth(folds(harness), 0).textContent, /Fade in the title · 1 op · waiting for Apply/);
  const view = bar(harness);
  assert.deepEqual(
    [view.state, view.tone, view.text, view.actions],
    ["needs-you", "amber", "Apply “Fade in the title”?", ["Apply", "Discard"]],
  );
  const item = waitingItem(harness);
  assert.deepEqual(textsOf(item, "sheet-item-title"), ["Fade in the title"]);
  assert.match(item.textContent, /Animate Opacity · TITLE: 0 → 100/);
  assert.match(item.textContent, /Source: extynt · asked .*Apply and Discard are in the bar above\./);
  assert.equal(buttonsNamed(item, "Apply").length + buttonsNamed(item, "Discard").length, 0, "the sheet's detail is read-only");
  assert.equal(allButtonsFor(harness, "Apply").length, 1, "one Apply on the whole page");
  assert.equal(allButtonsFor(harness, "Discard").length, 1);
  assert.equal(buttonsNamed(harness.body(), "Cancel").length, 0, "Discard is the one word for it");
});

test("more than four rows collapse behind +N more, which expands in place", () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ label: "Change " + index, target: "L" + index, before: null, after: null }));
  const harness = harnessWithPlanCard(planCard("p1", { rows }));
  assert.equal(waitingItem(harness).all((node) => node.tagName === "LI").length, 4);
  nth(buttonsNamed(waitingItem(harness), "+3 more"), 0).click();
  assert.equal(waitingItem(harness).all((node) => node.tagName === "LI").length, 7);
  assert.match(bar(harness).sub, /Change 0 and 6 more changes/);
});

test("there is one gate: unchecked changes are named on the button, and one press sends the acknowledgement", () => {
  const harness = harnessWithPlanCard(planCard("p1", { requiresAcknowledgement: true, notices: unverified }));
  const button = required(barButton(harness, "apply"));
  assert.equal(button.textContent, "Apply (2 unchecked)");
  assert.ok(
    waitingItem(harness).all((node) => node.classList.has("plan-note")).length === 1,
    "the note is in the sheet, readable before the press",
  );
  button.click();
  const calls = toolCalls(harness, "ae_approve_plan");
  assert.equal(calls.length, 1, "one press, one approval");
  assert.equal(fieldOf(nth(calls, 0), "acknowledgeUnverified"), true);
  assert.equal(buttonsNamed(harness.body(), "Apply anyway").length + buttonsNamed(harness.body(), "Leave it").length, 0, "no second gate");
});

test("a plan that did not know it needed the acknowledgement asks once, in the bar, and does not apply", () => {
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1")], {
    sidecar: (sidecar) => {
      sidecar.approve = (args) =>
        fieldOf(args, "acknowledgeUnverified") === true
          ? ((sidecar.plans[0] = planRow("p1", { status: "applied_unverified" })),
            { status: 200, text: JSON.stringify({ ok: true, data: { status: "applied_unverified", receipt: {} } }) })
          : { status: 422, text: JSON.stringify({ ok: false, error: { code: "UNVERIFIED_OPERATIONS", message: "cannot be read back" } }) };
    },
  });
  apply(harness);
  assert.match(bar(harness).sub, /can't be confirmed on this build/);
  assert.match(required(barButton(harness, "apply")).textContent, /^Apply \(/);
  apply(harness);
  assert.deepEqual(
    toolCalls(harness, "ae_approve_plan").map((call) => fieldOf(call, "acknowledgeUnverified")),
    [undefined, true],
  );
  assert.equal(pill(changeRow(harness)), "Done · not all checked");
});

test("applying turns the plan into a row in Changes: Done, a verdict line, Undo, and no raw JSON", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  apply(harness);
  assert.equal(bar(harness).state, "idle", "nothing is waiting any more");
  assert.equal(allButtonsFor(harness, "Apply").length, 0);
  const row = opened(harness);
  assert.equal(pill(row), "Done");
  assert.ok(row.find((node) => node.classList.has("receipt-line") && node.textContent.startsWith("Done · checked")));
  assert.equal(buttonsNamed(row, "Undo").length, 1);
  assert.doesNotMatch(row.textContent, /\{|"status"|Verified receipt/);
  assert.equal(openSheet(harness).all((node) => node.classList.has("change-row")).length, 1, "the row did not multiply");
  assert.match(nth(folds(harness), 0).textContent, /verified/);
});

test("a refused approval on a plan already applied never overwrites its result", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  apply(harness);
  const applied = nth(harness.sidecar.plans, 0);
  assert.equal(fieldOf(applied, "status"), "verified");
  harness.sidecar.approve = () => ({
    status: 409,
    text: JSON.stringify({ ok: false, error: { code: "PLAN_NOT_APPROVABLE", message: "already applied" } }),
  });
  harness.send("and again");
  assert.equal(pill(changeRow(harness)), "Done");
  assert.doesNotMatch(harness.body().textContent, /Could not start|Couldn't apply/);
});

test("a refusal on a Ready plan says what happened in the bar and leaves it ready to try again", () => {
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1")], {
    sidecar: (sidecar) => {
      sidecar.approve = () => ({
        status: 409,
        text: JSON.stringify({ ok: false, error: { code: "STALE_SNAPSHOT", message: "The project changed." } }),
      });
    },
  });
  apply(harness);
  assert.match(bar(harness).sub, /Couldn't apply: The project changed\./);
  assert.equal(bar(harness).state, "needs-you");
  assert.deepEqual(bar(harness).actions, ["Apply", "Discard"]);
  assert.match(nth(folds(harness), 0).textContent, /waiting for Apply/);
});

test("Discard withdraws the plan and the thread's line says so", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  required(barButton(harness, "discard")).click();
  assert.equal(toolCalls(harness, "ae_cancel_plan").length, 1);
  assert.match(nth(folds(harness), 0).textContent, /discarded/);
  assert.equal(allButtonsFor(harness, "Apply").length, 0);
  assert.equal(bar(harness).state, "idle");
});

function failedChange(): JsonObject {
  return {
    planId: "p1",
    summary: "Fade in the title",
    appliedAt: new Date().toISOString(),
    operations: 1,
    status: "failed",
    mayHaveMutated: false,
    undoGroupsRemaining: 0,
    undo: { available: false, code: "NOTHING_CHANGED", reason: "nothing changed" },
    source: "panel",
    jobId: null,
    batch: null,
    origin: "chat",
  };
}
function withoutRows(card: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(card).filter(([key]) => key !== "rows"));
}

test("a plan the sidecar failed without touching the project says Didn't apply, with the reason and Retry on its row", () => {
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1")], {
    sidecar: (sidecar) => {
      sidecar.approve = () => {
        sidecar.plans[0] = planRow("p1", { status: "failed", postcondition: "not_run", mayHaveMutated: false });
        sidecar.changes = [failedChange()];
        return {
          status: 200,
          text: JSON.stringify({ ok: true, data: { status: "failed", receipt: { error: { message: "The layer is locked." } } } }),
        };
      };
    },
  });
  apply(harness);
  const sheet = openSheet(harness);
  assert.deepEqual(
    sheet
      .all((node) => node.classList.has("sheet-title"))
      .map((node) => node.textContent)
      .slice(0, 2),
    ["Needs a look · 1", "Changes · newest first"],
  );
  const row = changeRow(harness);
  assert.equal(pill(row), "Didn't apply");
  assert.match(row.textContent, /Didn't apply\. Nothing changed\./);
  assert.match(row.textContent, /The layer is locked\./);
  assert.equal(buttonsNamed(row, "Retry").length, 1);
});

test("the receipt's frames hold their place as skeletons, then fill in when the sidecar has them", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  apply(harness);
  let row = opened(harness);
  assert.equal(row.all((node) => node.classList.has("thumb-skeleton")).length, 2, "two skeletons until the frames arrive");
  harness.sidecar.thumbs.set("p1", { before: { dataUrl: PNG, width: 240, height: 135 }, after: { dataUrl: PNG, width: 240, height: 135 } });
  harness.sse("thumbs", { planId: "p1" });
  row = changeRow(harness);
  assert.equal(row.all((node) => node.classList.has("thumb-skeleton")).length, 0);
  assert.equal(row.all((node) => node.tagName === "IMG").length, 2);
  assert.ok(
    row.find((node) => node.classList.has("thumb-pair")),
    "the pair is one button that enlarges",
  );
});

test("Show before/after frames off draws no frames at all", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.prefs.showThumbnails = false;
    },
  });
  assert.equal(harness.el("show-thumbnails")?.checked, false);
});

test("Undo is live: it is disabled with a plain explanation when the sidecar says the project moved on", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  apply(harness);
  assert.equal(nth(buttonsNamed(changeRow(harness), "Undo"), 0).disabled, false);
  harness.sse("undo", {
    planId: "p1",
    undo: { available: false, reason: "the project changed after this was applied", code: "UNDO_PROJECT_CHANGED" },
  });
  assert.equal(nth(buttonsNamed(changeRow(harness), "Undo"), 0).disabled, true);
  harness.sse("undo", { planId: "p1", undo: { available: true, reason: null } });
  assert.equal(nth(buttonsNamed(changeRow(harness), "Undo"), 0).disabled, false);
});

test("Undo asks for a few seconds, not tens, and the row becomes Undone", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  apply(harness);
  nth(buttonsNamed(changeRow(harness), "Undo"), 0).click();
  const call = nth(toolCalls(harness, "ae_undo_plan"), 0);
  assert.equal(fieldOf(call, "waitSeconds"), 5);
  const request = nth(
    harness.requestsTo("/v1/mcp/tools/call").filter((record) => record.body.includes("ae_undo_plan")),
    0,
  );
  assert.ok((request.timeoutMs ?? 0) <= 13000);
  assert.equal(pill(changeRow(harness)), "Undone");
  assert.equal(allButtonsFor(harness, "Undo").length, 1, "one Undo, on the row, nowhere else");
});

test("a change row's detail has Copy receipt, and Undo only the last step for a plan with several undo groups", () => {
  const operations = Array.from({ length: 30 }, () => "set_layer_property");
  const harness = harnessWithPlanCard(withoutRows(planCard("p1", { operations })));
  harness.sidecar.approve = (args) => {
    patchPlan(harness.sidecar, fieldOf(args, "planId"), { status: "verified" });
    harness.sidecar.changes = [
      {
        planId: "p1",
        summary: "Fade in the title",
        appliedAt: new Date().toISOString(),
        operations: 30,
        status: "verified",
        mayHaveMutated: false,
        undoGroupsRemaining: 2,
        undo: { available: true },
        source: "panel",
        jobId: null,
        batch: null,
        origin: "chat",
      },
    ];
    return { status: 200, text: JSON.stringify({ ok: true, data: { status: "verified", receipt: { status: "executed" } } }) };
  };
  apply(harness);
  const row = opened(harness);
  assert.deepEqual(
    row
      .all((node) => node.tagName === "BUTTON" && (node.textContent === "Copy receipt" || node.textContent === "Undo only the last step"))
      .map((node) => node.textContent),
    ["Copy receipt", "Undo only the last step"],
  );
  required(buttonStarting(row, "Undo only the last step")).click();
  assert.equal(fieldOf(nth(toolCalls(harness, "ae_undo_plan"), 0), "scope"), "last");
});

test("an outside agent's held plan still needs your Apply: amber bar with the agent named, in Waiting", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.plans = [planRow("pm1", { source: "agent", summary: "Vignette" })];
    },
  });
  harness.sse("mcp", {
    calls: [
      {
        id: 9,
        rev: 1,
        at: new Date().toISOString(),
        tool: "ae_propose_plan",
        client: "claude-code",
        args: "",
        state: "ok",
        code: null,
        ms: 80,
        planIds: ["pm1"],
      },
    ],
  });
  harness.sse("plans", { reason: "state", planId: "pm1" });
  const view = bar(harness);
  assert.deepEqual([view.state, view.tone, view.actions], ["needs-you", "amber", ["Apply", "Discard"]]);
  assert.match(view.sub, /Claude Code/);
  const item = required(openSheet(harness).find((node) => node.classList.has("sheet-item")));
  assert.equal(item.find((node) => node.classList.has("source-tag"))?.textContent, "Claude Code");
});
