// Which services may train on prompts, the acknowledgement that unlocks them, and the refusal before any request leaves.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { supportsTools, type AgentStepResult, type ChatProvider } from "@extynt/llm";
import type { ModelSettingsStore } from "../src/llm-config.js";
import { loadEnvironmentLayers } from "../src/llm-env-layers.js";
import { loadLlmEnvFile } from "../src/llm-env-file.js";
import { MODEL_SERVICES, type ModelSlot } from "../src/llm-model-services.js";
import { resolveSlot } from "../src/llm-slot-resolution.js";
import { effectiveTrainingPolicy, trainingRefusal, TrainingRiskRefusal } from "../src/training-policy.js";
import { storeIn } from "./settings-fixture.js";

type Environment = Readonly<Record<string, string>>;

const MESSAGE = "Google (Gemini) may use your prompts to train its models. Open model settings and confirm you accept that, or pick another provider.";
const GOOGLE: Environment = { AE_LLM_PROVIDER: "google", GEMINI_API_KEY: "gemini-test-key" };
const FALLBACK_TO_DEEPSEEK: Environment = { AE_LLM_PROVIDER: "mock", AE_LLM_FALLBACK_PROVIDER: "deepseek", AE_LLM_FALLBACK_API_KEY: "ds-test-key", AE_LLM_FALLBACK_MODEL: "deepseek-flash", AE_LLM_ALLOW_TRAINING_RISK: "1" };
const LOOPBACK_ADDRESSES = ["http://127.0.0.1:8080/v1", "http://localhost:1234/v1", "http://[::1]:9000/v1"];
const REMOTE_ADDRESSES = ["https://api.example.com/v1", "http://192.168.1.20:11434/v1", "not a url", ""];
const ACKNOWLEDGED = "AE_LLM_ALLOW_TRAINING_RISK";

async function stepOf(provider: ChatProvider | undefined): Promise<AgentStepResult> {
  if (!supportsTools(provider)) throw new Error("expected a tool-calling provider");
  return provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "ping" }], tools: [] });
}

async function refusalOf(provider: ChatProvider | undefined): Promise<Error | undefined> {
  try {
    await stepOf(provider);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : undefined;
  }
}

