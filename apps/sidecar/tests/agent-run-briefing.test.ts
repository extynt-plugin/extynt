// What the briefing and the per-step budget note tell the model: a bounded storm, the host's failed operations, an interrupted apply, the target rule, and the steps left.
import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentBriefing, buildAgentBriefingSegments, remainingBudget, runAgent } from "../src/agent.js";
import type { RuntimeOperationEvidence } from "@extynt/mcp-server";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { MockProvider } from "@extynt/llm";
import { readCall, toolMessages } from "./agent-test-support.js";

const VERIFIED_AT = "2026-09-01T00:00:00.000Z";

test("the briefing bounds a warning storm and a select-all, and says what it dropped", () => {
  const storm = (warnings: number, selected: number): ProjectSnapshot => ({
    ...representativeSnapshot,
    warnings: Array.from({ length: warnings }, (_, index) => `probe-warning-${index}: ${"x".repeat(90)}`),
    truncation: { truncated: true, limits: { maxLayersPerComposition: 256 } },
    selection: { compositionId: "comp-main", layerIds: Array.from({ length: selected }, (_, index) => `layer-sel-${index}`) },
  });
  const briefing = buildAgentBriefing(storm(512, 300));
  assert.ok(briefing.includes('"probeWarningCount":512'), "the total is stated");
  assert.ok(briefing.includes('"probeWarningsOmitted":504'), "and what was dropped is stated, not silently cut");
  assert.ok(briefing.includes('"selectedLayerCount":300'));
  assert.ok(briefing.includes('"selectedLayerIdsOmitted":268'));
  assert.ok((briefing.match(/probe-warning-\d+/g) ?? []).length <= 8, "only a bounded number of warnings reach the prompt");
  assert.ok((briefing.match(/layer-sel-\d+/g) ?? []).length <= 32, "and a bounded number of selected ids");
  assert.ok(briefing.length < 30_000, `the storm alone was 54,569 characters; the briefing is ${briefing.length}`);
});

test("the host's own failed operations ride the cached half of the briefing, bounded", () => {
  const evidence: Record<string, RuntimeOperationEvidence> = {
    set_text_document: { count: 20, lastVerifiedAt: VERIFIED_AT, hostVersion: "26.2.1", failures: 12, lastFailureBasis: "text-document-mismatch" },
    set_layer_property: { count: 5, lastVerifiedAt: VERIFIED_AT, hostVersion: "26.2.1" },
  };
  const withFailures = buildAgentBriefing(representativeSnapshot, { runtimeEvidence: evidence });
  assert.ok(withFailures.includes("- set_text_document (text-document-mismatch, 12 failures)"), "the failure, its basis and its count are named");
  assert.ok(!withFailures.includes("(5 failures"), "an operation that has never failed is not named");
  const cached = buildAgentBriefingSegments(representativeSnapshot, { runtimeEvidence: evidence }).find((segment) => segment.cache === true);
  assert.ok(cached?.text.includes("set_text_document (text-document-mismatch, 12 failures)"), "the block is in the half a provider caches, not the half that changes per turn");

  assert.equal(buildAgentBriefing(representativeSnapshot, { runtimeEvidence: {} }), buildAgentBriefing(representativeSnapshot));

  const many: Record<string, RuntimeOperationEvidence> = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`op-${index}`, { count: 3, lastVerifiedAt: VERIFIED_AT, hostVersion: "26.2.1", failures: index + 1, lastFailureBasis: "read-back-mismatch" }]));
  const bounded = buildAgentBriefing(representativeSnapshot, { runtimeEvidence: many });
  assert.ok(bounded.includes("- op-11 (read-back-mismatch, 12 failures)"), "the worst operation comes first");
  assert.ok(!bounded.includes("- op-3 ("), "only the worst eight are named");
});

test("the briefing describes a host quit as an interrupted apply, not a readback failure", () => {
  const interrupted = buildAgentBriefing(representativeSnapshot, {
    latestInterruptedApply: { index: 16, operationCount: 20, operation: "reorder_layer", layerId: "__new__:layer0" },
    runtimeEvidence: { reorder_layer: { count: 0, lastVerifiedAt: "", hostVersion: "26.2.1", failures: 1, lastFailureBasis: "host-quit-during-apply" } },
  });
  assert.match(interrupted, /After Effects quit during apply at step 17 of 20 \(reorder_layer, __new__:layer0\)/);
  assert.match(interrupted, /Operations before it may have applied/);
  assert.match(interrupted, /Refresh the snapshot and inspect carefully before queueing anything else/);
  assert.match(interrupted, /Operations interrupted when After Effects quit mid-apply/);
  assert.doesNotMatch(interrupted, /Operations this host build has failed to read back before/);
});

test("the briefing states the target rule the composer accepts and how to search before calling something impossible", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);
  assert.ok(briefing.includes("compositionId may be left out"), "the target sentence agrees with rule 6 and with the composer");
  assert.ok(briefing.includes("__new__:<name> placeholder"), "and names the placeholder a queue uses for what it creates");
  assert.match(briefing, /before you call anything impossible/i, "impossibility is only reported after a capability search");
  assert.ok(briefing.includes("ae_search_host_capabilities") && briefing.includes("ae_search_native_operations"), "and the search names the tools that answer it");
});

test("every step states the steps left, not only the wrap-up window", async () => {
  const provider = new MockProvider({ script: (input) => toolMessages(input.messages).length
    ? { text: "Read it.", toolCalls: [] }
    : { text: "", toolCalls: [readCall("read-1")] } });
  const result = await runAgent(provider, { requestId: "req-budget-fact", message: "read it", history: [], briefing: "briefing", callTool: () => ({ ok: true, data: { layerId: "layer-1" } }) });

  assert.equal(result.failure, undefined, "the turn finished");

  const content = toolMessages(provider.stepInputs[1]?.messages ?? []).at(-1)?.content ?? "";
  assert.match(content, /\[Budget: 59 steps left\.\]$/, "the first step says what is left, with no deadline to name");
  assert.ok(!content.includes("Finish the queue you are holding"), "and the loud note has not started: the fact is not the warning");
});

test("a landing time is never shown to the model, ahead or passed", async () => {
  for (const landingAt of [Date.now() + 600_000, Date.now() - 1_000]) {
    const provider = new MockProvider({ script: (input) => toolMessages(input.messages).length
      ? { text: "Read it.", toolCalls: [] }
      : { text: "", toolCalls: [readCall("read-1")] } });
    await runAgent(provider, { requestId: "req-no-clock", message: "read it", history: [], briefing: "briefing", landingAt, callTool: () => ({ ok: true, data: { layerId: "layer-1" } }) });
    const content = toolMessages(provider.stepInputs[1]?.messages ?? []).at(-1)?.content ?? "";
    assert.match(content, /\[Budget: 59 steps left\.\]$/, `only steps are stated, got ${content}`);
    assert.doesNotMatch(content, /panel|waiting|\d+s\b/, "no wall clock reaches the model: a countdown made it stop a long build early");
  }
});

test("the last step of a turn reads zero", () => {
  assert.equal(remainingBudget(0), "Budget: 0 steps left.", "the last step says no steps left rather than going quiet");
  assert.equal(remainingBudget(1), "Budget: 1 step left.", "one step reads as one step");
});
