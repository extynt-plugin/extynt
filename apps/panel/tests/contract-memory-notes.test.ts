/** Panel contract: the notes history: current and replaced notes, Restore with the ids the history returned, and Forget by scope. */
import assert from "node:assert/strict";
import test from "node:test";
import { createPanelHarness } from "./contract.test.js";
import { fieldOf } from "./json-narrow.js";
import { element, nth, required } from "./contract-helpers.js";

import { CAPS, GLOW, ok, refused, note, gone, world, callsTo, text, type, buttons, only, withoutCodes, pressTwice, showNotes } from "./contract-memory-fixtures.js";
import type { World } from "./contract-memory-fixtures.js";

test("the history shows current and replaced notes with their kind, stale flag and why they were replaced", () => {
  const w = world({
    current: [note("c1"), note("c2", { kind: "measured", value: 40, stale: true, staleReason: "ae-build", controlPath: null })],
    replaced: [gone("r1", { stale: true, staleReason: "effect-version" })],
  });
  showNotes(w);
  const asked = callsTo(w, "/v1/notes/history");
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.path, "/v1/notes/history?matchName=ADBE%20Glo2", "the match name is sent as typed");
  const list = text(w, "notes-list");
  for (const expected of [
    "Current notes",
    "Replaced notes",
    "Note c1.",
    "Note c2.",
    "Note r1.",
    "Agent's guess",
    "Measured",
    "Whole effect · value 40",
    "Control ADBE Glo2-0001",
    "Out of date",
    "Written under an older After Effects.",
    "Written for an older version of this effect.",
    "Replaced 2026-10-03: Cleaner.",
  ])
    assert.ok(list.includes(expected), `shows ${expected}`);
  assert.equal(text(w, "notes-status"), "Glow: 2 current notes of 5, 1 replaced note.");
  assert.equal(buttons(w, "notes-list", /^Restore$/).length, 1, "only a replaced note can be restored");
  assert.equal(buttons(w, "notes-list", /^Forget$/).length, 3, "every note can be forgotten");
  assert.equal(element(w.harness, "notes-forget-row").hidden, false);
  assert.equal(
    element(w.harness, "notes-forget-plugin").hidden,
    false,
    "the effect belongs to a plugin, so its notes can be forgotten too",
  );
  withoutCodes(list);
});

test("typing part of an effect's name draws no suggestion list, because the panel has no census to suggest from", () => {
  const w = world();
  w.harness.click("open-settings");
  type(w, "notes-effect", "gau");
  assert.equal(element(w.harness, "notes-suggest").hidden, true);
  assert.equal(element(w.harness, "notes-suggest").childNodes.length, 0);
  w.harness.click("notes-show");
  assert.equal(callsTo(w, "/v1/notes/history")[0]?.path, "/v1/notes/history?matchName=gau", "what was typed is what is asked for");
});

test("a match name typed in goes through as it is, and nothing is asked for without an effect", () => {
  const w = world();
  w.harness.click("open-settings");
  type(w, "notes-effect", " ADBE Glo2 ");
  w.harness.click("notes-show");
  assert.equal(callsTo(w, "/v1/notes/history")[0]?.path, "/v1/notes/history?matchName=ADBE%20Glo2");
  element(w.harness, "notes-effect").value = "  ";
  w.harness.click("notes-show");
  assert.equal(callsTo(w, "/v1/notes/history").length, 1);
  assert.equal(text(w, "notes-status"), "Pick an effect first.");
});

test("an effect extynt has not learned says so, and an effect with no notes explains how notes appear", () => {
  const w = world({ current: [], currentIds: [], replaced: [] });
  showNotes(w);
  assert.match(
    text(w, "notes-status"),
    /^No notes for Glow yet\. Notes appear once an agent writes them, and only for plugins you chose to document\.$/,
  );
  assert.equal(element(w.harness, "notes-forget-row").hidden, true, "nothing to forget");
  const missing = createPanelHarness({
    respond: (record) => (record.url.includes("/v1/notes/history") ? ok({ notes: [], current: null }) : undefined),
  });
  missing.click("open-settings");
  element(missing, "notes-effect").value = "Nope";
  missing.click("notes-show");
  assert.equal(element(missing, "notes-status").textContent, "extynt has not learned an effect with that name yet.");
});

