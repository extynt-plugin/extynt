// Narrowing readers the agent tests share, so an assertion reads a definite message or value instead of a maybe.
import type { AgentMessage, AgentStepInput } from "@extynt/llm";
import type { ToolArguments, ToolResult } from "../src/agent.js";

/** An assistant turn of the conversation. */
export type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

/** A tool result of the conversation. */
export type ToolMessage = Extract<AgentMessage, { role: "tool" }>;

/** The value, or a failed test when it is missing. */
export function present<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/** The assistant message at `index`, or a failed test when that position holds another role. */
export function assistantAt(messages: readonly AgentMessage[], index: number): AssistantMessage {
  const message = messages[index];
  if (message?.role !== "assistant") throw new Error(`expected an assistant message at ${index}`);
  return message;
}

/** The tool message at `index`, or a failed test when that position holds another role. */
export function toolAt(messages: readonly AgentMessage[], index: number): ToolMessage {
  const message = messages[index];
  if (message?.role !== "tool") throw new Error(`expected a tool message at ${index}`);
  return message;
}

/** A plan the fake queue holds: its id and the summary the first queue add gave it. */
export interface StoredTestPlan {
  readonly planId: string;
  readonly summary: string;
}

/** A fake queue the agent can call: its stored plans and the `callTool` that opens, fixes, seals and lists them. */
export interface PlanTools {
  readonly store: Map<string, StoredTestPlan>;
  readonly callTool: (name: string, args: ToolArguments) => ToolResult;
}

/** A queue that stores one plan per add and seals it with a card, standing in for the sidecar's tools. */
export function planTools(): PlanTools {
  const store = new Map<string, StoredTestPlan>();
  let next = 1;
  let open: string | null = null;
  const add = (args: ToolArguments): ToolResult => {
    if (!open) {
      open = `plan-${next++}`;
      store.set(open, { planId: open, summary: String(args.summary ?? open) });
    }
    return { ok: true, data: { queued: 1, accepted: 1, corrected: 0, next: "Accepted — 1 operation queued and validated, 1 in the queue." } };
  };
  const finish = (): ToolResult => {
    const planId = open ?? `plan-${next++}`;
    const summary = store.get(planId)?.summary ?? planId;
    store.set(planId, { planId, summary });
    open = null;
    return { ok: true, sealedCard: { planId, presentation: { title: summary }, plan: { operations: [{ type: "set_layer_name" }] } }, data: { sealed: true, operationCount: 1, undoGroups: 1, queued: 0 } };
  };
  const handlers = new Map<string, (args: ToolArguments) => ToolResult>([
    ["ae_queue_add", add],
    ["ae_queue_fix", () => ({ ok: true, data: { queued: 1, fixed: 1, next: "Fixed." } })],
    ["ae_queue_finish", finish],
    ["ae_list_plans", () => ({ ok: true, data: [...store.values()].map(({ planId, summary }) => ({ planId, summary })) })],
  ]);
  return { store, callTool: (name, args) => handlers.get(name)?.(args) ?? { ok: true, data: {} } };
}

/** A scripted ae_queue_add call renaming the title layer. */
export const queueAdd = (id: string, name = "Hero") => ({ id, name: "ae_queue_add", arguments: { summary: "Rename the title to Hero", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name }] } });

/** A scripted ae_queue_finish call. */
export const queueFinish = (id: string) => ({ id, name: "ae_queue_finish", arguments: {} });

/** A scripted ae_inspect_layer call. */
export const readCall = (id: string) => ({ id, name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: "layer-1" } });

/** A model that queues one rename, seals it and then answers. */
export const sealedTurn = (input: Pick<AgentStepInput, "messages">) => {
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [queueAdd("add-1")] };
  if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [queueFinish("finish-1")] };
  return { text: "Renamed it. Say the word for the next part.", toolCalls: [] };
};

/** The tool results among the messages, in order. */
export function toolMessages(messages: readonly AgentMessage[]): ToolMessage[] {
  return messages.filter((message): message is ToolMessage => message.role === "tool");
}
