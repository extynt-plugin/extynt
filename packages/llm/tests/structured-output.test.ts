/** Structured output for each adapter: the request body shape, the decoded reply, and a reply that is not JSON refused. */
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { AnthropicProvider } from "../src/anthropic.js";
import { MockProvider } from "../src/mock.js";
import { OpenAICompatibleProvider, OpenAIResponsesProvider } from "../src/openai.js";
import { ProviderHttpError } from "../src/provider-http-error.js";
import { supportsStructuredOutput } from "../src/provider-guards.js";
import type { SecretSource } from "../src/provider-secret.js";
import type { JsonSchemaSpec } from "../src/types.js";
import { captureJson } from "./wire-fixtures.js";

const secret: SecretSource = { authSource: "server-environment", resolve: () => "secret" };
const schema: JsonSchemaSpec = { name: "verdict", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } };
const request = { system: "Judge.", user: "Is it fine?" };
const chatConfig = { id: "compat-chat", endpoint: "https://llm.test/v1", model: "m", authSource: "server-environment" } as const;

type Scripted = { status: number; body: JsonValue };

function scripted(bodies: JsonObject[], replies: Scripted[]): typeof fetch {
  return async (_input, init) => {
    bodies.push(captureJson(String(init?.body)));
    const reply = replies.shift();
    if (!reply) throw new Error("The scripted replies ran out.");
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
}

function chatText(content: string): Scripted {
  return { status: 200, body: { choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] } };
}

function refusal(message: string): Scripted {
  return { status: 400, body: { error: { message } } };
}

function bodyAt(bodies: JsonObject[], index: number): JsonObject {
  const body = bodies[index];
  if (!body) throw new Error(`No request was sent at position ${index}.`);
  return body;
}

function chatProvider(bodies: JsonObject[], replies: Scripted[]): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({ config: chatConfig, secretSource: secret, fetch: scripted(bodies, replies) });
}

test("the guard tells a structured provider from a plain one", () => {
  assert.equal(supportsStructuredOutput(chatProvider([], [])), true);
  assert.equal(supportsStructuredOutput(new MockProvider()), false);
  assert.equal(supportsStructuredOutput(undefined), false);
});

test("Anthropic forces one tool carrying the schema, sends no thinking, and returns the tool input as JSON", async () => {
  const bodies: JsonObject[] = [];
  const reply = { status: 200, body: { content: [{ type: "tool_use", id: "t1", name: "verdict", input: { ok: true } }], stop_reason: "tool_use" } };
  const provider = new AnthropicProvider({ secretSource: secret, fetch: scripted(bodies, [reply]) });
  const text = await provider.completeJson(request, schema);
  assert.deepEqual(JSON.parse(text), { ok: true });
  const body = bodyAt(bodies, 0);
  assert.deepEqual(body.tool_choice, { type: "tool", name: "verdict" });
  assert.deepEqual(body.tools, [{ name: "verdict", description: "Return the answer as this object.", input_schema: schema.schema }]);
  assert.equal(body.system, "Judge.");
  assert.deepEqual(body.messages, [{ role: "user", content: "Is it fine?" }]);
  assert.equal("thinking" in body, false);
});

test("Anthropic refuses a reply that did not call the tool", async () => {
  const reply = { status: 200, body: { content: [{ type: "text", text: "Sure." }], stop_reason: "end_turn" } };
  const provider = new AnthropicProvider({ secretSource: secret, fetch: scripted([], [reply]) });
  await assert.rejects(provider.completeJson(request, schema), ProviderHttpError);
});

test("OpenAI Responses asks for the schema through text.format and returns the output text", async () => {
  const bodies: JsonObject[] = [];
  const reply = { status: 200, body: { output_text: "{\"ok\":false}" } };
  const provider = new OpenAIResponsesProvider({ config: { id: "openai-responses", endpoint: "https://api.test/v1", model: "gpt", authSource: "server-environment" }, secretSource: secret, fetch: scripted(bodies, [reply]) });
  assert.equal(await provider.completeJson(request, schema), "{\"ok\":false}");
  const body = bodyAt(bodies, 0);
  assert.deepEqual(body.text, { format: { type: "json_schema", name: "verdict", schema: schema.schema, strict: true } });
  assert.equal(body.instructions, "Judge.");
  assert.equal(body.store, false);
});

