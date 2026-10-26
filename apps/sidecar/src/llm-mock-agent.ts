// The offline stand-in for a real model (AE_LLM_PROVIDER=mock): a scripted agent that answers from the prompt alone.
import { array, decodeJson, decodeOrThrow, fallback, type Infer, string } from "@extynt/decode";
import { splitTransient, type AgentMessage, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import { lenientObject } from "./server-mcp-arguments.js";

type ToolMessage = Extract<AgentMessage, { role: "tool" }>;

const CONTINUATION_MARKER = "WORKFLOW CONTINUATION INPUT (sidecar-owned structured evidence; do not infer beyond these fields):";
const CYCLE = /"cycle"\s*:\s*(\d+)/;
const NEVER_COMPLETE_SWITCH = "AE_MOCK_PROVIDER_NEVER_COMPLETE";
const FAIL_AFTER_SEAL_SWITCH = "AE_MOCK_PROVIDER_FAILURE_AFTER_SEAL";

const continuationDecoder = lenientObject({
  goalDigest: fallback(string(), undefined),
  settledBatches: fallback(array(lenientObject({
    batchId: fallback(string(), undefined),
    receipt: lenientObject({ receiptId: fallback(string(), undefined), verification: fallback(string(), undefined) }),
  })), undefined),
});

type Continuation = Infer<typeof continuationDecoder>;
type Evidence = { batchId: string; receiptId: string };

const hostContextDecoder = lenientObject({
  activeComposition: lenientObject({ id: fallback(string(), undefined) }),
  selectedLayerIds: fallback(array(fallback(string(), undefined)), undefined),
});

function reply(text: string): AgentStepResult {
  return { text, toolCalls: [] };
}

function cycleText(system: string): string | undefined {
  return CYCLE.exec(system)?.[1];
}

function currentCycle(system: string): number | undefined {
  const text = cycleText(system);
  if (text === undefined) return undefined;
  if (process.env[FAIL_AFTER_SEAL_SWITCH] === "1" && Number(text) >= 1) throw new Error("mock provider disconnected after the verified receipt");
  return Number(text);
}

function continuationOf(system: string): Continuation | undefined {
  const start = system.indexOf(CONTINUATION_MARKER);
  if (start < 0) return undefined;
  const block = system.slice(start + CONTINUATION_MARKER.length).trim();
  const end = block.indexOf("\n\nTurn state");
  const decoded = decodeJson((end >= 0 ? block.slice(0, end) : block).trim(), continuationDecoder);
  return decoded.ok ? decoded.value : undefined;
}

function verifiedEvidence(continuation: Continuation | undefined): Evidence | undefined {
  const verified = [...continuation?.settledBatches ?? []].reverse().find((batch) => batch.batchId && batch.receipt.receiptId && batch.receipt.verification === "verified");
  const batchId = verified?.batchId, receiptId = verified?.receipt.receiptId;
  return batchId && receiptId ? { batchId, receiptId } : undefined;
}

function completeCall(goalDigest: string, evidence: Evidence): AgentStepResult {
  const reference = { kind: "batch_receipt", batchId: evidence.batchId, receiptId: evidence.receiptId };
  const callArguments = { goalDigest, criterionIds: ["goal-observed"], evidence: [{ criterionId: "goal-observed", reference }] };
  return { text: "", toolCalls: [{ id: "mock-complete", name: "ae_workflow_complete", arguments: callArguments }] };
}

function completionReply(input: AgentStepInput, toolMessages: readonly ToolMessage[]): AgentStepResult | undefined {
  if (toolMessages.some((message) => message.name === "ae_workflow_complete")) return reply("Mock agent: the workflow is complete from verified receipt evidence.");
  const cycle = currentCycle(input.system);
  if (cycle === undefined || cycle < 2) return undefined;
  const continuation = continuationOf(input.system);
  const evidence = verifiedEvidence(continuation);
  if (continuation?.goalDigest && evidence) return completeCall(continuation.goalDigest, evidence);
  return reply("Mock agent: the sidecar has not supplied enough verified evidence to complete this workflow.");
}

function hostContextOf(system: string) {
  const context = /\{"host":.*\}/.exec(system)?.[0];
  return context ? decodeOrThrow(hostContextDecoder, JSON.parse(context)) : undefined;
}

function queueCall(system: string, name: string | undefined): AgentStepResult {
  const host = hostContextOf(system);
  const compositionId = host?.activeComposition.id;
  const layerId = host?.selectedLayerIds?.find((id) => id !== undefined);
  if (!compositionId || !layerId) return reply("Mock agent: select a layer first.");
  const operation = { type: "set_layer_name", target: { compositionId, layerId }, ...(name === undefined ? {} : { name }) };
  return { text: "", toolCalls: [{ id: "mock-queue", name: "ae_queue_add", arguments: { summary: `Rename to ${name}`, operations: [operation] } }] };
}

function renamedBefore(system: string): boolean {
  return Number(cycleText(system) ?? 0) >= 1 || (continuationOf(system)?.settledBatches?.length ?? 0) > 0;
}

function renameReply(system: string, toolMessages: readonly ToolMessage[], lastUser: AgentMessage | undefined): AgentStepResult {
  const rename = lastUser && /rename (?:it |this |the layer )?to (.+)/i.exec(lastUser.content);
  if (!rename) return reply("Mock agent: I read the project briefing. Try \"rename to Hero\" with a layer selected.");
  const called = toolMessages.map((message) => message.name);
  if (toolMessages.some((message) => message.content.includes("\"error\"") || message.content.includes("\"fix\""))) return reply("Mock agent: the plan was rejected.");
  if (!called.includes("ae_queue_add")) return queueCall(system, renamedBefore(system) ? `${rename[1]} 2` : rename[1]);
  if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "mock-finish", name: "ae_queue_finish", arguments: {} }] };
  return reply(`Mock agent: this plan renames the selected layer to "${rename[1]}".`);
}

