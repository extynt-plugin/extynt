/** Panel contract: the status bar in the real panel. Blocked, offline, After Effects busy and setup: their words, roles, actions and precedence. */
import assert from "node:assert/strict";
import test from "node:test";
import { allButtonsFor, bar, barButton, buttonsNamed, element, hostEventBody, jobPayload, openSheet, present } from "./contract-helpers.js";
import { createPanelHarness, testNow, type FakeSidecar, type PanelHarness } from "./contract.test.js";
import { recordAt } from "./json-narrow.js";
import { type JsonValue } from "@extynt/decode";

const BLOCKED = "extynt paused changes: it couldn't confirm the last one finished.";
const BUSY = "After Effects has a dialog or menu open. extynt continues when it closes.";
const RECONNECTING = "Reconnecting to extynt…";
const HELPER = "extynt's helper isn't running. It normally restarts by itself.";
const SETUP = "Set up a model to start.";
const AWAY = "Waiting for After Effects";
const BUSY_HOST = { state: "stalled", stall: { verdict: "ae-busy", waitedMs: 5000, idleAgeMs: 4000 } };

function quarantined(kind: string): (sidecar: FakeSidecar) => void {
  return (sidecar) => {
    sidecar.quarantine = { accessKind: kind };
  };
}
function wait(harness: PanelHarness, ms: number): void {
  harness.advance(ms);
  harness.runTimeouts((timer) => timer.ms <= 10000);
}
function sidecarDown(harness: PanelHarness): void {
  harness.dropStream();
}
function downAfterBoot(): { harness: PanelHarness; recover: () => void } {
  let down = false;
  const harness = createPanelHarness({ respond: (record) => (down && !record.url.endsWith("/v1/ui/events") ? { fail: true } : undefined) });
  down = true;
  return {
    harness,
    recover: () => {
      down = false;
    },
  };
}

test("a healthy panel is a slim idle strip that says it is ready, and announces nothing", () => {
  const harness = createPanelHarness();
  const view = bar(harness);
  assert.deepEqual([view.state, view.tone, view.role], ["idle", "quiet", "status"]);
  assert.match(view.text, /^Ready/);
  assert.equal(harness.el("bar-announce")?.textContent, "");
  assert.deepEqual(view.actions, [], "an idle bar has no buttons: there is nothing to stop or decide");
});

test("a paired host whose first read has not landed is not Ready: the strip waits for the project, then clears", () => {
  const booted = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.awaitingSnapshot = true;
    },
  });
  assert.equal(bar(booted).text, "Waiting for the project");
  booted.sse("host", hostEventBody("online", {}, { awaitingSnapshot: false }));
  assert.match(bar(booted).text, /^Ready/);
  const harness = createPanelHarness();
  assert.match(bar(harness).text, /^Ready/);
  harness.sse("host", hostEventBody("online", {}, { awaitingSnapshot: true }));
  assert.equal(bar(harness).text, "Waiting for the project");
  harness.sse("host", hostEventBody("online"));
  assert.match(bar(harness).text, /^Ready/, "an event that does not say it is waiting means the read landed");
});

test("blocked: a quarantine at boot is a red alert with What happened, and is announced", () => {
  const harness = createPanelHarness({ sidecar: quarantined("mutation") });
  assert.deepEqual(bar(harness), { state: "blocked", tone: "red", role: "alert", text: BLOCKED, sub: "", actions: ["What happened"] });
  assert.equal(harness.el("bar-announce")?.textContent, BLOCKED);
});

test("blocked arrives live in a host event, and is announced once, not again by later events", () => {
  const harness = createPanelHarness();
  harness.sse("host", hostEventBody("online", {}, { nativeAccessQuarantine: { accessKind: "read" } }));
  assert.equal(bar(harness).state, "blocked");
  assert.equal(harness.el("bar-announce")?.textContent, BLOCKED);
  const announce = element(harness, "bar-announce");
  announce.textContent = "";
  harness.sse("host", hostEventBody("online", {}, { nativeAccessQuarantine: { accessKind: "read" } }));
  assert.equal(announce.textContent, "", "still blocked is not news");
});

