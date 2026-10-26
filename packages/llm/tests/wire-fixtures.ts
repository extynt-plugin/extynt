// Decoded views of the request bodies the adapters send, and fetch doubles that record them.
import { array, boolean, decodeJson, type Infer, jsonObject, jsonValue, number, object, optional, string, union } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { AgentStepInput, AgentStepResult } from "../src/types.js";

const functionShape = object({
  name: optional(string()),
  description: optional(string()),
  parameters: optional(jsonValue),
  arguments: optional(jsonValue),
});

const toolCallShape = object({ id: optional(string()), type: optional(string()), function: optional(functionShape) });

const messageShape = object({
  role: optional(string()),
  content: optional(union(string(), array(jsonValue))),
  reasoning_content: optional(jsonValue),
  tool_call_id: optional(string()),
  tool_calls: optional(array(toolCallShape)),
});

const toolShape = object({
  name: optional(string()),
  description: optional(string()),
  type: optional(string()),
  input_schema: optional(jsonValue),
  cache_control: optional(jsonValue),
  function: optional(functionShape),
});

const systemBlockShape = object({ type: optional(string()), text: optional(string()), cache_control: optional(jsonValue) });

const requestShape = object({
  model: optional(string()),
  max_tokens: optional(number()),
  stream: optional(boolean()),
  stream_options: optional(jsonValue),
  output_config: optional(jsonValue),
  thinking: optional(jsonValue),
  reasoning_effort: optional(string()),
  system: optional(union(array(systemBlockShape), string())),
  tools: optional(array(toolShape)),
  messages: optional(array(messageShape)),
});

export type CapturedMessage = Infer<typeof messageShape>;
export type CapturedTool = Infer<typeof toolShape>;

export type CapturedRequest = Omit<Infer<typeof requestShape>, "tools" | "messages" | "system"> & {
  system?: Array<Infer<typeof systemBlockShape>>;
  tools: CapturedTool[];
  messages: CapturedMessage[];
};

export function captureRequest(body: string): CapturedRequest {
  const decoded = decodeJson(body, requestShape);
  if (!decoded.ok) throw new Error("A captured request body must be a JSON object.");
  const { system, ...rest } = decoded.value;
  const blocks = typeof system === "string" ? [{ type: "text", text: system }] : system;
  return { ...rest, ...(blocks ? { system: [...blocks] } : {}), tools: [...(decoded.value.tools ?? [])], messages: [...(decoded.value.messages ?? [])] };
}

export function captureJson(body: string): JsonObject {
  const decoded = decodeJson(body, jsonObject);
  if (!decoded.ok) throw new Error("A captured body must be a JSON object.");
  return decoded.value;
}

export function requestAt(bodies: ReadonlyArray<CapturedRequest>, index: number): CapturedRequest {
  const request = bodies[index < 0 ? bodies.length + index : index];
  if (!request) throw new Error(`No request was sent at position ${index}.`);
  return request;
}

export function messageAt(request: CapturedRequest, index: number): CapturedMessage {
  const message = request.messages[index];
  if (!message) throw new Error(`The request carries no message at position ${index}.`);
  return message;
}

export function lastRequest(bodies: ReadonlyArray<CapturedRequest>): CapturedRequest {
  return requestAt(bodies, -1);
}

export function nextReply(replies: Array<() => Response>): Response {
  const reply = replies.shift();
  if (!reply) throw new Error("The scripted replies ran out.");
  return reply();
}

export function recordingReply(bodies: CapturedRequest[], payload: JsonValue): typeof fetch {
  return async (_input, init) => {
    bodies.push(captureRequest(String(init?.body)));
    return new Response(JSON.stringify(payload), { status: 200 });
  };
}

export function staticReply(payload: JsonValue): typeof fetch {
  return async () => new Response(JSON.stringify(payload), { status: 200 });
}

export function stepOnce(provider: { step(input: AgentStepInput): Promise<AgentStepResult> }): Promise<AgentStepResult> {
  return provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "hi" }], tools: [] });
}

export function recordingResponder(bodies: CapturedRequest[]): typeof fetch {
  return recordingReply(bodies, { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Done." } }] });
}

export const serverSecret = { authSource: "server-environment", resolve: () => "anthropic-secret" } as const;

export function toolAt(request: CapturedRequest, index: number): CapturedTool {
  const tool = request.tools[index];
  if (!tool) throw new Error(`The request carries no tool at position ${index}.`);
  return tool;
}

export function systemAt(request: CapturedRequest, index: number): NonNullable<CapturedRequest["system"]>[number] {
  const block = request.system?.[index];
  if (!block) throw new Error(`The request carries no system block at position ${index}.`);
  return block;
}