function neverCompletingInput(input: AgentStepInput): AgentStepInput | undefined {
  if (process.env[NEVER_COMPLETE_SWITCH] !== "1") return undefined;
  const cycle = cycleText(input.system);
  if (cycle === undefined || Number(cycle) < 1) return undefined;
  const lastUserIndex = input.messages.map((message) => message.role).lastIndexOf("user");
  const messages = input.messages.map((message, index) => index === lastUserIndex && message.role === "user" ? { ...message, content: `rename to Hero ${cycle}` } : message);
  return { ...input, system: input.system.replace(/"cycle"\s*:\s*\d+/, '"cycle":0'), messages };
}

/**
 * Answers one agent step: "rename to X" proposes a rename of the first selected layer, a continuation prompt with
 * verified receipt evidence completes the workflow, anything else gets a plain answer. AE_MOCK_PROVIDER_NEVER_COMPLETE=1
 * makes a model that never completes, authoring a fresh rename every continuation cycle, so the automatic cycle budget
 * is what ends the job; AE_MOCK_PROVIDER_FAILURE_AFTER_SEAL=1 disconnects it from the first continuation cycle on.
 */
export function mockAgentScript(stepInput: AgentStepInput): AgentStepResult {
  const input = { ...stepInput, messages: splitTransient(stepInput.messages).persisted };
  const fresh = neverCompletingInput(input);
  if (fresh) return mockAgentScript(fresh);
  const lastUserIndex = input.messages.map((message) => message.role).lastIndexOf("user");
  const lastUser = input.messages[lastUserIndex];
  const toolMessages = input.messages.slice(lastUserIndex + 1).filter((message): message is ToolMessage => message.role === "tool");
  return completionReply(input, toolMessages) ?? renameReply(input.system, toolMessages, lastUser);
}