test("What happened lifts the sheet to the Connection section with the native steps and a Done button", () => {
  const harness = createPanelHarness({ sidecar: quarantined("mutation") });
  assert.equal(harness.el("sheet")?.hidden, true);
  barButton(harness, "help")?.click();
  const sheet = element(harness, "sheet");
  assert.equal(sheet.hidden, false);
  assert.match(sheet.textContent, /extynt paused changes/);
  assert.match(sheet.textContent, /never heard back whether it finished\. The change may or may not have happened/);
  const steps = sheet.all((node) => node.tagName === "LI").map((node) => node.textContent);
  assert.equal(steps.length, 4);
  assert.match(steps[0] ?? "", /Give After Effects a minute/);
  assert.match(steps[1] ?? "", /quit it\. If it asks to save, look over the project first/);
  assert.match(steps[2] ?? "", /Reopen After Effects and your project/);
  assert.match(steps[3] ?? "", /Press Done/);
  assert.equal(buttonsNamed(sheet, "Done").length, 1);
  assert.match(sheet.textContent, /Still blocked after that\? Restart After Effects/);
});

test("the steps explain the kind of call that never answered: a change, a read, or unknown", () => {
  const words = (kind: JsonValue): string => {
    const harness = createPanelHarness({
      sidecar: (sidecar) => {
        sidecar.quarantine = kind;
      },
    });
    barButton(harness, "help")?.click();
    return (
      harness
        .el("sheet")
        ?.all((node) => node.tagName === "P")
        .map((node) => node.textContent)[1] ?? ""
    );
  };
  assert.match(words({ accessKind: "mutation" }), /never heard back whether it finished/);
  assert.match(words({ accessKind: "read" }), /to read your project and never heard back/);
  assert.match(words({ accessKind: "something else" }), /cannot confirm that After Effects finished its last request/);
  assert.match(words({}), /cannot confirm that After Effects finished its last request/);
});

test("Done asks the sidecar again and clears the block only when the sidecar reports none", () => {
  const harness = createPanelHarness({ sidecar: quarantined("mutation") });
  barButton(harness, "help")?.click();
  const before = harness.requestsTo("/v1/ui/bootstrap").length;
  buttonsNamed(element(harness, "sheet"), "Done")[0]?.click();
  assert.equal(harness.requestsTo("/v1/ui/bootstrap").length, before + 1, "Done re-reads the bootstrap");
  assert.equal(bar(harness).state, "blocked");
  assert.match(element(harness, "sheet").textContent, /Still blocked\. Work through the steps above, then press Done again\./);
  harness.sidecar.quarantine = null;
  buttonsNamed(element(harness, "sheet"), "Done")[0]?.click();
  assert.notEqual(bar(harness).state, "blocked");
  assert.doesNotMatch(element(harness, "sheet").textContent, /Press Done/);
});

test("offline: a short outage shows nothing, then Reconnecting, then the helper words with Try again", () => {
  const { harness } = downAfterBoot();
  sidecarDown(harness);
  assert.equal(bar(harness).state, "idle", "under three seconds is not worth a bar state");
  wait(harness, 2000);
  assert.equal(bar(harness).state, "idle");
  wait(harness, 1000);
  assert.deepEqual(bar(harness), { state: "offline", tone: "grey", role: "status", text: RECONNECTING, sub: "", actions: [] });
  wait(harness, 6000);
  assert.equal(bar(harness).text, RECONNECTING, "ten seconds have not passed yet");
  wait(harness, 1500);
  assert.deepEqual(bar(harness), { state: "offline", tone: "grey", role: "status", text: HELPER, sub: "", actions: ["Try again"] });
  assert.equal(harness.el("bar-announce")?.textContent, "", "only a block is announced");
});

test("Try again reads the bootstrap again: still down keeps the bar, back up clears it", () => {
  const { harness, recover } = downAfterBoot();
  sidecarDown(harness);
  wait(harness, 3000);
  wait(harness, 8000);
  const before = harness.requestsTo("/v1/ui/bootstrap").length;
  barButton(harness, "retry")?.click();
  assert.equal(harness.requestsTo("/v1/ui/bootstrap").length, before + 1);
  assert.equal(bar(harness).text, HELPER);
  recover();
  barButton(harness, "retry")?.click();
  assert.equal(bar(harness).state, "idle");
});

