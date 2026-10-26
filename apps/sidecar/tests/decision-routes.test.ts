// The decision-model routes and the ae_decision_model tool: keys go in and never come back, a higher layer's override is reported, clear works, and a generic entry round-trips into the model list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { array, boolean, decodeOrThrow, object, optional, string } from "@extynt/decode";
import { decisionModelSetup } from "@extynt/decide";
import { loadLlmEnvFile } from "../src/llm-env-file.js";
import { decisionRig } from "./decision-fixture.js";

const SECRET = "sk-test-5d21aa90e3";
const stateReply = object({
  ok: boolean(),
  state: object({ configured: boolean(), models: array(object({ provider: string(), keySet: boolean(), usable: boolean() })) }),
  shadowed: array(object({ variable: string(), source: string() })),
});
const savedReply = object({ saved: boolean(), test: object({ ok: boolean() }), state: object({ configured: boolean() }) });
const testReply = object({ ok: boolean(), test: object({ ok: boolean() }) });
const toolReply = object({ ok: boolean(), data: object({ url: optional(string()), say: optional(string()), cleared: optional(boolean()) }) });
const setJev = JSON.stringify({ provider: "jev", apiKey: SECRET });

test("a key is saved to llm.env and never returned", async (t) => {
  const rig = await decisionRig(t);
  const empty = decodeOrThrow(stateReply, JSON.parse((await rig.call("GET", "/v1/settings/decision")).text));
  assert.equal(empty.state.configured, false);
  const saved = await rig.call("POST", "/v1/settings/decision", setJev);
  assert.equal(saved.status, 200);
  assert.equal(saved.text.includes(SECRET), false);
  const reply = decodeOrThrow(stateReply, JSON.parse(saved.text));
  assert.deepEqual(reply.state.models.map((model) => [model.provider, model.keySet, model.usable]), [["jev", true, true]]);
  assert.match(readFileSync(rig.filePath, "utf8"), new RegExp(`TYPESAFE_API_KEY=${SECRET}`));
  assert.equal((await rig.call("GET", "/v1/settings/decision")).text.includes(SECRET), false);
});

test("a process environment key wins over llm.env and the answer says so", async (t) => {
  const rig = await decisionRig(t, { processEnv: { TYPESAFE_API_KEY: "from-the-shell" } });
  const saved = decodeOrThrow(stateReply, JSON.parse((await rig.call("POST", "/v1/settings/decision", setJev)).text));
  assert.deepEqual(saved.shadowed, [{ variable: "TYPESAFE_API_KEY", source: "environment" }]);
});

test("clear removes the provider and the file keeps no key", async (t) => {
  const rig = await decisionRig(t);
  await rig.call("POST", "/v1/settings/decision", setJev);
  const cleared = decodeOrThrow(stateReply, JSON.parse((await rig.call("POST", "/v1/settings/decision", '{"provider":"jev","action":"clear"}')).text));
  assert.equal(cleared.state.configured, false);
  assert.equal(readFileSync(rig.filePath, "utf8").includes(SECRET), false);
});

test("a generic entry round-trips into the decision model list", async (t) => {
  const rig = await decisionRig(t);
  const body = JSON.stringify({ provider: "openai", apiKey: SECRET, model: "small-1", baseUrl: "https://models.example.test/v1" });
  assert.equal((await rig.call("POST", "/v1/settings/decision", body)).status, 200);
  const values = loadLlmEnvFile(rig.filePath);
  const setup = decisionModelSetup(values, globalThis.fetch);
  assert.deepEqual(setup.models.map((model) => model.id), ["openai"]);
  assert.equal(setup.skipped.length, 0);
  assert.equal(values.EXTYNT_DECISION_OPENAI_KEY, SECRET);
});

test("a missing field is refused with a reason and nothing is written", async (t) => {
  const rig = await decisionRig(t);
  const refused = await rig.call("POST", "/v1/settings/decision", '{"provider":"openai","apiKey":"x"}');
  assert.equal(refused.status, 422);
  assert.deepEqual(loadLlmEnvFile(rig.filePath), {});
});

test("a test of a model that is not set up says so, and a failing endpoint reports a failure", async (t) => {
  const rig = await decisionRig(t);
  assert.equal(decodeOrThrow(testReply, JSON.parse((await rig.call("POST", "/v1/settings/decision/test", "{}")).text)).test.ok, false);
  await rig.call("POST", "/v1/settings/decision", setJev);
  const failed = await rig.call("POST", "/v1/settings/decision/test", '{"provider":"jev"}');
  assert.equal(decodeOrThrow(testReply, JSON.parse(failed.text)).test.ok, false);
  assert.equal(failed.text.includes(SECRET), false);
});

test("the tool hands out a link, takes no key, and reports a secret-free status", async (t) => {
  const rig = await decisionRig(t);
  const setup = decodeOrThrow(toolReply, JSON.parse((await rig.tool('{"action":"setup","provider":"jev"}')).text));
  assert.match(setup.data.url ?? "", /\/decision-key\//);
  assert.match(setup.data.say ?? "", /stored only on this computer/);
  assert.deepEqual(rig.events, [{ type: "decision", reason: "open" }]);
  const refused = await rig.tool(JSON.stringify({ action: "status", apiKey: SECRET }));
  assert.equal(refused.text.includes(SECRET), false);
  await rig.call("POST", "/v1/settings/decision", setJev);
  const status = await rig.tool('{"action":"status"}');
  assert.equal(status.text.includes(SECRET), false);
  assert.match(status.text, /"keySet":true/);
  assert.equal(decodeOrThrow(toolReply, JSON.parse((await rig.tool('{"action":"clear"}')).text)).data.cleared, true);
  assert.equal((await rig.tool('{"action":"nonsense"}')).status, 422);
});

test("a save with test set writes only when the test passes", async (t) => {
  const failing = await decisionRig(t);
  const failedReply = decodeOrThrow(savedReply, JSON.parse((await failing.call("POST", "/v1/settings/decision", JSON.stringify({ provider: "jev", apiKey: SECRET, test: true }))).text));
  assert.deepEqual([failedReply.saved, failedReply.test.ok, failedReply.state.configured], [false, false, false]);
  assert.deepEqual(loadLlmEnvFile(failing.filePath), {});
  assert.deepEqual(failing.events, []);
  const passing = await decisionRig(t, { modelAnswers: true });
  const passed = await passing.call("POST", "/v1/settings/decision", JSON.stringify({ provider: "jev", apiKey: SECRET, test: true }));
  assert.equal(passed.text.includes(SECRET), false);
  const passedReply = decodeOrThrow(savedReply, JSON.parse(passed.text));
  assert.deepEqual([passedReply.saved, passedReply.test.ok, passedReply.state.configured], [true, true, true]);
  assert.equal(loadLlmEnvFile(passing.filePath).TYPESAFE_API_KEY, SECRET);
  assert.deepEqual(passing.events, [{ type: "decision", reason: "changed" }]);
});
