/** Panel contract: the sheet's Changes section: order, frames, Undo on change rows, folded verified runs and the outside-agent filter. */
import assert from "node:assert/strict";
import test from "node:test";
import { allButtonsFor, bar, buttonsNamed, element, nth, openSheet, planRow, required, sheetTitles, textsOf, toolCalls } from "./contract-helpers.js";
import { PNG } from "./contract.test.js";
import { type JsonObject } from "@extynt/decode";
import { fieldOf } from "./json-narrow.js";
import { MINUTE, ago, change, pill, waiting, changeRows, withState } from "./contract-sheet-fixtures.js";

function listedChanges(): JsonObject[] {
  return [
    change("c1", { summary: "Fade the logo in", operations: 3 }),
    change("c2", {
      summary: "Stagger the dots",
      status: "applied_unverified",
      source: "claude-code",
      origin: "mcp",
      appliedAt: ago(3600000),
      operations: 1,
    }),
    change("c3", {
      summary: "Tidy the folders",
      status: "undone",
      appliedAt: ago(2 * 86400000),
      undo: { available: false, code: "ALREADY_UNDONE", reason: "" },
    }),
  ];
}

test("Changes lists the project's changes newest first, with a plain status, who, when and how many", () => {
  const harness = withState([], listedChanges());
  const rows = changeRows(harness);
  assert.deepEqual(
    rows.map((row) => textsOf(row, "change-title")[0]),
    ["Fade the logo in", "Stagger the dots", "Tidy the folders"],
    "the sidecar's order is kept",
  );
  assert.deepEqual(rows.map(pill), ["Done", "Done · not all checked", "Undone"]);
  assert.deepEqual(
    rows.map((row) => textsOf(row, "change-meta")[0]),
    ["Done 3 ops · 5 min ago", "Done · not all checked 1 op · 1 h ago", "Undone 3 ops · 2 d ago"],
  );
  assert.deepEqual(
    rows.map((row) => row.find((node) => node.classList.has("source-tag") || node.classList.has("role-tag"))?.textContent),
    ["agent", "outside agent", "agent"],
  );
  assert.equal(
    nth(rows, 1).find((node) => node.classList.has("source-tag"))?.textContent,
    "outside agent",
    "an outside change carries the dashed source tag",
  );
  assert.equal(sheetTitles(harness).includes("Needs a look · 0"), false);
  assert.equal(bar(harness).text, "Ready · Fixture.aep · 3 changes");
});

test("a change with before and after frames shows the pair; one without shows none", () => {
  const harness = withState(
    [planRow("c1", { status: "verified", visual: true }), planRow("c2", { status: "verified", visual: true })],
    [change("c1"), change("c2")],
    {
      sidecar: (sidecar) => {
        sidecar.thumbs.set("c1", { before: PNG, after: PNG });
      },
    },
  );
  const [first, second] = changeRows(harness);
  required(required(first).find((node) => node.classList.has("change-head"))).click();
  required(required(second).find((node) => node.classList.has("change-head"))).click();
  const [one, two] = changeRows(harness);
  assert.equal(required(one).all((node) => node.classList.has("thumb-pair")).length, 1);
  assert.equal(required(one).all((node) => node.tagName === "IMG").length, 2);
  assert.equal(
    required(two).all((node) => node.classList.has("thumb-pair") && node.all((entry) => entry.tagName === "IMG").length > 0).length,
    0,
  );
});

test("with Show before/after frames off no frames are fetched", () => {
  const harness = withState([planRow("c1", { status: "verified", visual: true })], [change("c1")], {
    sidecar: (sidecar) => {
      sidecar.prefs.showThumbnails = false;
      sidecar.thumbs.set("c1", { before: PNG, after: PNG });
    },
  });
  required(nth(changeRows(harness), 0).find((node) => node.classList.has("change-head"))).click();
  assert.equal(harness.requestsTo("/v1/thumbs/").length, 0);
  assert.equal(nth(changeRows(harness), 0).all((node) => node.classList.has("thumb-pair")).length, 0);
});

test("Undo is offered only where the sidecar says it is safe, and the others give its reason", () => {
  const harness = withState(
    [],
    [
      change("c1"),
      change("c2", { undo: { available: false, code: "PROJECT_CHANGED", reason: "the project changed after this was applied." } }),
    ],
  );
  const [safe, stale] = changeRows(harness);
  assert.equal(nth(buttonsNamed(required(safe), "Undo"), 0).disabled, false);
  assert.equal(nth(buttonsNamed(required(stale), "Undo"), 0).disabled, true);
  required(required(stale).find((node) => node.classList.has("change-head"))).click();
  assert.match(nth(changeRows(harness), 1).textContent, /The project changed after this\./);
  assert.equal(nth(buttonsNamed(required(stale), "Undo"), 0).click(), false);
  assert.equal(toolCalls(harness, "ae_undo_plan").length, 0);
});

test("Undo asks for a few seconds' wait, then reads the list again and says it was requested", () => {
  const harness = withState([], [change("c1")]);
  openSheet(harness);
  const before = harness.requestsTo("/v1/changes").length;
  nth(buttonsNamed(nth(changeRows(harness), 0), "Undo"), 0).click();
  const [call] = toolCalls(harness, "ae_undo_plan");
  assert.equal(fieldOf(required(call), "planId"), "c1");
  assert.equal(fieldOf(required(call), "waitSeconds"), 5);
  assert.ok(
    required(required(harness.requestsTo("/v1/mcp/tools/call").find((record) => record.body.includes("ae_undo_plan"))).timeoutMs) <= 13000,
  );
  assert.ok(harness.requestsTo("/v1/changes").length > before, "the list is read again");
  assert.match(openSheet(harness).textContent, /Undo requested\. After Effects is restoring the project\./);
});

