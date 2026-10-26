/** The reply that closes a job the panel did not start a request for: after Apply the sidecar goes on without the request and pushes what it said as a stream event, which is written into the chat the job belongs to; one read on the job's end catches a reply the stream missed. */
import { closingReplyDecoder } from "./chat-reply.js";
import type { SessionId } from "./ids.js";
import { addRow } from "./panel-chat-render.js";
import { getCurrentSessionId, setTurnSessionId, turnSessionId } from "./panel-sessions.js";
import { diagnosticId, pollContext, send } from "./panel-transport.js";
import { takeClosing } from "./ui-state.js";

const answered = new Set<string>();
const owners = new Map<string, SessionId | null>();

function land(requestId: string, text: string): void {
  if (answered.has(requestId)) return;
  answered.add(requestId);
  const owner = owners.get(requestId) ?? null;
  owners.delete(requestId);
  const previous = turnSessionId();
  setTurnSessionId(owner !== null && owner !== getCurrentSessionId() ? owner : previous);
  addRow({ kind: "assistant", text, failed: false });
  setTurnSessionId(previous);
}

/** Remembers the chat a job belongs to, so its closing reply lands there whenever it arrives. */
export function noteClosingOwner(requestId: string, sessionId: SessionId | null): void {
  if (!owners.has(requestId)) owners.set(requestId, sessionId);
}

/** Writes the closing reply a stream event carried for this request. */
export function closingArrived(requestId: string): void {
  const text = takeClosing(requestId);
  if (text) land(requestId, text);
}

/** Reads the closing reply once, for a panel whose stream was down when the job ended. */
export function catchUpClosing(requestId: string): void {
  if (answered.has(requestId)) return;
  const path = "/v1/chat/closing";
  const context = pollContext("GET", path, diagnosticId("closing"));
  send({ method: "GET", path: path + "?requestId=" + encodeURIComponent(requestId), body: null, context, decoder: closingReplyDecoder }, (reply) => {
    if (reply.ok && reply.value.ok && reply.value.closing) land(requestId, reply.value.closing);
  });
}
