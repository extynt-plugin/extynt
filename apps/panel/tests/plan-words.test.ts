/** The plain words of a plan card: its rows, its states, its checklist and the model pill. Pure, so no panel is booted. */
import assert from "node:assert/strict";
import test from "node:test";
import { modelPillText } from "../runtime/panel-model-label.js";
import { checklistOf, checklistSummary } from "../runtime/panel-plan-checks.js";
import { cardStateOf, chipFor, planRowsOf, rowWords, type PlanRowView } from "../runtime/panel-plan-labels.js";
import { planNoticeDecoder, planValueRowDecoder } from "../runtime/plan-content.js";
import { receiptDecoder } from "../runtime/receipt.js";
import { decodeOrThrow, type JsonObject } from "@extynt/decode";

const rows = (list: ReadonlyArray<JsonObject>): PlanRowView[] =>
  planRowsOf(
    list.map((fields) => decodeOrThrow(planValueRowDecoder, fields)),
    [],
  );

test("a row reads label · target: before → after", () => {
  assert.deepEqual(rows([{ label: "Animate Opacity", target: "TITLE", before: 0, after: 100 }]).map(rowWords), [
    "Animate Opacity · TITLE: 0 → 100",
  ]);
});

test("a row with no known before shows the after value alone, and never the word undefined", () => {
  const words = rows([
    { label: "Set the name", target: "BG", before: null, after: "Backdrop" },
    { label: "Set the name", target: "BG", after: "Backdrop" },
  ]).map(rowWords);
  assert.deepEqual(words, ["Set the name · BG: Backdrop", "Set the name · BG: Backdrop"]);
  for (const text of words) assert.doesNotMatch(text, /undefined|null/);
});

test("a row with no target or no values leaves them out, and an unchanged value shows once", () => {
  assert.deepEqual(
    rows([
      { label: "Add a layer", before: null, after: null },
      { label: "Set the work area", before: null, after: "0:00 to 0:05" },
      { label: "Scale", target: "LOGO", before: 100, after: 100 },
    ]).map(rowWords),
    ["Add a layer", "Set the work area: 0:00 to 0:05", "Scale · LOGO: 100"],
  );
});

const CARD_STATES: ReadonlyArray<readonly [string, string]> = [
  ["draft", "drafting"],
  ["prepared", "waiting"],
  ["presented", "waiting"],
  ["approved", "applying"],
  ["applying", "applying"],
  ["verified", "applied"],
  ["applied", "applied"],
  ["applied_unverified", "unverified"],
  ["undone", "undone"],
  ["partially_undone", "undone"],
  ["failed", "failed"],
  ["undo_unverified", "failed"],
  ["cancelled", "discarded"],
];

test("every plan status draws one of the card's states", () => {
  for (const [status, state] of CARD_STATES) assert.equal(cardStateOf(status), state, status);
  assert.equal(chipFor("draft", false).label, "Drafting");
});

test("the checklist follows the host's outcome for each change, with the row's words", () => {
  const list = rows([
    { label: "Animate Opacity", target: "TITLE", before: 0, after: 100 },
    { label: "Set an expression", target: "TITLE", before: null, after: null },
    { label: "Rename", target: "BG", before: "BG", after: "Backdrop" },
  ]);
  const receipt = decodeOrThrow(receiptDecoder, {
    operationOutcomes: [
      { index: 0, type: "animate_property", outcome: "confirmed" },
      { index: 1, type: "set_expression", outcome: "applied_unconfirmed" },
      { index: 2, type: "set_layer_name", outcome: "failed_during_apply", error: { code: "LOCKED", message: "The layer is locked." } },
    ],
  });
  const items = checklistOf({ rows: list, status: "failed", notices: [], receipt });
  assert.deepEqual(
    items.map((item) => item.mark),
    ["ok", "unknown", "bad"],
  );
  assert.equal(items[0]?.label, "Animate Opacity · TITLE: 0 → 100");
  assert.equal(items[2]?.note, "The layer is locked.");
  assert.deepEqual(checklistSummary(items), { text: "3 changes · 1 failed", tone: "bad" });
});

test("without the receipt the checklist reads the status and the unchecked notices", () => {
  const list = rows([
    { label: "A", before: null, after: null },
    { label: "B", before: null, after: null },
    { label: "C", before: null, after: null },
  ]);
  const notices = [decodeOrThrow(planNoticeDecoder, { severity: "unverified", title: "x", operationIndexes: [1] })];
  const items = checklistOf({ rows: list, status: "applied_unverified", notices, receipt: null });
  assert.deepEqual(
    items.map((item) => item.mark),
    ["ok", "unknown", "ok"],
  );
  assert.deepEqual(checklistSummary(items), { text: "3 changes · 1 not checked", tone: "warn" });
  assert.deepEqual(checklistSummary(checklistOf({ rows: list, status: "verified", notices: [], receipt: null })), {
    text: "3 changes ✓",
    tone: "ok",
  });
  assert.deepEqual(checklistOf({ rows: list, status: "failed", notices: [], receipt: null }), []);
  assert.deepEqual(
    checklistSummary(
      checklistOf({ rows: rows([{ label: "A", before: null, after: null }]), status: "verified", notices: [], receipt: null }),
    ),
    { text: "1 change ✓", tone: "ok" },
  );
});

test("the model pill names the model and the effort, and leaves out what is unknown", () => {
  assert.equal(modelPillText("claude-sonnet-4-5-20250929", "high"), "Sonnet 4.5 · High");
  assert.equal(modelPillText("claude-opus-4", "default"), "Opus 4");
  assert.equal(modelPillText("Claude Sonnet 5.5", undefined), "Sonnet 5.5");
  assert.equal(modelPillText("deepseek-v4", "medium"), "deepseek-v4 · Medium");
  assert.equal(modelPillText("openrouter/some-very-long-model-identifier-2025", undefined), "some-very-long-mo…");
  assert.equal(modelPillText(undefined, "low"), "Low");
  assert.equal(modelPillText(undefined, undefined), "");
});