test("a host that is not connected gets the same grace period before it is called away", () => {
  for (const state of ["offline", "connecting", "closing"]) {
    const harness = createPanelHarness();
    harness.sse("host", hostEventBody(state));
    assert.equal(bar(harness).state, "idle", state + " right away");
    wait(harness, 3000);
    assert.equal(bar(harness).text, AWAY, state + " after three seconds");
  }
  const unresponsive = createPanelHarness();
  unresponsive.sse("host", hostEventBody("stalled", { stall: { verdict: "plugin-unresponsive", waitedMs: 20000, idleAgeMs: null } }));
  wait(unresponsive, 3000);
  assert.equal(bar(unresponsive).text, AWAY);
});

test("a host that has been down for a while says After Effects is away, and online clears it", () => {
  const harness = createPanelHarness();
  harness.sse("host", hostEventBody("offline", { since: testNow() - 20000 }));
  const view = bar(harness);
  assert.deepEqual([view.state, view.tone, view.text], ["offline", "grey", AWAY]);
  assert.match(view.sub, /Open After Effects with the extynt panel in it/);
  harness.sse("host", hostEventBody("online"));
  assert.equal(bar(harness).state, "idle", "online again");
});

test("busy: an After Effects dialog is a grey bar that says when it continues, with no button", () => {
  const harness = createPanelHarness();
  harness.sse("host", hostEventBody("stalled", BUSY_HOST));
  assert.deepEqual(bar(harness), { state: "offline", tone: "grey", role: "status", text: BUSY, sub: "", actions: [] });
  assert.equal(harness.el("bar-announce")?.textContent, "");
  harness.sse("host", hostEventBody("online"));
  assert.equal(bar(harness).state, "idle");
});

test("busy: a dialog the plugin saw open is named in the bar", () => {
  const harness = createPanelHarness();
  const dialog = { title: "Select a LUT file", sinceMs: 2500 };
  harness.sse("host", hostEventBody("stalled", { stall: { verdict: "ae-busy", waitedMs: 5000, idleAgeMs: 4000, dialog } }));
  assert.equal(bar(harness).text, "After Effects is waiting for you in the “Select a LUT file” window");
});

test("experimental: an After Effects newer than any tested is a one-line amber warning, and clears when the host is not experimental", () => {
  const harness = createPanelHarness();
  harness.sse("host", hostEventBody("online", { aeVersion: "27.1.0 (build 3)", experimental: true }));
  const view = bar(harness);
  assert.deepEqual(
    [view.state, view.tone, view.text, view.actions],
    ["locked", "amber", "After Effects 27.1.0 (build 3) is experimental: extynt has not been tested on it. Check each result.", []],
  );
  harness.sse("host", hostEventBody("stalled", { ...BUSY_HOST, aeVersion: "27.1.0", experimental: true }));
  assert.equal(bar(harness).tone, "grey", "a dialog outranks the warning");
  harness.sse("host", hostEventBody("online", { aeVersion: "26.5.0" }));
  assert.equal(bar(harness).state, "idle");
});

test("older: an After Effects below 25 is a red alert that names the version and the floor, and clears on 25", () => {
  const harness = createPanelHarness();
  harness.sse("host", hostEventBody("online", { aeVersion: "24.6.0 (build 3)" }));
  const view = bar(harness);
  assert.deepEqual(
    [view.state, view.tone, view.role, view.text],
    [
      "blocked",
      "red",
      "alert",
      "After Effects 24.6.0 (build 3) is too old for extynt. Update to After Effects 25 or later; extynt won't read or change this project.",
    ],
  );
  harness.sse("host", hostEventBody("offline", { aeVersion: "24.6.0" }));
  assert.equal(bar(harness).state, "idle", "an offline host is not called old");
  harness.sse("host", hostEventBody("online", { aeVersion: "25.0" }));
  assert.equal(bar(harness).state, "idle");
});

test("a merely slow host is not worth a bar state", () => {
  const harness = createPanelHarness();
  harness.sse("host", hostEventBody("stalled", { stall: { verdict: "slow", waitedMs: 8000, idleAgeMs: null } }));
  assert.equal(bar(harness).state, "idle");
});

