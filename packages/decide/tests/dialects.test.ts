// Tests for the OpenAI and Cloudflare dialects against an injected fake fetch: request shape, answers, every failure class and band selection.
import assert from "node:assert/strict";
import type { Decoder } from "@extynt/decode";
import { array, boolean, decodeJson, jsonValue, object, optional, string } from "@extynt/decode";
import test from "node:test";
import { cloudflareDecisionModel, cloudflareUrl, decideAll, openAiDecisionModel, replySchema } from "../src/index.js";
import type { DecisionModel, HttpFetch, HttpReply, JsonValue, Question } from "../src/index.js";
import { FEATURE, IS_SCENE, URGENCY, fakeFetch, jsonReply, textReply } from "./support.js";
import type { Call } from "./support.js";

const STATE = { text: "a scene with glow" };

const SCENE_QUESTIONS: ReadonlyArray<Question> = [{ id: "scene", kind: "binary", instructions: IS_SCENE.instructions }];

const message = object({ role: string(), content: string() });

const openAiSent = object({ model: string(), messages: array(message), response_format: object({ type: string(), json_schema: object({ name: string(), strict: boolean(), schema: jsonValue }) }) });

const cloudflareSent = object({ model: optional(string()), messages: array(message), response_format: object({ type: string(), json_schema: jsonValue }) });

const sentState = object({ state: object({ text: string() }), questions: array(object({ id: string() })) });

function sentBody<T>(call: Call | undefined, decoder: Decoder<T>): T {
  const decoded = decodeJson(call?.request.body ?? "", decoder);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return decoded.value;
}

function userMessage(messages: ReadonlyArray<{ readonly role: string; readonly content: string }>): string {
  return messages[1]?.content ?? "";
}

function completionOf(content: string | null, refusal: string | null = null): HttpReply {
  return jsonReply(200, { id: "c1", model: "gpt", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, refusal } }] });
}

function sceneReply(probability: number): HttpReply {
  return completionOf(JSON.stringify({ answers: { scene: { probability } } }));
}

function openAi(fetch: HttpFetch, extra: { readonly baseUrl?: string; readonly threshold?: number; readonly calibrated?: boolean } = {}): DecisionModel {
  return openAiDecisionModel({ id: "oa", model: "gpt-4o-mini", apiKey: "sk-test", fetch, ...extra });
}

async function sceneThrough(model: DecisionModel) {
  return (await decideAll(STATE, { scene: IS_SCENE }, { models: [model] })).scene;
}

test("an openai request carries the model, messages, strict json_schema format and bearer key", async () => {
  const { fetch, calls } = fakeFetch(sceneReply(0.97));
  await decideAll(STATE, { scene: IS_SCENE, feature: FEATURE, urgency: URGENCY }, { models: [openAi(fetch)] });
  const call = calls[0];
  assert.equal(calls.length, 1);
  assert.equal(call?.url, "https://api.openai.com/v1/chat/completions");
  assert.deepEqual(call?.request.headers, { "Content-Type": "application/json", Authorization: "Bearer sk-test" });
  const body = sentBody(call, openAiSent);
  assert.equal(body.model, "gpt-4o-mini");
  assert.deepEqual(body.messages.map((entry) => entry.role), ["system", "user"]);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.name.length > 0, true);
  const asked = decodeJson(userMessage(body.messages), sentState);
  assert.deepEqual(asked.ok ? [asked.value.state.text, asked.value.questions.map((question) => question.id).sort()] : null, [STATE.text, ["feature", "scene", "urgency"]]);
});

test("the openai schema is the shared reply schema of the batched questions", async () => {
  const { fetch, calls } = fakeFetch(sceneReply(0.97));
  await sceneThrough(openAi(fetch));
  assert.deepEqual(sentBody(calls[0], openAiSent).response_format.json_schema.schema, replySchema(SCENE_QUESTIONS));
});

test("a custom base address is used without its trailing slash", async () => {
  const { fetch, calls } = fakeFetch(sceneReply(0.97));
  await sceneThrough(openAi(fetch, { baseUrl: "https://proxy.example/v1/" }));
  assert.equal(calls[0]?.url, "https://proxy.example/v1/chat/completions");
});

