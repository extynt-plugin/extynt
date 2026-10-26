/** Panel contract: before and after frames only for plans a frame can show, Undo that waits for the sidecar's answer, and the plan list's own event. */
import assert from "node:assert/strict";
import test from "node:test";
import { allButtonsFor, bar, harnessWithPlanCard, openedChange, openSheet, planCard, planRow, required, textsOf, toolCalls } from "./contract-helpers.js";
import { createPanelHarness, PNG, type PanelHarness } from "./contract.test.js";
import type { FakeSession } from "./contract-xhr.js";
import { type JsonObject } from "@extynt/decode";
import { patchPlan } from "./contract-xhr.js";

const FRAME = { dataUrl: PNG, width: 240, height: 135 };
const classed = (harness: PanelHarness, name: string): number => openedChange(harness).all((node) => node.classList.has(name)).length;
const applyIt = (harness: PanelHarness): void => {
  required(required(harness.el("status-bar")).find((node) => node.tagName === "BUTTON" && node.textContent === "Apply")).click();
};

function restored(plans: Array<JsonObject>): PanelHarness {
  const at = Date.now() - 60000;
  const messages: JsonObject[] = [
    { kind: "user", text: "fade it", at },
    {
      kind: "plan",
      planId: "p1",
      text: "Fade in the title",
      status: "verified",
      rows: [],
      operations: ["animate_property"],
      notices: [],
      warnings: [],
      expressions: [],
      at,
    },
  ];
  const session: FakeSession = { id: "s1", title: "Fade", project: "Fixture.aep", createdAt: at, updatedAt: at, messages };
  return createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.sessions.set("s1", session);
      sidecar.current = "s1";
      sidecar.plans = plans;
    },
  });
}

test("a plan no frame can show draws no frames and no skeletons, and never asks for them", () => {
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1", { visual: false })], {
    sidecar: (sidecar) => {
      sidecar.thumbs.set("p1", { before: FRAME, after: FRAME });
    },
  });
  applyIt(harness);
  assert.equal(classed(harness, "thumb-pair") + classed(harness, "thumb-skeleton") + classed(harness, "thumb-slot"), 0);
  assert.equal(harness.requestsTo("/v1/thumbs/p1").length, 0);
});

test("a visual plan that has only its after frame still draws it, beside an empty before cell", () => {
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1", { visual: true })], {
    sidecar: (sidecar) => {
      sidecar.thumbs.set("p1", { after: FRAME });
    },
  });
  applyIt(harness);
  assert.equal(openedChange(harness).all((node) => node.tagName === "IMG").length, 1);
  assert.equal(classed(harness, "thumb-empty"), 1, "the before cell keeps the pair's shape");
  assert.equal(classed(harness, "thumb-skeleton"), 0, "and does not pulse as if a frame were coming");
});

test("a before frame that arrives after the after frame completes the pair", () => {
  const harness = harnessWithPlanCard(planCard("p1"), [planRow("p1", { visual: true })], {
    sidecar: (sidecar) => {
      sidecar.thumbs.set("p1", { after: FRAME });
    },
  });
  applyIt(harness);
  harness.sidecar.thumbs.set("p1", { before: FRAME, after: FRAME });
  harness.sse("thumbs", { planId: "p1" });
  assert.equal(openedChange(harness).all((node) => node.tagName === "IMG").length, 2);
  assert.equal(classed(harness, "thumb-empty"), 0);
});

test("a restored chat offers no Undo until the change list says it is safe, and reads that list when the chat opens", () => {
  const unknown = restored([]);
  assert.equal(unknown.requestsTo("/v1/changes").length > 0, true, "the change list is read when the chat is restored");
  assert.equal(allButtonsFor(unknown, "Undo").length, 0, "the thread has no Undo at all; the sheet's rows come from the list");
  openSheet(unknown);
  assert.equal(allButtonsFor(unknown, "Undo").length, 0, "the list has no such change, so there is nothing to undo");
  const known = restored([planRow("p1", { status: "verified" })]);
  openSheet(known);
  assert.equal(allButtonsFor(known, "Undo").length, 1);
});

test("a failed change that may have reached After Effects says Partly applied in the changes list", () => {
  const entry = (planId: string, mayHaveMutated: boolean): JsonObject => ({
    planId,
    summary: "Change " + planId,
    appliedAt: new Date().toISOString(),
    operations: 2,
    status: "failed",
    mayHaveMutated,
    undoGroupsRemaining: 0,
    undo: { available: false, code: "NOTHING_CHANGED", reason: "nothing was changed" },
    source: "panel",
    jobId: null,
    batch: null,
    origin: "chat",
  });
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.changes = [entry("c1", true), entry("c2", false)];
    },
  });
  const pills = openSheet(harness)
    .all((node) => node.classList.has("change-row"))
    .map((row) => textsOf(row, "pill")[0]);
  assert.deepEqual(pills, ["Partly applied", "Didn't apply"]);
});

test("a plans event reads the plan list again, and an expired plan is not waiting", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.plans = [planRow("p1", { approvalExpired: false })];
    },
  });
  assert.equal(bar(harness).state, "needs-you");
  const before = toolCalls(harness, "ae_list_plans").length;
  patchPlan(harness.sidecar, "p1", { approvalExpired: true });
  harness.sse("plans", { reason: "expired", planId: null });
  assert.equal(toolCalls(harness, "ae_list_plans").length, before + 1);
  assert.equal(bar(harness).state, "idle");
});

test("a plan from the in-panel chat is attributed to extynt and an external one to an agent", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.plans = [planRow("p1", { source: "panel" }), planRow("p2", { source: "agent" }), planRow("p3", { source: null })];
    },
  });
  const sources = openSheet(harness)
    .all((node) => node.classList.has("sheet-item"))
    .map((item) =>
      (
        textsOf(item, "plan-sub")
          .join(" ")
          .match(/Source: ([^·]+) ·/)?.[1] ?? ""
      ).trim(),
    );
  assert.deepEqual(sources.sort(), ["An agent", "An agent", "extynt"]);
});
