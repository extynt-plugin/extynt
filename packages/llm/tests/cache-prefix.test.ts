/** Prompt-cache stability: the request prefix survives from step to step and only the trailing state message changes. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, decodeOrThrow, object, optional, string, type Infer } from "@extynt/decode";
import { createLocalSecretInput, type AgentMessage, type AgentToolSpec } from "../src/index.js";
import { createAnthropicProvider } from "../src/anthropic.js";
import { OpenAICompatibleProvider } from "../src/openai.js";
import { messageAt, recordingReply, requestAt, type CapturedMessage, type CapturedRequest } from "./wire-fixtures.js";

const tools: AgentToolSpec[] = [
  { name: "ae_a", description: "A.", parameters: { type: "object" } },
  { name: "ae_b", description: "B.", parameters: { type: "object" } },
];
const call = { id: "c1", name: "ae_a", arguments: {} };
const history: AgentMessage[] = [
  { role: "user", content: "do it" },
  { role: "assistant", content: "", toolCalls: [call] },
  { role: "tool", toolCallId: "c1", name: "ae_a", content: "result one" },
];
const stateAt = (n: number): AgentMessage => ({ role: "user", content: `state ${n}`, transient: true });

test("the OpenAI-compatible request shares an identical prefix across steps and only the trailing state changes", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("k"),
    config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "deepseek-flash", authSource: "local-secret-input" },
    fetch: recordingReply(bodies, { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }),
  });
  const grown: AgentMessage[] = [...history, { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "ae_b", arguments: {} }] }, { role: "tool", toolCallId: "c2", name: "ae_b", content: "result two" }];
  await provider.step({ requestId: "r1", system: "Brief.", messages: [...history, stateAt(1)], tools });
  await provider.step({ requestId: "r2", system: "Brief.", messages: [...grown, stateAt(2)], tools });
  const first = requestAt(bodies, 0).messages;
  const second = requestAt(bodies, 1).messages;
  const stablePrefix = first.slice(0, -1);
  assert.deepEqual(second.slice(0, stablePrefix.length), stablePrefix, "system and every earlier message are byte-identical");
  assert.equal(JSON.stringify(requestAt(bodies, 0).tools), JSON.stringify(requestAt(bodies, 1).tools));
  assert.match(JSON.stringify(first.at(-1)), /state 1/);
  assert.match(JSON.stringify(second.at(-1)), /state 2/);
  assert.doesNotMatch(JSON.stringify(second.slice(0, -1)), /state/, "the state appears only in the trailing message");
});

const EPHEMERAL = { type: "ephemeral" };
const blockShape = object({ type: optional(string()), text: optional(string()), cache_control: optional(object({ type: string() })) });

function blocksOf(message: CapturedMessage): Array<Infer<typeof blockShape>> {
  return [...decodeOrThrow(array(blockShape), message.content)];
}

function blockAt(message: CapturedMessage, index: number): Infer<typeof blockShape> {
  const block = blocksOf(message)[index];
  if (!block) throw new Error(`The message carries no block at position ${index}.`);
  return block;
}

test("the Anthropic request breaks the cache on the last tool, the stable system block and the last persisted message, not the state", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = createAnthropicProvider({
    secretSource: { authSource: "server-environment", resolve: () => "k" },
    fetch: recordingReply(bodies, { content: [{ type: "text", text: "ok" }] }),
  });
  await provider.step({ requestId: "r", system: "Brief.", systemSegments: [{ text: "Brief.", cache: true }], messages: [...history, stateAt(1)], tools });
  const body = requestAt(bodies, 0);
  assert.equal(body.tools[0]?.cache_control, undefined);
  assert.deepEqual(body.tools.at(-1)?.cache_control, EPHEMERAL);
  assert.deepEqual(body.system?.[0]?.cache_control, EPHEMERAL);
  const last = messageAt(body, body.messages.length - 1);
  assert.equal(last.role, "user", "the state merges into the tool-result user turn");
  assert.equal(blockAt(last, 0).type, "tool_result");
  assert.deepEqual(blockAt(last, 0).cache_control, EPHEMERAL, "the last persisted block carries the breakpoint");
  assert.equal(blockAt(last, 1).text, "state 1");
  assert.equal(blockAt(last, 1).cache_control, undefined, "the state message is outside the cache");
  assert.equal(JSON.stringify(body).split("cache_control").length - 1, 3, "three breakpoints, under the limit of four");
});
