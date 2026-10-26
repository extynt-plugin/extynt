/** Fixtures the sheet suites share: waiting plans, change rows, a panel booted over them, and readers for the open sheet. */
import { StubElement } from "./contract-dom.js";
import { openSheet, planRow, textsOf, toolCalls } from "./contract-helpers.js";
import { createPanelHarness, type PanelHarness } from "./contract.test.js";
import { type JsonObject } from "@extynt/decode";

/** One minute in milliseconds. */
export const MINUTE = 60000;
/** An ISO time the given number of milliseconds in the past. */
export const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

/** A plan row waiting for the reader, proposed three minutes ago. */
export const waiting = (planId: string, title: string, extra: JsonObject = {}): JsonObject =>
  planRow(planId, { updatedAt: ago(3 * MINUTE), presentation: { title, values: [], notices: [], warnings: [] }, ...extra });
/** A verified change row, applied five minutes ago, unless `extra` says otherwise. */
export const change = (planId: string, extra: JsonObject = {}): JsonObject => ({
  planId,
  summary: "Change " + planId,
  appliedAt: ago(5 * MINUTE),
  operations: 3,
  status: "verified",
  undoGroupsRemaining: 1,
  undo: { available: true },
  source: "panel",
  jobId: null,
  batch: null,
  origin: "chat",
  ...extra,
});
/** A panel booted over a sidecar that already holds the given plans and changes. */
export const withState = (
  plans: Array<JsonObject>,
  changes: Array<JsonObject> = [],
  extra: Parameters<typeof createPanelHarness>[0] = {},
): PanelHarness =>
  createPanelHarness({
    ...extra,
    sidecar: (sidecar) => {
      sidecar.plans = plans;
      sidecar.changes = changes;
      extra.sidecar?.(sidecar);
    },
  });
/** The Waiting rows of the open sheet. */
export const waitingRows = (harness: PanelHarness): StubElement[] => openSheet(harness).all((node) => node.classList.has("sheet-item"));
/** The change rows of the open sheet. */
export const changeRows = (harness: PanelHarness): StubElement[] => openSheet(harness).all((node) => node.classList.has("change-row"));
/** The status pill text of a change row. */
export const pill = (row: StubElement): string => textsOf(row, "pill")[0] ?? "";
/** How many times the panel has read the changes and the plans. */
export const reads = (harness: PanelHarness): { changes: number; plans: number } => ({
  changes: harness.requestsTo("/v1/changes").length,
  plans: toolCalls(harness, "ae_list_plans").length,
});
/** A job checklist from (id, phase, status) triples, with `at` as the current item. */
export const checklist = (items: Array<[string, string, "open" | "verified"]>, at?: string): JsonObject => {
  const list = items.map(([id, phase, status], index) => ({
    id,
    title: "Item " + id,
    phase,
    status,
    ...(status === "verified" ? { verifiedAt: new Date(Date.now() - (items.length - index) * 60000).toISOString() } : {}),
  }));
  const phases = [...new Set(list.map((item) => item.phase))].map((name) => ({
    name,
    verified: list.filter((item) => item.phase === name && item.status === "verified").length,
    total: list.filter((item) => item.phase === name).length,
  }));
  return { items: list, phases, current: at ?? list.find((item) => item.status === "open")?.id ?? null };
};