test("setup: with no model the bar points at the first-run card in an empty chat, and at Provider & keys once there is history", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.modelConfigured = false;
    },
  });
  const view = bar(harness);
  assert.deepEqual([view.state, view.tone, view.text, view.actions], ["locked", "amber", SETUP, ["Set up"]]);
  const key = present(
    element(harness, "chat-output").find((node) => node.tagName === "INPUT"),
    "the first-run card's key field",
  );
  barButton(harness, "setup")?.click();
  assert.equal(key.focused > 0, true, "an empty chat: the card takes focus, no second form opens");
  assert.equal(harness.el("page")?.classList.has("open"), false);
  harness.send("hello");
  barButton(harness, "setup")?.click();
  assert.equal(harness.el("page")?.classList.has("open"), true);
  assert.equal(harness.el("page-title")?.textContent, "Settings");
  assert.equal(harness.el("acc-model")?.getAttribute("aria-expanded"), "true");
});

test("precedence: blocked, then offline, then a decision, then setup", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.quarantine = { accessKind: "mutation" };
      sidecar.modelConfigured = false;
      sidecar.host = recordAt(hostEventBody("stalled", BUSY_HOST), "host");
    },
  });
  assert.equal(bar(harness).state, "blocked");
  harness.sse("host", hostEventBody("stalled", BUSY_HOST));
  assert.equal(bar(harness).state, "offline", "blocked cleared, a busy host outranks setup");
  harness.sse("host", hostEventBody("offline", { since: testNow() - 20000 }));
  assert.equal(bar(harness).text, AWAY, "away outranks setup");
  harness.sse("host", hostEventBody("offline", { since: testNow() - 20000 }, { nativeAccessQuarantine: { accessKind: "read" } }));
  assert.equal(bar(harness).state, "blocked", "blocked outranks offline");
  harness.sse("host", hostEventBody("online"));
  assert.equal(bar(harness).text, SETUP, "only setup is left");
});

test("an unreachable sidecar outranks a busy host that was last reported before it went away", () => {
  const { harness } = downAfterBoot();
  harness.sse("host", hostEventBody("stalled", BUSY_HOST));
  assert.equal(bar(harness).text, BUSY);
  sidecarDown(harness);
  wait(harness, 3000);
  assert.equal(bar(harness).text, RECONNECTING);
});

test("a job keeps its Stop through every grey state, and the helper being down shows Try again instead", () => {
  const harness = createPanelHarness();
  harness.sse("activity", {
    jobs: [
      jobPayload({
        checklist: {
          items: [
            { id: "a-1", title: "A", phase: "a", status: "verified" },
            { id: "a-2", title: "B", phase: "a", status: "open" },
          ],
          phases: [{ name: "a", verified: 1, total: 2 }],
          current: "a-2",
        },
      }),
    ],
  });
  harness.sse("host", hostEventBody("offline", { since: testNow() - 20000 }));
  const view = bar(harness);
  assert.equal(view.text, AWAY);
  assert.deepEqual(view.actions, ["Stop"]);
  assert.match(view.sub, /Job paused · 1\/2 · cycle 3/);
  assert.equal(allButtonsFor(harness, "Stop").length, 1);
  assert.match(element(harness, "status-bar").textContent, /ETA resumes when connected/);
  openSheet(harness);
  assert.equal(allButtonsFor(harness, "Stop").length, 1, "the open sheet's head is this bar: still one Stop");
});

test("with no turn open (after cycle 1, or a reloaded panel) the bar shows cycle and step from the activity job, next to the checklist count", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.jobs = [
        jobPayload({
          cycle: 2,
          step: 14,
          activity: "title card entrance",
          checklist: {
            items: [
              { id: "a-1", title: "A", phase: "a", status: "verified" },
              { id: "a-2", title: "B", phase: "a", status: "open" },
            ],
            phases: [{ name: "a", verified: 1, total: 2 }],
            current: "a-2",
          },
        }),
      ];
    },
  });
  const node = element(harness, "status-bar");
  assert.equal(bar(harness).state, "working", "a reattached panel shows the running job");
  assert.deepEqual(bar(harness).actions, ["Stop"]);
  assert.equal(node.querySelector(".bar-count")?.textContent, "1/2 · cycle 2 · step 14");
  harness.sse("activity", { jobs: [jobPayload({ cycle: 2, step: 15, activity: "title card entrance" })] });
  assert.equal(
    element(harness, "status-bar").querySelector(".bar-count")?.textContent,
    "cycle 2 · step 15",
    "the step keeps moving from the stream with no chat request open",
  );
});
