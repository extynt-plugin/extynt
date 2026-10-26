/**
 * Panel contract: prompt suggestions for the selection. When the selection changes and then stays put, the panel asks the
 * sidecar (once) and shows the model's two or three short prompts as chips in the empty chat, never above the composer. A chip
 * fills the composer and never sends. The chips go when the selection changes, a turn starts or the user types, and nothing is
 * asked while the panel is hidden, the setting is off, the composer has a draft, a turn is running, there is history on screen,
 * or nothing is selected.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { StubElement, createPanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { bodyOf, element, nth } from "./contract-helpers.js";
import { declarationsFor, readPanelStyles } from "./panel-styles.js";
import { HIDDEN_WAIT_MS, SETTLE_MS } from "../runtime/panel-suggest.js";
import { type JsonObject } from "@extynt/decode";

const WORDS = ["mock chip one", "mock chip two", "mock chip three"];
const ok = (extra: JsonObject): StubResponse => ({
  status: 200,
  text: JSON.stringify({ ok: true, writeAuthorizing: false, ...extra }),
});
const chips = (suggestions: string[] = WORDS): StubResponse => ok({ suggestions, source: "model", reason: null });

interface Sidecar {
  asked: Array<JsonObject>;
  answers: StubResponse[];
  chats: number;
}

function world(options: { holdChat?: boolean; suggestPrompts?: boolean; rateLimit?: boolean } = {}) {
  const sidecar: Sidecar = { asked: [], answers: [], chats: 0 };
  const harness = createPanelHarness({
    sidecar: (fake) => {
      fake.prefs.suggestPrompts = options.suggestPrompts !== false;
      fake.prefs.rateLimit = options.rateLimit !== false;
    },
    respond: (record: StubRequestRecord) => {
      if (record.url.includes("/v1/suggestions")) {
        sidecar.asked.push(bodyOf(record));
        return sidecar.answers.shift() ?? chips();
      }
      if (record.url.endsWith("/v1/chat") && record.method === "POST") {
        sidecar.chats += 1;
        return options.holdChat ? { hold: true } : ok({ outcome: "answered", answer: "Done." });
      }
      return undefined;
    },
  });
  return { harness, sidecar, composer: element(harness, "chat-message") };
}
type World = ReturnType<typeof world>;

const select = (w: World, ids: string[], fingerprint: string): void => {
  w.harness.sse("focus", {
    focus: {
      project: "Fixture.aep",
      compositionId: "comp-1",
      compositionName: "Main",
      selected: ids.length,
      layerNames: ids,
      kinds: ids.map(() => "shape"),
      selectionFingerprint: fingerprint,
      at: Date.now(),
    },
  });
};
const settle = (w: World, ms = SETTLE_MS): number => w.harness.runTimeouts((timer) => timer.ms === ms);
const chatArea = (w: World): StubElement => element(w.harness, "chat-output");
const shown = (w: World): StubElement[] => chatArea(w).all((node) => node.tagName === "BUTTON" && WORDS.includes(node.textContent));
const isOn = (w: World): boolean => shown(w).length > 0;
const heldTo = (w: World, path: string) => w.harness.held().filter((xhr) => xhr.url.includes(path) && !xhr.aborted);
const turnEnds = (w: World, extra: JsonObject = {}): void => {
  nth(heldTo(w, "/v1/chat"), 0).respond(200, JSON.stringify({ ok: true, outcome: "answered", answer: "Done.", ...extra }));
};

test("the chips live only in the empty chat: there is no row above the composer, and the setting is in Preferences with what it sends", () => {
  const html = readFileSync("apps/panel/index.html", "utf8");
  const form = html.slice(html.indexOf('<form class="composer"'), html.indexOf("</form>"));
  assert.equal(form.includes("suggestions"), false, "nothing above the composer");
  assert.equal(html.includes('id="suggestions"'), false);
  const frames = html.slice(html.indexOf('id="frames-section"'), html.indexOf('id="memory-section"'));
  assert.match(
    frames,
    /<input id="suggest-prompts" type="checkbox" checked><span[^>]*>Suggest prompts for the selection<\/span><span class="note"[^>]*>[^<]*names[^<]*your model/,
  );
  const css = readPanelStyles();
  assert.equal(declarationsFor(css, ".suggestions").length, 0, "the row's styles are gone");
  assert.match(css, /--t-base: 160ms;/);
});

test("a selection that holds still for 1.2 s is asked about once, and the model's words appear as accessible chips", () => {
  const w = world();
  select(w, ["layer-1"], "sel-A");
  assert.deepEqual(w.sidecar.asked, [], "nothing is asked the moment the selection changes");
  assert.equal(w.harness.pendingTimeouts().filter((timer) => timer.ms === SETTLE_MS).length, 1, "it waits for the selection to settle");
  assert.equal(settle(w), 1);
  assert.deepEqual(
    w.sidecar.asked,
    [{ selectionFingerprint: "sel-A" }],
    "only the fingerprint is sent: the sidecar reads the layers itself",
  );
  assert.deepEqual(
    shown(w).map((chip) => chip.textContent),
    WORDS,
  );
  assert.ok(shown(w).every((chip) => chip.tagName === "BUTTON" && chip.type === "button"));
  assert.ok(
    shown(w).every((chip) => chip.parentNode?.classList.has("chips")),
    "in the empty chat's own chip list",
  );
  assert.equal(isOn(w), true);
  select(w, ["layer-1"], "sel-A");
  settle(w);
  assert.equal(w.sidecar.asked.length, 1, "the same selection read again changes nothing and asks nothing");
});

test("the ask is a quiet POST /v1/suggestions with the panel's bearer", () => {
  const w = world();
  select(w, ["layer-1"], "sel-A");
  settle(w);
  const asks = w.harness.requestsTo("/v1/suggestions");
  assert.equal(asks.length, 1);
  assert.equal(nth(asks, 0).method, "POST");
  assert.equal(nth(asks, 0).headers.Authorization, "Bearer test-token");
});

test("a selection that keeps changing is asked about once, for the one it settled on", () => {
  const w = world();
  select(w, ["layer-1"], "sel-A");
  select(w, ["layer-2"], "sel-B");
  settle(w);
  assert.deepEqual(w.sidecar.asked, [{ selectionFingerprint: "sel-B" }]);
});

test("a selection the sidecar reported at boot is asked about too", () => {
  const harness = createPanelHarness({
    sidecar: (fake) => {
      fake.focus = {
        project: "Fixture.aep",
        compositionId: "comp-1",
        compositionName: "Main",
        selected: 1,
        layerNames: ["Title"],
        kinds: ["text"],
        selectionFingerprint: "sel-boot",
        at: Date.now(),
      };
    },
  });
  harness.runTimeouts((timer) => timer.ms === SETTLE_MS);
  assert.deepEqual(harness.requestsTo("/v1/suggestions").map(bodyOf), [{ selectionFingerprint: "sel-boot" }]);
});

test("a chip puts its words in the composer and focuses it, and sends nothing", () => {
  const w = world();
  let focused = 0;
  w.composer.focus = () => {
    focused += 1;
  };
  select(w, ["layer-1"], "sel-A");
  settle(w);
  nth(shown(w), 1).click();
  assert.equal(w.composer.value, "mock chip two");
  assert.equal(focused, 1);
  assert.equal(w.sidecar.chats, 0, "choosing is not sending: that is the Send button");
  assert.equal(
    w.harness.requests.some((record) => record.method === "POST" && record.url.endsWith("/v1/chat")),
    false,
  );
});

test("with history on screen nothing is asked: there is nowhere to show chips", () => {
  const w = world();
  w.harness.send("hello");
  select(w, ["layer-1"], "sel-A");
  settle(w);
  assert.deepEqual(w.sidecar.asked, []);
  assert.equal(isOn(w), false);
  w.harness.click("chat-clear");
  settle(w);
  assert.deepEqual(w.sidecar.asked, [{ selectionFingerprint: "sel-A" }], "a new chat is empty again, so the open selection is asked about");
  assert.equal(isOn(w), true);
});

test("typing, a new selection and a turn starting each take the chips away", () => {
  const w = world({ holdChat: true });
  select(w, ["layer-1"], "sel-A");
  settle(w);
  w.composer.value = "make";
  w.composer.dispatch("input");
  assert.equal(isOn(w), false, "typing");
  w.composer.value = "";
  select(w, ["layer-1", "layer-2"], "sel-B");
  settle(w);
  assert.equal(isOn(w), true);
  select(w, ["layer-3"], "sel-C");
  assert.equal(isOn(w), false, "a new selection takes them away at once, before anything new is asked");
  assert.equal(shown(w).length, 0);
  settle(w);
  assert.equal(isOn(w), true);
  w.harness.send("go");
  assert.equal(isOn(w), false, "a turn starting");
  assert.equal(w.sidecar.chats, 1);
});

test("clearing the selection takes the chips away and asks nothing more", () => {
  const w = world();
  select(w, ["layer-1"], "sel-A");
  settle(w);
  select(w, [], "sel-empty");
  assert.equal(isOn(w), false);
  assert.equal(w.harness.pendingTimeouts().filter((timer) => timer.ms === SETTLE_MS).length, 0, "no layer, nothing to settle");
  assert.equal(w.sidecar.asked.length, 1);
});

test("an answer that arrives after the user typed, or after the selection moved on, is never shown", () => {
  const w = world();
  w.sidecar.answers.push({ hold: true }, { hold: true });
  select(w, ["layer-1"], "sel-A");
  settle(w);
  w.composer.value = "typed meanwhile";
  w.composer.dispatch("input");
  nth(heldTo(w, "/v1/suggestions"), 0).respond(200, JSON.stringify({ ok: true, suggestions: WORDS }));
  assert.equal(isOn(w), false, "the user's own words come first");
  w.composer.value = "";
  select(w, ["layer-2"], "sel-B");
  settle(w);
  select(w, ["layer-3"], "sel-C");
  nth(heldTo(w, "/v1/suggestions"), 1).respond(200, JSON.stringify({ ok: true, suggestions: WORDS }));
  assert.equal(isOn(w), false, "an answer about layers no longer selected");
});

test("nothing is asked while hidden; a hidden panel asks once it is shown", () => {
  const w = world();
  select(w, ["layer-1"], "sel-A");
  w.harness.document.hidden = true;
  settle(w);
  assert.deepEqual(w.sidecar.asked, [], "hidden");
  assert.equal(settle(w, HIDDEN_WAIT_MS) > 0, true, "it checks again, quietly");
  assert.deepEqual(w.sidecar.asked, [], "still hidden");
  w.harness.document.hidden = false;
  settle(w, HIDDEN_WAIT_MS);
  assert.equal(w.sidecar.asked.length, 1, "shown, so asked");
});

test("nothing is asked with a draft in the composer, or with nothing selected", () => {
  const draft = world();
  draft.composer.value = "half a thought";
  select(draft, ["layer-1"], "sel-A");
  settle(draft);
  assert.deepEqual(draft.sidecar.asked, [], "a draft is the user's own words");
  const nothing = world();
  select(nothing, [], "sel-empty");
  assert.equal(nothing.harness.pendingTimeouts().filter((timer) => timer.ms === SETTLE_MS).length, 0, "no layer, nothing to settle");
});

test("with the setting off nothing is asked, and the toggle shows the saved choice", () => {
  const off = world({ suggestPrompts: false });
  assert.equal(element(off.harness, "suggest-prompts").checked, false, "the toggle shows the saved choice");
  select(off, ["layer-1"], "sel-A");
  settle(off);
  assert.deepEqual(off.sidecar.asked, [], "off sends no layer name anywhere");
  assert.equal(off.harness.requestsTo("/v1/suggestions").length, 0);
});

test("the setting is saved to the sidecar, turning it off takes the chips away, and turning it on asks for the selection that is open", () => {
  const w = world();
  const toggle = element(w.harness, "suggest-prompts");
  assert.equal(toggle.checked, true, "on by default");
  select(w, ["layer-1"], "sel-A");
  settle(w);
  assert.equal(isOn(w), true);
  toggle.checked = false;
  toggle.dispatch("change");
  assert.deepEqual(
    w.harness
      .requestsTo("/v1/ui/prefs")
      .filter((record) => record.method === "PATCH")
      .map(bodyOf),
    [{ suggestPrompts: false }],
  );
  assert.equal(w.harness.sidecar.prefs.suggestPrompts, false);
  assert.equal(isOn(w), false);
  toggle.checked = true;
  toggle.dispatch("change");
  assert.equal(w.harness.sidecar.prefs.suggestPrompts, true);
  settle(w);
  assert.equal(w.sidecar.asked.length, 2, "asked again for the open selection (the sidecar answers from memory)");
  assert.equal(isOn(w), true);
});

test("a selection that changes during a turn is asked about when the turn ends, not during it", () => {
  const w = world({ holdChat: true });
  w.harness.send("go");
  select(w, ["layer-1"], "sel-A");
  settle(w);
  assert.deepEqual(w.sidecar.asked, [], "a running turn is left alone");
  turnEnds(w);
  settle(w);
  assert.deepEqual(w.sidecar.asked, [], "and the answered chat has history, which is where chips cannot show");
  w.harness.click("chat-clear");
  settle(w);
  assert.deepEqual(w.sidecar.asked, [{ selectionFingerprint: "sel-A" }]);
  assert.equal(isOn(w), true);
});

test("a 'too soon' answer is believed once, after the wait it names", () => {
  const w = world();
  w.sidecar.answers.push(ok({ suggestions: [], reason: "TOO_SOON", retryAfterMs: 3000 }));
  select(w, ["layer-1"], "sel-A");
  settle(w);
  assert.equal(isOn(w), false);
  assert.equal(
    w.harness.pendingTimeouts().some((timer) => timer.ms === 3100),
    true,
    "it comes back after the wait the sidecar named",
  );
  w.harness.runTimeouts((timer) => timer.ms === 3100);
  assert.equal(w.sidecar.asked.length, 2);
  assert.equal(isOn(w), true);
});

test("a sidecar with nothing to offer shows nothing and is not asked again", () => {
  const none = world();
  none.sidecar.answers.push(ok({ suggestions: [], reason: "NO_MODEL" }));
  select(none, ["layer-1"], "sel-A");
  settle(none);
  assert.deepEqual([isOn(none), none.sidecar.asked.length, shown(none).length], [false, 1, 0], "no model, no chips, no retry");
});

test("a refused or unreachable ask shows nothing", () => {
  const w = world();
  w.sidecar.answers.push({ status: 503, text: JSON.stringify({ ok: false, error: { code: "UNAVAILABLE", message: "No." } }) });
  select(w, ["layer-1"], "sel-A");
  settle(w);
  assert.deepEqual([isOn(w), shown(w).length], [false, 0]);
});

test("the 'Pause after heavy use' guard, even only warning, keeps the panel from adding a background ask", () => {
  const w = world({ holdChat: true });
  w.harness.send("go");
  select(w, ["layer-1"], "sel-A");
  turnEnds(w, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, steps: 100 });
  w.harness.click("chat-clear");
  settle(w);
  assert.deepEqual(w.sidecar.asked, [], "100 of 120 model calls in a minute is the guard's warning: a background ask waits");
  assert.equal(isOn(w), false);
});

test("with the guard switched off the same heavy use does not hold the ask back", () => {
  const w = world({ holdChat: true, rateLimit: false });
  w.harness.send("go");
  select(w, ["layer-1"], "sel-A");
  turnEnds(w, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, steps: 100 });
  w.harness.click("chat-clear");
  settle(w);
  assert.equal(w.sidecar.asked.length, 1);
});

test("what the model spent on the suggestions counts toward the model-call guard like an answer's", () => {
  const w = world();
  w.sidecar.answers.push(
    ok({ suggestions: WORDS, source: "model", reason: null, usage: { inputTokens: 400, outputTokens: 30, cachedInputTokens: 0 } }),
  );
  select(w, ["layer-1"], "sel-A");
  settle(w);
  w.harness.click("open-settings");
  w.harness.click("open-developer");
  assert.match(
    element(w.harness, "telemetry-display").textContent,
    /model calls 1\/120 this minute/,
    "it counts as a model call toward the guard",
  );
});