test("a history that cannot be loaded says why in words", () => {
  const w = world();
  w.sidecar.failing.add("/v1/notes/history?matchName=ADBE%20Glo2");
  showNotes(w, "ADBE Glo2");
  assert.equal(text(w, "notes-status"), "The notes could not be loaded. extynt can't reach its notes storage right now.");
  withoutCodes(text(w, "notes-status"));
  assert.equal(text(w, "notes-list"), "");
});

test("Restore sends the note and the ids the history returned, and shows the list again", () => {
  const w = world();
  w.sidecar.restore = (call) => {
    w.sidecar.current = [...w.sidecar.current, nth(w.sidecar.replaced, 0)];
    w.sidecar.replaced = [];
    w.sidecar.currentIds = ["c1", "c2", String(fieldOf(call.body, "noteId"))];
    return ok({ restored: { id: fieldOf(call.body, "noteId") ?? null } });
  };
  showNotes(w);
  only(buttons(w, "notes-list", /^Restore$/)).click();
  assert.deepEqual(
    callsTo(w, "/v1/notes/restore").map((call) => call.body),
    [{ noteId: "r1", expectedNoteIds: ["c1", "c2"] }],
  );
  assert.equal(callsTo(w, "/v1/notes/history").length, 2, "reloaded after the restore");
  assert.equal(text(w, "notes-status"), "Restored the note.");
  assert.equal(buttons(w, "notes-list", /^Restore$/).length, 0);
  assert.ok(text(w, "notes-list").includes("Note r1."));
});

function restoreAtLimit(): World {
  const w = world({ current: [note("c1"), note("c2")], currentIds: ["c1", "c2"] });
  const fresh = { ok: true, effect: {}, notes: [note("c1"), note("c2")], noteIds: ["c1", "c2"], caps: CAPS };
  w.sidecar.restore = (call) =>
    fieldOf(call.body, "replaces") === undefined
      ? refused(409, "EFFECT_NOTES_CAP_REACHED", { current: fresh })
      : ok({ restored: { id: fieldOf(call.body, "noteId") ?? null } });
  showNotes(w);
  only(buttons(w, "notes-list", /^Restore$/)).click();
  return w;
}

test("a restore at the limit lets the user pick which current note to replace and give a one-line reason", () => {
  const w = restoreAtLimit();
  assert.equal(callsTo(w, "/v1/notes/restore").length, 1);
  const picker = element(w.harness, "notes-replace");
  assert.equal(picker.hidden, false);
  assert.match(
    picker.textContent,
    /^This effect is at its limit of 5 notes\. To bring this one back, pick a note to replace and say why\./,
  );
  assert.equal(text(w, "notes-status"), "This effect is at its limit of notes.");
  const radios = picker.all((node) => node.tagName === "INPUT" && node.type === "radio");
  assert.deepEqual(
    radios.map((radio) => radio.value),
    ["c1", "c2"],
    "the current notes of the history",
  );
  const confirm = only(buttons(w, "notes-replace", /^Restore and replace$/));
  confirm.click();
  assert.equal(callsTo(w, "/v1/notes/restore").length, 1, "nothing is sent without a note and a reason");
  assert.equal(text(w, "notes-status"), "Pick the note it should replace.");
  nth(radios, 1).checked = true;
  confirm.click();
  assert.equal(text(w, "notes-status"), "Say in a few words why it replaces that note.");
  const reason = only(picker.all((node) => node.tagName === "INPUT" && node.type === "text"));
  reason.value = "Newer wording.\nSecond line";
  confirm.click();
  assert.equal(text(w, "notes-status"), "Keep the reason to one short line.");
  assert.equal(callsTo(w, "/v1/notes/restore").length, 1);
  reason.value = "  Back to the first reading.  ";
  confirm.click();
  assert.deepEqual(
    callsTo(w, "/v1/notes/restore")[1]?.body,
    { noteId: "r1", expectedNoteIds: ["c1", "c2"], replaces: "c2", reason: "Back to the first reading." },
    "the ids are the history's, and the reason is trimmed",
  );
  assert.equal(text(w, "notes-status"), "Restored the note.");
  assert.equal(element(w.harness, "notes-replace").hidden, true);
});

