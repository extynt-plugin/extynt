// Local-only client for the sidecar MCP route; the connection is resolved immediately before each call rather than retained.
import { decode, decodeJson, errorCauseCode, jsonValue } from "@extynt/decode";
import { asObject } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { readSessionFile } from "./session.js";
import type { SessionFile } from "./session.js";
import { TOOL_DEFINITIONS } from "./tool-catalogue.js";
import { MCP_SERVER_VERSION } from "./version.js";

type SidecarConnection = { endpoint: string; token: string };

type SidecarHttpResponse = { status: number; json(): Promise<JsonValue | undefined> };

/** The request function the client sends a call with; tests replace it. */
export type SidecarFetch = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<SidecarHttpResponse>;

type SidecarClientDependencies = {
  environment?: Readonly<Record<string, string | undefined>>;
  readSession?: () => SessionFile | undefined;
  fetch?: SidecarFetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

type CallOutcome =
  | { kind: "answered"; status: number; result: JsonObject }
  | { kind: "malformed"; status: number }
  | { kind: "undelivered" }
  | { kind: "lost" };

const DEFAULT_ENDPOINT = "http://127.0.0.1:3210";
const RECONNECT_BACKOFF_MS = 1000;
const NOT_DELIVERED_CODES = new Set(["ECONNREFUSED", "ENOTFOUND"]);

const UNREACHABLE = { code: "SIDECAR_UNREACHABLE", message: "After Effects/extynt is not reachable (the sidecar did not answer). Retrying in this turn will not help: report what was already applied from earlier results and stop." };
const AUTH_REJECTED = { code: "AUTH_REJECTED", message: "The extynt sidecar rejected the bridge token (401/403). Retrying will not help: report what was already applied from earlier results and stop; the user must reconnect the session." };
const RESPONSE_LOST = { code: "SIDECAR_RESPONSE_LOST", message: "The request reached the extynt sidecar but its response was lost, so whether it was applied is unknown. Do not call the tool again yet: check the plan with ae_get_plan_status or ae_get_receipt (or ae_status for the newest work), and retry only if nothing was applied." };

const RESPONSE_INVALID = { code: "SIDECAR_RESPONSE_INVALID", message: "The extynt sidecar answered with a body that is not JSON, so whether the call was applied is unknown. Do not call the tool again yet: check the plan with ae_get_plan_status or ae_get_receipt (or ae_status for the newest work), and retry only if nothing was applied." };

const REJECTED_STATUSES = new Set([401, 403]);

async function bodyOf(response: Response): Promise<JsonValue | undefined> {
  const decoded = decodeJson(await response.text(), jsonValue);
  return decoded.ok ? decoded.value : undefined;
}

const hostFetch: SidecarFetch = async (url, init) => {
  const response = await globalThis.fetch(url, init);
  return { status: response.status, json: () => bodyOf(response) };
};

function endpointOf(environment: Readonly<Record<string, string | undefined>>, session: SessionFile | undefined): string {
  const discovered = session ? `http://127.0.0.1:${session.port}` : DEFAULT_ENDPOINT;
  return (environment.EXTYNT_ENDPOINT || discovered).replace(/\/+$/, "");
}

/** Reads the endpoint and token from the environment first, then from the pairing file. */
export function resolveSidecarConnection(dependencies: SidecarClientDependencies = {}): SidecarConnection {
  const environment = dependencies.environment ?? process.env;
  const session = (dependencies.readSession ?? readSessionFile)();
  return { endpoint: endpointOf(environment, session), token: environment.AE_BRIDGE_TOKEN || session?.token || "" };
}

async function performCall(name: string, args: JsonObject, dependencies: SidecarClientDependencies): Promise<CallOutcome> {
  const connection = resolveSidecarConnection(dependencies);
  const send = dependencies.fetch ?? hostFetch;
  const response = await send(`${connection.endpoint}/v1/mcp/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.token}`, "X-AE-Client": "agent", "X-AE-Client-Version": MCP_SERVER_VERSION },
    body: JSON.stringify({ name, arguments: args }),
  });
  const body = await response.json();
  if (body === undefined) return { kind: "malformed", status: response.status };
  return { kind: "answered", status: response.status, result: asObject(body) ?? {} };
}

function failure(reason: { code: string; message: string }): JsonObject {
  return { ok: false, error: { code: reason.code, message: reason.message } };
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

function isReadOnlyTool(name: string): boolean {
  return TOOL_DEFINITIONS.find((definition) => definition.name === name)?.annotations.readOnlyHint === true;
}

async function attemptCall(name: string, args: JsonObject, dependencies: SidecarClientDependencies): Promise<CallOutcome> {
  try {
    return await performCall(name, args, dependencies);
  } catch (error) {
    const cause = decode(errorCauseCode, error);
    return { kind: cause.ok && NOT_DELIVERED_CODES.has(cause.value) ? "undelivered" : "lost" };
  }
}

async function attemptWithRetry(name: string, args: JsonObject, dependencies: SidecarClientDependencies): Promise<CallOutcome> {
  const first = await attemptCall(name, args, dependencies);
  if (first.kind === "answered" || first.kind === "malformed" || (first.kind === "lost" && !isReadOnlyTool(name))) return first;
  await (dependencies.sleep ?? pause)(RECONNECT_BACKOFF_MS);
  return attemptCall(name, args, dependencies);
}

function resultOf(outcome: CallOutcome, name: string): JsonObject {
  if (outcome.kind === "malformed") return REJECTED_STATUSES.has(outcome.status) ? failure(AUTH_REJECTED) : failure(RESPONSE_INVALID);
  if (outcome.kind === "answered") return REJECTED_STATUSES.has(outcome.status) ? failure(AUTH_REJECTED) : outcome.result;
  return outcome.kind === "lost" && !isReadOnlyTool(name) ? failure(RESPONSE_LOST) : failure(UNREACHABLE);
}

/** Calls a tool on the sidecar. A 401 precedes any accepted mutation, so the session is re-resolved and the call retried once; a dead sidecar becomes a structured tool error, never a thrown one. */
export async function callSidecar(name: string, args: JsonObject, dependencies: SidecarClientDependencies = {}): Promise<JsonObject> {
  let outcome = await attemptWithRetry(name, args, dependencies);
  if (outcome.kind === "answered" && outcome.status === 401) outcome = await attemptWithRetry(name, args, dependencies);
  return resultOf(outcome, name);
}
