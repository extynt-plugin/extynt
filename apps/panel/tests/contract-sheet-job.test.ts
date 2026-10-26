/** Panel contract: the sheet for a running job and for a dropped link: phases, checklist, Now with specialists, Connection. */
import assert from "node:assert/strict";
import test from "node:test";
import { allButtonsFor, jobPayload, nth, openSheet, required, sheetTitles, textsOf } from "./contract-helpers.js";
import { createPanelHarness, testNow, type PanelHarness } from "./contract.test.js";
import { checklist, withState } from "./contract-sheet-fixtures.js";

function runningLaunchFilm(): PanelHarness {
  const list = checklist([
    ["lay-1", "lay", "verified"],
    ["lay-2", "lay", "verified"],
    ["typ-1", "typ", "verified"],
    ["typ-2", "typ", "open"],
    ["typ-3", "typ", "open"],
    ["mot-1", "mot", "open"],
  ]);
  const specialists = [
    { role: "designer", state: "running", startedAt: new Date(Date.now() - 100000).toISOString(), elapsedMs: null, label: "Designer" },
    { role: "reviewer", state: "done", startedAt: new Date().toISOString(), elapsedMs: 12000, label: "Reviewer" },
  ];
  return createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.jobs = [jobPayload({ checklist: list, specialists })];
    },
  });
}

test("the sheet's head for a running job: the phases, the checklist with the current phase open, Now with specialists, and the spend", () => {
  const harness = runningLaunchFilm();
  const sheet = openSheet(harness);
  assert.deepEqual(sheetTitles(harness), ["Now", "Checklist · cycle 3"]);
  assert.match(nth(textsOf(sheet, "sheet-job"), 0), /Build a launch film · 3 of 6 items/);
  assert.deepEqual(textsOf(sheet, "sheet-phase"), ["lay 2/2", "typ 1/3", "mot 0/1"]);
  const now = required(sheet.find((node) => node.classList.has("sheet-section")));
  assert.deepEqual(
    now.all((node) => node.classList.has("now-row")).map((row) => textsOf(row, "role-tag")[0]),
    ["main", "Designer", "Reviewer"],
  );
  const nowRows = now.all((node) => node.classList.has("now-row"));
  assert.match(nth(nowRows, 1).textContent, /working.*1:40/);
  assert.match(nth(nowRows, 2).textContent, /finished.*0:12/);
  const phases = sheet.all((node) => node.classList.has("check-phase"));
  assert.deepEqual(
    phases.map((phase) => phase.all((node) => node.classList.has("check-row")).length),
    [0, 3, 0],
    "only the current phase is open; the rest are counts",
  );
  assert.deepEqual(
    phases.map((phase) => textsOf(phase, "check-count")[0]),
    ["2 of 2", "1 of 3", "0 of 1"],
  );
  assert.equal(allButtonsFor(harness, "Stop").length, 1, "the sheet's head is the bar: one Stop");
});

test("Connection appears only when a link is down, and the spend line only once a job has spent something", () => {
  const harness = withState([]);
  assert.equal(sheetTitles(harness).includes("Connection"), false);
  harness.sse("host", {
    host: {
      state: "offline",
      since: testNow() - 20000,
      pluginVersion: "0.1.0",
      aeVersion: "26.2",
      idleAgeMs: null,
      stall: null,
      busyKind: null,
    },
    hostInstanceId: "native:1:1",
    nativeAccessQuarantine: null,
  });
  assert.equal(sheetTitles(harness).includes("Connection"), true);
  const text = required(
    openSheet(harness).find((node) => node.classList.has("link-row") && /After Effects/.test(node.textContent)),
  ).textContent;
  assert.match(text, /not connected/);
});
