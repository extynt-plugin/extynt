// Tests for image-aware routing: a picture goes only to a provider that accepts images, never to Jev, in the one call each tier gets.
import assert from "node:assert/strict";
import test from "node:test";
import { array, decodeJson, jsonValue, object } from "@extynt/decode";
import { FRAME_QUALITY, VISUAL_WAIVER, decideAll, decisionModelsFromEnvironment, jevDecisionModel, languageDecisionModel, openAiDecisionModel } from "../src/index.js";
import type { DecisionImage, DecisionModel, JsonValue } from "../src/index.js";
import { FEATURE, IS_SCENE, answersReply, fakeFetch, jsonReply } from "./support.js";

const IMAGE: DecisionImage = { mediaType: "image/png", base64: "AAAA" };

const SEEN = { ...IS_SCENE, name: "seen", wantsImage: true as const };

const NEEDS = { ...SEEN, name: "needed", needsImage: true as const };

const MODEL_ONLY = { ...FEATURE, name: "modelled", useModel: true as const };

const STATE = { text: "a glow scene" };

interface Recorded {
  readonly questions: ReadonlyArray<string>;
  readonly image: DecisionImage | undefined;
}

function recorder(id: string, tier: DecisionModel["tier"], acceptsImages: boolean | undefined): { readonly model: DecisionModel; readonly calls: Recorded[] } {
  const calls: Recorded[] = [];
  const model: DecisionModel = {
    id, tier, supports: new Set(["choice", "binary"]), calibrated: true, threshold: 0.5,
    ...(acceptsImages === undefined ? {} : { acceptsImages }),
    decide: async (_state, questions, _signal, image) => {
      calls.push({ questions: questions.map((question) => question.id), image });
      const answers = new Map(questions.map((question) => [question.id, question.kind === "binary"
        ? { kind: "binary" as const, probability: 0.99, confidence: 0.99 }
        : { kind: "choice" as const, label: "glow", confidence: 0.99, probabilities: { glow: 0.99, blur: 0.005, none: 0.005 } }]));
      return { ok: true, answers, usage: { model: null, inputTokens: null } };
    },
  };
  return { model, calls };
}

test("an image goes to a tier that accepts images and the result says so", async () => {
  const { model, calls } = recorder("vision", "decision-model", true);
  const results = await decideAll(STATE, { seen: SEEN }, { models: [model], image: IMAGE });
  assert.deepEqual(calls[0]?.image, IMAGE);
  assert.equal(results.seen.imageSent, true);
});

test("an image never goes to a tier that does not accept images", async () => {
  const text = recorder("text", "decision-model", false);
  const silent = recorder("silent", "decision-model", undefined);
  const results = await decideAll(STATE, { seen: SEEN }, { models: [text.model, silent.model], image: IMAGE });
  assert.equal(text.calls[0]?.image, undefined);
  assert.equal(results.seen.imageSent, false);
});

test("a question that does not want an image is sent none even to an image tier", async () => {
  const { model, calls } = recorder("vision", "decision-model", true);
  const results = await decideAll(STATE, { plain: IS_SCENE }, { models: [model], image: IMAGE });
  assert.equal(calls[0]?.image, undefined);
  assert.equal(results.plain.imageSent, false);
});

test("Jev never receives an image, in the request or in the model's capabilities", async () => {
  const { fetch, calls } = fakeFetch(answersReply({ seen: { type: "binary", probability: 0.9, confidence: 0.9 } }));
  const jev = jevDecisionModel({ apiKey: "k", fetch });
  const results = await decideAll(STATE, { seen: SEEN }, { models: [jev], image: IMAGE });
  assert.equal(jev.acceptsImages ?? false, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.request.body.includes(IMAGE.base64), false);
  assert.equal(calls[0]?.request.body.includes("image"), false);
  assert.equal(results.seen.imageSent, false);
});

test("a mixed batch is one call per tier and the image rides the call that wants it", async () => {
  const first = recorder("vision", "decision-model", true);
  const second = recorder("user", "model", true);
  await decideAll(STATE, { seen: SEEN, plain: IS_SCENE, modelled: MODEL_ONLY }, { models: [first.model, second.model], image: IMAGE });
  assert.equal(first.calls.length, 1);
  assert.deepEqual(first.calls[0]?.questions, ["seen", "plain", "modelled"]);
  assert.deepEqual(first.calls[0]?.image, IMAGE);
});

test("a mixed batch gives each tier one call and a tier with no image question gets none", async () => {
  const first = recorder("text", "decision-model", false);
  const second = recorder("user", "model", true);
  const feature = { ...FEATURE, threshold: 1 };
  await decideAll(STATE, { seen: SEEN, modelled: { ...MODEL_ONLY, ...feature } }, { models: [first.model, second.model], image: IMAGE });
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 1);
  assert.equal(first.calls[0]?.image, undefined);
});

test("without an image the call and the answers are exactly what they were", async () => {
  const { model, calls } = recorder("vision", "decision-model", true);
  const wanted = await decideAll(STATE, { seen: SEEN }, { models: [model] });
  const plain = await decideAll(STATE, { seen: IS_SCENE }, { models: [model] });
  assert.equal(calls[0]?.image, undefined);
  assert.equal(calls[1]?.image, undefined);
  assert.equal(wanted.seen.value, plain.seen.value);
  assert.equal(wanted.seen.imageSent, false);
  const offline = await decideAll(STATE, { seen: SEEN }, { image: IMAGE });
  assert.equal(offline.seen.source, "deterministic");
  assert.equal(offline.seen.imageSent, false);
});

