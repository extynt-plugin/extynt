/** Tests prompt files, turn traces and their rendering. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeJson } from "@extynt/decode";
import { wireObject } from "@extynt/fake-plugin";
import { CONTEXT_SCHEMA_VERSION, CapabilityLedger, MockProvider, providerDisplayMetadata, type CopilotContext, type ReasoningEffort, type ProviderCompletion, type ProviderConfig, type ProviderDisplayMetadata, type AgentMessage, type AgentStepInput, type AgentStepResult, type AgentToolSpec, type ToolCallingProvider } from "@extynt/llm";
import { createTrace, extractReasoning, renderTrace, tracingProvider, type Trace, type TraceRecord } from "../src/trace.js";
import { loadPrompts, parsePrompt, PROMPTS_DIRECTORY } from "../src/prompts.js";
import { SCENARIOS, scenarioById } from "../src/scenarios.js";
import { availableProfileFiles, defaultProfileDirectory, describeSeeding, isolatedProfileDirectory, realProfileDirectory, seedIsolatedProfile } from "../src/host-profile.js";
import { effectsProvenApplied } from "../src/profile-reports.js";
import { startTracedSidecar } from "../src/inprocess.js";
import { compositionAsset, freshProbe } from "../src/assets.js";
import { jsonArray, jsonNumber, jsonString } from "../src/wire-reads.js";
import type { WireObject } from "../src/wire-types.js";

test("a prompt file is front matter plus a verbatim body", () => {
  const { scenario } = parsePrompt([
    "---",
    "id: my-prompt",
    "asset: empty-ident",
    "notes: why this exists",
    'expect: {"outcome":"planned","plans":{"min":1}}',
    "---",
    "Line one of the request.",
    "  Line two keeps its leading spaces.",
  ].join("\n"));
  assert.equal(scenario.id, "my-prompt");
  assert.equal(scenario.asset, "empty-ident");
  assert.equal(scenario.offline, false);
  assert.equal(scenario.notes, "why this exists");
  assert.deepEqual(scenario.expect, { outcome: "planned", plans: { min: 1 } });
  assert.equal(scenario.message, "Line one of the request.\n  Line two keeps its leading spaces.");
});

test("a prompt with no front matter, asset, id, or body is rejected with the reason", () => {
  assert.throws(() => parsePrompt("no fence at all", "p.md"), /must open with a "---" front-matter fence/);
  assert.throws(() => parsePrompt("---\nid: a\n", "p.md"), /never closed/);
  assert.throws(() => parsePrompt("---\nid: a\n---\nbody", "p.md"), /"asset" is required/);
  assert.throws(() => parsePrompt("---\nasset: nope\n---\nbody", "p.md"), /unknown asset "nope"/);
  assert.throws(() => parsePrompt("---\nasset: empty-ident\n---\n", "p.md"), /body is empty/);
  assert.throws(() => parsePrompt("---\nasset: empty-ident\nexpect: {oops\n---\nbody", "p.md"), /"expect" must be one line of JSON/);
});

test("the id falls back to a slug of the file name, and an explicit id is validated as written", () => {
  assert.equal(parsePrompt("---\nasset: empty-ident\n---\nbody", "/tmp/Some Prompt.md").scenario.id, "some-prompt");
  assert.equal(parsePrompt("---\nasset: empty-ident\n---\nbody", "/tmp/2 - Big Idea!.md").scenario.id, "2-big-idea");
  assert.throws(() => parsePrompt("---\nid: Has Spaces\nasset: empty-ident\n---\nbody", "p.md"), /must be lowercase letters, digits, and dashes/);
  assert.throws(() => parsePrompt("---\nasset: empty-ident\n---\nbody", "/tmp/---.md"), /yields no usable id/);
});

test("the shipped prompt library loads and lands in SCENARIOS", () => {
  const prompts = loadPrompts();
  assert.ok(prompts.length >= 1, `expected at least one prompt in ${PROMPTS_DIRECTORY}`);
  for (const prompt of prompts) {
    assert.ok(prompt.path.endsWith(".md"), "every prompt names the file it came from");
    assert.equal(scenarioById(prompt.scenario.id).message, prompt.scenario.message);
  }
  const ident = scenarioById("title-ident-from-scratch");
  assert.equal(ident.asset, "empty-ident");
  for (const needle of ["Ramp", "gradient fill", "repeater", "track matte", "Essential Graphics", "coherent stages", "recorded undo"]) {
    assert.ok(ident.message.includes(needle), `the prompt should still ask for ${needle}`);
  }
});

test("a missing prompt directory is an empty library, not a crash", () => {
  assert.deepEqual(loadPrompts("/tmp/extynt-no-such-prompt-directory"), []);
});

test("every scenario in the merged list resolves its asset", () => {
  assert.ok(SCENARIOS.some((scenario) => scenario.offline), "at least one scenario runs without a model");
  assert.ok(SCENARIOS.some((scenario) => !scenario.offline), "at least one scenario needs a model");
  assert.ok(SCENARIOS.some((scenario) => scenario.id === "title-ident-from-scratch"), "file prompts join the code scenarios");
});

test("an isolated run is seeded with the host's installed effects", () => {
  const home = mkdtempSync(join(tmpdir(), "extynt-seed-test-"));
  try {
    const source = defaultProfileDirectory(), seeded = seedIsolatedProfile(home, source);
    const target = isolatedProfileDirectory(home);
    for (const file of seeded) {
      assert.ok(existsSync(join(target, file)), `${file} was reported seeded but is not in the isolated profile`);
      assert.ok(existsSync(join(source, file)), `${file} disappeared from the source profile`);
    }
    assert.equal(seeded.length, availableProfileFiles().length, "the seeded set is what the real profile had");
    if (seeded.includes("host-capability-profile.json")) {
      const entries = jsonArray(parsedLine(readFileSync(join(target, "host-capability-profile.json"), "utf8")).entries, "the seeded host capability profile entries");
      assert.ok(entries.length > 0, "a seeded profile must carry entries");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  assert.match(describeSeeding([]), /No host capability profile found/);
  assert.match(describeSeeding(["host-capability-profile.json"]), /Seeded the host profile/);
});

test("a profile is derived only from effects the live matrix actually applied", () => {
  const report = {
    cases: [
      { host: [{ response: { steps: [{ operation: "ensure_effect", status: "applied", effectPath: "ADBE Effect Parade/ADBE Ramp" }] } }] },
      { host: [{ response: { steps: [{ operation: "ensure_effect", status: "applied", effectPath: "ADBE Effect Parade/ADBE Glo2#2" }] } }] },
      { host: [{ response: { steps: [{ operation: "ensure_effect", status: "rejected", effectPath: "ADBE Effect Parade/ADBE Broken" }] } }] },
      { host: [{ response: { steps: [{ operation: "set_layer_property", status: "applied", effectPath: "ADBE Effect Parade/ADBE NotAnEffect" }] } }] },
    ],
  };
  const proven = effectsProvenApplied([report]);
  assert.deepEqual([...proven.keys()].sort(), ["ADBE Glo2", "ADBE Ramp"]);
  assert.equal(proven.get("ADBE Ramp"), 1);
  assert.equal(effectsProvenApplied([null, {}, { cases: "no" }]).size, 0);
});

test("chat-tests offers a text-only model no picture, only a frame it can measure", async () => {
  const trace = createTrace();
  const handle = await startTracedSidecar({ kind: "mock" }, { trace });
  try {
    const published = await handle.publishSnapshot(freshProbe(compositionAsset("summer-launch"), `probe-vision-${Date.now()}`));
    assert.equal(published.status, 201, "the fixture must publish before a turn can run");
    const response = await handle.chat({ requestId: "vision-check", message: "rename to Hero" });
    assert.equal(response.status, 200);
    const offered = /\[tools offered: ([^\]]*)\]/.exec(trace.render())?.[1] ?? "";
    assert.ok(offered.length > 0, "the transcript must name the tools the model was offered");
    assert.doesNotMatch(offered, /ae_get_capture_frame/, "a model that takes no images is never handed the picture");
    assert.match(offered, /ae_observe_frame/, "visual work is checked in numbers");
    for (const tool of ["ae_tool_schema", "ae_call_tool"]) assert.match(offered, new RegExp(tool));
  } finally {
    await handle.stop();
  }
});

function fakeProvider(replies: AgentStepResult[]): MockProvider {
  let index = 0;
  return new MockProvider({ model: "fake-1", script: () => replies[Math.min(index++, replies.length - 1)] ?? { text: "", toolCalls: [] } });
}

function stepInput(
  system: string,
  messages: AgentMessage[],
  extra: { tools?: AgentToolSpec[]; systemSegments?: Array<{ text: string; cache?: boolean }> } = {},
): AgentStepInput {
  return { requestId: "trace-test", system, messages, tools: extra.tools ?? [], ...(extra.systemSegments ? { systemSegments: extra.systemSegments } : {}) };
}

function toolMessage(content: string): AgentMessage {
  return { role: "tool", toolCallId: "c1", name: "ae_inspect_layer", content };
}

function toolSpec(name: string, description: string): AgentToolSpec {
  return { name, description, parameters: {} };
}

function ofKind<K extends TraceRecord["kind"]>(trace: Trace, kind: K): Array<Extract<TraceRecord, { kind: K }>> {
  return trace.records.filter((record): record is Extract<TraceRecord, { kind: K }> => record.kind === kind);
}

function parsedLine(line: string): WireObject {
  const decoded = decodeJson(line, wireObject);
  assert.ok(decoded.ok, "the line should be a JSON object");
  return decoded.value;
}

const userMessage: AgentMessage = { role: "user", content: "do the thing" };

test("wrapping a provider keeps its prototype getters and methods", () => {
  class RealisticProvider implements ToolCallingProvider {
    public readonly id = "real";
    public readonly model = "real-1";
    public readonly config: ProviderConfig = { id: "real", endpoint: "https://real.invalid", model: "real-1", authSource: "server-environment", displayName: "Real", contextWindow: 1_000_000 };
    public get displayMetadata(): ProviderDisplayMetadata { return providerDisplayMetadata(this.config, true); }
    public async complete(): Promise<ProviderCompletion> { return { answer: "x" }; }
    public async step(): Promise<AgentStepResult> { return { text: "", toolCalls: [] }; }
  }
  const inner = new RealisticProvider();
  const wrapped = tracingProvider(inner, createTrace());
  assert.equal(wrapped.displayMetadata.displayName, "Real", "a prototype getter must survive the wrap");
  assert.equal(wrapped.config.contextWindow, 1_000_000, "own properties must stay reachable");
  assert.equal(typeof wrapped.complete, "function", "other prototype methods must stay reachable");
  assert.equal(wrapped.id, "real");
});

const emptyContext: CopilotContext = {
  schemaVersion: CONTEXT_SCHEMA_VERSION, snapshotIdentity: { revision: "r", fingerprint: "f" }, activeCompositionId: null, currentTime: null,
  selection: { compositionId: null, layerIds: [] }, selectedLayers: [], selectionAncestors: [], sources: [], items: [], warnings: [], truncation: null,
  redaction: { redactedSecretCount: 0, redactedPathCount: 0, omittedExpressionCount: 0, truncatedStringCount: 0 },
};

test("a traced provider forwards every member of the provider it wraps, reading capabilities live", async () => {
  class FullProvider implements ToolCallingProvider {
    public readonly id = "full";
    public readonly model = "full-1";
    public readonly config: ProviderConfig = { id: "full", endpoint: "https://full.invalid", model: "full-1", authSource: "server-environment", displayName: "Full", contextWindow: 1000 };
    public capabilities?: CapabilityLedger;
    public readonly calls: string[] = [];
    public get displayMetadata(): ProviderDisplayMetadata { return providerDisplayMetadata(this.config, true); }
    public async discoverCapabilities(): Promise<void> { this.calls.push(`capabilities:${this.id}`); }
    public async discoverEfforts(options?: { refresh?: boolean }): Promise<ReasoningEffort[]> { this.calls.push(`efforts:${options?.refresh}`); return ["high"]; }
    public async complete(): Promise<ProviderCompletion> { this.calls.push("complete"); return { answer: "x" }; }
    public async step(): Promise<AgentStepResult> { this.calls.push("step"); return { text: "", toolCalls: [] }; }
  }
  const inner = new FullProvider();
  const wrapped = tracingProvider(inner, createTrace());
  assert.equal(wrapped.capabilities, undefined);
  const ledger = new CapabilityLedger({ images: true });
  inner.capabilities = ledger;
  assert.equal(wrapped.capabilities, ledger, "capabilities assigned after the wrap are still seen");
  await wrapped.discoverCapabilities?.();
  assert.deepEqual(await wrapped.discoverEfforts?.({ refresh: true }), ["high"]);
  await wrapped.complete({ requestId: "q", systemInstructions: "", userMessage: "", history: [], context: emptyContext });
  await wrapped.step(stepInput("S", [userMessage]));
  assert.deepEqual(inner.calls, ["capabilities:full", "efforts:true", "complete", "step"]);
  assert.deepEqual([wrapped.id, wrapped.model, wrapped.config.displayName], ["full", "full-1", "Full"]);
});

test("the first step records the briefing and the tools; later steps record only the delta", async () => {
  const trace = createTrace();
  const inner = fakeProvider([
    { text: "looking", toolCalls: [{ id: "c1", name: "ae_inspect_layer", arguments: { layerId: "L" } }] },
    { text: "done", toolCalls: [] },
  ]);
  const provider = tracingProvider(inner, trace);
  await provider.step(stepInput("BRIEFING", [userMessage], { systemSegments: [{ text: "BRIEFING", cache: true }], tools: [toolSpec("ae_inspect_layer", "read a layer")] }));
  await provider.step(stepInput("BRIEFING", [userMessage, { role: "assistant", content: "looking", toolCalls: [] }, toolMessage("RESULT-BODY")]));

  const [first, second, ...rest] = ofKind(trace, "step.request");
  assert.ok(first && second && rest.length === 0, "two requests were recorded");
  assert.deepEqual(first.system, [{ text: "BRIEFING", cache: true }]);
  assert.deepEqual(first.tools, [{ name: "ae_inspect_layer", description: "read a layer" }]);
  assert.equal(first.delta.length, 1, "step 1 sends the user message");
  assert.equal(second.system, undefined);
  assert.equal(second.tools, undefined);
  assert.equal(second.delta.length, 2, "step 2 sends only what was appended");
  assert.equal(second.messageCount, 3);
});

test("the tool result text the model actually read is in the transcript", async () => {
  const trace = createTrace();
  const provider = tracingProvider(fakeProvider([{ text: "", toolCalls: [] }]), trace);
  await provider.step(stepInput("B", [userMessage, toolMessage("TRUNCATED… [truncated; narrow the query]")]));
  const rendered = trace.render();
  assert.match(rendered, /\[tool result: ae_inspect_layer\]/);
  assert.match(rendered, /TRUNCATED… \[truncated; narrow the query\]/);
});

test("reasoning is captured from both provider shapes, and the reply's text is kept separately", async () => {
  const trace = createTrace();
  const deepseek = tracingProvider(fakeProvider([{ text: "answer", toolCalls: [], raw: { reasoning_content: "deepseek chain" } }]), trace);
  await deepseek.step(stepInput("B", [userMessage]));
  assert.equal(ofKind(trace, "step.reply")[0]?.reasoning, "deepseek chain");

  const anthropicTrace = createTrace();
  const anthropic = tracingProvider(fakeProvider([{ text: "answer", toolCalls: [], raw: { content: [{ type: "thinking", thinking: "anthropic chain" }, { type: "text", text: "answer" }] } }]), anthropicTrace);
  await anthropic.step(stepInput("B", [userMessage]));
  assert.equal(ofKind(anthropicTrace, "step.reply")[0]?.reasoning, "anthropic chain");

  assert.equal(extractReasoning(undefined), "");
  assert.equal(extractReasoning({ reasoning_content: "   " }), "");
  assert.equal(extractReasoning({ content: [{ type: "text", text: "not reasoning" }] }), "");
});

test("a fold is detected by comparing the tool messages the loop sends", async () => {
  const trace = createTrace();
  const provider = tracingProvider(fakeProvider([{ text: "", toolCalls: [] }, { text: "", toolCalls: [] }]), trace);
  await provider.step(stepInput("B", [toolMessage("x".repeat(5_000))]));
  await provider.step(stepInput("B", [toolMessage("x".repeat(400))]));
  const fold = ofKind(trace, "context.fold")[0];
  assert.ok(fold, "the fold the loop performs silently should appear in the transcript");
  assert.deepEqual(fold.messages, [{ position: 0, beforeChars: 5_000, afterChars: 400 }]);
});

test("the rendered transcript shows the request, the step, and the ending", async () => {
  const trace = createTrace();
  const provider = tracingProvider(fakeProvider([{ text: "on it", toolCalls: [{ id: "c1", name: "ae_inspect_layer", arguments: { layerId: "L" } }] }]), trace);
  trace.record({ kind: "turn.start", message: "build the thing", requestId: "chat-test-render" });
  await provider.step(stepInput("BRIEFING-TEXT", [userMessage], { tools: [toolSpec("t", "a tool")] }));
  trace.record({ kind: "turn.end", status: 200, outcome: "planned", steps: 1, usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 }, stopReason: "stop", provider: null, model: null, plans: [], notes: null, failure: null, answer: "here is the plan" });

  const rendered = renderTrace(trace.records);
  assert.match(rendered, /request: build the thing/);
  assert.match(rendered, /BRIEFING-TEXT/);
  assert.match(rendered, /\[user\]\ndo the thing/);
  assert.match(rendered, /\[text\]\non it/);
  assert.match(rendered, /\[called\] ae_inspect_layer/);
  assert.match(rendered, /=== end: planned after 1 step\(s\) ===/);
  assert.match(rendered, /cached=4/);
  assert.match(renderTrace([]), /Nothing recorded/);
});

test("a long briefing is previewed by default and complete on request", async () => {
  const trace = createTrace();
  const briefing = `RULES-${"x".repeat(4_000)}-END-OF-BRIEFING`;
  await tracingProvider(fakeProvider([{ text: "", toolCalls: [] }]), trace).step(stepInput(briefing, [userMessage]));

  const previewed = trace.render();
  assert.match(previewed, /RULES-/);
  assert.doesNotMatch(previewed, /END-OF-BRIEFING/);
  assert.match(previewed, /more characters of briefing withheld; re-run with --full-prompt/);

  const full = trace.render({ systemPreviewChars: Number.POSITIVE_INFINITY });
  assert.match(full, /END-OF-BRIEFING/);
  assert.doesNotMatch(full, /withheld/);

  const shortTrace = createTrace();
  await tracingProvider(fakeProvider([{ text: "", toolCalls: [] }]), shortTrace).step(stepInput("SHORT", [userMessage]));
  assert.match(shortTrace.render(), /SHORT/);
  assert.doesNotMatch(shortTrace.render(), /withheld/);
});

test("the trace is bounded and survives being reset between turns", () => {
  const trace = createTrace({ maxRecords: 3 });
  for (let index = 0; index < 6; index += 1) trace.record({ kind: "step.reply", step: index, durationMs: undefined, text: "", reasoning: "", toolCalls: [], finishReason: null, usage: null });
  assert.equal(trace.records.length, 3, "a pathological turn must not grow the trace without limit");
  assert.match(trace.render(), /3 record\(s\) dropped at the trace size limit/);
  trace.reset();
  assert.equal(trace.records.length, 0);
  assert.doesNotMatch(trace.render(), /dropped/);
});

test("the trace serializes to JSONL that can be read back line by line", async () => {
  const trace = createTrace({ now: () => new Date("2026-01-01T00:00:00.000Z") });
  await tracingProvider(fakeProvider([{ text: "hi", toolCalls: [] }]), trace).step(stepInput("B", [userMessage]));
  const lines = trace.toJsonl().trim().split("\n");
  assert.equal(lines.length, 2, "one record for the request that was sent, one for the reply");
  const parsed = parsedLine(lines[1] ?? "");
  assert.equal(jsonString(parsed.kind, "record.kind"), "step.reply");
  assert.equal(jsonString(parsed.at, "record.at"), "2026-01-01T00:00:00.000Z");
  assert.equal(jsonNumber(parsed.seq, "record.seq"), 2);
});

test("a traced sidecar's state directory is where the seeded profile is written", () => {
  const home = mkdtempSync(join(tmpdir(), "extynt-seed-"));
  try {
    const seeded = seedIsolatedProfile(home, realProfileDirectory());
    if (!seeded.includes("host-capability-profile.json")) return;
    assert.ok(
      existsSync(join(isolatedProfileDirectory(home), "host-capability-profile.json")),
      "the profile is under the directory a traced sidecar is given as its state directory",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