test("a good openai reply maps to answers and confidences from the decision-model tier", async () => {
  const { fetch } = fakeFetch(completionOf(JSON.stringify({ answers: {
    scene: { probability: 0.98 },
    feature: { probabilities: { glow: 0.95, blur: 0.03, none: 0.02 } },
    urgency: { probabilities: [0.01, 0.04, 0.95] },
  } })));
  const results = await decideAll(STATE, { scene: IS_SCENE, feature: FEATURE, urgency: URGENCY }, { models: [openAi(fetch)] });
  assert.deepEqual([results.scene.value, results.feature.label, results.urgency.level], [true, "glow", 2]);
  assert.equal(results.scene.source, "decision-model");
  assert.equal(results.scene.provider, "oa");
  assert.equal(results.scene.calibrated, false);
  assert.ok(Math.abs(results.scene.confidence - 0.96) < 1e-9);
  assert.ok(Math.abs(results.feature.confidence - 0.95) < 1e-9);
});

test("an uncalibrated entry routes with the conservative language-model bands", async () => {
  const act = await sceneThrough(openAi(fakeFetch(sceneReply(0.97)).fetch));
  const verify = await sceneThrough(openAi(fakeFetch(sceneReply(0.92)).fetch));
  const dropped = await sceneThrough(openAi(fakeFetch(sceneReply(0.88)).fetch));
  assert.deepEqual([act.band, verify.band, dropped.source, dropped.fallback?.reason], ["act", "verify", "deterministic", "low-confidence"]);
});

test("a calibrated entry with a threshold sets its own bands, and without one leaves the spec's", async () => {
  const loosened = await sceneThrough(openAi(fakeFetch(sceneReply(0.85)).fetch, { calibrated: true, threshold: 0.5 }));
  const tightened = await sceneThrough(openAi(fakeFetch(sceneReply(0.97)).fetch, { calibrated: true, threshold: 0.99 }));
  const model = openAi(fakeFetch(sceneReply(0.97)).fetch, { calibrated: true });
  assert.deepEqual([loosened.band, loosened.calibrated, tightened.band, model.bands, model.calibrated], ["act", true, "escalate", undefined, true]);
});

test("an uncalibrated entry ignores a threshold", () => {
  const model = openAi(fakeFetch(sceneReply(0.97)).fetch, { threshold: 0.1 });
  assert.deepEqual(model.bands, { verify: 0.8, act: 0.9 });
});

async function failureOf(model: DecisionModel): Promise<string | undefined> {
  return (await sceneThrough(model)).fallback?.reason;
}

test("openai failures map onto the existing failure reasons", async () => {
  const cases: ReadonlyArray<readonly [HttpReply | Error, string]> = [
    [new Error("ECONNREFUSED"), "unavailable"],
    [textReply(401, "{}"), "unauthorized"],
    [textReply(403, "{}"), "unauthorized"],
    [textReply(429, "{}"), "backoff"],
    [textReply(400, '{"error":{"code":"context_length_exceeded"}}'), "state-too-large"],
    [textReply(400, '{"error":{"code":"invalid_request_error"}}'), "rejected"],
    [textReply(404, "{}"), "rejected"],
    [textReply(500, "oops"), "unavailable"],
    [textReply(200, "not json"), "malformed"],
    [jsonReply(200, { choices: [] }), "malformed"],
    [completionOf(null), "malformed"],
    [completionOf("{\"answers\": 3}"), "malformed"],
    [completionOf(null, "I can't help with that."), "refused"],
  ];
  for (const [answer, reason] of cases) assert.equal(await failureOf(openAi(fakeFetch(answer).fetch)), reason, reason);
});

test("an aborted openai call is a timeout", async () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(await failureOf(openAi(fakeFetch(abort).fetch)), "timeout");
});

