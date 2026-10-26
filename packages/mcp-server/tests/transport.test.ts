// Proves capture retrieval emits exactly one image block, and that the direct MCP proxy re-reads rotating sessions, retries only what is safe, and reports lost or unreachable sidecars as tool errors.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { callSidecar, resolveSidecarConnection } from "../src/sidecar-client.js";
import type { SidecarFetch } from "../src/sidecar-client.js";
import { toMcpToolResult } from "../src/transport.js";
import { objectAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { mcpViewData, sidecarError } from "./support/protocol-views.js";

const CAPTURE_PNG = "data:image/png;base64,aGVsbG8=";

function jsonResponse(status: number, body: JsonObject): { status: number; json: () => Promise<JsonObject> } {
  return { status, json: async () => body };
}

function captureResult(data: JsonObject): JsonObject {
  return { ok: true, tool: "ae_get_capture_frame", snapshotFingerprint: "snapshot", data };
}

interface FailingFetch {
  readonly fetch: SidecarFetch;
  readonly attempts: { count: number };
}

function failingFetch(cause: { message: string; code: string } | undefined): FailingFetch {
  const attempts = { count: 0 };
  const fetch: SidecarFetch = async () => {
    attempts.count += 1;
    throw Object.assign(new TypeError("fetch failed"), cause ? { cause: Object.assign(new Error(cause.message), { code: cause.code }) } : {});
  };
  return { fetch, attempts };
}

const RESET = { message: "socket hang up", code: "ECONNRESET" };

test("completed capture retrieval emits one image block and compact metadata without a data URL duplicate", () => {
  const output = toMcpToolResult(captureResult({ captureId: "frame-1", status: "completed", receipt: { dataUrl: CAPTURE_PNG, originalWidth: 1920, originalHeight: 1080, previewWidth: 1280, previewHeight: 720, resized: true, providerShared: false } }));
  assert.equal(output.content.length, 2);
  assert.deepEqual(output.content[1], { type: "image", data: "aGVsbG8=", mimeType: "image/png" });
  assert.equal("structuredContent" in output, false, "structuredContent-first clients would otherwise drop the image block");
  const receipt = objectAt(mcpViewData(output), "receipt");
  assert.equal(JSON.stringify(receipt).includes("data:image/png;base64,"), false);
  assert.equal(receipt?.automaticUpload, false);
  assert.equal(receipt?.modelVisibleOnRetrieval, true);
});

test("pending and failed capture retrieval stays compact and never emits image data", () => {
  const cases: JsonObject[] = [{ captureId: "pending", status: "queued", receipt: null }, { captureId: "failed", status: "failed", receipt: { error: { code: "CAPTURE_FAILED" } } }];
  for (const data of cases) {
    const output = toMcpToolResult(captureResult(data));
    assert.equal(output.content.length, 1);
    assert.equal(mcpViewData(output).status, data.status);
  }
});

test("direct MCP proxy re-reads the rotating session and retries an unauthorized call exactly once", async () => {
  const sessions = [{ port: 4101, token: "old-session-token" }, { port: 4102, token: "new-session-token" }];
  let sessionReads = 0;
  const calls: Array<{ url: string; authorization: string | undefined }> = [];
  const fetch: SidecarFetch = async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization });
    return calls.length === 1 ? jsonResponse(401, { ok: false, error: { code: "UNAUTHORIZED" } }) : jsonResponse(200, { ok: true, tool: "ae_status", data: { connected: true } });
  };
  const result = await callSidecar("ae_status", {}, { readSession: () => sessions[Math.min(sessionReads++, sessions.length - 1)], fetch });
  assert.deepEqual(result, { ok: true, tool: "ae_status", data: { connected: true } });
  assert.deepEqual(calls.map((call) => call.url), ["http://127.0.0.1:4101/v1/mcp/tools/call", "http://127.0.0.1:4102/v1/mcp/tools/call"]);
  assert.deepEqual(calls.map((call) => call.authorization), ["Bearer old-session-token", "Bearer new-session-token"]);
  assert.equal(sessionReads, 2);
});

test("direct MCP proxy never retries beyond its one fresh-session retry", async () => {
  let calls = 0;
  const fetch: SidecarFetch = async () => {
    calls += 1;
    return jsonResponse(401, { ok: false, error: { code: "UNAUTHORIZED" } });
  };
  const result = await callSidecar("ae_status", {}, { readSession: () => ({ port: 4103, token: "rotating-token" }), fetch });
  assert.equal(calls, 2);
  assert.equal(stringAt(sidecarError(result), "code"), "AUTH_REJECTED");
});

