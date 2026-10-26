/** The sidecar's MCP tool route as the panel uses it: Apply, Undo, Discard and the plan list are tool calls. */
import type { Decoder } from "@extynt/decode";
import { diagnosticId, pollContext, send, TransportError, transportContext } from "./panel-transport.js";
import type { OnReply } from "./panel-transport.js";
import { fallback, type JsonObject, literal, map, object, string } from "@extynt/decode";
import { andThen, nullIfAbsent } from "./wire-decoders.js";

interface McpCall<T> {
  readonly name: string;
  readonly args: JsonObject;
  readonly data: Decoder<T>;
  readonly polling?: boolean;
  readonly timeoutMs?: number;
}

const ROUTE = "/v1/mcp/tools/call";

const shellDecoder = object({ ok: fallback(literal(true), false), error: fallback(object({ message: fallback(string(), null) }), null) });

type ToolResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly message: string };

function refusal(message: string): Decoder<ToolResult<never>> {
  return map(object({}), (): ToolResult<never> => ({ ok: false, message }));
}

function envelopeFor<T>(data: Decoder<T>): Decoder<ToolResult<T>> {
  const accepted = map(object({ data: nullIfAbsent(data) }), (answer): ToolResult<T> => ({ ok: true, data: answer.data }));
  return andThen(shellDecoder, (shell) => (shell.ok ? accepted : refusal(shell.error?.message ?? "")));
}

function contextFor<T>(call: McpCall<T>): ReturnType<typeof transportContext> {
  const context = call.polling === true ? pollContext("POST", ROUTE, diagnosticId(call.name)) : transportContext("POST", ROUTE, diagnosticId(call.name));
  if (call.timeoutMs) context.timeoutMs = call.timeoutMs;
  context.client = "panel";
  return context;
}

/** Calls the tool. A refusal (`ok: false`) arrives as a TransportError carrying the sidecar's message. */
export function mcpCall<T>(call: McpCall<T>, done: OnReply<T>): void {
  const request = { method: "POST", path: ROUTE, body: { name: call.name, arguments: call.args }, context: contextFor(call), decoder: envelopeFor(call.data) };
  send(request, (reply) => {
    if (!reply.ok) done(reply);
    else done(reply.value.ok ? { ok: true, value: reply.value.data } : { ok: false, error: new TransportError(reply.value.message) });
  });
}