test("OpenAI Responses refuses output text that is not JSON", async () => {
  const provider = new OpenAIResponsesProvider({ config: { id: "openai-responses", endpoint: "https://api.test/v1", model: "gpt", authSource: "server-environment" }, secretSource: secret, fetch: scripted([], [{ status: 200, body: { output_text: "fine, thanks" } }]) });
  await assert.rejects(provider.completeJson(request, schema), ProviderHttpError);
});

test("a chat endpoint is first asked for a json_schema response format", async () => {
  const bodies: JsonObject[] = [];
  const text = await chatProvider(bodies, [chatText("{\"ok\":true}")]).completeJson(request, schema);
  assert.equal(text, "{\"ok\":true}");
  const body = bodyAt(bodies, 0);
  assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "verdict", schema: schema.schema, strict: true } });
  assert.deepEqual(body.messages, [{ role: "system", content: "Judge." }, { role: "user", content: "Is it fine?" }]);
});

test("a refused json_schema falls back to json_object with the schema in the system prompt, and is remembered", async () => {
  const bodies: JsonObject[] = [];
  const provider = chatProvider(bodies, [refusal("Unsupported response_format json_schema"), chatText("{\"ok\":true}"), chatText("{\"ok\":false}")]);
  assert.equal(await provider.completeJson(request, schema), "{\"ok\":true}");
  assert.deepEqual(bodyAt(bodies, 1).response_format, { type: "json_object" });
  assert.match(String(JSON.stringify(bodyAt(bodies, 1).messages)), /JSON Schema \(verdict\)/);
  assert.equal(provider.capabilities.current.structuredOutput, "json_object");
  await provider.completeJson(request, schema);
  assert.deepEqual(bodyAt(bodies, 2).response_format, { type: "json_object" });
});

test("a refused json_object falls back to the prompt alone", async () => {
  const bodies: JsonObject[] = [];
  const provider = chatProvider(bodies, [refusal("response_format is not supported"), refusal("json_object response_format unsupported"), chatText("{\"ok\":true}")]);
  assert.equal(await provider.completeJson(request, schema), "{\"ok\":true}");
  assert.equal("response_format" in bodyAt(bodies, 2), false);
  assert.equal(provider.capabilities.current.structuredOutput, "prompt");
});

test("a refusal about something else is not retried", async () => {
  const provider = chatProvider([], [refusal("The model is overloaded")]);
  await assert.rejects(provider.completeJson(request, schema), ProviderHttpError);
});

test("a JSON object wrapped in prose is cut out, and a reply with no JSON is refused", async () => {
  const wrapped = await chatProvider([], [chatText("Here it is:\n```json\n{\"ok\":true}\n```")]).completeJson(request, schema);
  assert.equal(wrapped, "{\"ok\":true}");
  await assert.rejects(chatProvider([], [chatText("I cannot do that.")]).completeJson(request, schema), ProviderHttpError);
});

test("the caller's signal aborts the request", async () => {
  const controller = new AbortController();
  const hanging: typeof fetch = (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  const provider = new OpenAICompatibleProvider({ config: chatConfig, secretSource: secret, fetch: hanging });
  const pending = provider.completeJson({ ...request, signal: controller.signal }, schema);
  controller.abort();
  await assert.rejects(pending, /aborted/);
});

const frame = { mediaType: "image/png", base64: "AAAA" };

test("a structured request carrying an image sends it as a data URL on the chat wire and as a base64 block on Anthropic's", async () => {
  const bodies: JsonObject[] = [];
  await chatProvider(bodies, [chatText("{\"ok\":true}")]).completeJson({ ...request, image: frame }, schema);
  assert.deepEqual(bodyAt(bodies, 0).messages, [{ role: "system", content: "Judge." }, { role: "user", content: [{ type: "text", text: "Is it fine?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }]);
  const reply = { status: 200, body: { content: [{ type: "tool_use", id: "t1", name: "verdict", input: { ok: true } }], stop_reason: "tool_use" } };
  await new AnthropicProvider({ secretSource: secret, fetch: scripted(bodies, [reply]) }).completeJson({ ...request, image: frame }, schema);
  assert.deepEqual(bodyAt(bodies, 1).messages, [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }, { type: "text", text: "Is it fine?" }] }]);
});
