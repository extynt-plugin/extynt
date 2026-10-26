// The user-LLM decision tier on the sidecar: the chat model joins only when no decision model is configured and it can constrain its output, one batched call answers the opted-in questions, and a decision model always wins.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MockProvider, type JsonCompletionRequest, type JsonSchemaSpec } from "@extynt/llm";
import { clearBook, bookedOneOf } from "../src/decision-book.js";
import { CHAT_MODEL_DECISIONS_VARIABLE, withChatModel } from "../src/decision-language.js";
import { primeJobOpen } from "../src/decision-prime.js";
import { DecisionService } from "../src/decision-service.js";
import { scriptedModel, yesNo } from "./decision-fakes.js";
import { listOf, parseJson, textOf } from "./http-json.js";

beforeEach(() => clearBook());

interface Asked { readonly request: JsonCompletionRequest; readonly schema: JsonSchemaSpec }

class StructuredMock extends MockProvider {
  public readonly asked: Asked[] = [];
  public constructor(private readonly reply: string, acceptsImages?: boolean) { super(acceptsImages === undefined ? {} : { acceptsImages }); }
  public async completeJson(request: JsonCompletionRequest, schema: JsonSchemaSpec): Promise<string> {
    this.asked.push({ request, schema });
    return this.reply;
  }
}

const REQUEST = "Draw a rocket over a skyline.";
const REPLY = JSON.stringify({ answers: {
  "drawn-scene": { probabilities: { "drawn-scene": 0.97, "arranged-layers": 0.03 } },
  "request-scale": { probabilities: { small: 0.05, long: 0.95 } },
} });

const noModels = () => [];

test("the chat model joins the decision models only when it can constrain its output and no decision model is configured", () => {
  const structured = new StructuredMock(REPLY);
  assert.deepEqual(withChatModel(noModels, () => structured, {})().map((model) => [model.id, model.tier]), [[`chat-model:${structured.model}`, "model"]]);
  assert.equal(withChatModel(noModels, () => new MockProvider(), {})().length, 0, "a provider without structured output is not asked");
  assert.equal(withChatModel(noModels, () => undefined, {})().length, 0);
  assert.equal(withChatModel(noModels, () => structured, { [CHAT_MODEL_DECISIONS_VARIABLE]: "0" })().length, 0, "the user can turn it off");
  const jev = scriptedModel(() => yesNo(true)).model;
  assert.deepEqual(withChatModel(() => [jev], () => structured, {})(), [jev], "a configured decision model keeps the decisions to itself");
});

test("the model is one object per provider, and a new provider gets a new one", () => {
  let provider = new StructuredMock(REPLY);
  const models = withChatModel(noModels, () => provider, {});
  assert.equal(models()[0], models()[0]);
  const first = models()[0];
  provider = new StructuredMock(REPLY);
  assert.notEqual(models()[0], first);
});

test("the job-open batch costs the chat model one schema-constrained call that carries only the opted-in questions, and its confident answers are booked", async () => {
  const provider = new StructuredMock(REPLY);
  const service = new DecisionService({ models: withChatModel(noModels, () => provider, {}), log: { record: () => undefined }, now: () => new Date(0) });
  await primeJobOpen(service, { request: REQUEST, message: REQUEST });
  assert.equal(provider.asked.length, 1);
  const { request, schema } = provider.asked[0] ?? assert.fail("no call");
  const asked = listOf(parseJson(request.user), "questions").map((question) => textOf(question, "id")).sort();
  assert.deepEqual(asked, ["asserts-current-state", "drawn-scene", "request-scale"]);
  const required = listOf(schema.schema, "properties.answers.required").map((id) => String(id)).sort();
  assert.deepEqual(required, ["asserts-current-state", "drawn-scene", "request-scale"]);
  assert.equal(bookedOneOf({ decision: "drawn-scene", text: REQUEST }, ["drawn-scene", "arranged-layers"] as const), "drawn-scene");
  assert.equal(bookedOneOf({ decision: "request-scale", text: REQUEST }, ["small", "long"] as const), "long");
});

test("a chat model that answers with doubt, or not at all, leaves the deterministic answer in place", async () => {
  const doubtful = new StructuredMock(JSON.stringify({ answers: { "drawn-scene": { probabilities: { "drawn-scene": 0.6, "arranged-layers": 0.4 } } } }));
  const service = new DecisionService({ models: withChatModel(noModels, () => doubtful, {}), log: { record: () => undefined }, now: () => new Date(0) });
  await primeJobOpen(service, { request: REQUEST, message: REQUEST });
  assert.equal(bookedOneOf({ decision: "drawn-scene", text: REQUEST }, ["drawn-scene", "arranged-layers"] as const), undefined);
  assert.equal(bookedOneOf({ decision: "request-scale", text: REQUEST }, ["small", "long"] as const), undefined);
});

test("a chat model that takes images joins a configured decision model, which cannot read a frame", () => {
  const jev = scriptedModel(() => yesNo(true)).model;
  const seeing = new StructuredMock(REPLY, true);
  const models = withChatModel(() => [jev], () => seeing, {})();
  assert.deepEqual(models.map((model) => model.tier), ["decision-model", "model"]);
  assert.equal(models[1]?.acceptsImages, true);
});

test("a chat model beside a decision model answers only the questions that need a frame, never the retry or opted-in ones", async () => {
  const provider = new StructuredMock(REPLY, true);
  const jev = scriptedModel(() => yesNo(true)).model;
  const service = new DecisionService({ models: withChatModel(() => [jev], () => provider, {}), log: { record: () => undefined }, now: () => new Date(0) });
  await primeJobOpen(service, { request: REQUEST, message: REQUEST });
  assert.equal(provider.asked.length, 0);
  assert.equal(withChatModel(() => [jev], () => provider, {})()[1]?.imageOnly, true);
  assert.equal(withChatModel(noModels, () => provider, {})()[0]?.imageOnly, undefined);
});