test("the frame-quality and visual-waiver decisions want an image", () => {
  assert.equal(FRAME_QUALITY.wantsImage, true);
  assert.equal(VISUAL_WAIVER.wantsImage, true);
});

const sentBody = object({ messages: array(object({ content: jsonValue })) });

function userContent(calls: ReadonlyArray<{ readonly request: { readonly body: string } }>): JsonValue {
  const decoded = decodeJson(calls[0]?.request.body ?? "", sentBody);
  return decoded.ok ? decoded.value.messages[1]?.content ?? null : null;
}

const SCENE_REPLY = jsonReply(200, { id: "c", model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ answers: { seen: { probability: 0.97 } } }), refusal: null } }] });

test("an OpenAI-compatible model that accepts images sends the frame as an image_url data URL", async () => {
  const { fetch, calls } = fakeFetch(SCENE_REPLY);
  const model = openAiDecisionModel({ id: "oa", model: "gpt-vision", apiKey: "k", fetch, acceptsImages: true });
  const results = await decideAll(STATE, { seen: SEEN }, { models: [model], image: IMAGE });
  const content = userContent(calls);
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[1], { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  assert.equal(results.seen.imageSent, true);
});

test("an OpenAI-compatible model not declared to accept images stays text-only", async () => {
  const { fetch, calls } = fakeFetch(SCENE_REPLY);
  const model = openAiDecisionModel({ id: "oa", model: "gpt-text", apiKey: "k", fetch });
  await decideAll(STATE, { seen: SEEN }, { models: [model], image: IMAGE });
  assert.equal(typeof userContent(calls), "string");
  assert.equal(calls[0]?.request.body.includes("image_url"), false);
});

test("a language model reads its image capability at each call", async () => {
  let accepts = false;
  const requests: Array<DecisionImage | undefined> = [];
  const model = languageDecisionModel({ id: "chat", completeJson: async (request) => { requests.push(request.image); return JSON.stringify({ answers: { seen: { probability: 0.97 } } }); } }, 0.5, { acceptsImages: () => accepts });
  await decideAll(STATE, { seen: { ...SEEN, useModel: true } }, { models: [model], image: IMAGE });
  accepts = true;
  await decideAll(STATE, { seen: { ...SEEN, useModel: true } }, { models: [model], image: IMAGE });
  assert.deepEqual(requests, [undefined, IMAGE]);
});

test("an openai entry reads acceptsImages from the configuration and defaults to false; a systemone entry never accepts images", () => {
  const entries = JSON.stringify([
    { dialect: "openai", id: "vision", model: "m", baseUrl: "http://localhost:1/v1", acceptsImages: true },
    { dialect: "openai", id: "plain", model: "m", baseUrl: "http://localhost:1/v1" },
    { dialect: "systemone", id: "one", model: "m", baseUrl: "http://localhost:2", acceptsImages: true },
  ]);
  const accepts = decisionModelsFromEnvironment({ EXTYNT_DECISION_MODELS: entries }, fakeFetch(new Error("unused")).fetch).map((model) => [model.id, model.acceptsImages ?? false]);
  assert.deepEqual(accepts, [["vision", true], ["plain", false], ["one", false]]);
});

test("a question that needs an image is never asked of a text-only tier, Jev included, and is answered offline with the reason", async () => {
  const { fetch, calls } = fakeFetch(answersReply({ needed: { type: "binary", probability: 0.9, confidence: 0.9 } }));
  const jev = jevDecisionModel({ apiKey: "k", fetch });
  const results = await decideAll(STATE, { needed: NEEDS }, { models: [jev], image: IMAGE });
  assert.equal(calls.length, 0);
  assert.equal(results.needed.source, "deterministic");
  assert.equal(results.needed.fallback?.reason, "image-unavailable");
  assert.equal(results.needed.fallback?.provider, "jev");
  assert.equal(results.needed.imageSent, false);
});

test("a question that needs an image is not asked of an image tier when no image is given", async () => {
  const { model, calls } = recorder("vision", "decision-model", true);
  const results = await decideAll(STATE, { needed: NEEDS, plain: IS_SCENE }, { models: [model] });
  assert.deepEqual(calls[0]?.questions, ["plain"]);
  assert.equal(results.needed.source, "deterministic");
  assert.equal(results.needed.fallback?.reason, "image-unavailable");
});

test("a question that needs an image goes to a later tier that sees it, and a model tier takes it without an opt-in", async () => {
  const text = recorder("text", "decision-model", false);
  const seeing = recorder("user", "model", true);
  const results = await decideAll(STATE, { needed: NEEDS }, { models: [text.model, seeing.model], image: IMAGE });
  assert.equal(text.calls.length, 0);
  assert.deepEqual(seeing.calls[0]?.image, IMAGE);
  assert.equal(results.needed.provider, "user");
  assert.equal(results.needed.imageSent, true);
});

test("an image-only tier is asked the needsImage question and nothing else, even on retry", async () => {
  const only = { ...recorder("user", "model", true), };
  const model: DecisionModel = { ...only.model, imageOnly: true };
  const unsure = { ...MODEL_ONLY, stakes: "high" as const };
  const results = await decideAll(STATE, { needed: NEEDS, plain: IS_SCENE, modelled: MODEL_ONLY, unsure }, { models: [model], image: IMAGE });
  assert.deepEqual(only.calls[0]?.questions, ["needed"]);
  assert.equal(only.calls.length, 1);
  assert.equal(results.needed.provider, "user");
});