test("an openai failure never puts the key in the reason", async () => {
  const fallback = (await sceneThrough(openAi(fakeFetch(textReply(401, "bad sk-test")).fetch))).fallback;
  assert.equal(JSON.stringify(fallback).includes("sk-test"), false);
});

const WORKERS_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function cloudflare(fetch: HttpFetch, gateway?: string): DecisionModel {
  return cloudflareDecisionModel({ id: "cf", accountId: "acc1", model: WORKERS_MODEL, apiKey: "cf-test", fetch, ...(gateway === undefined ? {} : { gateway }) });
}

function runReply(response: JsonValue): HttpReply {
  return jsonReply(200, { success: true, errors: [], messages: [], result: { response } });
}

test("cloudflare urls are direct on the account, or through the gateway", () => {
  const model = { accountId: "acc1", model: WORKERS_MODEL };
  assert.equal(cloudflareUrl(model), `https://api.cloudflare.com/client/v4/accounts/acc1/ai/run/${WORKERS_MODEL}`);
  assert.equal(cloudflareUrl({ ...model, gateway: "gw" }), `https://gateway.ai.cloudflare.com/v1/acc1/gw/workers-ai/${WORKERS_MODEL}`);
});

test("a cloudflare request is the native run call in JSON mode with the reply schema", async () => {
  const { fetch, calls } = fakeFetch(runReply({ answers: { scene: { probability: 0.97 } } }));
  await sceneThrough(cloudflare(fetch));
  const body = sentBody(calls[0], cloudflareSent);
  assert.equal(calls[0]?.url, `https://api.cloudflare.com/client/v4/accounts/acc1/ai/run/${WORKERS_MODEL}`);
  assert.deepEqual(calls[0]?.request.headers, { "Content-Type": "application/json", Authorization: "Bearer cf-test" });
  assert.equal(body.response_format.type, "json_schema");
  assert.deepEqual(body.response_format.json_schema, replySchema(SCENE_QUESTIONS));
  assert.equal(body.model, undefined);
});

test("a cloudflare request through a gateway goes to the gateway address", async () => {
  const { fetch, calls } = fakeFetch(runReply({ answers: { scene: { probability: 0.97 } } }));
  await sceneThrough(cloudflare(fetch, "gw"));
  assert.equal(calls[0]?.url, `https://gateway.ai.cloudflare.com/v1/acc1/gw/workers-ai/${WORKERS_MODEL}`);
});

test("a cloudflare reply is read whether the response is an object or a JSON string", async () => {
  const asObject = await sceneThrough(cloudflare(fakeFetch(runReply({ answers: { scene: { probability: 0.97 } } })).fetch));
  const asString = await sceneThrough(cloudflare(fakeFetch(runReply('{"answers":{"scene":{"probability":0.97}}}')).fetch));
  assert.deepEqual([asObject.value, asObject.source, asObject.provider, asObject.band, asString.value, asString.band], [true, "decision-model", "cf", "act", true, "act"]);
});

test("cloudflare failures map onto the existing failure reasons", async () => {
  const cases: ReadonlyArray<readonly [HttpReply | Error, string]> = [
    [new Error("ENOTFOUND"), "unavailable"],
    [textReply(401, "{}"), "unauthorized"],
    [textReply(403, "{}"), "unauthorized"],
    [textReply(429, "{}"), "backoff"],
    [textReply(400, '{"errors":[{"message":"JSON Mode couldn\'t be met"}]}'), "rejected"],
    [textReply(503, "busy"), "unavailable"],
    [textReply(200, "<html>"), "malformed"],
    [jsonReply(200, { success: true, result: {} }), "malformed"],
    [runReply("no json here"), "malformed"],
  ];
  for (const [answer, reason] of cases) assert.equal(await failureOf(cloudflare(fakeFetch(answer).fetch)), reason, reason);
});

test("a cloudflare model is uncalibrated and carries the conservative bands", () => {
  const model = cloudflare(fakeFetch(runReply({})).fetch);
  assert.deepEqual([model.tier, model.calibrated, model.bands], ["decision-model", false, { verify: 0.8, act: 0.9 }]);
});