test("Cancel closes the replace step without sending anything", () => {
  const w = world();
  w.sidecar.restore = () => refused(409, "EFFECT_NOTES_CAP_REACHED", { current: { notes: [note("c1")], noteIds: ["c1"], caps: CAPS } });
  showNotes(w);
  only(buttons(w, "notes-list", /^Restore$/)).click();
  only(buttons(w, "notes-replace", /^Cancel$/)).click();
  assert.equal(element(w.harness, "notes-replace").hidden, true);
  assert.equal(callsTo(w, "/v1/notes/restore").length, 1);
});

test("a restore of a note whose set changed underneath reloads the notes and says to try again", () => {
  const w = world();
  w.sidecar.restore = () => refused(409, "EFFECT_NOTES_STALE", { current: { notes: [], noteIds: [], caps: CAPS } });
  showNotes(w);
  only(buttons(w, "notes-list", /^Restore$/)).click();
  assert.equal(
    text(w, "notes-status"),
    "Could not restore that note. These notes changed while you were looking, so they were reloaded. Try again.",
  );
  assert.equal(callsTo(w, "/v1/notes/history").length, 2);
  withoutCodes(text(w, "notes-status"));
});

test("forgetting one note takes two presses and names the note", () => {
  const w = world();
  showNotes(w);
  const forgets = buttons(w, "notes-list", /^Forget$/);
  assert.equal(forgets.length, 3);
  const second = nth(forgets, 1);
  second.click();
  assert.equal(callsTo(w, "/v1/notes/forget").length, 0);
  assert.equal(second.textContent, "Press again to forget");
  assert.equal(nth(forgets, 0).textContent, "Forget", "only the pressed one is armed");
  second.click();
  assert.deepEqual(
    callsTo(w, "/v1/notes/forget").map((call) => call.body),
    [{ scope: "note", noteId: "c2" }],
  );
  assert.equal(text(w, "notes-status"), "Forgot 1 note.");
  assert.equal(callsTo(w, "/v1/notes/history").length, 2, "the list is read again");
});

test("pressing a different delete button disarms the first", () => {
  const w = world();
  showNotes(w);
  const [first, second] = buttons(w, "notes-list", /^Forget$/);
  required(first).click();
  required(second).click();
  assert.equal(required(first).textContent, "Forget");
  required(first).click();
  assert.equal(callsTo(w, "/v1/notes/forget").length, 0, "the first press on the first button is only an arming again");
});

test("Forget all for this effect and for this plugin each take two presses and send their scope", () => {
  const w = world();
  showNotes(w);
  const effect = element(w.harness, "notes-forget-effect"),
    plugin = element(w.harness, "notes-forget-plugin");
  effect.click();
  assert.equal(effect.textContent, "Press again to forget all");
  assert.equal(callsTo(w, "/v1/notes/forget").length, 0);
  effect.click();
  assert.deepEqual(
    callsTo(w, "/v1/notes/forget").map((call) => call.body),
    [{ scope: "effect", matchName: GLOW }],
  );
  assert.equal(effect.textContent, "Forget all for this effect");
  plugin.click();
  assert.equal(callsTo(w, "/v1/notes/forget").length, 1);
  w.harness.advance(6000);
  plugin.click();
  assert.equal(callsTo(w, "/v1/notes/forget").length, 1, "too late to count as the second press");
  plugin.click();
  assert.deepEqual(
    callsTo(w, "/v1/notes/forget")[1]?.body,
    { scope: "plugin", pluginKey: "Stylize" },
    "the plugin comes from the effect's history",
  );
});

test("a failed forget says why and leaves the list alone", () => {
  const w = world();
  showNotes(w);
  w.sidecar.failing.add("/v1/notes/forget");
  const [first] = buttons(w, "notes-list", /^Forget$/);
  pressTwice(w, required(first));
  assert.equal(text(w, "notes-status"), "Could not forget that note. extynt can't reach its notes storage right now.");
  withoutCodes(text(w, "notes-status"));
  assert.equal(callsTo(w, "/v1/notes/history").length, 1);
});
