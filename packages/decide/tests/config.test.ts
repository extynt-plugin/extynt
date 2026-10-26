// Tests for environment configuration: Jev appears only with a key, and the generic list adds more providers.
import assert from "node:assert/strict";
import test from "node:test";
import { decideAll, decisionModelSetup, decisionModelsFromEnvironment } from "../src/index.js";
import { IS_SCENE, answersReply, fakeFetch, jsonReply } from "./support.js";

const STATE = { text: "scene" };

test("with no key no decision model is configured and nothing is sent", async () => {
  const { fetch, calls } = fakeFetch(answersReply({}));
  const models = decisionModelsFromEnvironment({}, fetch);
  await decideAll(STATE, { scene: IS_SCENE }, { models });
  assert.deepEqual([models.length, calls.length], [0, 0]);
});

test("an empty key does not enable Jev", () => {
  const { fetch } = fakeFetch(answersReply({}));
  assert.equal(decisionModelsFromEnvironment({ TYPESAFE_API_KEY: "" }, fetch).length, 0);
});

test("the TypeSafe key enables Jev on the hosted address with the default model", async () => {
  const { fetch, calls } = fakeFetch(answersReply({}));
  const models = decisionModelsFromEnvironment({ TYPESAFE_API_KEY: "secret" }, fetch);
  await decideAll(STATE, { scene: IS_SCENE }, { models });
  assert.equal(models[0]?.id, "jev");
  assert.equal(calls[0]?.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0]?.request.headers.Authorization, "Bearer secret");
  assert.equal(calls[0]?.request.body.includes('"model":"jev-latest"'), true);
});

test("the base address and model can be overridden", async () => {
  const { fetch, calls } = fakeFetch(answersReply({}));
  const environment = { TYPESAFE_API_KEY: "k", TYPESAFE_BASE_URL: "https://proxy.example/", TYPESAFE_MODEL: "jev-mini" };
  await decideAll(STATE, { scene: IS_SCENE }, { models: decisionModelsFromEnvironment(environment, fetch) });
  assert.equal(calls[0]?.url, "https://proxy.example/v1/systemone");
  assert.equal(calls[0]?.request.body.includes('"model":"jev-mini"'), true);
});

test("a generic entry adds a local keyless server after Jev", async () => {
  const { fetch, calls } = fakeFetch(answersReply({ scene: { type: "noul", noul: 0.99 } }));
  const entries = JSON.stringify([{ dialect: "systemone", id: "local", baseUrl: "http://127.0.0.1:8080", model: "decider" }]);
  const models = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries }, fetch);
  const results = await decideAll(STATE, { scene: IS_SCENE }, { models });
  assert.deepEqual([results.scene.provider, results.scene.calibrated], ["local", false]);
  assert.equal(calls[0]?.request.headers.Authorization, undefined);
});

test("a generic entry reads its key from the named variable", async () => {
  const { fetch, calls } = fakeFetch(answersReply({}));
  const entries = JSON.stringify([{ dialect: "systemone", id: "x", baseUrl: "https://x.example", model: "m", keyEnv: "X_KEY", threshold: 0.5 }]);
  await decideAll(STATE, { scene: IS_SCENE }, { models: decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries, X_KEY: "abc" }, fetch) });
  assert.equal(calls[0]?.request.headers.Authorization, "Bearer abc");
});

test("a malformed entry list configures nothing", () => {
  const { fetch } = fakeFetch(answersReply({}));
  assert.equal(decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: "[{\"dialect\":\"other\"}]" }, fetch).length, 0);
});

const COMPLETION = jsonReply(200, { choices: [{ message: { content: JSON.stringify({ answers: { scene: { probability: 0.99 } } }), refusal: null } }] });

test("an openai entry defaults its address and reads OPENAI_API_KEY", async () => {
  const { fetch, calls } = fakeFetch(COMPLETION);
  const entries = JSON.stringify([{ dialect: "openai", id: "oa", model: "gpt-4o-mini" }]);
  const models = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries, OPENAI_API_KEY: "sk" }, fetch);
  const results = await decideAll(STATE, { scene: IS_SCENE }, { models });
  assert.deepEqual([results.scene.provider, results.scene.source], ["oa", "decision-model"]);
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0]?.request.headers.Authorization, "Bearer sk");
});

