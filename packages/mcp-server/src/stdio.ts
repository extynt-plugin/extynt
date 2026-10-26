/** Local stdio MCP launcher: initialize, ping and tools/list are answered locally; every tools/call is proxied to the co-located sidecar. */
import { createInterface } from "node:readline";
import { decodeJson, jsonValue } from "@extynt/decode";
import { asObject, booleanAt, jsonFieldsOf } from "./json.js";
import { handleMcpRequest, parseRpcRequest } from "./rpc.js";
import type { JsonRpcRequest } from "./rpc.js";
import { callSidecar } from "./sidecar-client.js";
import { createAgentViewMemory, toMcpToolResult } from "./transport.js";

const viewMemory = createAgentViewMemory();

const INVALID_JSON_FRAME = `${JSON.stringify({ error: { code: "INVALID_JSON", message: "Request must be JSON." } })}\n`;

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  void handleLine(line);
});

async function handleToolsCall(request: JsonRpcRequest): Promise<void> {
  const args = request.params?.arguments ?? {};
  const result = await callSidecar(request.params?.name ?? "", args);
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: request.id ?? null,
    result: toMcpToolResult(jsonFieldsOf(result), { verbose: booleanAt(args, "verbose") === true, memory: viewMemory }),
  })}\n`);
}

function unreachableFrame(request: JsonRpcRequest, message: string): string {
  const failure = { ok: false, error: { code: "SIDECAR_UNREACHABLE", message: `${message}. After Effects/extynt is not reachable; stop and report what was already applied.` } };
  return `${JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, result: toMcpToolResult(jsonFieldsOf(failure)) })}\n`;
}

async function handleLine(line: string): Promise<void> {
  const parsed = decodeJson(line, jsonValue);
  if (!parsed.ok) {
    process.stdout.write(INVALID_JSON_FRAME);
    return;
  }
  const frame = asObject(parsed.value);
  if (!frame || !Object.hasOwn(frame, "id")) return;
  const parsedRequest = parseRpcRequest(frame);
  if (!parsedRequest.ok) {
    process.stdout.write(`${JSON.stringify(parsedRequest.response)}\n`);
    return;
  }
  const request = parsedRequest.request;
  if (request.method !== "tools/call") {
    process.stdout.write(`${JSON.stringify(handleMcpRequest(request, {}))}\n`);
    return;
  }
  try {
    await handleToolsCall(request);
  } catch (error) {
    process.stdout.write(unreachableFrame(request, error instanceof Error ? error.message : "The sidecar is unreachable."));
  }
}
