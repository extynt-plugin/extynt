/** The HTTP surface of a running sidecar as the harness uses it, shared by the spawned and the in-process sidecar. */
import { decode, decodeJson, number, object, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { wireObject } from "@extynt/fake-plugin";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { chatBodyOf, type ChatResponse } from "./chat-wire.js";
import { lenient } from "./lenient.js";
import { stringList } from "./string-list.js";
import type { WireObject } from "./wire-types.js";

interface HostStamp { epoch: number; revision: number }

interface CatalogueProgress { state?: string | undefined; pending?: number | undefined; engineHosts?: number | undefined }

/** The running turn, as `/v1/chat/progress` reports it. */
export interface ChatProgress {
  requestId?: string | undefined;
  step?: number | undefined;
  maxSteps?: number | undefined;
  phase?: string | undefined;
  label?: string | undefined;
  notes?: string[] | undefined;
}

/** One chat request body. */
export interface ChatRequest {
  requestId: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  autoApply?: boolean;
}

/** A sidecar a scenario can be run against. */
export interface SidecarHandle {
  port: number;
  token: string;
  isolatedHome: string;
  seeded: string[];
  profileSource: string;
  logLines: WireObject[];
  publishSnapshot(probe: WireObject): Promise<{ status: number; body: WireObject }>;
  chat(body: ChatRequest): Promise<ChatResponse>;
  progress(): Promise<ChatProgress | null>;
  catalogue(): Promise<CatalogueProgress | null>;
  latestStamp(): Promise<HostStamp | null>;
  patchPrefs(patch: WireObject): Promise<void>;
  callTool(name: string, args?: WireObject): Promise<WireObject>;
  stop(): Promise<void>;
}

type SidecarClient = Pick<SidecarHandle, "publishSnapshot" | "progress" | "catalogue" | "latestStamp" | "patchPrefs" | "callTool">;

const stampBody = object({ snapshot: lenient(object({ result: lenient(object({ hostStamp: lenient(object({ epoch: number(), revision: number() })) })) })) });
const healthBody = object({ catalogue: lenient(object({ state: lenient(string()), pending: lenient(number()), engineHosts: lenient(number()) })) });
const progressBody = object({
  progress: lenient(
    object({
      requestId: lenient(string()),
      step: lenient(number()),
      maxSteps: lenient(number()),
      phase: lenient(string()),
      label: lenient(string()),
      notes: lenient(stringList),
    }),
  ),
});

async function readBody<T>(response: Response, decoder: Decoder<T>): Promise<T | undefined> {
  try {
    const decoded = decode(decoder, await response.json());
    return decoded.ok ? decoded.value : undefined;
  } catch {
    return undefined;
  }
}

async function wireBody(response: Response): Promise<WireObject> {
  return (await readBody(response, wireObject)) ?? {};
}

function authorizedHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** A client for the sidecar listening on `port` and guarded by `token`. */
export function sidecarClient(port: number, token: string): SidecarClient {
  const base = `http://127.0.0.1:${port}`, headers = authorizedHeaders(token);
  const post = (path: string, method: string, body: WireObject): Promise<Response> => fetch(`${base}${path}`, { method, headers, body: JSON.stringify(body) });
  return {
    async publishSnapshot(probe) {
      const response = await post("/v1/snapshots", "POST", probe);
      return { status: response.status, body: await wireBody(response) };
    },
    async progress() {
      return (await readBody(await fetch(`${base}/v1/chat/progress`, { headers }), progressBody))?.progress ?? null;
    },
    async catalogue() {
      const response = await fetch(`${base}/health`, { headers });
      return response.ok ? (await readBody(response, healthBody))?.catalogue ?? null : null;
    },
    async latestStamp() {
      const response = await fetch(`${base}/v1/snapshots/latest`, { headers });
      return response.ok ? (await readBody(response, stampBody))?.snapshot?.result?.hostStamp ?? null : null;
    },
    async patchPrefs(patch) {
      const response = await post("/v1/ui/prefs", "PATCH", patch);
      if (!response.ok) throw new Error(`The sidecar refused the preference change: HTTP ${response.status}`);
    },
    async callTool(name, args = {}) {
      return wireBody(await post("/v1/mcp/tools/call", "POST", { name, arguments: args }));
    },
  };
}

/**
 * A chat POST that applies no client-side response deadline. Node's `fetch` (undici) destroys the
 * socket at its 300-second headersTimeout while the sidecar is still running a long turn, so
 * a turn is bounded by the harness's own timer instead.
 */
export function postChat(port: number, token: string, body: WireObject): Promise<ChatResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${port}/v1/chat`, { method: "POST", headers: authorizedHeaders(token) }, (response: IncomingMessage) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { text += chunk; });
      response.on("end", () => {
        const decoded = decodeJson(text, chatBodyOf);
        resolve({ status: response.statusCode ?? 0, body: decoded.ok ? decoded.value : {} });
      });
    });
    request.on("error", reject);
    request.setTimeout(0);
    request.end(JSON.stringify(body));
  });
}
