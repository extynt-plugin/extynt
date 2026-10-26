/**
 * Panel contract: a plan in each of its states, now that detail follows state, not place. The thread keeps a one-line fold;
 * a held plan's rows are in the sheet's Waiting and its buttons in the bar; a finished plan's receipt (verdict, frames,
 * checklist) is on its Changes row. Also the composer's pill and chip.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allButtonsFor, bar, barButton, buttonsNamed, element, folds, harnessWithPlanCard, nth, openedChange, openSheet, planCard, planRow, required, textsOf, toolCalls } from "./contract-helpers.js";
import { createPanelHarness, PNG, type PanelHarness, type StubElement, type StubResponse } from "./contract.test.js";
import { type JsonObject } from "@extynt/decode";

const FRAMES = { before: { dataUrl: PNG, width: 240, height: 135 }, after: { dataUrl: PNG, width: 240, height: 135 } };

function fold(harness: PanelHarness): string {
  const [first] = folds(harness);
  if (!first) throw new Error("no fold line");
  return first.textContent;
}
function chip(node: StubElement): string {
  return node.find((child) => child.classList.has("pill"))?.textContent ?? "";
}
function reply(status: string, receipt: JsonObject = {}): StubResponse {
  return { status: 200, text: JSON.stringify({ ok: true, data: { status, receipt } }) };
}
function applied(card: JsonObject, listed: JsonObject): PanelHarness {
  return harnessWithPlanCard(card, [listed], {
    sidecar: (sidecar) => {
      sidecar.thumbs.set("p1", FRAMES);
    },
  });
}
const apply = (harness: PanelHarness): void => {
  required(barButton(harness, "apply")).click();
};

test("the thread's fold line says which state a plan is in, and changes with it", () => {
  const held = harnessWithPlanCard(planCard("p1"));
  assert.match(fold(held), /waiting for Apply/);
  apply(held);
  assert.match(fold(held), /verified/);
  nth(buttonsNamed(openedChange(held), "Undo"), 0).click();
  assert.match(fold(held), /undone/);
  const unverified = harnessWithPlanCard(planCard("p1", { status: "applied_unverified" }), [
    planRow("p1", { status: "applied_unverified" }),
  ]);
  assert.match(fold(unverified), /done/);
  const failed = harnessWithPlanCard(planCard("p1", { status: "failed" }), [planRow("p1", { status: "failed", postcondition: "not_run" })]);
  assert.match(fold(failed), /didn't apply/);
});

test("drafting: a plan still being written is a fold line that says drafting, with nothing to press", () => {
  const harness = harnessWithPlanCard(planCard("p1", { status: "draft", rows: [], operations: [] }), [planRow("p1", { status: "draft" })]);
  assert.match(fold(harness), /drafting/);
  assert.equal(allButtonsFor(harness, "Apply").length + allButtonsFor(harness, "Discard").length, 0);
  assert.equal(bar(harness).state, "idle");
});

test("drafting becomes waiting in place when the sidecar seals the plan: the bar turns amber", () => {
  const harness = harnessWithPlanCard(planCard("p1", { status: "draft", rows: [], operations: [] }), [planRow("p1", { status: "draft" })]);
  harness.sidecar.plans[0] = planRow("p1", { status: "prepared" });
  harness.sse("change", { seq: 2, reason: "plan", planId: "p1" });
  assert.match(fold(harness), /waiting for Apply/);
  assert.deepEqual(bar(harness).actions, ["Apply", "Discard"]);
});

test("waiting: rows read label · target: before → after, and a row with an unknown before shows the after value alone", () => {
  const rows: JsonObject[] = [
    { label: "Animate Opacity", target: "TITLE", before: 0, after: 100 },
    { label: "Set the name", target: "BG", before: null, after: "Backdrop" },
    { label: "Add a layer", before: null, after: null },
  ];
  const harness = harnessWithPlanCard(planCard("p1", { rows }));
  const item = required(openSheet(harness).find((node) => node.classList.has("sheet-item")));
  assert.deepEqual(
    item.all((node) => node.tagName === "LI").map((node) => node.textContent),
    ["Animate Opacity · TITLE: 0 → 100", "Set the name · BG: Backdrop", "Add a layer"],
  );
  assert.doesNotMatch(item.textContent, /undefined|null/);
});

test("the bar holds the one primary and Discard; the held plan's detail has no action row of its own", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  assert.deepEqual(bar(harness).actions, ["Apply", "Discard"]);
  assert.equal(element(harness, "status-bar").all((node) => node.classList.has("primary")).length, 1, "a single primary action");
  const item = required(openSheet(harness).find((node) => node.classList.has("sheet-item")));
  assert.equal(item.all((node) => node.tagName === "BUTTON" && node.textContent !== "+3 more").length, 0);
  assert.equal(
    nth(folds(harness), 0).all((node) => node.tagName === "BUTTON" && node !== folds(harness)[0]).length,
    0,
    "the fold itself is the one button, with no buttons inside",
  );
});

test("a plan the sidecar dropped shows a discarded fold line that says why", () => {
  const why = "The sidecar restarted before this was applied.";
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1", { status: "cancelled", droppedBecause: why })]);
  assert.match(fold(harness), /discarded/);
  assert.match(fold(harness), /sidecar restarted before this was applied/);
  assert.equal(bar(harness).state, "idle");
});

test("applying: the thread says applying and the bar's buttons wait", () => {
  let release: (() => void) | null = null;
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1")], {
    sidecar: (sidecar) => {
      sidecar.approve = () => {
        sidecar.plans[0] = planRow("p1", { status: "approved" });
        return reply("approved");
      };
    },
  });
  void release;
  apply(harness);
  assert.match(fold(harness), /applying/);
  assert.equal(bar(harness).state, "idle", "it is no longer waiting for the reader");
});

test("applied: the verdict comes first, then the frames, then the checklist, on the change row", () => {
  const harness = applied(
    planCard("p1", { status: "verified" }),
    planRow("p1", { status: "verified", postcondition: "passed", visual: true }),
  );
  harness.sse("thumbs", { planId: "p1" });
  const row = openedChange(harness),
    order = ["receipt-line", "thumb-slot", "receipt-checklist"];
  const all = row.all(() => true);
  const positions = order.map((name) => all.findIndex((child) => child.classList.has(name)));
  assert.ok(
    positions.every((index) => index >= 0),
    "all three parts are drawn: " + positions.join(),
  );
  assert.ok(nth(positions, 0) < nth(positions, 1) && nth(positions, 1) < nth(positions, 2), "verdict, frames, checklist, in that order");
  assert.equal(
    row.find((child) => child.classList.has("receipt-checklist"))?.find((child) => child.tagName === "SUMMARY")?.textContent,
    "1 change ✓",
  );
  assert.equal(textsOf(row, "check-text")[0], "Animate Opacity · TITLE: 0 → 100");
  assert.doesNotMatch(row.textContent, /\{|"status"|operationOutcomes/);
});

test("unverified: the verdict says how many could not be checked, and the checklist marks them with a question mark", () => {
  const notices = [
    { severity: "unverified", title: "1 change can't be checked automatically", detail: "No readback.", operationIndexes: [1] },
  ];
  const rows = [
    { label: "Animate Opacity", target: "TITLE", before: 0, after: 100 },
    { label: "Set an expression", target: "TITLE", before: null, after: null },
  ];
  const harness = harnessWithPlanCard(planCard("p1", { status: "applied_unverified", rows, notices, operations: ["a", "b"] }), [
    planRow("p1", { status: "applied_unverified" }),
  ]);
  const row = openedChange(harness);
  assert.equal(chip(row), "Done · not all checked");
  assert.match(row.find((child) => child.classList.has("receipt-line"))?.textContent ?? "", /^Done · 1 of 2 couldn't be checked/);
  assert.deepEqual(
    row.all((child) => child.classList.has("check-row")).map((child) => child.getAttribute("data-mark")),
    ["ok", "unknown"],
  );
  assert.equal(
    row.find((child) => child.classList.has("receipt-checklist"))?.find((child) => child.tagName === "SUMMARY")?.textContent,
    "2 changes · 1 not checked",
  );
});

test("the checklist uses the host's outcome for each change when the panel holds the receipt", () => {
  const rows = [
    { label: "Animate Opacity", target: "TITLE", before: 0, after: 100 },
    { label: "Rename the layer", target: "BG", before: "BG", after: "Backdrop" },
  ];
  const receipt = {
    operationOutcomes: [
      { index: 0, type: "animate_property", outcome: "confirmed" },
      { index: 1, type: "set_layer_name", outcome: "readback_mismatch" },
    ],
  };
  const harness = harnessWithPlanCard(planCard("p1", { rows, operations: ["a", "b"] }), [planRow("p1")], {
    sidecar: (sidecar) => {
      sidecar.approve = () => {
        sidecar.plans[0] = planRow("p1", { status: "applied_unverified" });
        return reply("applied_unverified", receipt);
      };
    },
  });
  apply(harness);
  assert.deepEqual(
    openedChange(harness)
      .all((child) => child.classList.has("check-row"))
      .map((child) => child.getAttribute("data-mark")),
    ["ok", "bad"],
  );
});

test("once the host reports, the verdict counts its outcomes as the checklist does, not the plan's forecast", () => {
  const notices = [{ severity: "unverified", title: "2 steps never tested here", detail: "No readback.", operationIndexes: [0, 1] }];
  const rows = [
    { label: "Import file", target: "cuts.avi", before: null, after: null },
    { label: "Detect scene edits", target: "cuts", before: null, after: null },
  ];
  const receipt = {
    operationOutcomes: [
      { index: 0, type: "import_file", outcome: "confirmed" },
      { index: 1, type: "detect_scene_edits", outcome: "applied_unconfirmed" },
    ],
  };
  const harness = harnessWithPlanCard(planCard("p1", { rows, notices, operations: ["a", "b"] }), [planRow("p1")], {
    sidecar: (sidecar) => {
      sidecar.approve = () => {
        sidecar.plans[0] = planRow("p1", { status: "applied_unverified" });
        return reply("applied_unverified", receipt);
      };
    },
  });
  apply(harness);
  const row = openedChange(harness);
  assert.match(row.find((child) => child.classList.has("receipt-line"))?.textContent ?? "", /^Done · 1 of 2 couldn't be checked/);
  assert.equal(
    row.find((child) => child.classList.has("receipt-checklist"))?.find((child) => child.tagName === "SUMMARY")?.textContent,
    "2 changes · 1 not checked",
  );
});

test("with Show before/after frames off a receipt draws no frames and no skeletons", () => {
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1", { visual: true })], {
    sidecar: (sidecar) => {
      sidecar.prefs.showThumbnails = false;
      sidecar.thumbs.set("p1", FRAMES);
    },
  });
  apply(harness);
  harness.sse("thumbs", { planId: "p1" });
  const row = openedChange(harness);
  assert.equal(chip(row), "Done");
  assert.equal(
    row.all((child) => child.classList.has("thumb-pair") || child.classList.has("thumb-skeleton") || child.classList.has("thumb-slot"))
      .length,
    0,
  );
  assert.equal(harness.requestsTo("/v1/thumbs/p1").length, 0, "the frames are not even asked for");
});

test("the frames sit side by side from the reference width and stack below it", () => {
  const css = readFileSync("apps/panel/styles/components/receipt.css", "utf8");
  assert.match(css, /@container panel \(min-width: 340px\)[^}]*\{[^}]*button\.thumb-pair\s*\{[^}]*flex-direction: row/);
  assert.match(css, /button\.thumb-pair \{\s*display: flex;\s*flex-direction: column/);
});

test("undone: a verdict line, no frames, no checklist, no live Undo, and Copy receipt is still there", () => {
  const harness = applied(planCard("p1"), planRow("p1", { visual: true }));
  apply(harness);
  harness.sse("thumbs", { planId: "p1" });
  nth(buttonsNamed(openedChange(harness), "Undo"), 0).click();
  const row = openedChange(harness);
  assert.equal(chip(row), "Undone");
  assert.equal(row.all((child) => child.classList.has("receipt-checklist")).length, 0);
  assert.equal(nth(buttonsNamed(row, "Undo"), 0).disabled, true);
  assert.equal(buttonsNamed(row, "Copy receipt").length, 1);
});

test("failed after a partial apply says Partly applied with the reason; the row is open on its own", () => {
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1")], {
    sidecar: (sidecar) => {
      sidecar.approve = () => {
        sidecar.plans[0] = planRow("p1", { status: "failed", postcondition: "failed", mayHaveMutated: true });
        sidecar.changes = [
          {
            planId: "p1",
            summary: "Fade in the title",
            appliedAt: new Date().toISOString(),
            operations: 1,
            status: "failed",
            mayHaveMutated: true,
            undoGroupsRemaining: 1,
            undo: { available: true },
            source: "panel",
            jobId: null,
            batch: null,
            origin: "chat",
          },
        ];
        return reply("failed", { error: { message: "The layer is locked." } });
      };
    },
  });
  apply(harness);
  const row = required(openSheet(harness).find((node) => node.classList.has("change-row")));
  assert.equal(row.getAttribute("data-tone"), "bad");
  assert.equal(chip(row), "Partly applied");
  assert.match(row.textContent, /Partly applied[\s\S]*The layer is locked\./);
  assert.equal(nth(folds(harness), 0).find((node) => node.classList.has("pill"))?.textContent, "1 partly");
});

test("Copy receipt puts the receipt on the clipboard, not on the sheet", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  apply(harness);
  nth(buttonsNamed(openedChange(harness), "Copy receipt"), 0).click();
  assert.equal(toolCalls(harness, "ae_get_receipt").length, 1);
  assert.equal(harness.clipboard.length, 1);
  assert.match(nth(harness.clipboard, 0), /^\{/);
  assert.doesNotMatch(openSheet(harness).textContent, /^\{|"status"/);
  assert.match(openSheet(harness).textContent, /Receipt copied\./);
});

test("when Undo is not available the row says why in muted words, by cause, where the button was", () => {
  const harness = harnessWithPlanCard(planCard("p1"));
  apply(harness);
  openedChange(harness);
  harness.sse("undo", {
    planId: "p1",
    undo: { available: false, reason: "the project changed after this was applied", code: "UNDO_PROJECT_CHANGED" },
  });
  const note = openedChange(harness).find((child) => child.classList.has("undo-reason"));
  assert.match(
    note?.textContent ?? "",
    /You've edited the project since\. Undo here would undo your edits first\. Use Edit > Undo in After Effects/,
  );
  harness.sse("undo", {
    planId: "p1",
    undo: { available: false, reason: "a newer change was made on top of this one; undo that one first", code: "UNDO_NOT_LATEST" },
  });
  assert.match(
    openedChange(harness).find((child) => child.classList.has("undo-reason"))?.textContent ?? "",
    /A later change by extynt is on top of this one\. Undo that first, or ask me to revert\./,
  );
  harness.sse("undo", { planId: "p1", undo: { available: false, reason: "something else" } });
  assert.match(
    openedChange(harness).find((child) => child.classList.has("undo-reason"))?.textContent ?? "",
    /The project changed after this\./,
  );
});

test("the composer's context chip reads Acting on, then the composition and the layers", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.focus = {
        project: "F.aep",
        compositionId: "c1",
        compositionName: "Main",
        selected: 3,
        layerNames: ["A", "B", "C"],
        kinds: [],
        selectionFingerprint: "x",
        at: 1,
      };
    },
  });
  assert.match(readFileSync("apps/panel/index.html", "utf8"), /<span class="ctx-chip-label" data-i18n="chrome.context.acting">Acting on<\/span><span class="ctx-chip-text"/);
  assert.equal(harness.el("context-chip")?.querySelector(".ctx-chip-text")?.textContent, "Main · 3 layers");
});

test("the composer's model pill names the model and its effort, from the primary slot", () => {
  const harness = createPanelHarness();
  assert.equal(harness.el("model-picker")?.querySelector(".effort-label")?.textContent, "DeepSeek · High");
  assert.match(harness.el("model-picker")?.getAttribute("aria-label") ?? "", /^Model and reasoning effort: .*high/);
});

test("the controls row is the text, attach a frame, attach images, the model pill and Send, in that order for the keyboard", () => {
  const html = readFileSync("apps/panel/index.html", "utf8"),
    row = html.slice(html.indexOf('class="composer-row"'), html.indexOf("</form>"));
  const order = ['id="chat-message"', 'id="snapshot"', 'id="attach-images"', 'id="model-picker"', 'id="chat"'].map((marker) =>
    row.indexOf(marker),
  );
  assert.ok(order.every((index) => index > 0) && [...order].sort((a, b) => a - b).join() === order.join(), "the order is " + order.join());
});
