/** The Decision model section's wording: the status line and the test line in every language, and the tolerant reading of the sidecar's answer. Pure, so no panel is booted. */
import assert from "node:assert/strict";
import test from "node:test";
import { decode } from "@extynt/decode";
import { DECISION_FAILURE_CODES, translatorFor } from "@extynt/ui-text";
import { advancedOpens, headlineModel, receiptLine, shownFields, statusLine, testLine } from "../runtime/panel-decision-view.js";
import { decisionReplyDecoder, type DecisionStateView } from "../runtime/panel-decision-wire.js";

const english = translatorFor("en");
const model = (usable: boolean, reason = "") => ({ provider: "jev" as const, id: "jev", model: "jev", baseUrl: "", keySet: true, source: "llm.env", usable, reason });
const stateOf = (...models: DecisionStateView["models"]): DecisionStateView => ({ configured: models.length > 0, models, skipped: [], listProblem: "" });

test("with nothing set up the line says decisions stay on built-in rules", () => {
  const line = statusLine(stateOf(), english);
  assert.equal(line.ok, false);
  assert.match(line.text, /built-in rules/);
});

test("a working Jev reads as connected, and an unusable one gives its reason", () => {
  assert.deepEqual(statusLine(stateOf(model(true)), english), { ok: true, text: english("settings.decision.status.connected", { provider: english("settings.decision.provider.jev") }) });
  const broken = statusLine(stateOf(model(false, "no key")), english);
  assert.equal(broken.ok, false);
  assert.match(broken.text, /no key/);
});

test("the status line belongs to the chosen provider, not to whichever model is first", () => {
  const state = stateOf(model(true));
  assert.equal(statusLine(state, english, "jev").ok, true);
  const openai = statusLine(state, english, "openai");
  assert.deepEqual(openai, { ok: false, text: english("settings.decision.error.notSetUp", { provider: english("settings.decision.provider.openai") }) });
  assert.equal(receiptLine(state, [], english, "cloudflare").tone, "muted");
});

test("the headline is the first working model, else the first one set up", () => {
  const other = { ...model(true), provider: "openai" as const, id: "openai" };
  assert.equal(headlineModel(stateOf(model(false), other))?.provider, "openai");
  assert.equal(headlineModel(stateOf(model(false), { ...other, usable: false }))?.provider, "jev");
});

test("the test line carries the time or the reason, in every language", () => {
  for (const language of ["en", "es", "de", "fr", "ja", "zh-Hans"] as const) {
    const say = translatorFor(language);
    assert.match(testLine({ ok: true, ms: 412, reason: "" }, "jev", say).text, /412/, language);
    const failed = testLine({ ok: false, ms: 0, reason: "401 key rejected" }, "jev", say);
    assert.equal(failed.ok, false, language);
    assert.equal(failed.text, [say("settings.decision.provider.jev"), say("settings.decision.page.testFailed"), "401 key rejected"].join(" · "), language);
  }
});

test("a failed test says why in the reader's language, not in the provider's English", () => {
  const english = translatorFor("en");
  for (const language of ["es", "de", "fr", "ja", "zh-Hans"] as const) {
    const say = translatorFor(language);
    for (const code of DECISION_FAILURE_CODES) {
      const line = testLine({ ok: false, ms: 0, reason: `${code}: English detail (HTTP 401).`, code }, "jev", say);
      assert.doesNotMatch(line.text, /English detail/, `${language} ${code}`);
      assert.notEqual(line.text.split(" · ")[2], english(`settings.decision.failure.${code}`), `${language} ${code}`);
    }
  }
});

test("a reply with a bad model entry or a missing field still reads", () => {
  const decoded = decode(decisionReplyDecoder, { ok: true, state: { models: [{ provider: "nope" }, { provider: "jev", keySet: true, usable: true }] } });
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.state?.models.length, 1);
  assert.deepEqual(decoded.value.shadowed, []);
});

test("the receipt is one line: muted when nothing is set up, good with a passed test folded in, amber when a test failed", () => {
  assert.equal(receiptLine(stateOf(), [], english).tone, "muted");
  const passed = receiptLine(stateOf(model(true)), [testLine({ ok: true, ms: 412, reason: "" }, "jev", english)], english);
  assert.deepEqual(passed, { tone: "good", text: "Jev (TypeSafe) · connected · test ok · 412 ms" });
  const failed = receiptLine(stateOf(model(true)), [testLine({ ok: false, ms: 0, reason: "401" }, "jev", english)], english);
  assert.equal(failed.tone, "warn");
  assert.match(failed.text, /test failed · 401/);
});

const emptyFields = { model: "", baseUrl: "", accountId: "" };

test("each provider shows only the advanced fields the key page shows", () => {
  assert.deepEqual(shownFields("jev"), ["model", "baseUrl"]);
  assert.deepEqual(shownFields("openai"), ["model", "baseUrl"]);
  assert.deepEqual(shownFields("cloudflare"), ["model", "accountId"]);
});

test("Advanced opens for a visible value or a failure, and a hidden value does not open it", () => {
  assert.equal(advancedOpens("jev", emptyFields, false), false);
  assert.equal(advancedOpens("jev", { ...emptyFields, baseUrl: "https://example.test" }, false), true);
  assert.equal(advancedOpens("jev", { ...emptyFields, accountId: "abc" }, false), false);
  assert.equal(advancedOpens("cloudflare", { ...emptyFields, accountId: "abc" }, false), true);
  assert.equal(advancedOpens("jev", emptyFields, true), true);
});