test("a 403 without an error envelope is an AUTH_REJECTED tool error and is not retried", async () => {
  let calls = 0;
  const fetch: SidecarFetch = async () => { calls += 1; return jsonResponse(403, { ok: false }); };
  const result = await callSidecar("ae_status", {}, { readSession: () => undefined, fetch });
  assert.equal(calls, 1);
  assert.equal(stringAt(sidecarError(result), "code"), "AUTH_REJECTED");
});

test("a mutating call whose response is lost is not replayed and reports SIDECAR_RESPONSE_LOST", async () => {
  for (const name of ["ae_propose_plan", "ae_undo_plan", "ae_approve_plan"]) {
    const { fetch, attempts } = failingFetch(RESET);
    const result = await callSidecar(name, { planId: "plan-1" }, { readSession: () => undefined, fetch, sleep: async () => {} });
    assert.equal(attempts.count, 1, `${name} must not be replayed after a lost response`);
    const error = sidecarError(result);
    assert.equal(error.code, "SIDECAR_RESPONSE_LOST");
    assert.match(stringAt(error, "message") ?? "", /ae_get_plan_status/);
  }
});

test("a read-only call whose response is lost is retried once", async () => {
  const { fetch, attempts } = failingFetch(RESET);
  const result = await callSidecar("ae_status", {}, { readSession: () => undefined, fetch, sleep: async () => {} });
  assert.equal(attempts.count, 2);
  assert.equal(sidecarError(result).code, "SIDECAR_UNREACHABLE");
});

test("a mutating call refused before it was sent (ECONNREFUSED) is retried once and reports SIDECAR_UNREACHABLE", async () => {
  const { fetch, attempts } = failingFetch({ message: "connect ECONNREFUSED", code: "ECONNREFUSED" });
  const result = await callSidecar("ae_propose_plan", {}, { readSession: () => undefined, fetch, sleep: async () => {} });
  assert.equal(attempts.count, 2);
  assert.equal(sidecarError(result).code, "SIDECAR_UNREACHABLE");
});

test("an unreachable sidecar is retried once after a backoff, then returns SIDECAR_UNREACHABLE", async () => {
  const { fetch, attempts } = failingFetch(undefined);
  const pauses: number[] = [];
  const result = await callSidecar("ae_status", {}, { readSession: () => undefined, fetch, sleep: async (ms) => { pauses.push(ms); } });
  assert.equal(attempts.count, 2);
  assert.equal(pauses.length, 1);
  assert.ok((pauses[0] ?? Infinity) <= 2000);
  const error = sidecarError(result);
  assert.equal(error.code, "SIDECAR_UNREACHABLE");
  assert.match(stringAt(error, "message") ?? "", /not reachable/);
  assert.equal(toMcpToolResult(result).isError, true);
});

test("a momentary sidecar restart is absorbed by the single retry", async () => {
  let calls = 0;
  const fetch: SidecarFetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return jsonResponse(200, { ok: true, tool: "ae_status", data: {} });
  };
  const result = await callSidecar("ae_status", {}, { readSession: () => undefined, fetch, sleep: async () => {} });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("explicit sidecar endpoint and token retain precedence over discovered sessions", () => {
  const resolved = resolveSidecarConnection({
    environment: { EXTYNT_ENDPOINT: "http://127.0.0.1:4999/", AE_BRIDGE_TOKEN: "operator-token" },
    readSession: () => ({ port: 4104, token: "session-token" }),
  });
  assert.deepEqual(resolved, { endpoint: "http://127.0.0.1:4999", token: "operator-token" });
});

async function callAgainstBody(status: number, body: string, name: string): Promise<JsonObject> {
  const server = createServer((_request, response) => { response.writeHead(status, { "Content-Type": "text/html" }); response.end(body); });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return await callSidecar(name, {}, { environment: { EXTYNT_ENDPOINT: `http://127.0.0.1:${port}`, AE_BRIDGE_TOKEN: "t" }, readSession: () => undefined, sleep: async () => {} });
  } finally {
    server.close();
  }
}

test("a sidecar body that is not JSON is a typed SIDECAR_RESPONSE_INVALID tool error, not a thrown one and not replayed", async () => {
  for (const name of ["ae_propose_plan", "ae_status"]) {
    const error = sidecarError(await callAgainstBody(200, "<html>proxy error</html>", name));
    assert.equal(error.code, "SIDECAR_RESPONSE_INVALID", name);
    assert.match(stringAt(error, "message") ?? "", /not JSON/);
  }
});

test("a 401 whose body is not JSON is still AUTH_REJECTED", async () => {
  assert.equal(sidecarError(await callAgainstBody(401, "denied", "ae_status")).code, "AUTH_REJECTED");
});
