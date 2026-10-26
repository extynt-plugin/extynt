// The JSON-RPC adapter the stdio launcher drives: it answers the protocol's methods and runs `tools/call` through the tool runner.
import { decode, type Decoder, type Infer, jsonObject, type JsonObject, literal, nullValue, number, object, optional, string, union } from "@extynt/decode";
import type { ToolContext } from "./contracts.js";
import { MCP_SERVER_INSTRUCTIONS } from "./instructions.js";
import { booleanAt, jsonFieldsOf, jsonOf } from "./json.js";
import { callTool } from "./tool-run.js";
import { listTools } from "./tool-catalogue.js";
import { toMcpToolResult } from "./transport.js";
import { MCP_SERVER_VERSION } from "./version.js";

type JsonRpcId = string | number | null;

const requestId: Decoder<JsonRpcId> = union(string(), number(), nullValue);

const rpcRequest = object({
  jsonrpc: optional(literal("2.0")),
  id: optional(requestId),
  method: optional(string()),
  params: optional(object({ name: optional(string()), arguments: optional(jsonObject) })),
});

/** A JSON-RPC request as the stdio launcher decodes it. */
export type JsonRpcRequest = Infer<typeof rpcRequest>;

type RpcParse = { readonly ok: true; readonly request: JsonRpcRequest } | { readonly ok: false; readonly response: JsonObject };

const METHOD_NOT_FOUND = -32601;
const INVALID_REQUEST = -32600;
const INVALID_PARAMS = -32602;
const PARAMS_PATH = "$.params";

function errorReply(id: JsonRpcId, code: number, message: string): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Decodes a request frame; a frame whose fields are malformed is answered Invalid params when the fault is inside `params` and Invalid Request otherwise, never as an unknown method. */
export function parseRpcRequest(frame: JsonObject): RpcParse {
  const request = decode(rpcRequest, frame);
  if (request.ok) return { ok: true, request: request.value };
  const id = decode(requestId, frame.id);
  const code = request.error.path.startsWith(PARAMS_PATH) ? INVALID_PARAMS : INVALID_REQUEST;
  const label = code === INVALID_PARAMS ? "Invalid params" : "Invalid Request";
  return { ok: false, response: errorReply(id.ok ? id.value : null, code, `${label}: ${request.error.message}`) };
}

function reply(id: JsonRpcId, result: JsonObject): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

function toolCallResponse(request: JsonRpcRequest, id: JsonRpcId, context: ToolContext): JsonObject {
  const args = request.params?.arguments ?? {};
  const result = callTool(request.params?.name ?? "", args, context);
  return reply(id, jsonFieldsOf(toMcpToolResult(jsonFieldsOf(result), { verbose: booleanAt(args, "verbose") === true })));
}

/** The response to one request: initialisation, ping, the tool list, a tool call, or a method-not-found error. */
export function handleMcpRequest(request: JsonRpcRequest, context: ToolContext): JsonObject {
  const id = request.id ?? null;
  switch (request.method) {
    case "initialize": return reply(id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "extynt", version: MCP_SERVER_VERSION }, instructions: MCP_SERVER_INSTRUCTIONS });
    case "notifications/initialized":
    case "ping": return reply(id, {});
    case "tools/list": return reply(id, { tools: jsonOf(listTools("agent")) });
    case "tools/call": return toolCallResponse(request, id, context);
    default: return errorReply(id, METHOD_NOT_FOUND, "Method not found.");
  }
}
