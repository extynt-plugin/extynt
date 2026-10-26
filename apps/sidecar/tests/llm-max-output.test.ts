// The output limit a slot asks for: the user's setting, else the documented maximum of the service's own model, else nothing.
import assert from "node:assert/strict";
import test from "node:test";
import { supportsTools } from "@extynt/llm";
import type { EnvironmentLayers } from "../src/llm-env-layers.js";
import { createSlotProvider } from "../src/llm-slot-provider.js";
import { resolveSlot } from "../src/llm-slot-resolution.js";
import { parseJson, recordOf, type JsonObject } from "./http-json.js";

type Environment = Readonly<Record<string, string>>;

const UNKNOWN_MODEL: Environment = { AE_LLM_PROVIDER: "custom", AE_LLM_BASE_URL: "http://127.0.0.1:9", AE_LLM_MODEL: "unknown-model" };

function layersOf(processEnv: Environment): EnvironmentLayers {
  return { file: {}, dotEnv: {}, process: { DEEPSEEK_API_KEY: "k", ...processEnv } };
}

async function sentBody(processEnv: Environment): Promise<JsonObject> {
  const bodies: JsonObject[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(recordOf(parseJson(String(init?.body)), ""));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    const resolved = resolveSlot(layersOf(processEnv), "primary");
    assert.ok(resolved);
    const { provider } = createSlotProvider(resolved);
    assert.ok(supportsTools(provider), "the provider takes tool-calling steps");
    await provider.step({ requestId: "r", system: "s", messages: [{ role: "user", content: "hi" }], tools: [], forceStream: false });
  } finally {
    globalThis.fetch = real;
  }
  const body = bodies[0];
  assert.ok(body, "one request was sent");
  return body;
}

test("DeepSeek sends the documented maximum of its default model", async () => {
  assert.equal((await sentBody({ AE_LLM_PROVIDER: "deepseek" })).max_tokens, 384_000);
});

test("the user's AE_LLM_MAX_OUTPUT_TOKENS wins over the documented maximum", async () => {
  assert.equal((await sentBody({ AE_LLM_PROVIDER: "deepseek", AE_LLM_MAX_OUTPUT_TOKENS: "16000" })).max_tokens, 16_000);
});

test("another model than the documented one sends no maximum", async () => {
  assert.equal("max_tokens" in (await sentBody({ AE_LLM_PROVIDER: "deepseek", AE_LLM_MODEL: "deepseek-other" })), false);
});

test("an unknown model with no setting sends no maximum", async () => {
  assert.equal("max_tokens" in (await sentBody(UNKNOWN_MODEL)), false);
});

test("an unknown model sends the maximum the user set", async () => {
  assert.equal((await sentBody({ ...UNKNOWN_MODEL, AE_LLM_MAX_OUTPUT_TOKENS: "4000" })).max_tokens, 4_000);
});