test("the Undo requested line goes once the list shows that change undone", () => {
  let fake: { changes: Array<JsonObject> } | null = null;
  const undone = (record: { url: string; body: string }) => {
    if (fake && record.url.endsWith("/v1/mcp/tools/call") && record.body.includes("ae_undo_plan"))
      fake.changes = [
        change("c1", {
          status: "undone",
          undoGroupsRemaining: 0,
          undo: { available: false, code: "ALREADY_UNDONE", reason: "already undone" },
        }),
      ];
    return undefined;
  };
  const harness = withState([], [change("c1")], {
    respond: undone,
    sidecar: (sidecar) => {
      fake = sidecar;
    },
  });
  nth(buttonsNamed(nth(changeRows(harness), 0), "Undo"), 0).click();
  assert.equal(pill(nth(changeRows(harness), 0)), "Undone");
  assert.doesNotMatch(openSheet(harness).textContent, /Undo requested/);
});

test("an Undo the sidecar refuses says why", () => {
  const refuse = (record: { url: string; body: string }) =>
    record.url.endsWith("/v1/mcp/tools/call") && record.body.includes("ae_undo_plan")
      ? { status: 409, text: JSON.stringify({ ok: false, error: { code: "UNDO_REFUSED", message: "The project moved on." } }) }
      : undefined;
  const harness = withState([], [change("c1")], { respond: refuse });
  nth(buttonsNamed(nth(changeRows(harness), 0), "Undo"), 0).click();
  assert.match(openSheet(harness).textContent, /Could not undo: The project moved on\./);
});

test("Undo lives on change rows and nowhere else: there is no Undo in the thread, the bar or Waiting", () => {
  const harness = withState([waiting("w1", "Held")], [change("c1")]);
  assert.equal(allButtonsFor(harness, "Undo").length, 0, "nothing until the sheet shows the rows");
  openSheet(harness);
  assert.equal(allButtonsFor(harness, "Undo").length, 1);
  assert.equal(element(harness, "chat-output").all((node) => node.tagName === "BUTTON" && /^Undo/.test(node.textContent)).length, 0);
  assert.equal(element(harness, "status-bar").all((node) => node.tagName === "BUTTON" && /^Undo/.test(node.textContent)).length, 0);
});

function longJobRows(): JsonObject[] {
  const rows = Array.from({ length: 8 }, (_, index) =>
    change("b" + (8 - index), {
      summary: "Batch " + (8 - index),
      jobId: "job_1",
      batch: "batch-" + (8 - index),
      operations: 5,
      appliedAt: ago((index + 1) * MINUTE),
    }),
  );
  rows.splice(
    2,
    0,
    change("bad", {
      summary: "Batch 6b",
      status: "failed",
      mayHaveMutated: true,
      jobId: "job_1",
      batch: "batch-6",
      undo: { available: true },
    }),
  );
  rows.push(change("mcp1", { summary: "Vignette", origin: "mcp", source: "claude-code", appliedAt: ago(20 * MINUTE) }));
  return rows;
}

test("a long job folds its verified runs by job and batch, and keeps failures and the live batch open", () => {
  const rows = longJobRows();
  const harness = withState([], rows);
  const items = openSheet(harness).all((node) => node.classList.has("change-row") || node.classList.has("change-fold"));
  const titles = items.map((node) =>
    node.classList.has("change-fold") ? "FOLD " + textsOf(node, "fold-text")[0] : textsOf(node, "change-title")[0],
  );
  assert.deepEqual(
    titles.slice(0, 4),
    ["Batch 8", "Batch 7", "Batch 6b", "Batch 6"],
    "the newest verified ones and the failure stay open, in order",
  );
  assert.ok(titles.includes("FOLD Batches 1–5 · 25 ops · verified"), titles.join(" | "));
  assert.equal(titles.includes("Batch 5"), false, "older verified batches are inside the fold");
  assert.equal(titles.at(-1), "Vignette", "a change from outside any job never folds");
  assert.ok(sheetTitles(harness).includes("Needs a look · 1"));
  const fold = required(openSheet(harness).find((node) => node.classList.has("change-fold")));
  fold.click();
  assert.equal(openSheet(harness).all((node) => node.classList.has("change-row")).length, rows.length, "opening the fold shows every row");
});

test("the filter chips appear only once an outside agent has made a call or a change", () => {
  const without = withState([], [change("c1")]);
  openSheet(without);
  assert.equal(element(without, "sheet").all((node) => node.classList.has("filter-chips")).length, 0);
  const withMcp = withState([], [change("c1"), change("c2", { origin: "mcp", source: "claude-code", summary: "Vignette" })]);
  openSheet(withMcp);
  const chips = required(element(withMcp, "sheet").find((node) => node.classList.has("filter-chips")));
  assert.deepEqual(
    chips.all((node) => node.tagName === "BUTTON").map((node) => node.textContent),
    ["All", "Agent", "MCP"],
  );
  nth(
    chips.all((node) => node.tagName === "BUTTON"),
    2,
  ).click();
  assert.deepEqual(
    required(withMcp.el("sheet"))
      .all((node) => node.classList.has("change-row"))
      .map((node) => textsOf(node, "change-title")[0]),
    ["Vignette"],
  );
});
