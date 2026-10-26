/** Tests the native client's framing, round trips and errors. */
import assert from "node:assert/strict";
import test from "node:test";
import { isJsonObject } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { NativeClient, assertOk } from "../lib/client.ts";
import { textAt } from "../lib/json-access.ts";
import type { NativeResponse } from "../lib/wire.ts";
import { errorResponse, okResponse, startFakeServer } from "./fake-server.ts";
import type { FakeHandler, FakeServer } from "./fake-server.ts";

interface Connected {
  readonly server: FakeServer;
  readonly client: NativeClient;
  readonly done: () => Promise<void>;
}

function resultOf(response: NativeResponse): JsonObject {
  return isJsonObject(response.result) ? response.result : {};
}

function spikeError(code: string, extra: { readonly exitCode?: number; readonly message?: RegExp } = {}) {
  return { name: "SpikeError", code, ...extra };
}

async function connected(handler: FakeHandler, timeoutMs = 2000): Promise<Connected> {
  const server = await startFakeServer(handler);
  const client = new NativeClient({ port: server.port, token: "secret", timeoutMs });
  await client.connect();
  return { server, client, done: async () => { client.close(); await server.close(); } };
}

test("a request carries id, token, op and params and returns the response with a round trip time", async () => {
  const { server, client, done } = await connected((request) => okResponse(request, { pong: true }));
  const { response, rttMs } = await client.request("ping", { extra: 1 });
  assert.equal(response.ok, true);
  assert.deepEqual(response.result, { pong: true });
  assert.ok(rttMs >= 0);
  assert.deepEqual(server.requests[0], { id: "1", token: "secret", op: "ping", extra: 1 });
  await client.request("ping");
  assert.equal(server.requests[1]?.id, "2");
  await done();
});

test("a response split across several writes is reassembled", async () => {
  const body = `${JSON.stringify({ ok: true, id: "1", op: "ping", result: { text: "x".repeat(5000) }, timing: {} })}\n`;
  const chunks = [body.slice(0, 7), body.slice(7, 3000), body.slice(3000)];
  const { client, done } = await connected(() => ({ chunks }));
  const { response } = await client.request("ping");
  assert.equal(textAt(resultOf(response), "text")?.length, 5000);
  await done();
});

test("a multi-megabyte response line arrives intact", async () => {
  const big = "y".repeat(3_000_000);
  const { client, done } = await connected((request) => okResponse(request, { big }));
  const { response } = await client.request("read_project");
  assert.equal(textAt(resultOf(response), "big")?.length, big.length);
  await done();
});

test("an error response is returned by request and thrown by call", async () => {
  const { client, done } = await connected((request) => errorResponse(request, "COMP_NOT_FOUND", "no such comp"));
  const { response } = await client.request("read_comp", { compId: "1" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "COMP_NOT_FOUND");
  await assert.rejects(client.call("read_comp"), spikeError("COMP_NOT_FOUND", { exitCode: 1 }));
  await done();
});

test("UNAUTHORIZED explains that the discovery file is stale", async () => {
  const { client, done } = await connected((request) => errorResponse(request, "UNAUTHORIZED", "bad token"));
  await assert.rejects(client.call("ping"), spikeError("UNAUTHORIZED", { exitCode: 2, message: /stale/ }));
  await done();
});

test("a silent plugin produces a TIMEOUT error that names --timeout-ms", async () => {
  const { client, done } = await connected(() => ({ raw: "" }), 80);
  await assert.rejects(client.request("ping"), spikeError("TIMEOUT", { message: /--timeout-ms/ }));
  await done();
});

test("a plugin hanging up mid-request is a CONNECTION_CLOSED error", async () => {
  const { client, done } = await connected(() => ({ close: true }));
  await assert.rejects(client.request("ping"), spikeError("CONNECTION_CLOSED"));
  await done();
});

test("garbage instead of JSON is a PROTOCOL error and a mismatched id is rejected", async () => {
  const garbage = await connected(() => ({ raw: "not json\n" }));
  await assert.rejects(garbage.client.request("ping"), spikeError("PROTOCOL"));
  await garbage.done();
  const wrongId = await connected((request) => okResponse({ ...request, id: "999" }));
  await assert.rejects(wrongId.client.request("ping"), spikeError("PROTOCOL", { message: /999/ }));
  await wrongId.done();
});

test("an error response without an id (a too-large line) reaches the caller as its own error, an ok one does not", async () => {
  const refused = await connected(() => ({ ok: false, id: "", op: "", error: { code: "REQUEST_TOO_LARGE", message: "request line exceeds 16 MiB" } }));
  await assert.rejects(refused.client.call("ping"), spikeError("REQUEST_TOO_LARGE"));
  await refused.done();
  const idless = await connected(() => ({ ok: true, id: "", op: "ping", result: {}, timing: {} }));
  await assert.rejects(idless.client.request("ping"), spikeError("PROTOCOL"));
  await idless.done();
});

test("only one request may be in flight per connection", async () => {
  const { client, done } = await connected((request) => ({ delayMs: 40, response: okResponse(request) }));
  const first = client.request("ping");
  await assert.rejects(client.request("ping"), spikeError("CLIENT_STATE"));
  await first;
  await done();
});

test("connecting to a closed port is CONNECT_FAILED with a stale-file hint", async () => {
  const server = await startFakeServer(() => ({}));
  const port = server.port;
  await server.close();
  const client = new NativeClient({ port, token: "t" });
  await assert.rejects(client.connect(), spikeError("CONNECT_FAILED", { message: /refused.*stale/s }));
});

test("assertOk passes ok responses and names the failing op otherwise", () => {
  assertOk({ ok: true }, "ping");
  assert.throws(() => assertOk({ ok: false, error: { code: "BAD", message: "m" } }, "hash_project"), /hash_project/);
});