test("an openai entry can name its address and key variable", async () => {
  const { fetch, calls } = fakeFetch(COMPLETION);
  const entries = JSON.stringify([{ dialect: "openai", id: "oa", model: "m", baseUrl: "https://llm.example/v1", keyEnv: "MY_KEY", calibrated: true, threshold: 0.6 }]);
  const models = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries, MY_KEY: "k2" }, fetch);
  await decideAll(STATE, { scene: IS_SCENE }, { models });
  assert.deepEqual([calls[0]?.url, calls[0]?.request.headers.Authorization, models[0]?.calibrated, models[0]?.threshold], ["https://llm.example/v1/chat/completions", "Bearer k2", true, 0.6]);
});

test("a cloudflare entry builds the run url, with a gateway when named", async () => {
  const { fetch, calls } = fakeFetch(jsonReply(200, { result: { response: { answers: { scene: { probability: 0.99 } } } } }));
  const entries = JSON.stringify([
    { dialect: "cloudflare", id: "cf", accountId: "a1", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    { dialect: "cloudflare", id: "cfg", accountId: "a1", model: "@cf/m/x", gateway: "g1", keyEnv: "CF2" },
  ]);
  const models = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries, CLOUDFLARE_API_TOKEN: "t", CF2: "t2" }, fetch);
  await decideAll(STATE, { scene: IS_SCENE }, { models: [models[1] ?? never()] });
  await decideAll(STATE, { scene: IS_SCENE }, { models: [models[0] ?? never()] });
  assert.deepEqual(calls.map((call) => call.url), [
    "https://gateway.ai.cloudflare.com/v1/a1/g1/workers-ai/@cf/m/x",
    "https://api.cloudflare.com/client/v4/accounts/a1/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  ]);
  assert.deepEqual(calls.map((call) => call.request.headers.Authorization), ["Bearer t2", "Bearer t"]);
});

function never(): never {
  throw new Error("model missing");
}

test("an entry whose key is missing is skipped with a readable reason and the others stay", () => {
  const { fetch } = fakeFetch(COMPLETION);
  const entries = JSON.stringify([
    { dialect: "openai", id: "oa", model: "m" },
    { dialect: "cloudflare", id: "cf", accountId: "a", model: "m", keyEnv: "CF_KEY" },
    { dialect: "systemone", id: "local", baseUrl: "http://127.0.0.1:1", model: "d" },
  ]);
  const setup = decisionModelSetup({ EXTYNT_DECISION_MODELS: entries, CF_KEY: "" }, fetch);
  assert.deepEqual(setup.models.map((model) => model.id), ["local"]);
  assert.deepEqual(setup.skipped, ['decision model "oa" skipped: OPENAI_API_KEY is not set', 'decision model "cf" skipped: CF_KEY is not set']);
});

test("a list with a bad entry is skipped as a whole with the decoder's reason", () => {
  const { fetch } = fakeFetch(COMPLETION);
  const entries = JSON.stringify([
    { dialect: "openai", id: "fine", model: "m" },
    { dialect: "cloudflare", id: "cf", model: "m" },
  ]);
  const setup = decisionModelSetup({ EXTYNT_DECISION_MODELS: entries, OPENAI_API_KEY: "k" }, fetch);
  assert.deepEqual(setup.models, []);
  assert.equal(setup.skipped.length, 1);
  assert.equal(setup.skipped[0]?.includes("accountId"), true);
});

test("a list that is not JSON configures nothing and says so", () => {
  const { fetch } = fakeFetch(COMPLETION);
  const setup = decisionModelSetup({ EXTYNT_DECISION_MODELS: "{nope" }, fetch);
  assert.deepEqual([setup.models.length, setup.skipped.length], [0, 1]);
});

test("a configured entry precedes the user's chat model: it is in the decision-model tier", () => {
  const { fetch } = fakeFetch(COMPLETION);
  const entries = JSON.stringify([{ dialect: "openai", id: "oa", model: "m" }, { dialect: "cloudflare", id: "cf", accountId: "a", model: "m" }]);
  const models = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries, OPENAI_API_KEY: "k", CLOUDFLARE_API_TOKEN: "t" }, fetch);
  assert.deepEqual(models.map((model) => model.tier), ["decision-model", "decision-model"]);
});

function refused(): Error {
  return new Error("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11435"), { code: "ECONNREFUSED" }) });
}

