/** Which reasoning effort a request sends: nothing for Default, the chosen level when the model offers it, else the nearest level at or above. */
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonValue } from "@extynt/decode";
import { createLocalSecretInput, effortWithin, type ProviderConfig, type ReasoningEffort } from "../src/index.js";
import { OpenAICompatibleProvider } from "../src/openai.js";
import { captureRequest, requestAt, stepOnce, type CapturedRequest } from "./wire-fixtures.js";

test("a level the model offers is sent as it is; one it lacks becomes the nearest above, then the nearest below", () => {
  const withMedium: ReasoningEffort[] = ["low", "medium", "high"], withoutMedium: ReasoningEffort[] = ["low", "high", "max"];
  assert.equal(effortWithin(withMedium, "medium"), "medium");
  assert.equal(effortWithin(withoutMedium, "medium"), "high", "never silently less thinking than asked");
  assert.equal(effortWithin(withoutMedium, "xhigh"), "max");
  assert.equal(effortWithin(withMedium, "max"), "high", "nothing above: the strongest level there is");
  assert.equal(effortWithin(withMedium, "none"), "low", "the weakest level the model takes");
  assert.equal(effortWithin(["max", "low", "high"], "medium"), "high", "the list's own order does not matter");
  assert.equal(effortWithin([], "high"), undefined, "a model with no effort control takes none");
  assert.equal(effortWithin(withMedium, undefined), undefined, "Default asks for nothing");
  assert.equal(effortWithin(undefined, "medium"), "medium", "an unreported list sends the request as it is");
});

function providerFor(reasoningEffort: ReasoningEffort | undefined, row: JsonValue, bodies: CapturedRequest[]): OpenAICompatibleProvider {
  const config: ProviderConfig = { id: "custom-chat", endpoint: "http://127.0.0.1:4310", model: "m", authSource: "local-secret-input", ...(reasoningEffort ? { reasoningEffort } : {}) };
  return new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("k"),
    config,
    fetch: (async (_input, init) => {
      if (init?.method !== "POST") return new Response(JSON.stringify({ data: [row] }), { status: 200 });
      bodies.push(captureRequest(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }), { status: 200 });
    }),
  });
}

test("Default sends no effort parameter and no thinking switch, whatever levels the model lists", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = providerFor(undefined, { id: "m", effort: { supported_levels: ["low", "high", "max"] } }, bodies);
  await provider.discoverCapabilities();
  await stepOnce(provider);
  assert.equal("reasoning_effort" in requestAt(bodies, 0), false);
  assert.equal("thinking" in requestAt(bodies, 0), false);
});

test("a provider list without medium sends the next level up for a medium choice", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = providerFor("medium", { id: "m", effort: { supported_levels: ["low", "high", "max"] } }, bodies);
  await provider.discoverCapabilities();
  await stepOnce(provider);
  assert.equal(requestAt(bodies, 0).reasoning_effort, "high");
});

test("a provider list with medium sends medium", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = providerFor("medium", { id: "m", effort: { supported_levels: ["low", "medium", "high"] } }, bodies);
  await provider.discoverCapabilities();
  await stepOnce(provider);
  assert.equal(requestAt(bodies, 0).reasoning_effort, "medium");
});

test("a refresh reads the provider's list again, where the first answer is otherwise kept", async () => {
  let levels = ["low", "high"];
  const requests: string[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("k"),
    config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "m", authSource: "local-secret-input" },
    fetch: (async (input) => { requests.push(String(input)); return new Response(JSON.stringify({ data: [{ id: "m", effort: { supported_levels: levels } }] }), { status: 200 }); }),
  });
  assert.deepEqual(await provider.discoverEfforts(), ["low", "high"]);
  levels = ["low", "medium", "high"];
  assert.deepEqual(await provider.discoverEfforts(), ["low", "high"], "the memo answers without asking");
  assert.equal(requests.length, 1);
  assert.deepEqual(await provider.discoverEfforts({ refresh: true }), ["low", "medium", "high"]);
  assert.equal(requests.length, 2);
});
