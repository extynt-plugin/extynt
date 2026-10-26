// Narrows a tool reply's payload to the JSON object the sidecar edits in place before the model reads it.
import { type JsonValue } from "@extynt/decode";
import type { AgentToolReply } from "./server-chat-agent-types.js";

/** The payload of a tool reply: a JSON object whose entries the sidecar may add to. */
export interface ReplyPayload {
  [key: string]: JsonValue;
}

function isReplyPayload(candidate: JsonValue | undefined): candidate is ReplyPayload {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
}

/** The payload of a successful reply when it is a JSON object: the object itself, so edits reach the reply the model reads. */
export function replyPayload(reply: AgentToolReply): ReplyPayload | undefined {
  return reply.ok && isReplyPayload(reply.data) ? reply.data : undefined;
}
