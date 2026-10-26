/**
 * Panel contract: Memory in Settings. The "Learn from my work" switch reflects the sidecar and reverts when a save fails,
 * "Forget what it learned" takes two presses, "Document this plugin" posts the right key and stays usable with hundreds of
 * plugins. The notes history is in contract-memory-notes.
 * Settings load when the tab opens (and after bootstrap when it is already open), never on a timer, and no error code
 * reaches the user.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPanelHarness } from "./contract.test.js";
import { declarationsFor, readPanelStyles } from "./panel-styles.js";
import { element, nth } from "./contract-helpers.js";

import { ok, world, callsTo, openSettings, text, status, type, only, pluginBoxes, boxFor, withoutCodes, pressTwice } from "./contract-memory-fixtures.js";

test("Memory is in Settings, off for every plugin until chosen, and its learn switch is on by default with one plain sentence", () => {
  const html = readFileSync("apps/panel/index.html", "utf8");
  const settings = html.slice(html.indexOf('data-panel="settings"'), html.indexOf('data-panel="debug"'));
  assert.ok(
    settings.includes('id="memory-section"') &&
      settings.indexOf('id="approvals-section"') < settings.indexOf('id="memory-section"') &&
      settings.indexOf('id="memory-section"') < settings.indexOf('id="agents-section"'),
    "its own accordion row between Approvals and Agents",
  );
  assert.match(settings, /<input id="learn-from-work" type="checkbox" checked>/);
  assert.match(settings, /Learns locally from values you keep and effects you use, and never leaves this computer\./);
  assert.match(settings, /<button id="memory-forget"[^>]*>Forget what it learned<\/button>/);
  assert.match(settings, /Lets an agent write labelled guesses about what a plugin's controls do\./);
  assert.match(settings, /id="memory-plugins" class="memory-plugins"/);
  assert.ok(
    declarationsFor(readPanelStyles(), ".memory-plugins").every((block) => !/overflow|max-height/.test(block)),
    "the list never scrolls inside the page: the code bounds the rows drawn",
  );
  assert.match(settings, /id="memory-status"[^>]*role="status"/);
});

test("opening Settings reads what the sidecar holds, once, and nothing polls it", () => {
  const w = world({ learn: false });
  assert.equal(callsTo(w, "/v1/notes/settings").length, 0, "not read at startup while Settings is closed");
  openSettings(w);
  assert.equal(callsTo(w, "/v1/notes/settings").length, 1);
  assert.equal(element(w.harness, "learn-from-work").checked, false, "reflects the sidecar");
  assert.deepEqual(
    pluginBoxes(w).map((box) => [box.getAttribute("aria-label"), box.checked]),
    [
      ["Document Stylize", true],
      ["Document Blur", false],
    ],
    "opted-in plugins first",
  );
  for (let round = 0; round < 5; round += 1) {
    w.harness.runIntervals();
    w.harness.advance(60000);
    w.harness.runTimeouts();
  }
  assert.equal(callsTo(w, "/v1/notes/settings").length, 1, "not polled");
  w.harness.click("page-back");
  w.sidecar.learn = true;
  openSettings(w);
  assert.equal(callsTo(w, "/v1/notes/settings").length, 2, "read again each time Settings opens");
  assert.equal(element(w.harness, "learn-from-work").checked, true);
});

test("Settings shows one line of what has been learned so far, drops what is zero, and Forget clears it", () => {
  const w = world({ learned: { effects: 3, fonts: 1, presets: 0, animationSeconds: 0.6 } });
  openSettings(w);
  assert.equal(text(w, "memory-learned"), "Learned so far: 3 effects, 1 font, animations ~0.6 s");
  pressTwice(w, only([element(w.harness, "memory-forget")]));
  assert.equal(callsTo(w, "/v1/notes/usage/forget").length, 1);
  assert.equal(text(w, "memory-learned"), "", "nothing is left to show after Forget");
  const fresh = world({ learned: { effects: 0, fonts: 0, presets: 0, animationSeconds: null } });
  openSettings(fresh);
  assert.equal(text(fresh, "memory-learned"), "", "no line until something is learned");
  const older = world();
  openSettings(older);
  assert.equal(text(older, "memory-learned"), "", "an older sidecar sends no counts");
  assert.match(readFileSync("apps/panel/index.html", "utf8"), /id="memory-learned" class="memory-status" role="status"/);
});

test("boot reads the memory settings only when Settings is already on screen once the panel has started", () => {
  const closed = world();
  assert.equal(callsTo(closed, "/v1/notes/settings").length, 0, "not read at startup while Settings is closed");
  const early = createPanelHarness({
    respond: (record) =>
      record.url.endsWith("/v1/ui/bootstrap")
        ? { hold: true }
        : record.url.includes("/v1/notes/settings")
          ? ok({ learnFromWork: false, optedIn: [], plugins: [] })
          : undefined,
  });
  early.click("open-settings");
  assert.equal(early.requestsTo("/v1/notes/settings").length, 1, "read as soon as the page opened");
  assert.equal(element(early, "learn-from-work").checked, false);
  nth(
    early.held().filter((xhr) => xhr.url.endsWith("/v1/ui/bootstrap")),
    0,
  ).respond(
    200,
    JSON.stringify({
      ok: true,
      sidecarVersion: "0.1.0",
      uiBuild: null,
      host: early.sidecar.host,
      hostInstanceId: "native:1:1",
      prefs: early.sidecar.prefs,
      currentSessionId: null,
      nativeAccessQuarantine: null,
      focus: null,
      project: "Fixture.aep",
    }),
  );
  assert.equal(early.requestsTo("/v1/notes/settings").length, 2, "and again once the bootstrap has come in, as Settings is on screen");
});

test("the learn switch posts the new value, keeps it when saved, and reverts with a plain sentence when the save fails", () => {
  const w = world();
  openSettings(w);
  const box = element(w.harness, "learn-from-work");
  box.checked = false;
  box.dispatch("change");
  assert.deepEqual(
    callsTo(w, "/v1/notes/learn-from-work").map((call) => call.body),
    [{ enabled: false }],
  );
  assert.equal(box.checked, false);
  assert.equal(box.disabled, false);
  assert.match(status(w), /^extynt has stopped learning from your work\. What it already learned stays until you forget it\.$/);
  w.sidecar.failing.add("/v1/notes/learn-from-work");
  box.checked = true;
  box.dispatch("change");
  assert.equal(callsTo(w, "/v1/notes/learn-from-work").length, 2);
  assert.equal(box.checked, false, "the failed save is undone");
  assert.equal(status(w), "Could not change “Learn from my work”. extynt can't reach its notes storage right now.");
  withoutCodes(status(w));
});

test("a sidecar that cannot be reached also reverts the learn switch", () => {
  const dead = createPanelHarness({
    respond: (record) =>
      record.url.includes("/v1/notes/learn-from-work")
        ? { fail: true }
        : record.url.includes("/v1/notes/settings")
          ? ok({ learnFromWork: true, optedIn: [], plugins: [] })
          : undefined,
  });
  dead.click("open-settings");
  const box = element(dead, "learn-from-work");
  box.checked = false;
  box.dispatch("change");
  assert.equal(box.checked, true, "back to what the sidecar still holds");
  assert.equal(
    element(dead, "memory-status").textContent,
    "Could not change \u201cLearn from my work\u201d. extynt could not be reached. Check that it is still running.",
  );
});

test("Forget what it learned needs two presses inside a few seconds, then reports the result", () => {
  const w = world();
  openSettings(w);
  const forget = element(w.harness, "memory-forget");
  forget.click();
  assert.equal(callsTo(w, "/v1/notes/usage/forget").length, 0, "one press only arms it");
  assert.equal(forget.textContent, "Press again to forget");
  w.harness.advance(6000);
  forget.click();
  assert.equal(callsTo(w, "/v1/notes/usage/forget").length, 0, "a second press after the window is a new first press");
  w.harness.advance(1000);
  forget.click();
  assert.equal(callsTo(w, "/v1/notes/usage/forget").length, 1, "the second press inside the window does it");
  assert.equal(forget.textContent, "Forget what it learned");
  assert.equal(status(w), "Forgot what extynt learned from your work (4 items).");
  forget.click();
  assert.equal(callsTo(w, "/v1/notes/usage/forget").length, 1, "armed again from the start");
  w.harness.runTimeouts();
  assert.equal(forget.textContent, "Forget what it learned", "the label returns when the window passes");
});

test("a failed forget says so in plain words and a nothing-to-forget answer says that", () => {
  const w = world();
  openSettings(w);
  const forget = element(w.harness, "memory-forget");
  w.sidecar.failing.add("/v1/notes/usage/forget");
  pressTwice(w, forget);
  assert.equal(status(w), "Could not forget what extynt learned. extynt can't reach its notes storage right now.");
  withoutCodes(status(w));
  assert.equal(forget.disabled, false);
});

test("turning a plugin on posts its key, turning it off posts false, and a failed save puts the box back", () => {
  const w = world();
  openSettings(w);
  const blur = boxFor(w, "Blur");
  blur.checked = true;
  blur.dispatch("change");
  assert.deepEqual(
    callsTo(w, "/v1/notes/plugins").map((call) => call.body),
    [{ pluginKey: "Blur", enabled: true }],
  );
  assert.equal(blur.checked, true);
  assert.equal(status(w), "An agent may now write labelled guesses about Blur.");
  const stylize = boxFor(w, "Stylize");
  stylize.checked = false;
  stylize.dispatch("change");
  assert.deepEqual(callsTo(w, "/v1/notes/plugins")[1]?.body, { pluginKey: "Stylize", enabled: false });
  assert.match(status(w), /^Agents will no longer write guesses about Stylize\. Notes already written stay until you forget them\.$/);
  w.sidecar.failing.add("/v1/notes/plugins");
  blur.checked = false;
  blur.dispatch("change");
  assert.equal(blur.checked, true, "the failed save is undone");
  assert.equal(status(w), "Could not change Blur. extynt can't reach its notes storage right now.");
  withoutCodes(status(w));
});

test("with hundreds of plugins the list stays bounded and a filter narrows it", () => {
  const plugins = Array.from({ length: 400 }, (_, index) => ({
    pluginKey: `Plugin ${String(index).padStart(3, "0")}`,
    effectCount: 2,
    optedIn: index === 399,
  }));
  const w = world({ plugins });
  openSettings(w);
  assert.equal(pluginBoxes(w).length, 100, "never more than a screenful of rows is drawn");
  assert.equal(pluginBoxes(w)[0]?.getAttribute("aria-label"), "Document Plugin 399", "opted-in first");
  assert.equal(element(w.harness, "memory-plugin-filter").hidden, false, "a long list gets a filter");
  assert.equal(text(w, "memory-plugins-note"), "Showing 100 of 400. Type to narrow the list.");
  type(w, "memory-plugin-filter", "plugin 12");
  assert.equal(pluginBoxes(w).length, 10);
  assert.equal(text(w, "memory-plugins-note"), "");
  type(w, "memory-plugin-filter", "nothing like it");
  assert.equal(pluginBoxes(w).length, 0);
  assert.equal(text(w, "memory-plugins-note"), "No plugin matches “nothing like it”.");
  type(w, "memory-plugin-filter", "");
  const box = boxFor(w, "Plugin 007");
  box.checked = true;
  box.dispatch("change");
  assert.deepEqual(callsTo(w, "/v1/notes/plugins").at(-1)?.body, { pluginKey: "Plugin 007", enabled: true });
});

test("a short list has no filter, and no plugins reads as an empty state that says what to do", () => {
  const few = world();
  openSettings(few);
  assert.equal(element(few.harness, "memory-plugin-filter").hidden, true);
  const none = world({ plugins: [] });
  openSettings(none);
  assert.equal(pluginBoxes(none).length, 0);
  assert.match(text(none, "memory-plugins-note"), /appear here once extynt has learned your effects/);
});

test("settings that cannot be read leave the section usable and say why in words", () => {
  const w = world();
  w.sidecar.failing.add("/v1/notes/settings");
  openSettings(w);
  assert.equal(status(w), "Memory settings could not be loaded. extynt can't reach its notes storage right now.");
  withoutCodes(status(w));
  const old = createPanelHarness({ respond: (record) => (record.url.includes("/v1/notes/") ? { status: 404, text: "{}" } : undefined) });
  old.click("open-settings");
  assert.equal(
    element(old, "memory-status").textContent,
    "Memory settings could not be loaded. This version of extynt does not have that yet.",
  );
});