function countingFetch(t: TestContext): string[] {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (target) => {
    calls.push(String(target));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}

function modelServiceOf(id: string): (typeof MODEL_SERVICES)[number] {
  const service = MODEL_SERVICES.find((entry) => entry.id === id);
  assert.ok(service, `${id} is a service`);
  return service;
}

function customLayers(address: string): ReturnType<typeof loadEnvironmentLayers> {
  return loadEnvironmentLayers({ filePath: join(tmpdir(), "no-such-llm.env"), processEnv: { AE_LLM_PROVIDER: "custom", AE_LLM_BASE_URL: address, AE_LLM_MODEL: "m" } });
}

function policyView(store: ModelSettingsStore, slot: ModelSlot): { trainingPolicy: string | undefined; acknowledged: boolean | undefined } {
  const view = store.view().slots[slot];
  return { trainingPolicy: view?.trainingPolicy, acknowledged: view?.trainingRiskAcknowledged };
}

function googleSaved(t: TestContext): { store: ModelSettingsStore; filePath: string } {
  const fixture = storeIn(t);
  fixture.store.save({ primary: { service: "google", model: "gemini-flash-latest", apiKey: "gemini-test-key" } });
  return fixture;
}

test("the service table classifies every service", () => {
  const policies = Object.fromEntries(MODEL_SERVICES.map((service) => [service.id, service.trainingPolicy]));
  assert.deepEqual(policies, { anthropic: "no-training", openai: "no-training", google: "may-train", deepseek: "may-train", xai: "may-train", openrouter: "no-training", ollama: "no-training", custom: "may-train", "custom-anthropic": "may-train", mock: "no-training" });
});

for (const id of ["custom", "custom-anthropic"]) {
  for (const address of LOOPBACK_ADDRESSES) {
    test(`a ${id} address on this machine is no-training: ${address}`, () => {
      assert.equal(effectiveTrainingPolicy(modelServiceOf(id), address), "no-training");
    });
  }
  for (const address of REMOTE_ADDRESSES) {
    test(`a ${id} address that is not on this machine may train: ${JSON.stringify(address)}`, () => {
      assert.equal(effectiveTrainingPolicy(modelServiceOf(id), address), "may-train");
    });
  }
}

test("a resolved custom slot on this machine is no-training", () => {
  assert.equal(resolveSlot(customLayers("http://127.0.0.1:8080/v1"), "primary")?.trainingPolicy, "no-training");
});

test("a resolved custom slot on a remote address may train", () => {
  assert.equal(resolveSlot(customLayers("https://api.example.com/v1"), "primary")?.trainingPolicy, "may-train");
});

test("a may-train slot is still built, so settings and the model list keep working", (t) => {
  assert.ok(storeIn(t, GOOGLE).store.providers().primary);
});

test("a may-train slot that was not acknowledged is refused with the policy sentence", async (t) => {
  const refusal = await refusalOf(storeIn(t, GOOGLE).store.providers().primary);
  assert.ok(refusal instanceof TrainingRiskRefusal);
  assert.equal(refusal.message, MESSAGE);
});

test("a refused slot makes no network call", async (t) => {
  const calls = countingFetch(t);
  await refusalOf(storeIn(t, GOOGLE).store.providers().primary);
  assert.deepEqual(calls, []);
});

test("a refused slot is listed among the provider errors", (t) => {
  assert.ok(storeIn(t, GOOGLE).store.providers().errors.some((line) => line.includes(MESSAGE)));
});

test("an acknowledged may-train slot goes out", async (t) => {
  const calls = countingFetch(t);
  await stepOf(storeIn(t, { ...GOOGLE, [ACKNOWLEDGED]: "1" }).store.providers().primary);
  assert.equal(calls.length > 0, true);
});

test("an acknowledged may-train slot reports no errors", (t) => {
  assert.deepEqual(storeIn(t, { ...GOOGLE, [ACKNOWLEDGED]: "1" }).store.providers().errors, []);
});

test("the fallback slot has its own acknowledgement", async (t) => {
  const refusal = await refusalOf(storeIn(t, FALLBACK_TO_DEEPSEEK).store.providers().fallback);
  assert.ok(refusal instanceof TrainingRiskRefusal);
});

test("a refused fallback makes no network call", async (t) => {
  const calls = countingFetch(t);
  await refusalOf(storeIn(t, FALLBACK_TO_DEEPSEEK).store.providers().fallback);
  assert.deepEqual(calls, []);
});

test("web search is refused with the same sentence", (t) => {
  assert.equal(trainingRefusal(storeIn(t, GOOGLE).store.resolve("primary"))?.message, MESSAGE);
});

test("web search is allowed once the slot is acknowledged", (t) => {
  assert.equal(trainingRefusal(storeIn(t, { ...GOOGLE, [ACKNOWLEDGED]: "1" }).store.resolve("primary")), undefined);
});

test("web search is allowed on a service that never trains", (t) => {
  assert.equal(trainingRefusal(storeIn(t, { AE_LLM_PROVIDER: "ollama", AE_LLM_MODEL: "m" }).store.resolve("primary")), undefined);
});

test("a saved may-train service shows its policy and is not acknowledged", (t) => {
  assert.deepEqual(policyView(googleSaved(t).store, "primary"), { trainingPolicy: "may-train", acknowledged: false });
});

test("the acknowledgement is saved through the settings update and shown in the view", (t) => {
  const { store, filePath } = googleSaved(t);
  assert.deepEqual(store.save({ primary: { service: "google", acknowledgeTrainingRisk: true } }), { ok: true });
  assert.deepEqual([loadLlmEnvFile(filePath)[ACKNOWLEDGED], policyView(store, "primary").acknowledged], ["1", true]);
});

test("a change that does not name the service keeps the acknowledgement", (t) => {
  const { store } = googleSaved(t);
  store.save({ primary: { service: "google", acknowledgeTrainingRisk: true } });
  assert.deepEqual(store.save({ primary: { model: "gemini-pro-latest" } }), { ok: true });
  assert.equal(policyView(store, "primary").acknowledged, true);
});

test("switching service clears the acknowledgement given for the old one", (t) => {
  const { store, filePath } = googleSaved(t);
  store.save({ primary: { service: "google", acknowledgeTrainingRisk: true } });
  assert.deepEqual(store.save({ primary: { service: "xai", model: "grok-4" } }), { ok: true });
  assert.deepEqual([loadLlmEnvFile(filePath)[ACKNOWLEDGED], policyView(store, "primary").acknowledged], [undefined, false]);
});

test("the fallback slot's acknowledgement is saved on its own variable", (t) => {
  const { store, filePath } = googleSaved(t);
  const saved = store.save({ primary: { service: "xai", model: "grok-4", acknowledgeTrainingRisk: true }, fallback: { service: "deepseek", model: "deepseek-flash", acknowledgeTrainingRisk: true } });
  assert.deepEqual(saved, { ok: true });
  assert.equal(loadLlmEnvFile(filePath).AE_LLM_FALLBACK_ALLOW_TRAINING_RISK, "1");
});

test("withdrawing the primary's acknowledgement leaves the fallback's alone", (t) => {
  const { store } = googleSaved(t);
  store.save({ primary: { service: "xai", model: "grok-4", acknowledgeTrainingRisk: true }, fallback: { service: "deepseek", model: "deepseek-flash", acknowledgeTrainingRisk: true } });
  assert.deepEqual(store.save({ primary: { service: "xai", acknowledgeTrainingRisk: false } }), { ok: true });
  assert.deepEqual([policyView(store, "primary").acknowledged, policyView(store, "fallback").acknowledged], [false, true]);
});