test("a systemone entry on loopback http needs no key and sends no Authorization", async () => {
  const { fetch, calls } = fakeFetch(answersReply({ scene: { type: "noul", noul: 0.99 } }));
  const entries = JSON.stringify([{ dialect: "systemone", id: "local", baseUrl: "http://127.0.0.1:11435", model: "m" }]);
  const models = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries }, fetch);
  const results = await decideAll(STATE, { scene: IS_SCENE }, { models });
  assert.deepEqual([calls[0]?.url, calls[0]?.request.headers.Authorization, results.scene.source], ["http://127.0.0.1:11435/v1/systemone", undefined, "decision-model"]);
});

test("a remote address must be https, for every dialect", () => {
  const { fetch } = fakeFetch(answersReply({}));
  const entries = JSON.stringify([
    { dialect: "systemone", id: "a", baseUrl: "http://models.example.com", model: "m" },
    { dialect: "openai", id: "b", baseUrl: "http://models.example.com/v1", model: "m", keyEnv: "K" },
    { dialect: "openai", id: "c", baseUrl: "not a url", model: "m", keyEnv: "K" },
    { dialect: "systemone", id: "d", baseUrl: "https://models.example.com", model: "m" },
  ]);
  const setup = decisionModelSetup({ EXTYNT_DECISION_MODELS: entries, K: "k" }, fetch);
  assert.deepEqual(setup.models.map((model) => model.id), ["d"]);
  assert.equal(setup.skipped.length, 3);
  assert.equal(setup.skipped[0]?.includes("https"), true);
});

test("an uncalibrated systemone entry never acts at 0.7, while a calibrated one with a threshold does", async () => {
  const reply = answersReply({ scene: { type: "noul", noul: 0.9 } });
  const local = JSON.stringify([{ dialect: "systemone", id: "l", baseUrl: "http://localhost:8000", model: "m" }]);
  const fitted = JSON.stringify([{ dialect: "systemone", id: "l", baseUrl: "http://localhost:8000", model: "m", calibrated: true, threshold: 0.7 }]);
  const conservative = await decideAll(STATE, { scene: IS_SCENE }, { models: decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: local }, fakeFetch(reply).fetch) });
  const own = await decideAll(STATE, { scene: IS_SCENE }, { models: decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: fitted }, fakeFetch(reply).fetch) });
  assert.deepEqual([conservative.scene.band, own.scene.band], ["verify", "act"]);
  const middling = answersReply({ scene: { type: "noul", noul: 0.875 } });
  const dropped = await decideAll(STATE, { scene: IS_SCENE }, { models: decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: local }, fakeFetch(middling).fetch) });
  assert.deepEqual([dropped.scene.source, dropped.scene.fallback?.reason], ["deterministic", "low-confidence"]);
});

test("a configured server that is not running falls back once with a readable reason", async () => {
  const entries = JSON.stringify([{ dialect: "systemone", id: "local", baseUrl: "http://127.0.0.1:11435", model: "m" }, { dialect: "openai", id: "chat", baseUrl: "http://127.0.0.1:11434/v1", model: "m" }]);
  for (const index of [0, 1]) {
    const { fetch, calls } = fakeFetch(refused());
    const models = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries }, fetch);
    const results = await decideAll(STATE, { scene: IS_SCENE }, { models: [models[index] ?? never()] });
    assert.deepEqual([results.scene.source, results.scene.fallback?.reason, calls.length], ["deterministic", "unavailable", 1]);
    assert.equal(results.scene.fallback?.detail.includes("ECONNREFUSED"), true);
    assert.equal(results.scene.fallback?.detail.includes("server running"), true);
  }
});

test("an openai entry on a loopback address needs no key and sends no Authorization", async () => {
  const { fetch, calls } = fakeFetch(COMPLETION);
  const entries = JSON.stringify([{ dialect: "openai", id: "local-chat", baseUrl: "http://127.0.0.1:11434/v1", model: "m" }]);
  const models = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries }, fetch);
  const results = await decideAll(STATE, { scene: IS_SCENE }, { models });
  assert.deepEqual([calls[0]?.url, calls[0]?.request.headers.Authorization, results.scene.provider], ["http://127.0.0.1:11434/v1/chat/completions", undefined, "local-chat"]);
});
